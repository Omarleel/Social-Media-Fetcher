# SMF (Social Media Fetcher) 🚀

**SMF** es una potente API de automatización construida en Node.js diseñada para el respaldo masivo y sincronización de activos multimedia (imágenes y videos) desde plataformas sociales como **TikTok**, **Pinterest**, **Instagram** y **Threads**.

El sistema utiliza técnicas avanzadas de inyección de sesiones y concurrencia limitada para garantizar descargas veloces sin comprometer la estabilidad del servidor ni activar firewalls de seguridad.

---

## 🛠 Arquitectura Técnica

SMF está construido bajo un modelo de capas modular:

* **Controllers:** Gestionan la lógica específica de cada red social (Puppeteer para TikTok, REST API Pinterest, Puppeteer/GraphQL para Instagram y un motor de Smart Scroll para Threads).
* **Services:** Servicios universales de descarga con soporte para `Streams` y `Pipelines`.
* **Utils:** Herramientas de control de flujo, incluyendo el motor de concurrencia limitada (`mapLimit`) y simuladores de comportamiento humano (`moveMouseInCircle`).

---

## 🚀 Características Principales

* ✅ **TikTok Engine:** Scroll infinito automatizado con Puppeteer y captura de buffers de video mediante intercepción de red.
* ✅ **Pinterest Engine:** Extracción masiva vía API interna utilizando `bookmarks` para paginación infinita.
* ✅ **Instagram Engine:** Consumo de GraphQL y automatización más fiel con Puppeteer.
* ✅ **Threads Engine:** Consumo de GraphQL y automatización más fiel con Puppeteer.
    * **Smart Reactive Scroll:** Sistema de scroll basado en eventos que detecta nuevas respuestas de red y espera tiempos dinámicos antes de continuar.
    * **Stagnation Detection:** Algoritmo que detecta bloqueos de sesión o límites de contenido público para evitar bucles infinitos.
    * **Spoiler/Hidden Extraction:** Análisis de scripts SJS (`data-sjs`) para recuperar contenido oculto o spoilers.


* ✅ **Parallel Downloader:** Procesamiento concurrente basado en la variable `THREADS_DOWNLOAD` para manejar perfiles con +400 archivos sin saturar el stack de red.
* ✅ **Stealth Mode:** Integración con plugins de ocultamiento para evitar detecciones de bots.

---

## 📦 Instalación

1. Clona el repositorio:

```bash
git clone https://github.com/Omarleel/Social-Media-Fetcher.git
cd Social-Media-Fetcher

```

2. Instala las dependencias:

```bash
npm install

```

3. Configura tus variables de entorno en un archivo `.env`:

```env
PORT=3000
DIR_STORAGE=./storage
THREADS_DOWNLOAD=5      # Número de hilos paralelos para descargas
PINTEREST_COOKIE=       # Cookie: _pinterest_sess
INSTA_SESSIONID=        # Cookie: sessionid (Instagram)
INSTA_CSRF_TOKEN=       # Cookie: csrftoken (Instagram)
THREADS_SESSIONID=      # Cookie: sessionid (Threads)
THREADS_CSRF_TOKEN=     # Cookie: csrftoken (Threads)

```

---

## 📡 Endpoints de la API

| Plataforma | Endpoint | Parámetros | Descripción |
| --- | --- | --- | --- |
| **TikTok** | `/tiktok/get-all-media` | `username, limit` | Scroll infinito y descarga de videos .mp4 y Foto de Perfil |
| **Pinterest** | `/pinterest/get-all-media` | `username, limit` | Paginación por bookmarks y descarga de imágenes/videos |
| **Instagram** | `/instagram/get-all-media` | `username, limit, mediaType, method` | Descarga de Stories, Highlights, Videos, Imágenes y Foto de Perfil |
| **Threads** | `/threads/get-all-media` | `username`, `limit, method` | Extracción reactiva de contenido multimedia, manejo de spoilers y fotos de perfil |

---

## ⚙️ Configuración de Concurrencia

El sistema implementa un algoritmo de **Pooling de Promesas** mediante la utilidad `mapLimit`.

A diferencia de `Promise.all` estándar, SMF gestiona una cola de ejecución. Si `THREADS_DOWNLOAD` es 5, el sistema mantendrá exactamente 5 descargas activas en todo momento. A medida que una termina, la siguiente en la cola (`allMediaTasks`) toma su lugar. Esto garantiza:

1. **Estabilidad Térmica:** Menor carga de CPU.
2. **Evasión de Bans:** Evita picos de tráfico que activan el rate-limiting de las redes sociales.

---

## 🛡 Seguridad y Buenas Prácticas

* **Sesión Persistente:** Instagram y Threads requieren que sus respectivos `COOKIES` y `CSRF_TOKEN` sean válidos para acceder a perfiles privados o feeds extensos.
* **Stream Pipeline:** Se utiliza `stream/promises` para escribir archivos directamente en disco, evitando cargar buffers binarios pesados en la memoria RAM.

---
