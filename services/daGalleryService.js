const puppeteer = require('puppeteer-extra');
const path = require('path');
const { sanitizeFilename } = require('../utils/deviantart');

class DaGalleryService {
    
    /**
     * Estrategia A: Obtener media usando la API interna (Requiere Auth)
     */
    async fetchViaApi({ username, csrfToken, cookies, ua, maxItems, userFolder }) {
        const tasks = [];
        let authorInfo = null;
        let currentOffset = 0;
        let hasMore = true;

        const HEADERS = {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': ua,
            'Referer': `https://www.deviantart.com/${username}/gallery`,
            'Cookie': cookies
        };

        while (hasMore && (!maxItems || tasks.length < maxItems)) {
            const apiUrl = `https://www.deviantart.com/_puppy/dashared/gallection/contents?username=${username}&type=gallery&offset=${currentOffset}&limit=24&all_folder=true&csrf_token=${csrfToken}`;
            
            const response = await fetch(apiUrl, { headers: HEADERS });
            const data = await response.json();

            if (!data.results || data.results.length === 0) break;

            if (!authorInfo && data.results[0] && data.results[0].author) {
                authorInfo = data.results[0].author;
            }

             for (const result of data.results) {
                if (maxItems && tasks.length >= maxItems) break;
                if (!result.media || !result.isDownloadable) continue;

                const processedTask = this._processApiMediaItem(result, userFolder);
                if (processedTask) tasks.push(processedTask);
            }

            currentOffset = data.nextOffset;
            hasMore = data.hasMore;
            if (hasMore) await new Promise(r => setTimeout(r, 1000));
        }
       return { tasks, authorInfo };
    }

    _processApiMediaItem(result, userFolder) {
        const baseUri = result.media.baseUri;
        const prettyName = result.media.prettyName;
        const tokens = result.media.token;
        let finalDownloadUrl = '';
        let isOriginal = false;

        if (tokens.length > 1) {
            finalDownloadUrl = `${baseUri}?token=${tokens[1]}`;
            isOriginal = true;
        } else {
            console.log(`⚠️ Imagen sin botón de descarga directo: ${prettyName}`);
            const fullviewType = result.media.types.find(t => t.t === 'fullview') || 
                               result.media.types[result.media.types.length - 1];
            
            if (fullviewType && fullviewType.c) {
                const processedPath = fullviewType.c.replace('<prettyName>', prettyName);
                finalDownloadUrl = `${baseUri}${processedPath}?token=${tokens[0]}`;
            } else {
                finalDownloadUrl = `${baseUri}?token=${tokens[0]}`;
            }
        }

        return {
            url: finalDownloadUrl,
            isOriginal,
            filename: sanitizeFilename(prettyName, result.deviationId, result.filetype),
            dest: path.join(userFolder, 'gallery')
        };
    }

    /**
     * Estrategia B: Obtener media scrapeando HTML (Modo Invitado)
     */
    async fetchViaHtml({ username, ua, maxItems, userFolder }) {
        console.log("🕵️ Modo Sesión Invitado: Extrayendo del código fuente...");
        const tasks = [];
        const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setUserAgent(ua);

        let currentPage = 1;
        let hasMoreContent = true;

        while (hasMoreContent && (!maxItems || tasks.length < maxItems)) {
            console.log(`📄 Scrapeando página ${currentPage}...`);
            await page.goto(`https://www.deviantart.com/${username}/gallery?page=${currentPage}`, { waitUntil: 'networkidle2' });

            const extractedImages = await page.evaluate(this._domScraperScript);

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
            await new Promise(r => setTimeout(r, 2000));
        }

        await browser.close();
        return tasks;
    }

    _domScraperScript() {
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
                
                const fileName = altText.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
                
                results.push({
                    url: highQualityUrl,
                    id: `${finalId}_${fileName}_${Date.now()}`,
                    title: altText
                });
            });
        });
        return results;
    }
}

module.exports = new DaGalleryService();