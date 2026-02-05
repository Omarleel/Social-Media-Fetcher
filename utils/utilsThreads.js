const pickBest = (node, type = 'image') => {
    const list = type === 'image' ? node?.image_versions2?.candidates : node?.video_versions;
    if (!list?.length) return null;

    const oh = Number(node.original_height), ow = Number(node.original_width);
    return list.find(c => Number(c.height) === oh && Number(c.width) === ow)?.url 
           || list.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]?.url;
};

const extractMediaFromJson = (payload) => {
    const results = [], seen = new Set();
    let user = null;

    const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) return obj.forEach(walk);

        if (!user && obj.user?.username) {
            user = { id: obj.user.id || obj.user.pk, username: obj.user.username, nickname: obj.user.full_name };
        }

        const id = obj.pk || obj.id;
        if (id && (obj.image_versions2 || obj.video_versions || obj.carousel_media)) {
            if (obj.carousel_media) obj.carousel_media.forEach(walk);
            else {
                const vid = pickBest(obj, 'video'), img = pickBest(obj, 'image');
                if ((vid || img) && !seen.has(id)) {
                    seen.add(id);
                    results.push({ url: vid || img, id: String(id), ext: vid ? 'mp4' : 'jpg' });
                }
            }
        }
        Object.keys(obj).forEach(k => k !== 'user' && walk(obj[k]));
    };

    walk(payload);
    return { medias: results, user };
};

const extractProfileFromMeta = async (page) => {
    return page.evaluate(() => {
        const img = document.querySelector('meta[property="og:image"]')?.content;
        return img ? { url: img, id: 'profile_picture', ext: 'jpg' } : null;
    });
};

const extractSpoilersFromHTML = async (page) => {
    return await page.evaluate(() => {
        const results = [];
        const sjsScripts = document.querySelectorAll('script[data-sjs]');

        for (const script of sjsScripts) {
            try {
                const json = JSON.parse(script.textContent);
                results.push(json);
            } catch (e) {
                continue;
            }
        }
        return results;
    });
};

module.exports = {  extractProfileFromMeta, extractMediaFromJson, extractSpoilersFromHTML };