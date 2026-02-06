const { downloadFile } = require('../services/downloadService');
const path = require('path');
const { mapLimit } = require('../utils/utils');
const Profile = require('../models/Profile');

const getAllMedia = async (req, res) => {
    const { userId, limit, mediaType } = req.query;
    const maxItems = limit ? parseInt(limit, 10) : null;

    if (!userId) return res.status(400).json({ error: "userId is required" });

    let allowedTypes = [];
    if (!mediaType || mediaType === 'null' || mediaType === 'undefined') {
        allowedTypes = ['illustrations', 'mangas'];
    } else {
        allowedTypes = String(mediaType)
            .replace(/[\[\]"']/g, '')
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(Boolean);
    }

    const PIXIV_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': `https://www.pixiv.net/en/users/${userId}/illustrations`,
        'Cookie': `PHPSESSID=${process.env.PIXIV_PHPSESSID}` || ''
    };

    const apiBase = `https://www.pixiv.net/ajax/user/${userId}`;

    try {
        const [profileRes, allIdsRes] = await Promise.all([
            fetch(`${apiBase}?full=1`, { headers: PIXIV_HEADERS }),
            fetch(`${apiBase}/profile/all?lang=en`, { headers: PIXIV_HEADERS })
        ]);

        const profileJson = await profileRes.json();
        const allIdsJson = await allIdsRes.json();
        if (profileJson.error) throw new Error("User not found or Private");

        const userProfile = new Profile({
            id: userId,
            nickname: profileJson.body.name,
            username: profileJson.body.account || userId,
            picture: profileJson.body.imageBig || '',
            url: `https://www.pixiv.net/en/users/${userId}`
        });
        const userFolder = path.join(process.env.DIR_STORAGE || './storage', 'pixiv', userProfile.nickname);

        const illustIds = allowedTypes.includes('illustrations')
            ? Object.keys(allIdsJson.body.illusts || {}).map(id => ({ id, type: 'illustrations' })) : [];
        const mangaIds = allowedTypes.includes('mangas')
            ? Object.keys(allIdsJson.body.manga || {}).map(id => ({ id, type: 'mangas' })) : [];

        let combinedIds = [...illustIds, ...mangaIds].reverse();
        if (maxItems) combinedIds = combinedIds.slice(0, maxItems);

        const chunkSize = 48;
        const chunks = [];
        for (let i = 0; i < combinedIds.length; i += chunkSize) chunks.push(combinedIds.slice(i, i + chunkSize));

        const worksMetadata = await Promise.all(chunks.map(async (chunk) => {
            const idsQuery = chunk.map(item => `ids%5B%5D=${item.id}`).join('&');
            const url = `${apiBase}/profile/illusts?${idsQuery}&work_category=illust&is_first_page=1&lang=en`;
            const r = await fetch(url, { headers: PIXIV_HEADERS });
            const j = await r.json();
            return Object.values(j.body.works || {});
        }));

        const allWorks = worksMetadata.flat();
        const tasks = [];

        if (userProfile.picture) {
            tasks.push({ 
                id: 'profile', 
                url: userProfile.picture, 
                filename: `profile_picture.jpg`, 
                dest: userFolder 
            });
        }

        await mapLimit(allWorks, 15, async (work) => {
            try {
                const workDetailsRes = await fetch(`https://www.pixiv.net/ajax/illust/${work.id}/pages?lang=en`, { headers: PIXIV_HEADERS });
                const workDetailsJson = await workDetailsRes.json();
                const pages = workDetailsJson.body;

                const safeTitle = work.title.replace(/[\\/:*?"<>|]/g, '_').trim();
                const workType = combinedIds.find(c => c.id === String(work.id))?.type;

                pages.forEach((pageData, p) => {
                    const originalUrl = pageData.urls.original;
                    const detectedExt = originalUrl.split('.').pop().split('?')[0] || 'jpg';
                    tasks.push({
                        id: work.id,
                        url: originalUrl,
                        filename: `${work.id}_p${p}.${detectedExt}`,
                        dest: path.join(userFolder, workType, safeTitle)
                    });
                });
            } catch (err) {
                console.error(`Error en pages de ${work.id}`);
            }
        });

        const finalDownloads = await mapLimit(tasks, process.env.THREADS_DOWNLOAD || 5, async (item) => {
            return await downloadFile(item.url, item.dest, item.filename, {
                ...PIXIV_HEADERS,
                'Referer': `https://www.pixiv.net/en/artworks/${item.id}`
            });
        });

        res.json({
            status: true,
            profile: userProfile,
            total_requested: maxItems,
            total_processed: tasks.length,
            downloads: finalDownloads
        });

    } catch (error) {
        res.status(500).json({ status: false, error: error.message });
    }
};

module.exports = { getAllMedia };