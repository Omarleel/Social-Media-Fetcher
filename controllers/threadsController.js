const { downloadFile } = require('../services/downloadService');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { mapLimit, moveMouseInCircle } = require('../utils/utils');
const { extractMediaFromJson, extractSpoilersFromHTML, extractProfilePictureFromMeta } = require('../utils/utilsThreads');
const Profile = require('../models/Profile');
puppeteer.use(StealthPlugin());

const getAllMedia = async (req, res) => {
    const { username, limit, method = 'normal' } = req.query;
     const cleanUsername = username.replace('@', '');
    const maxItems = limit ? parseInt(limit, 10) : null;
    const userFolder = path.join(process.env.DIR_STORAGE, 'threads', cleanUsername);

    let browser, userProfile = null;
    const seenIds = new Set(), finalDownloads = [], allTasks = [], pending = [];

    let resolveScroll;
    let scrollPromise;

    let itemsBeforeScroll = 0;
    let stagnationRetries = 0; 
    const MAX_STAGNATION = 3;

    const processDownload = async (item, cookies, ua) => {
        try {
            const sub = item.ext === 'mp4' ? 'videos' : 'images';
            const dest = path.join(userFolder, item.dest || 'posts', sub);
            const r = await downloadFile(item.url, dest, `${item.id}.${item.ext}`, {
                'User-Agent': ua, Cookie: cookies, Referer: 'https://www.threads.com/'
            });
            finalDownloads.push(r);
        } catch (e) {
            finalDownloads.push({ id: item.id, status: false, error: e.message });
        }
    };

    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        // await injectVisualCursor(page);
        const ua = await page.evaluate(() => navigator.userAgent);

        await page.setCookie(
            { name: 'sessionid', value: process.env.THREADS_SESSIONID, domain: '.threads.com' },
            { name: 'csrftoken', value: process.env.THREADS_CSRF_TOKEN, domain: '.threads.com' }
        );

        const handleMedias = (medias) => {
            let foundNew = false;
            for (const m of medias) {
                if ((maxItems && seenIds.size >= maxItems) || seenIds.has(m.id)) continue;
                seenIds.add(m.id);
                foundNew = true;

                if (method === 'normal') {
                    pending.push(page.cookies().then(c =>
                        processDownload(m, c.map(x => `${x.name}=${x.value}`).join('; '), ua)
                    ));
                } else allTasks.push(m);
            }
            return foundNew;
        };

        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('/graphql/query') || url.includes('/api/v1/')) {
                const data = await response.json().catch(() => null);
                if (data) {
                    const { medias, user } = extractMediaFromJson(data);
                    if (!userProfile && user) {
                        userProfile = new Profile({
                            id: user.id,
                            nickname: user.full_name,
                            username: user.username,
                            picture:  user.profile_pic_url || '',
                            url: `https://www.threads.net/@${cleanUsername}`
                        });
                    }
                    const hasNewItems = handleMedias(medias);

                    if (hasNewItems && resolveScroll) {
                        setTimeout(() => {
                            resolveScroll(true);
                        }, 500);
                    }
                }
            }
        });

        await page.goto(`https://www.threads.com/@${cleanUsername}/media`, { waitUntil: 'networkidle2' });

        
        handleMedias([await extractProfilePictureFromMeta(page)].filter(Boolean));

        const scanSJS = async () => {
            for (const s of await extractSpoilersFromHTML(page)) {
                handleMedias(extractMediaFromJson(s).medias);
            }
        };
        await scanSJS();

        let lastH = 0;
        let scrollRetries = 0;

        while ((!maxItems || seenIds.size < maxItems) && scrollRetries < 5) {
            itemsBeforeScroll = seenIds.size;
            await moveMouseInCircle(page);
            scrollPromise = new Promise((resolve) => { resolveScroll = resolve; });

            const curH = await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
                return document.body.scrollHeight;
            });

            if (curH === lastH) {
                scrollRetries++;
                await new Promise(r => setTimeout(r, 2000));
            } else {
                scrollRetries = 0;
                lastH = curH;
                await Promise.race([
                    scrollPromise,
                    new Promise(r => setTimeout(r, 5000))
                ]);
            }
            if (seenIds.size === itemsBeforeScroll) {
                stagnationRetries++;
                console.log(`[!] Sin contenido nuevo detectado (${stagnationRetries}/${MAX_STAGNATION})`);
                if (stagnationRetries >= MAX_STAGNATION) {
                    console.log("[->] Límite de scroll alcanzado o bloqueo de sesión. Finalizando...");
                    break; 
                }
            } else {
                stagnationRetries = 0;
            }
            await scanSJS();
        }

        if (method === 'normal') await Promise.all(pending);
        else {
            const cookies = (await page.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
            await mapLimit(allTasks.slice(0, maxItems || allTasks.length), process.env.THREADS_DOWNLOAD || 5, t => processDownload(t, cookies, ua));
        }

        await browser.close();
        res.json({
            status: true,
            nickname: userProfile ? userProfile.nickname : cleanUsername,
            user_id: userProfile ? userProfile.id : null,
            username: userProfile ? userProfile.username : cleanUsername,
            profile_url: userProfile ? userProfile.url : `https://www.threads.net/@${cleanUsername}`,
            total_requested: maxItems,
            total_requested: maxItems,
            total_proccessed: method === 'normal' ? seenIds.size : finalDownloads.length,
            downloads: finalDownloads
        });

    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ status: false, error: error.message });
    }
};
module.exports = { getAllMedia };
