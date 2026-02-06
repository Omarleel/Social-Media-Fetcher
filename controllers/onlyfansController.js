const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const { downloadFile } = require('../services/downloadService');
const { mapLimit, sanitizeFilename } = require('../utils/utils');
const { smartScroll } = require('../utils/utilsOnlyfans');
const Profile = require('../models/Profile');
puppeteer.use(StealthPlugin());

const USER_DATA_DIR = path.join(__dirname, '../config/of_profile');

const startOFScraper = async (req, res) => {
    const { username, limit } = req.query;
    const maxPosts = limit ? parseInt(limit) : null;

    if (!username) return res.status(400).json({ error: "username query param is required" });

    let browser;
    let userProfile = null;
    let tasks = [];
    let interceptedPosts = [];
    let hasMoreContent = true;

    try {
        browser = await puppeteer.launch({
            headless: false,
            userDataDir: USER_DATA_DIR,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--start-maximized',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });

        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        console.log('🌐 Accediendo a OnlyFans...');
        await page.goto('https://onlyfans.com/', { waitUntil: 'networkidle2' });

        const checkLogin = async (p) => {
            const cookies = await p.cookies();
            return cookies.some(c => c.name === 'auth_id');
        };

        let loggedIn = await checkLogin(page);

        if (!loggedIn) {
            console.log('🔴 No se detectó sesión activa. ESPERANDO LOGIN MANUAL...');
            try {
                await page.waitForFunction(() => {
                    return document.cookie.includes('auth_id') || !!document.querySelector('.b-chat__header');
                }, { timeout: 300000 });

                loggedIn = true;
                console.log('✅ Login detectado y persistido en el perfil.');
            } catch (e) {
                throw new Error("Timeout: No iniciaste sesión a tiempo.");
            }
        } else {
            console.log('🟢 Sesión recuperada automáticamente desde el perfil.');
        }

        if (!loggedIn) throw new Error("Timeout: No se detectó el inicio de sesión.");

        const waitForUserId = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timeout capturando ID")), 30000);

            page.on('response', async (response) => {
                const url = response.url();

                if (url.includes(`/api2/v2/users/${username}`) && !url.includes('/posts') && !url.includes('/subscribe')) {
                    try {
                        const json = await response.json();
                        if (!userProfile && json.id) {
                            userProfile = new Profile({
                                id: json.id,
                                nickname: json.name || username,
                                username: json.username || username,
                                picture: json.avatar || '',
                                header: json.header || '',
                                url: `https://onlyfans.com/${json.username || username}`
                            });
                            
                            clearTimeout(timeout);
                            resolve(json);
                        }
                    } catch (e) { }
                }

                if (url.includes('/posts/medias')) {
                    try {
                        const json = await response.json();
                        if (json.list) {
                            if (maxPosts === null || interceptedPosts.length < maxPosts) {
                                interceptedPosts.push(...json.list);
                            }

                            hasMoreContent = json.hasMore === true;

                            if (maxPosts !== null && interceptedPosts.length >= maxPosts) {
                                console.log(`limit alcanzado: ${interceptedPosts.length} posts.`);
                                hasMoreContent = false;
                            }

                            console.log(`✨ API: Total posts capturados: ${interceptedPosts.length}`);
                        }
                    } catch (e) { }
                }
            });
        });

        console.log(`🟢 Navegando a: https://onlyfans.com/${username}`);
        await page.goto(`https://onlyfans.com/${username}`, { waitUntil: 'networkidle2' });

        await waitForUserId;

        const userFolder = path.join(process.env.DIR_STORAGE || './storage', 'onlyfans', username);

        if (userProfile.picture) {
            tasks.push({
                id: 'profile_picture',
                url: userProfile.picture,
                filename: `profile_picture.jpg`,
                dest: userFolder,
                referer: `${userProfile.url}/media`
            });
        }
        if (userProfile.header) {
            tasks.push({
                id: 'header_picture',
                url: userProfile.header,
                filename: `header_picture.jpg`,
                dest: userFolder,
                referer: `${userProfile.url}/media`
            });
        }


        console.log(`🎯 ID Capturado: ${userProfile.id}. Iniciando recolección de media...`);

        await page.goto(`https://onlyfans.com/${username}/media`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.g-user-name', { timeout: 15000 });

        const myProfileData = await page.evaluate(() => ({
            name: document.querySelector('.g-user-name')?.textContent?.trim() || '',
            scrapedAt: new Date().toISOString()
        }));

        await smartScroll(page, () => hasMoreContent);
        const finalPosts = maxPosts !== null ? interceptedPosts.slice(0, maxPosts) : interceptedPosts;
        const postsTasks = finalPosts.flatMap(post => {
            const postDate = post.postedAt ? post.postedAt.split('T')[0] : 'date_unknown';
            const postText = post.text || '';
            const cleanText = sanitizeFilename(postText);

            const folderName = `${postDate}_${post.id}_${cleanText}`;

            return (post.media || []).map((m, index) => {
                const fileUrl = m.files?.full?.url || m.files?.preview?.url;
                if (!fileUrl) return null;

                const category = (m.type === 'video' || m.type === 'gif') ? 'videos' : 'images';
                const ext = fileUrl.split('.').pop().split('?')[0] || (category === 'videos' ? 'mp4' : 'jpg');

                return {
                    id: m.id,
                    url: fileUrl,
                    filename: `${m.id}_p${index}.${ext}`,
                    dest: path.join(userFolder, category, folderName),
                    referer: `${userProfile.url}/media`
                };
            });
        }).filter(Boolean);

        tasks = [...tasks, ...postsTasks];

        const finalCookies = (await page.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
        const userAgent = await page.evaluate(() => navigator.userAgent);

        await browser.close();

        console.log(`🚀 Iniciando descarga de ${tasks.length} archivos...`);
        const finalDownloads = await mapLimit(tasks, process.env.THREADS_DOWNLOAD || 5, async (item) => {
            return await downloadFile(item.url, item.dest, item.filename, {
                'Cookie': finalCookies,
                'User-Agent': userAgent,
                'Referer': item.referer
            });
        });

        return res.json({
            status: true,
            nickname: userProfile.nickname,
            user_id: userProfile.id,
            username: userProfile.username,
            profile_url: userProfile.url,
            total_requested: maxPosts,
            total_proccessed: finalDownloads.length,
            downloads: finalDownloads
        });

    } catch (error) {
        if (browser) await browser.close();
        console.error("❌ Error:", error.message);
        return res.status(500).json({ status: false, error: error.message });
    }
};

module.exports = { startOFScraper };