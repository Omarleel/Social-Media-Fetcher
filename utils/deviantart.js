const path = require('path');

/**
 * Limpia y normaliza el nombre del archivo
 */
const sanitizeFilename = (prettyName, deviationId, fileType) => {
    const cleanName = (prettyName || '')
        .toLowerCase()
        .replace(/\[.*?\]/g, '')
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 30);
    
    // Si no hay nombre limpio, usar solo el ID
    const finalName = cleanName ? `${deviationId}_${cleanName}` : deviationId;
    return `${finalName}.${fileType || 'jpg'}`;
};

/**
 * Prepara las cookies para Puppeteer
 */
const formatCookies = () => {
    const rawCookies = [
        { name: 'auth', value: process.env.DA_AUTH },
        { name: 'auth_secure', value: process.env.DA_AUTH_SECURE },
        { name: 'userinfo', value: process.env.DA_USERINFO },
        { name: '_px', value: process.env.DA_PX },
        { name: '_pxvid', value: process.env.DA_PXVID },
        { name: 'pxcts', value: process.env.DA_PXCTS }
    ];

    return rawCookies
        .filter(c => c.value !== undefined && c.value !== '')
        .map(cookie => ({
            name: cookie.name,
            value: String(cookie.value).trim(),
            domain: '.deviantart.com',
            path: '/'
        }));
};

module.exports = { sanitizeFilename, formatCookies };