const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { pipeline } = require('stream/promises');

const downloadFile = async (url, folder, fileName, headers = {}) => {
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }

    const filePath = path.join(folder, fileName);
    if (fs.existsSync(filePath)) return { status: 'exists', fileName };

    try {
        const response = await axios({
            method: 'get',
            url,
            responseType: 'stream',
            headers
        });
        await pipeline(response.data, fs.createWriteStream(filePath));
        return { status: 'downloaded', fileName };
    } catch (err) {
        console.error(`Error bajando ${fileName}:`, err.message);
        return { status: 'error', fileName, error: err.message };
    }
};

module.exports = { downloadFile };