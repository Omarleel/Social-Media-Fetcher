const { downloadFile } = require('../services/downloadService');
const path = require('path');
const { mapLimit } = require('../utils/utils');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// const getAllMedia = async (req, res) => {
//     const { username, limit } = req.query;
//     const maxItems = limit ? parseInt(limit) : null;

//     const userFolder = path.join(process.env.DIR_STORAGE, 'instagram', username);

//     const INSTA_HEADERS = {
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
//         'X-Ig-App-Id': '936619743392459',
//         'X-Csrftoken': process.env.INSTA_CSRF_TOKEN,
//         'Cookie': process.env.INSTA_COOKIE,
//         'Content-Type': 'application/x-www-form-urlencoded'
//     };

//     let hasNextPage = true;
//     let afterCursor = null;
//     let allMediaTasks = [];

//     try {
//         let userInfo = null;

//         while (hasNextPage) {
//             if (maxItems && allMediaTasks.length >= maxItems) break;

//             const variables = JSON.stringify({
//                 data: {
//                     count: 50,
//                     include_reel_media_seen_timestamp: true,
//                     after: afterCursor
//                 },
//                 username: username
//             });

//             const body = new URLSearchParams({
//                 variables: variables,
//                 doc_id: '34579740524958711'
//             });

//             const response = await fetch('https://www.instagram.com/graphql/query', {
//                 method: 'POST',
//                 headers: INSTA_HEADERS,
//                 body: body
//             });

//             const result = await response.json();
//             const connection = result.data?.xdt_api__v1__feed__user_timeline_graphql_connection;
//             const edges = connection?.edges || [];
//             const pageInfo = connection?.page_info;

//             edges.forEach(({ node }) => {
//                 if (maxItems && allMediaTasks.length >= maxItems) return;

//                 if (!userInfo) {
//                     userInfo = node.user;
//                     const profilePicture = userInfo.hd_profile_pic_url_info.url;
//                     allMediaTasks.push({ url: profilePicture, id: 'profile_picture', ext: 'jpg' });
//                 }

//                 if (node.carousel_media) {
//                     node.carousel_media.forEach(m => {
//                         if (maxItems && allMediaTasks.length >= maxItems) return;
//                         const url = m.video_versions?.[0]?.url || m.image_versions2?.candidates?.[0]?.url;
//                         if (url) allMediaTasks.push({ url, id: m.id, ext: url.includes('.mp4') ? 'mp4' : 'jpg' });
//                     });
//                 } else {
//                     const url = node.video_versions?.[0]?.url || node.image_versions2?.candidates?.[0]?.url;
//                     if (url) allMediaTasks.push({ url, id: node.id, ext: url.includes('.mp4') ? 'mp4' : 'jpg' });
//                 }
//             });

//             hasNextPage = pageInfo?.has_next_page || false;
//             afterCursor = pageInfo?.end_cursor || null;

//             console.log(`[Instagram] Acumulados: ${allMediaTasks.length}. Limit: ${maxItems || 'Sin límite'}`);

//             if (hasNextPage) {
//                 await new Promise(r => setTimeout(r, 1000));
//             }
//         }

//         const finalTasks = maxItems ? allMediaTasks.slice(0, maxItems) : allMediaTasks;
//         const downloadResults = await mapLimit(finalTasks, process.env.THREADS_DOWNLOAD, async (item) => {
//             const subFolder = item.ext === 'mp4' ? 'videos' : 'images';
//             const finalPath = path.join(userFolder, subFolder);

//             return await downloadFile(item.url, finalPath, `${item.id}.${item.ext}`, {
//                 'User-Agent': INSTA_HEADERS['User-Agent'],
//                 'Cookie': INSTA_HEADERS['Cookie']
//             });
//         });

//         res.json({
//             status: true,
//             nickname: userInfo?.full_name || username,
//             user_id: userInfo?.id,
//             username,
//             total_requested: maxItems,
//             total_proccessed: finalTasks.length,
//             downloads: downloadResults
//         });

//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// };

const getAllMediaPuppeteer = async (req, res) => {
    const { username, limit, mediaType } = req.query;
    const maxItems = limit ? parseInt(limit) : 100;
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
    console.log('[DEBUG] Tipos a procesar:', allowedTypes);

    let browser;
    let allMediaTasks = [];
    const seenIds = new Set();
    let userInfo = null;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        const cookieArray = process.env.INSTA_COOKIE.split(';').map(pair => {
            const [name, value] = pair.trim().split('=');
            return { name, value, domain: '.instagram.com' };
        });
        await page.setCookie(...cookieArray);

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
                    if (maxItems && seenIds.size >= maxItems) break;

                    const node = edge.node?.media || edge.node || edge;
                    if (!userInfo && node.user?.hd_profile_pic_url_info?.url) {
                        userInfo = node.user;
                        const profilePicture = userInfo.hd_profile_pic_url_info.url;
                        allMediaTasks.push({ url: profilePicture, id: 'profile_picture', ext: 'jpg', dest: typeLabel });
                    }
                    const nodeUsername = node.user?.username || node.owner?.username;
                    if (nodeUsername && nodeUsername.toLowerCase() !== username.toLowerCase()) {
                        continue;
                    }

                    const items = node.items || node.carousel_media || [node];

                    for (const m of items) {
                        const mediaId = m.pk || m.id;
                        if (mediaId && !seenIds.has(mediaId)) {
                            const videoUrl = m.video_versions?.[0]?.url;
                            const imageUrl = m.image_versions2?.candidates?.[0]?.url || m.display_uri || m.display_url;
                            const finalUrl = videoUrl || imageUrl;

                            if (finalUrl) {
                                allMediaTasks.push({
                                    url: finalUrl,
                                    id: mediaId,
                                    ext: (videoUrl || m.media_type === 2) ? 'mp4' : 'jpg',
                                    dest: typeLabel
                                });
                                seenIds.add(mediaId);
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
                            // Buscar el reel que pertenece al usuario solicitado
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
                console.log(`[Instagram] OK: ${storyData.length} stories encontradas en el source.`);
                for (const item of storyData) {
                    const mediaId = item.pk || item.id;
                    if (mediaId && !seenIds.has(mediaId)) {

                        const videoUrl = item.video_versions?.[0]?.url;
                        const imageUrl = item.image_versions2?.candidates?.[0]?.url;
                        const finalUrl = videoUrl || imageUrl;

                        if (finalUrl) {
                            allMediaTasks.push({
                                url: finalUrl,
                                id: mediaId,
                                ext: videoUrl ? 'mp4' : 'jpg',
                                dest: 'stories'
                            });
                            seenIds.add(mediaId);
                        }
                    }
                }
            } else {
                console.log(`[Instagram] No se encontraron datos de stories en los scripts de esta página.`);
            }
        }

        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle2' });

        if (allowedTypes.includes('highlights') && seenIds.size < maxItems) {
            const beforeHighlights = seenIds.size;
            const highlights = await page.$$('canvas[style*="position: absolute"]');
            
            if (highlights.length > 0) {
                console.log(`[Instagram] Procesando ${highlights.length} highlights...`);
                for (let i = 0; i < highlights.length; i++) {
                    if (seenIds.size >= maxItems) break;
                    await highlights[i].click();
                    await new Promise(r => setTimeout(r, 2500));
                    const close = await page.$('svg[aria-label="Cerrar"], svg[aria-label="Close"]');
                    if (close) await close.click();
                    await new Promise(r => setTimeout(r, 1000));
                }
                console.log(`[Instagram] OK: ${seenIds.size - beforeHighlights} elementos nuevos desde highlights.`);
            }
        }

        if (allowedTypes.includes('posts') && seenIds.size < maxItems) {
            const beforePosts = seenIds.size;
            console.log(`[Instagram] Haciendo scroll para buscar posts...`);
            
            let lastHeight = await page.evaluate('document.body.scrollHeight');
            let scrollRetries = 0;

            while (seenIds.size < maxItems && scrollRetries < 3) {
                await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
                await new Promise(r => setTimeout(r, 3000)); // Espera para que el interceptor trabaje
                
                let newHeight = await page.evaluate('document.body.scrollHeight');
                
                console.log(`[Instagram] Progreso: ${seenIds.size}/${maxItems} elementos totales capturados.`);

                if (newHeight === lastHeight) {
                    scrollRetries++; 
                } else {
                    scrollRetries = 0;
                    lastHeight = newHeight;
                }
            }
            const diffPosts = seenIds.size - beforePosts;
            console.log(`[Instagram] OK: ${diffPosts} posts nuevos encontrados.`);
        }

        const finalCookies = (await page.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
        const userAgent = await page.evaluate(() => navigator.userAgent);
        await browser.close();

        const finalTasks = maxItems ? allMediaTasks.slice(0, maxItems) : allMediaTasks;

        const downloadResults = await mapLimit(finalTasks, process.env.THREADS_DOWNLOAD || 5, async (item) => {
            const subFolder = item.ext === 'mp4' ? 'videos' : 'images';
            const finalPath = path.join(userFolder, item.dest, subFolder);
            return await downloadFile(item.url, finalPath, `${item.id}.${item.ext}`, {
                'User-Agent': userAgent, 'Cookie': finalCookies, 'Referer': 'https://www.instagram.com/'
            });
        });

        res.json({
            status: true,
            nickname: userInfo?.full_name || username,
            user_id: userInfo?.id,
            username,
            total_requested: maxItems,
            total_proccessed: finalTasks.length,
            downloads: downloadResults
        });

    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ error: error.message });
    }
};

module.exports = { getAllMediaPuppeteer };