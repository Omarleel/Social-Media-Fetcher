require('dotenv').config();

const express = require('express');
const tiktok = require('./controllers/tiktokController');
const pinterest = require('./controllers/pinterestController');
const instagram = require('./controllers/instagramController');

const app = express();
const PORT = process.env.PORT || 3000;

// Rutas Segmentadas
app.get('/tiktok/get-all-media', tiktok.getAllVideos);
app.get('/pinterest/get-all-media', pinterest.getAllPictures);
app.get('/instagram/get-all-media', instagram.getAllMediaPuppeteer);

app.listen(PORT, () => {
    console.log(`🚀 Servidor SocialMediaFetcher corriendo en puerto ${PORT}`);
});