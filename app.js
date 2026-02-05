require('dotenv').config();

const express = require('express');
const tiktok = require('./controllers/tiktokController');
const pinterest = require('./controllers/pinterestController');
const instagram = require('./controllers/instagramController');
const threads = require('./controllers/threadsController');

const app = express();
const PORT = process.env.PORT || 3000;

// Rutas
app.get('/tiktok/get-all-media', tiktok.getAllMedia);
app.get('/pinterest/get-all-media', pinterest.getAllMedia);
app.get('/instagram/get-all-media', instagram.getAllMedia);
app.get('/threads/get-all-media', threads.getAllMedia);

app.listen(PORT, () => {
    console.log(`🚀 Servidor SocialMediaFetcher corriendo en puerto ${PORT}`);
});