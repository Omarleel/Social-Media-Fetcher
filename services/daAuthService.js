const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Profile = require('../models/profile');
const { formatCookies } = require('../utils/deviantart');

puppeteer.use(StealthPlugin());

class DaAuthService {
    async getFreshAuth(username) {
        const browser = await puppeteer.launch({
            headless: 'shell',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });

        const page = await browser.newPage();
        
        await page.setViewport({ width: 1366, height: 768 });
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        await page.setUserAgent(ua);

        const cookiesToInject = formatCookies();

        if (cookiesToInject.length > 0) {
            await page.setCookie(...cookiesToInject);
        }

        let capturedToken = null;

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('csrf_token=') && url.includes('_puppy')) {
                const urlParams = new URLSearchParams(url.split('?')[1]);
                const token = urlParams.get('csrf_token');
                if (token && token.length > 10) capturedToken = token;
            }
            request.continue();
        });

        console.log(`🌐 Navegando a DeviantArt (${username})...`);
        
        try {
            await page.goto(`https://www.deviantart.com/${username}/gallery`, {
                waitUntil: 'networkidle2',
                timeout: 45000
            });
        } catch (e) {
            console.log("⚠️ Timeout de navegación, intentando recuperar datos igual...");
        }

        if (!capturedToken) {
            capturedToken = await page.evaluate(() => {
                try {
                    if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.config) {
                        return window.__INITIAL_STATE__.config.csrfToken;
                    }
                } catch (e) { return null; }
                return null;
            });
        }

        if (!capturedToken) {
            capturedToken = await this._extractCsrfFromHtml(page);
        }

        const profileData = await this._scrapeProfileDOM(page, username);
        const cookies = (await page.cookies()).map(c => `${c.name}=${c.value}`).join('; ');

        const authenticated = await this._verifyApiSession(capturedToken, ua, cookies);

        await browser.close();

        return { 
            csrfToken: capturedToken, 
            cookies, 
            ua, 
            profile: new Profile(profileData), 
            authenticated 
        };
    }

    async _scrapeProfileDOM(page, targetUser) {
        return page.evaluate((user) => {
            const userLink = document.querySelector(`a[data-username="${user}" i][data-userid]`);
            const id = userLink ? userLink.getAttribute('data-userid') : null;
            const titleText = document.title;
            const nickname = titleText.split(' - ')[0] || user;
            
            const picture = userLink ? userLink.getAttribute('data-icon') :
                (document.querySelector('meta[property="og:image"]')?.content || '');
            
            const headerDiv = document.querySelector('div[style*="background-image"]');
            let header = '';
            if (headerDiv) {
                const style = headerDiv.style.backgroundImage;
                header = style.replace(/url\(['"]?(.*?)['"]?\)/i, '$1');
            }

            return {
                id: parseInt(id),
                nickname: nickname,
                username: user,
                picture: picture,
                header: header,
                url: `https://www.deviantart.com/${user}`
            };
        }, targetUser);
    }

    async _extractCsrfFromHtml(page) {
        return page.evaluate(() => {
            const html = document.documentElement.innerHTML;
            const match = html.match(/"csrfToken":"([a-zA-Z0-9._-]+)"/);
            return match ? match[1] : null;
        });
    }

    async _extractCsrfFromHtml(page) {
        // Regex mejorada para JSON incrustado
        return page.evaluate(() => {
            const html = document.documentElement.innerHTML;
            const match = html.match(/"csrfToken":"([a-zA-Z0-9._-]+)"/);
            return match ? match[1] : null;
        });
    }

    async _verifyApiSession(token, ua, cookies) {
        if (!token) return false;
        console.log(`🔍 Verificando sesión con token: ${token.substring(0, 10)}...`);
        
        try {
            const response = await fetch(`https://www.deviantart.com/_puppy/damz/session?da_minor_version=20230710&csrf_token=${token}`, {
                headers: {
                    'User-Agent': ua,
                    'Cookie': cookies,
                    'Accept': 'application/json'
                }
            });
            const data = await response.json();
            
            if (data.error || data.status === 'error') {
                console.error(`❌ SESIÓN INVALIDADA: ${data.errorDescription || data.error}`);
                return false;
            } else {
                console.log(`✅ Sesión Válida. Usuario: ${data.username}`);
                return true;
            }
        } catch (e) {
            console.error("❌ Error de conexión al validar sesión");
            return false;
        }
    }
}

module.exports = new DaAuthService();