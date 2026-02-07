const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { downloadFile } = require('../services/downloadService');
const path = require('path');
const { mapLimit } = require('../utils/utils');
const Profile = require('../models/Profile');

puppeteer.use(StealthPlugin());

const getFreshAuth = async (username) => {
    const browser = await puppeteer.launch({
        headless: 'shell',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    const rawCookies = [
        { name: 'auth', value: process.env.DA_AUTH },
        { name: 'auth_secure', value: process.env.DA_AUTH_SECURE },
        { name: 'userinfo', value: process.env.DA_USERINFO },
        { name: '_px', value: process.env.DA_PX },
        { name: '_pxvid', value: process.env.DA_PXVID },
        { name: 'pxcts', value: process.env.DA_PXCTS }
    ];

    const cookiesToInject = rawCookies
        .filter(c => c.value !== undefined && c.value !== '')
        .map(cookie => ({
            name: cookie.name,
            value: String(cookie.value).trim(),
            domain: '.deviantart.com',
            path: '/'
        }));

    if (cookiesToInject.length === 0) {
        console.warn("⚠️ Advertencia: No se encontraron cookies de DeviantArt en el .env");
    } else {
        await page.setCookie(...cookiesToInject);
    }

    let capturedToken = null;

    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const url = request.url();
        if (url.includes('csrf_token=')) {
            const urlParams = new URLSearchParams(url.split('?')[1]);
            const token = urlParams.get('csrf_token');
            if (token) capturedToken = token;
        }
        request.continue();
    });

    console.log(`🌐 Navegando a DeviantArt para capturar tráfico...`);

    await page.goto(`https://www.deviantart.com/${username}/gallery`, {
        waitUntil: 'networkidle0',
        timeout: 60000
    });

    const profile = await page.evaluate((targetUser) => {
        const userLink = document.querySelector(`a[data-username="${targetUser}" i][data-userid]`);

        const id = userLink ? userLink.getAttribute('data-userid') : null;

        const titleText = document.title;
        const nickname = titleText.split(' - ')[0] || targetUser;

        const picture = userLink ? userLink.getAttribute('data-icon') :
            (document.querySelector('meta[property="og:image"]')?.content || '');
        const headerDiv = document.querySelector('div[style*="background-image"]');
        let header = '';
        if (headerDiv) {
            const style = headerDiv.style.backgroundImage;
            header = style.replace(/url\(['"]?(.*?)['"]?\)/i, '$1');
        }

        return {
            id: parseInt(id), // Fallback al username si falla la captura del ID
            nickname: nickname,
            username: targetUser,
            picture: picture,
            header: header,
            url: `https://www.deviantart.com/${targetUser}`
        };
    }, username);

    if (!capturedToken) {
        capturedToken = await page.evaluate(() => {
            const html = document.documentElement.innerHTML;
            const match = html.match(/"csrfToken":"([a-zA-Z0-9._-]+)"/);
            return match ? match[1] : null;
        });
    }

    const cookies = (await page.cookies())
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
    const ua = await page.evaluate(() => navigator.userAgent);

    console.log(`🔍 Verificando integridad de la sesión en la API...`);

    const apiSessionStatus = await page.evaluate(async (token) => {
        try {
            const response = await fetch(`https://www.deviantart.com/_puppy/damz/session?da_minor_version=20230710&csrf_token=${token}`);
            return await response.json();
        } catch (e) {
            return { error: 'connection_failed' };
        }
    }, capturedToken);
    let authenticated = false;
    if (apiSessionStatus.error || apiSessionStatus.status === 'error') {
        console.error(`❌ SESIÓN INVALIDADA por DeviantArt:`, apiSessionStatus.errorDescription || apiSessionStatus.error);
    } else {
        authenticated = true;
        console.log(`✅ API Session confirmada. Usuario: ${apiSessionStatus.username || 'Autenticado'}`);
    }

    await browser.close();

    return { csrfToken: capturedToken, cookies, ua, profile: new Profile(profile), browser, authenticated };
};

const getAllMedia = async (req, res) => {
    const { username, limit } = req.query;
    const maxItems = limit ? parseInt(limit, 10) : null;

    if (!username) return res.status(400).json({ error: "username is required" });

    const userProfile = new Profile({
        username: username, nickname: username, id: '', picture: '',
        url: `https://www.deviantart.com/${username.replace(/^@/, '')}`
    });

    const userFolder = path.join(process.env.DIR_STORAGE || './storage', 'deviantart', userProfile.username);

    try {
        const { csrfToken, cookies, ua, profile, authenticated } = await getFreshAuth(userProfile.username);
        if (!csrfToken) throw new Error("Bloqueo persistente: No se pudo extraer el CSRF Token");

        userProfile.header = profile.header;

        const HEADERS = {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': ua,
            'Referer': `https://www.deviantart.com/${userProfile.username}/gallery`,
            'Cookie': cookies
        };

        const DOWNLOAD_HEADERS = {
            'User-Agent': ua,
            'Cookie': cookies,
            'Referer': 'https://www.deviantart.com/',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'sec-fetch-dest': 'image',
            'sec-fetch-mode': 'no-cors',
            'sec-fetch-site': 'cross-site'
        };

        let currentOffset = 0;
        let hasMore = true;
        let tasks = [];

        if (userProfile.header) {
            tasks.push({
                url: userProfile.header,
                filename: 'profile_header.jpg',
                dest: userFolder,
                isOriginal: true
            });
        }

        if (authenticated) {
            while (hasMore && (!maxItems || tasks.length < maxItems)) {
                const apiUrl = `https://www.deviantart.com/_puppy/dashared/gallection/contents?username=${userProfile.username}&type=gallery&offset=${currentOffset}&limit=24&all_folder=true&csrf_token=${csrfToken}`;

                const response = await fetch(apiUrl, { headers: HEADERS });
                const data = await response.json();

                if (!data.results || data.results.length === 0) break;

                if (!userProfile.id && data.results[0].author) {
                    const author = data.results[0].author;
                    userProfile.id = author.userId;
                    userProfile.nickname = author.username;
                    userProfile.picture = author.usericon;
                    tasks.push({ url: userProfile.picture, filename: 'profile_picture.jpg', dest: userFolder, isOriginal: true });
                }

                for (const result of data.results) {
                    if (maxItems && tasks.length >= maxItems) break;
                    if (!result.media || !result.isDownloadable) continue;

                    const baseUri = result.media.baseUri;
                    const prettyName = result.media.prettyName;
                    const tokens = result.media.token;


                    let finalDownloadUrl = '';
                    let isOriginal = false;

                    if (tokens.length > 1) {
                        finalDownloadUrl = `${baseUri}?token=${tokens[1]}`;
                        isOriginal = true;
                    } else {
                        const fullviewType = result.media.types.find(t => t.t === 'fullview') ||
                            result.media.types[result.media.types.length - 1];
                        console.log(`⚠️ Imagen no tiene habilitada el botón de descarga: ${prettyName}`)
                        if (fullviewType && fullviewType.c) {
                            const processedPath = fullviewType.c.replace('<prettyName>', prettyName);
                            finalDownloadUrl = `${baseUri}${processedPath}?token=${tokens[0]}`;
                        } else {
                            finalDownloadUrl = `${baseUri}?token=${tokens[0]}`;
                        }
                    }

                    const fileType = result.filetype;

                    tasks.push({
                        url: finalDownloadUrl,
                        isOriginal,
                        filename: `${result.deviationId}_${prettyName}.${fileType}`,
                        dest: path.join(userFolder, 'gallery')
                    });
                }

                currentOffset = data.nextOffset;
                hasMore = data.hasMore;
                if (hasMore) await new Promise(r => setTimeout(r, 1000));
            }

        }
        else {
            console.log("🕵️ Modo Sesión Invitado: Extrayendo del código fuente...");
            if (!userProfile.id) {
                userProfile.id = profile.id;
                userProfile.nickname = profile.username;
                userProfile.picture = profile.picture;
                tasks.push({ url: userProfile.picture, filename: 'profile_picture.jpg', dest: userFolder, isOriginal: true });
            }
            const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox'] });
            const page = await browser.newPage();
            await page.setUserAgent(ua);

            let currentPage = 1;
            let hasMoreContent = true;

            while (hasMoreContent && (!maxItems || tasks.length < maxItems)) {
                const pageUrl = `https://www.deviantart.com/${userProfile.username}/gallery?page=${currentPage}`;
                console.log(`📄 Scrapeando página ${currentPage}...`);

                await page.goto(pageUrl, { waitUntil: 'networkidle2' });

                const extractedImages = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('div[data-testid="content_row"]'));
                    const results = [];

                    rows.forEach(row => {
                        const thumbs = row.querySelectorAll('div[data-testid="thumb"] img');

                        thumbs.forEach(img => {
                            const srcSet = img.getAttribute('srcset');
                            if (!srcSet) return;

                            const rawUrl = srcSet.split(' ')[0];

                            let highQualityUrl = rawUrl;

                            try {
                                const urlObj = new URL(rawUrl);
                                const token = urlObj.searchParams.get('token');

                                if (token) {
                                    const payloadPart = token.split('.')[1];
                                    const decodedPayload = JSON.parse(atob(payloadPart));

                                    const meta = decodedPayload.obj[0][0];
                                    const maxWidth = meta.width.replace(/[<=]/g, '');
                                    const maxHeight = meta.height.replace(/[<=]/g, '');

                                    highQualityUrl = rawUrl
                                        .replace(/\/(?:fill|crop|fit)\/w_\d+,h_\d+(?:,x_\d+,y_\d+,scl_[\d.]+)?/, `/v1/fit/w_${maxWidth},h_${maxHeight}`)
                                        .replace(/-\d+[tw](?:-2x)?\.jpg/, '-414w-2x.jpg')
                                        .replace(/q_\d+/, 'q_70');
                                }
                            } catch (e) {
                                highQualityUrl = rawUrl.replace(/q_\d+/, 'q_70');
                            }
                            const idMatch = rawUrl.match(/\/([a-z0-9]{7,10})-/i);
                            const finalId = idMatch ? idMatch[1] : 'DA';

                            const altText = img.getAttribute('alt') || '';
                            const fileName = altText
                                .toLowerCase()
                                .replace(/\[.*?\]/g, '')
                                .replace(/[^a-z0-9]/g, '_')
                                .replace(/_+/g, '_')
                                .replace(/^_|_$/g, '')
                                .substring(0, 30);
                            const uniqueId = `${finalId}_${fileName}_${Date.now()}`;
                            results.push({
                                url: highQualityUrl,
                                id: uniqueId,
                                title: altText
                            });
                        });
                    });

                    return results;
                });

                if (extractedImages.length === 0) {
                    hasMoreContent = false;
                    break;
                }

                for (const img of extractedImages) {
                    if (maxItems && tasks.length >= maxItems) break;
                    tasks.push({
                        url: img.url,
                        filename: `${img.id}.jpg`,
                        dest: path.join(userFolder, 'gallery'),
                        isOriginal: false
                    });
                }

                currentPage++;
                if (maxItems && tasks.length >= maxItems) hasMoreContent = false;
                await new Promise(r => setTimeout(r, 2000)); // Delay humano
            }
            await browser.close();
        }

        console.log(`✅ Total de tareas recolectadas: ${tasks.length}. Iniciando descargas...`);

        const allDownloadedResults = await mapLimit(tasks, process.env.THREADS_DOWNLOAD || 5, async (task) => {
            try {
                const headers = { ...DOWNLOAD_HEADERS };
                if (!task.isOriginal) {
                    headers['Sec-Fetch-Dest'] = 'image';
                    headers['Sec-Fetch-Mode'] = 'no-cors';
                }

                const result = await downloadFile(task.url, task.dest, task.filename, headers);

                const jitter = Math.floor(Math.random() * 1000) + 500;
                await new Promise(r => setTimeout(r, jitter));

                return result;
            } catch (err) {
                console.error(`⚠️ Error en ${task.filename}: ${err.message}`);
                return { id: task.filename, status: false, error: err.message };
            }
        });

        return res.json({
            status: true,
            profile: userProfile,
            total_requested: maxItems,
            total_processed: allDownloadedResults.length,
            downloads: allDownloadedResults
        });

    } catch (error) {
        console.error("❌ DA Error:", error.message);
        if (!res.headersSent) {
            return res.status(500).json({ status: false, error: error.message });
        }
    }
};

module.exports = { getAllMedia };