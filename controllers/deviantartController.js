const path = require('path');
const { downloadFile } = require('../services/downloadService');
const { mapLimit } = require('../utils/utils');
const Profile = require('../models/profile');

const authService = require('../services/daAuthService');
const galleryService = require('../services/daGalleryService');

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
        const { csrfToken, cookies, ua, profile, authenticated } = await authService.getFreshAuth(userProfile.username);
        
        if (!csrfToken) throw new Error("Bloqueo persistente: No se pudo extraer el CSRF Token");

        userProfile.header = profile.header;
        
        let tasks = [];
        if (userProfile.header) {
            tasks.push({ url: userProfile.header, filename: 'profile_header.jpg', dest: userFolder, isOriginal: true });
        }
        
        if (!authenticated && !userProfile.id) {
            userProfile.id = profile.id;
            userProfile.nickname = profile.nickname;
            userProfile.picture = profile.picture;
            tasks.push({ url: userProfile.picture, filename: 'profile_picture.jpg', dest: userFolder, isOriginal: true });
        }

        let mediaTasks = [];
        if (authenticated) {
            const { tasks: apiTasks, authorInfo } = await galleryService.fetchViaApi({ 
                username: userProfile.username, csrfToken, cookies, ua, maxItems, userFolder 
            });
            
            mediaTasks = apiTasks;
            
            if (authorInfo && (!userProfile.id || !userProfile.picture)) {
                console.log("🔄 Actualizando datos de perfil desde API...");
                
                userProfile.id = authorInfo.userId;
                userProfile.nickname = authorInfo.username;
                userProfile.picture = authorInfo.usericon;

                tasks.unshift({
                    url: userProfile.picture,
                    filename: 'profile_picture.jpg',
                    dest: userFolder,
                    isOriginal: true
                });
            }
        } else {
            mediaTasks = await galleryService.fetchViaHtml({ 
                username: userProfile.username, ua, maxItems, userFolder 
            });
        }

        tasks = [...tasks, ...mediaTasks];
        
        if (maxItems && tasks.length > maxItems) {
            tasks = tasks.slice(0, maxItems);
        }

        console.log(`✅ Total de tareas recolectadas: ${tasks.length}. Iniciando descargas...`);

        const downloadHeaders = {
            'User-Agent': ua,
            'Cookie': cookies,
            'Referer': 'https://www.deviantart.com/',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'sec-fetch-dest': 'image',
            'sec-fetch-mode': 'no-cors',
            'sec-fetch-site': 'cross-site'
        };

        const allDownloadedResults = await mapLimit(tasks, process.env.THREADS_DOWNLOAD || 5, async (task) => {
            try {
                const headers = { ...downloadHeaders };
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