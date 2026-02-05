const pickBestXImage = (mediaNode) => {
    const url = mediaNode?.media_url_https;
    if (!url) return null;
    // Twitter permite añadir un parámetro de formato para obtener la imagen original
    return url.includes('?') ? url : `${url}?name=large`;
};

const pickBestXVideo = (mediaNode) => {
    const variants = mediaNode?.video_info?.variants;
    if (!Array.isArray(variants)) return null;

    // Filtramos solo mp4 y ordenamos por bitrate descendente
    const best = variants
        .filter(v => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    return best?.url || null;
};

const extractMediaFromXJson = (payload) => {
    const results = [];
    const seen = new Set();
    let user = null;

    const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) return obj.forEach(walk);

        // Captura de datos de usuario (UserResults)
        if (!user && obj.__typename === 'User' && obj.legacy) {
            user = {
                id: obj.rest_id,
                username: obj.legacy.screen_name,
                nickname: obj.core.name
            };
            const profilePicture = obj.avatar?.image_url.replace('_normal', '_400x400');
            if (profilePicture)
             results.push({
                url: profilePicture,
                id: 'profile_picture',
                ext: 'jpg',
                dest: 'posts'
            });
        }
  
        // Detección de Media en Tweets
        const mediaList = obj?.extended_entities?.media || obj?.legacy?.entities?.media;
        if (Array.isArray(mediaList)) {
         
            mediaList.forEach(m => {
                const id = m.id_str;
                if (seen.has(id)) return;
              
                const videoUrl = pickBestXVideo(m);
                const imageUrl = pickBestXImage(m);

                if (videoUrl || imageUrl) {
                    seen.add(id);
                    results.push({
                        url: videoUrl || imageUrl,
                        id: id,
                        ext: videoUrl ? 'mp4' : 'jpg',
                        dest: 'posts'
                    });
                }
            });
        }

        Object.keys(obj).forEach(k => {
            if (k !== 'user_results' || !user) walk(obj[k]); 
        });
    };

    walk(payload);
    return { medias: results, user };
};

module.exports = { extractMediaFromXJson };