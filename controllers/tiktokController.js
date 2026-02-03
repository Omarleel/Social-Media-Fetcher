const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { downloadFile } = require('../services/downloadService');
const path = require('path');
const { mapLimit } = require('../utils/utils');
puppeteer.use(StealthPlugin());

const getAllVideos = async (req, res) => {
    const { username, limit } = req.query;
    const cleanUsername = username.replace('@', '');
    const maxItems = limit ? parseInt(limit) : null;
    
    const userFolder = path.join(process.env.DIR_STORAGE, 'tiktok', cleanUsername);
    let browser;
    let author = null;
    let allMediaTasks = [];
    
    try {
        browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
        const page = await browser.newPage();
        const videoListMap = new Map();
        let keepScrolling = true;

        page.on('response', async (response) => {
            if (response.url().includes('/api/post/item_list/')) {
                const data = await response.json().catch(() => ({}));
                
                if (!author && data.itemList?.[0]?.author) {
                    author = data.itemList[0].author;
                    allMediaTasks.push({ 
                        url: author.avatarLarger, 
                        id: 'profile_picture', 
                        ext: 'jpg' 
                    });
                }

                if (data.hasOwnProperty('hasMore')) keepScrolling = data.hasMore;

                const currentLimit = maxItems ? (maxItems - allMediaTasks.length) : Infinity;

                data.itemList?.forEach(item => {
                    if (videoListMap.size < currentLimit) {
                        videoListMap.set(item.id, item.video?.bitrateInfo?.[0]?.PlayAddr?.UrlList?.[0] || item.video?.downloadAddr);
                    }
                });
            }
        });

        await page.goto(`https://www.tiktok.com/@${cleanUsername}`, { waitUntil: 'networkidle2' });

        while (keepScrolling) {
            const totalCollected = allMediaTasks.length + videoListMap.size;
            if (maxItems && totalCollected >= maxItems) break;

            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            await new Promise(r => setTimeout(r, 3000));
            
            const isBottom = await page.evaluate(() => (window.innerHeight + window.scrollY) >= document.body.offsetHeight);
            if (isBottom) break;
        }

        const cookies = (await page.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
        const userAgent = await page.evaluate(() => navigator.userAgent);
        
        const videoTasks = Array.from(videoListMap).map(([id, url]) => ({ id, url, ext: 'mp4' }));
        allMediaTasks = [...allMediaTasks, ...videoTasks];

        const finalTasks = maxItems ? allMediaTasks.slice(0, maxItems) : allMediaTasks;

        const results = await mapLimit(finalTasks, process.env.THREADS_DOWNLOAD || 5, async (item) => {
            const subFolder = item.ext === 'mp4' ? 'videos' : 'images';
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
            nickname: author?.nickname || cleanUsername,
            user_id: author?.id, 
            username: cleanUsername, 
            total_requested: maxItems,
            total_proccessed: finalTasks.length, 
            results 
        });

    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ error: error.message });
    }
};

module.exports = { getAllVideos };