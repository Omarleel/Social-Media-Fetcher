const { downloadFile } = require('../services/downloadService');
const path = require('path');
const { mapLimit } = require('../utils/utils');

const getAllPictures = async (req, res) => {
    const { username, limit } = req.query;
    const maxItems = limit ? parseInt(limit) : null;

    if (!username) return res.status(400).json({ error: "Username is required" });

    const userFolder = path.join(process.env.DIR_STORAGE || './storage', 'pinterest', 'images', username);
    let currentBookmark = null;
    let hasMore = true;
    let allDownloaded = [];
    let firstPin = null;
    let taskCounter = 0;

    const PINTEREST_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'X-Pinterest-PWS-Handler': `www/[username]/_created.js`,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
        'Referer': `https://www.pinterest.com/${username}/_created/`,
        'Cookie': `_pinterest_sess=${process.env.PINTEREST_COOKIE};`
    };

    try {
        while (hasMore) {
            if (maxItems && taskCounter >= maxItems) break;

            const data = {
                options: {
                    username,
                    bookmarks: currentBookmark ? [currentBookmark] : [],
                    field_set_key: "profile_created_grid_item",
                    exclude_add_pin_rep: true
                },
                context: {}
            };

            const baseUrl = "https://mx.pinterest.com/resource/UserActivityPinsResource/get/";
            const finalUrl = `${baseUrl}?source_url=/${username}/_created/&data=${encodeURIComponent(JSON.stringify(data))}`;

            const response = await fetch(finalUrl, { headers: PINTEREST_HEADERS });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Pinterest Error (${response.status}): ${errorText.substring(0, 50)}`);
            }

            const result = await response.json();
            const pins = result.resource_response?.data || [];
            if (pins.length === 0) break;

            const allMediaTasks = [];

            for (const pin of pins) {
                if (maxItems && taskCounter >= maxItems) break;

                if (!firstPin) {
                    firstPin = pin;
                    const profilePicture = firstPin?.native_creator.image_large_url.replace(/\/(?:\d+x\d+|_RS|_60|_140|_280|image_large_url).*?\//, '/originals/');
                    allMediaTasks.push({ url: profilePicture, fileName: 'profile_picture.jpg' });
                    taskCounter++;
                    
                    if (maxItems && taskCounter >= maxItems) break;
                }

                const imgUrl = pin.images?.orig?.url ||
                               pin.story_pin_data?.pages?.[0]?.blocks?.[0]?.image?.images?.originals?.url;

                if (imgUrl) {
                    allMediaTasks.push({
                        url: imgUrl,
                        fileName: path.basename(new URL(imgUrl).pathname)
                    });
                    taskCounter++;
                }
            }

            const pageResults = await mapLimit(allMediaTasks, process.env.THREADS_DOWNLOAD || 5, async (task) => {
                return await downloadFile(task.url, userFolder, task.fileName, PINTEREST_HEADERS);
            });

            allDownloaded = [...allDownloaded, ...pageResults];

            currentBookmark = result.resource_response?.bookmark;
            hasMore = currentBookmark && currentBookmark !== '-end-';

            console.log(`[Pinterest] Acumulados: ${allDownloaded.length}. Siguiente página: ${hasMore}`);

            if (hasMore) await new Promise(r => setTimeout(r, 500));
        }

        const profileInfo = firstPin ? (firstPin.native_creator || firstPin.pinner) : { full_name: username, id: null };

        res.json({
            status: true,
            nickname: profileInfo.full_name,
            user_id: profileInfo.id,
            username,
            total_requested: maxItems,
            total_proccessed: allDownloaded.length,
            files: allDownloaded
        });
    } catch (error) {
        console.error("Pinterest Flow Error:", error.message);
        res.status(500).json({ error: error.message });
    }
};

module.exports = { getAllPictures };