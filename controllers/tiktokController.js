const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { downloadFile } = require('../services/downloadService');
const path = require('path');
const { mapLimit, moveMouseInCircle } = require('../utils/utils');
const Profile = require('../models/profile');
puppeteer.use(StealthPlugin());

const getAllMedia = async (req, res) => {
    const { username, limit } = req.query;
    const cleanUsername = username.replace('@', '');
    const maxItems = limit ? parseInt(limit) : null;

    const userFolder = path.join(process.env.DIR_STORAGE, 'tiktok', cleanUsername);
    let browser;
    let userProfile = null;
    let allMediaTasks = [];

    try {
        browser = await puppeteer.launch({
            headless: 'new', args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--start-maximized'
            ]
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        const mediaMap = new Map();
        let keepScrolling = true;

        page.on('response', async (response) => {
            if (response.url().includes('/api/post/item_list/')) {
                const data = await response.json().catch(() => ({}));
                if (!userProfile && data.itemList?.[0]?.author) {
                    const author = data.itemList[0].author;
                    userProfile = new Profile({
                        id: author.id,
                        nickname: author.nickname || cleanUsername,
                        username: author.uniqueId || cleanUsername,
                        picture: author.avatarLarger || author.avatarThumb || '',
                        url: `https://www.tiktok.com/@${cleanUsername}`
                    });

                    if (userProfile.picture) {
                        allMediaTasks.push({
                            id: 'profile_picture',
                            url: userProfile.picture,
                            ext: 'jpg',
                            type: 'image'
                        });
                    }   
                }
                if (data.hasOwnProperty('hasMore')) keepScrolling = data.hasMore;

                const currentLimit = maxItems ? (maxItems - allMediaTasks.length) : Infinity;

                data.itemList?.forEach(item => {
                    if (mediaMap.size < currentLimit) {
                        const url = item.video?.bitrateInfo?.[0]?.PlayAddr?.UrlList?.[0] || item.video?.downloadAddr;
                        if (url) {
                            mediaMap.set(item.id, { url, type: 'post' });
                        }
                    }
                });
            }
            else if (response.url().includes('/api/story/item_list/')) {
                const data = await response.json().catch(() => ({}));
              
                if (data.hasOwnProperty('hasMore')) keepScrolling = data.hasMore;

                const currentLimit = maxItems ? (maxItems - allMediaTasks.length) : Infinity;

                data.itemList?.forEach(item => {
                    if (mediaMap.size < currentLimit) {
                        const url = item.video?.bitrateInfo?.[0]?.PlayAddr?.UrlList?.[0] || item.video?.downloadAddr;
                        if (url) {
                            mediaMap.set(item.id, { url, type: 'story' });
                        }
                    }
                });
            }
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');

        await page.goto(`https://www.tiktok.com/@${cleanUsername}`, { waitUntil: 'networkidle2' });

        let lastHeight = await page.evaluate(() => document.body.scrollHeight);
        let stalledCycles = 0;

        while (keepScrolling) {
            const currentSize = mediaMap.size;
            const totalCollected = allMediaTasks.length + currentSize;

            if (maxItems && totalCollected >= maxItems) break;
            await moveMouseInCircle(page);
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

            try {
                await page.waitForFunction(
                    (prevHeight) => {
                        const isEnd = !!document.querySelector('[data-e2e="user-post-item-list-no-more"]');
                        return document.body.scrollHeight > prevHeight || isEnd;
                    },
                    { timeout: 5000 },
                    lastHeight
                );
            } catch (e) {
                console.log("[DEBUG] Tiempo de espera de carga agotado, verificando...");
            }

            let newHeight = await page.evaluate(() => document.body.scrollHeight);

            if (newHeight === lastHeight) {
                stalledCycles++;
                await page.evaluate(() => window.scrollBy(0, -200));
                await new Promise(r => setTimeout(r, 500));
                await page.evaluate(() => window.scrollBy(0, 400));

                if (stalledCycles >= 3) {
                    console.log("[DEBUG] El contenido dejó de crecer. Terminando scroll.");
                    break;
                }
            } else {
                stalledCycles = 0;
                lastHeight = newHeight;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        const cookies = (await page.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
        const userAgent = await page.evaluate(() => navigator.userAgent);

        const videoTasks = Array.from(mediaMap).map(([id, data]) => ({ 
            id, 
            url: data.url, 
            type: data.type, 
            ext: 'mp4' 
        }));
        allMediaTasks = [...allMediaTasks, ...videoTasks];

        const finalTasks = maxItems ? allMediaTasks.slice(0, maxItems) : allMediaTasks;

        const results = await mapLimit(finalTasks, process.env.THREADS_DOWNLOAD || 5, async (item) => {
            let subFolder = 'images';
            if (item.type === 'post') {
                subFolder = 'posts';
            } else if (item.type === 'story') {
                subFolder = 'stories';
            }

            const finalPath = path.join(userFolder, subFolder);

            return await downloadFile(item.url, finalPath, `${item.id}.${item.ext}`, {
                'User-Agent': userAgent,
                'Cookie': cookies,
                'Referer': 'https://www.tiktok.com/'
            });
        });

        await browser.close();

        res.json({
            status: true,
            profile: userProfile,
            total_requested: maxItems,
            total_proccessed: finalTasks.length,
            results
        });

    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ error: error.message });
    }
};

module.exports = { getAllMedia };