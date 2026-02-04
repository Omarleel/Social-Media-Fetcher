const { downloadFile } = require('../services/downloadService');
const path = require('path');
const { mapLimit } = require('../utils/utils');

const getAllMedia = async (req, res) => {
    const { username, limit } = req.query;
    const maxItems = limit ? parseInt(limit) : null;

    if (!username) return res.status(400).json({ error: "Username is required" });

    const userFolder = path.join(process.env.DIR_STORAGE || './storage', 'pinterest', username);
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
        'Cookie': `${process.env.PINTEREST_COOKIE};`
    };

    const getVideoUrl = async (pinId) => {
        try {
            const url = `https://www.pinterest.com/pin/${pinId}/`;

            const res = await fetch(url, {
                headers: {
                    'User-Agent': PINTEREST_HEADERS['User-Agent'],
                    'Cookie': process.env.PINTEREST_COOKIE
                }
            });

            if (!res.ok) return null;

            const html = await res.text();
            const regex = /https:\/\/v1\.pinimg\.com\/videos\/iht\/expMp4\/[a-zA-Z0-9_/.-]+\.mp4/g;
            const matches = html.match(regex);

            if (matches && matches.length > 0) {

                const uniqueUrls = [...new Set(matches)];

                const bestVideo = uniqueUrls[0];

                return bestVideo;
            }

            const fallbackRegex = /https:\/\/v1\.pinimg\.com\/videos\/iht\/720w\/[a-zA-Z0-9_/.-]+\.mp4/g;
            const fallbackMatches = html.match(fallbackRegex);

            return fallbackMatches ? fallbackMatches[0] : null;

        } catch (e) {
            console.error(`Error analizando HTML del Pin ${pinId}:`, e.message);
            return null;
        }
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
            const result = await response.json();
            const pins = result.resource_response?.data || [];
            if (pins.length === 0) break;

            const allMediaTasks = [];

            for (const pin of pins) {
                if (maxItems && taskCounter >= maxItems) break;

                if (!firstPin) {
                    firstPin = pin;
                    const profilePicture = firstPin?.native_creator?.image_large_url?.replace(/\/(?:\d+x\d+|_RS|_60|_140|_280|image_large_url).*?\//, '/originals/');
                    allMediaTasks.push({ url: profilePicture, fileName: 'profile_picture.jpg', folder: 'images' });
                    taskCounter++;
                }

                const pinId = pin.id;

                const isVideo = pin?.story_pin_data?.total_video_duration > 0 || pin?.is_video;
                if (isVideo) {
                    const videoUrl = await getVideoUrl(pinId);
                    if (videoUrl) {
                        allMediaTasks.push({
                            url: videoUrl,
                            fileName: `${pinId}.mp4`,
                            folder: 'videos'
                        });
                        taskCounter++;
                        continue; 
                    }
                }

                const imgUrl = pin.images?.orig?.url || pin.story_pin_data?.pages?.[0]?.blocks?.[0]?.image?.images?.originals?.url;
                if (imgUrl) {
                    allMediaTasks.push({
                        url: imgUrl,
                        fileName: `${pinId}.jpg`,
                        folder: 'images'
                    });
                    taskCounter++;
                }
            }

            const pageResults = await mapLimit(allMediaTasks, process.env.THREADS_DOWNLOAD || 5, async (task) => {
                const finalDest = path.join(userFolder, task.folder);
                return await downloadFile(task.url, finalDest, task.fileName, PINTEREST_HEADERS);
            });

            allDownloaded = [...allDownloaded, ...pageResults];
            currentBookmark = result.resource_response?.bookmark;
            hasMore = currentBookmark && currentBookmark !== '-end-';

            if (hasMore) await new Promise(r => setTimeout(r, 800));
        }

        res.json({
            status: true,
            nickname: firstPin ? (firstPin.native_creator?.full_name || username) : username,
            username,
            total_proccessed: allDownloaded.length,
            files: allDownloaded
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = { getAllMedia };