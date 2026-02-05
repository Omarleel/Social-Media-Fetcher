const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const { downloadFile } = require('../services/downloadService');
const { mapLimit } = require('../utils/utils');

puppeteer.use(StealthPlugin());

const startOFScraper = async (req, res) => {
    const { userId } = req.query;
    const username = userId;

    if (!username) return res.status(400).json({ error: "userId query param is required" });

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // --- FASE 1: Autenticación Humana ---
        await page.goto('https://onlyfans.com/', { waitUntil: 'networkidle2' });
        console.log('🔴 ESPERANDO LOGIN: Por favor, completa el login en la ventana de Chrome...');

        let loggedIn = false;
        const maxAttempts = 60; 
        for (let i = 0; i < maxAttempts; i++) {
            const cookies = await page.cookies();
            if (cookies.some(c => c.name === 'auth_id')) {
                loggedIn = true;
                break;
            }
            await new Promise(r => setTimeout(r, 5000));
            if (i % 6 === 0) console.log(`⏳ Esperando login... (${i*5}s)`);
        }

        if (!loggedIn) throw new Error("Timeout: No se detectó el inicio de sesión.");

        console.log('🟢 LOGIN DETECTADO. Navegando al perfil...');
        await new Promise(r => setTimeout(r, 2000));

        // --- FASE 2: Intercepción de Respuestas de API ---
        let interceptedPosts = [];
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('/posts/medias')) {
                try {
                    const json = await response.json();
                    if (json.list) {
                        interceptedPosts.push(...json.list);
                        console.log(`✨ API: Capturados ${json.list.length} posts con media.`);
                    }
                } catch (e) { /* Ignorar si no es JSON válido */ }
            }
        });

        await page.goto(`https://onlyfans.com/${username}/media`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.g-user-name', { timeout: 15000 });

        const profileData = await page.evaluate(() => ({
            name: document.querySelector('.g-user-name')?.textContent?.trim() || '',
            scrapedAt: new Date().toISOString()
        }));

        console.log(`📊 Extrayendo media de: ${profileData.name}`);
        await autoScroll(page);

        // --- FASE 3: Formateo de Tareas de Descarga ---
        const userFolder = path.join(process.env.DIR_STORAGE || './storage', 'onlyfans', username);
        
        const tasks = interceptedPosts.map(post => {
            const postDate = post.postedAt.split('T')[0];
            // Limpiamos el texto del post para usarlo de carpeta (máx 30 chars)
            const cleanText = (post.text || 'no_text')
                .replace(/<[^>]*>/g, '') // Quitar HTML tags
                .replace(/[\\/:*?"<>|]/g, '_') // Quitar chars prohibidos en archivos
                .trim()
                .substring(0, 30);

            const folderName = `${postDate}_${post.id}_${cleanText}`;

            return post.media.map((m, index) => {
                // Priorizamos el objeto 'full' que enviaste en tu ejemplo
                const fileUrl = m.files?.full?.url || m.files?.preview?.url;
                if (!fileUrl) return null;

                const category = (m.type === 'video' || m.type === 'gif') ? 'videos' : 'photos';
                const ext = fileUrl.split('.').pop().split('?')[0] || (category === 'videos' ? 'mp4' : 'jpg');

                return {
                    id: m.id,
                    url: fileUrl,
                    filename: `${m.id}_p${index}.${ext}`,
                    dest: path.join(userFolder, category, folderName),
                    referer: `https://onlyfans.com/${username}/media`
                };
            });
        }).flat().filter(Boolean);

        // Obtenemos las cookies finales para la descarga
        const finalCookies = (await page.cookies())
            .map(c => `${c.name}=${c.value}`)
            .join('; ');

        await browser.close();

        // --- FASE 4: Ejecución de Descargas ---
        console.log(`🚀 Iniciando descarga de ${tasks.length} archivos...`);
        
        const finalDownloads = await mapLimit(tasks, process.env.THREADS_DOWNLOAD || 10, async (item) => {
            return await downloadFile(item.url, item.dest, item.filename, {
                'Cookie': finalCookies,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
                'Referer': item.referer
            });
        });

        return res.json({
            status: true,
            total_found: tasks.length,
            profile: profileData,
            downloads: finalDownloads
        });

    } catch (error) {
        if (browser) await browser.close();
        console.error("❌ Error:", error.message);
        return res.status(500).json({ status: false, error: error.message });
    }
};

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            let distance = 400;
            let timer = setInterval(() => {
                let scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 400);
        });
    });
}

module.exports = { startOFScraper };