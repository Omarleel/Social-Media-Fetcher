const { downloadFile } = require('../services/downloadService');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { mapLimit } = require('../utils/utils');
const { removeSidebar } = require('../utils/utilsInstagram');
const Profile = require('../models/Profile');
puppeteer.use(StealthPlugin());

const getAllMedia = async (req, res) => {
    const { username, limit, mediaType, method = 'normal' } = req.query;
    const maxItems = limit ? parseInt(limit) : null;
    const userFolder = path.join(process.env.DIR_STORAGE, 'instagram', username);

    let allowedTypes = [];
    if (!mediaType || mediaType === 'null' || mediaType === 'undefined') {
        allowedTypes = ['posts', 'highlights', 'stories'];
    } else {
        allowedTypes = String(mediaType)
            .replace(/[\[\]"']/g, '')
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(Boolean);
    }

    let browser;
    const seenIds = new Set();
    let userProfile = null;
    
    const downloadResults = [];
    const pendingDownloads = [];
    let allMediaTasks = [];

    try {
        browser = await puppeteer.launch({
            headless: 'shell',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        const userAgent = await page.evaluate(() => navigator.userAgent);

        const cookieArray = [
            {
                name: 'sessionid',
                value: process.env.INSTA_SESSIONID,
                domain: '.instagram.com',
                path: '/',
                secure: true,
                httpOnly: true
            },
            {
                name: 'csrftoken',
                value: process.env.INSTA_CSRF_TOKEN,
                domain: '.instagram.com',
                path: '/',
                secure: true
            }
        ];
        await page.setCookie(...cookieArray);

        const handleMediaFound = (item) => {
            if (method === 'normal') {
                const downloadPromise = (async () => {
                    try {
                        const currentCookies = (await page.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
                        const subFolder = item.ext === 'mp4' ? 'videos' : 'images';
                        const finalPath = path.join(userFolder, item.dest, subFolder);
                        const result = await downloadFile(item.url, finalPath, `${item.id}.${item.ext}`, {
                            'User-Agent': userAgent,
                            'Cookie': currentCookies,
                            'Referer': 'https://www.instagram.com/'
                        });
                        downloadResults.push(result);
                    } catch (err) {
                        downloadResults.push({ id: item.id, status: false, error: err.message });
                    }
                })();
                pendingDownloads.push(downloadPromise);
            } else {
                allMediaTasks.push(item);
            }
        };

        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('/graphql/query') || url.includes('/api/v1/')) {
                const data = await response.json().catch(() => ({}));

                const isStoryResponse = url.includes('xdt_api__v1__feed__timeline__connection') ||
                    !!data.data?.xdt_api__v1__feed__timeline__connection ||
                    !!data.data?.xdt_api__v1__feed__reels_media;

                const isHighlightResponse = url.includes('PolarisStoriesV3HighlightsPageQuery') ||
                    !!data.data?.xdt_api__v1__feed__reels_media__connection;

                let typeLabel = 'posts';
                if (isHighlightResponse) typeLabel = 'highlights';
                else if (isStoryResponse) typeLabel = 'stories';

                if (!allowedTypes.includes(typeLabel)) return;

                const connection =
                    data.data?.xdt_api__v1__feed__timeline__connection ||
                    data.data?.xdt_api__v1__feed__reels_media?.reels_media?.[0] ||
                    data.data?.xdt_api__v1__feed__reels_media__connection ||
                    data.data?.xdt_api__v1__feed__user_timeline_graphql_connection ||
                    data.data?.user?.edge_owner_to_timeline_media;

                const edges = connection?.edges || connection?.items || data.items || [];

                for (const edge of edges) {
                    if (maxItems !== null && seenIds.size >= maxItems) break;

                    const node = edge.node?.media || edge.node || edge;

                    if (!userProfile && node.user?.hd_profile_pic_url_info?.url && typeLabel === 'posts') {
                        userProfile = new Profile({
                            id: node.user.id,
                            nickname: node.user.full_name || username,
                            username: node.user.username,
                            picture: node.user.hd_profile_pic_url_info.url,
                            url: `https://www.instagram.com/${node.user.username}`
                        });
                        
                        handleMediaFound({ 
                            url: userProfile.picture, 
                            id: 'profile_picture', 
                            ext: 'jpg', 
                            dest: typeLabel 
                        });
                    }

                    const nodeUsername = node.user?.username || node.owner?.username;
                    if (nodeUsername && nodeUsername.toLowerCase() !== username.toLowerCase()) continue;

                    const items = node.items || node.carousel_media || [node];

                    for (const m of items) {
                        const mediaId = m.pk || m.id;
                        if (mediaId && !seenIds.has(mediaId)) {
                            if (maxItems !== null && seenIds.size >= maxItems) break;

                            const videoUrl = m.video_versions?.[0]?.url;
                            const imageUrl = m.image_versions2?.candidates?.[0]?.url || m.display_uri || m.display_url;
                            const finalUrl = videoUrl || imageUrl;

                            if (finalUrl) {
                                seenIds.add(mediaId);
                                handleMediaFound({
                                    url: finalUrl,
                                    id: mediaId,
                                    ext: (videoUrl || m.media_type === 2) ? 'mp4' : 'jpg',
                                    dest: typeLabel
                                });
                            }
                        }
                    }
                }
            }
        });

        if (allowedTypes.includes('stories')) {
            await page.goto(`https://www.instagram.com/stories/${username}/`, { waitUntil: 'networkidle2' });

            const storyData = await page.evaluate((targetUser) => {
                function findKeyRecursive(obj, key) {
                    if (obj && typeof obj === 'object') {
                        if (obj.hasOwnProperty(key)) return obj[key];
                        for (let k in obj) {
                            let found = findKeyRecursive(obj[k], key);
                            if (found) return found;
                        }
                    }
                    return null;
                }

                const scripts = Array.from(document.querySelectorAll('script[data-sjs]'));
                for (const script of scripts) {
                    try {
                        const json = JSON.parse(script.textContent);
                        const result = findKeyRecursive(json, 'xdt_api__v1__feed__reels_media');
                        if (result && result.reels_media) {
                            const userReel = result.reels_media.find(reel =>
                                reel.user?.username?.toLowerCase() === targetUser.toLowerCase() ||
                                reel.owner?.username?.toLowerCase() === targetUser.toLowerCase()
                            );
                            return userReel ? userReel.items : null;
                        }
                    } catch (e) { continue; }
                }
                return null;
            }, username);

            if (storyData && storyData.length > 0) {
                for (const item of storyData) {
                    const mediaId = item.pk || item.id;
                    if (mediaId && !seenIds.has(mediaId)) {
                        const videoUrl = item.video_versions?.[0]?.url;
                        const imageUrl = item.image_versions2?.candidates?.[0]?.url;
                        const finalUrl = videoUrl || imageUrl;
                        if (finalUrl) {
                            seenIds.add(mediaId);
                            handleMediaFound({
                                url: finalUrl,
                                id: mediaId,
                                ext: videoUrl ? 'mp4' : 'jpg',
                                dest: 'stories'
                            });
                        }
                    }
                }
            }
        }

        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle2' });
        await removeSidebar(page);

        if (allowedTypes.includes('highlights') && (maxItems === null || seenIds.size < maxItems)) {
            const highlightSelector = 'header canvas[style*="position: absolute"], div[role="menu"] canvas[style*="position: absolute"]';
            const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, highlightSelector);

            for (let i = 0; i < count; i++) {
                if (maxItems !== null && seenIds.size >= maxItems) break;
                try {
                    const highlights = await page.$$(highlightSelector);
                    if (highlights[i]) {
                        await highlights[i].click();
                        await new Promise(r => setTimeout(r, 4000));
                        const closeButton = await page.waitForSelector('svg[aria-label="Cerrar"], svg[aria-label="Close"]', { timeout: 3000 }).catch(() => null);
                        if (closeButton) await closeButton.click();
                    }
                } catch (err) { continue; }
            }
        }

        if (allowedTypes.includes('posts') && (maxItems === null || seenIds.size < maxItems)) {
            let lastHeight = await page.evaluate('document.body.scrollHeight');
            let scrollRetries = 0;
            while ((maxItems === null || seenIds.size < maxItems) && scrollRetries < 3) {
                await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
                await new Promise(r => setTimeout(r, 3000));
                let newHeight = await page.evaluate('document.body.scrollHeight');
                if (newHeight === lastHeight) scrollRetries++;
                else { scrollRetries = 0; lastHeight = newHeight; }
            }
        }

        let finalDownloads = [];

        if (method === 'normal') {
            await Promise.all(pendingDownloads);
            finalDownloads = downloadResults;
        } else {
            const finalCookies = (await page.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
            const tasksToProcess = maxItems !== null ? allMediaTasks.slice(0, maxItems) : allMediaTasks;
            finalDownloads = await mapLimit(tasksToProcess, process.env.THREADS_DOWNLOAD || 5, async (item) => {
                const subFolder = item.ext === 'mp4' ? 'videos' : 'images';
                const finalPath = path.join(userFolder, item.dest, subFolder);
                return await downloadFile(item.url, finalPath, `${item.id}.${item.ext}`, {
                    'User-Agent': userAgent,
                    'Cookie': finalCookies,
                    'Referer': 'https://www.instagram.com/'
                });
            });
        }

        await browser.close();
        res.json({
            status: true,
            nickname: userProfile ? userProfile.nickname : username,
            user_id: userProfile ? userProfile.id : null,
            username: userProfile ? userProfile.username : username,
            profile_url: userProfile ? userProfile.url : `https://www.instagram.com/${username}`,
            total_requested: maxItems,
            total_proccessed: method === 'normal' ? seenIds.size : finalDownloads.length,
            downloads: finalDownloads
        });

    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ error: error.message });
    }
};

module.exports = { getAllMedia };