# SMF (Social Media Fetcher) 🚀

**SMF** es una potente API de automatización construida en Node.js diseñada para el respaldo masivo y sincronización de activos multimedia (imágenes y videos) desde múltiples plataformas sociales.

El sistema utiliza técnicas avanzadas de inyección de sesiones, persistencia de perfiles de navegador y concurrencia limitada para garantizar descargas veloces sin comprometer la estabilidad del servidor ni activar firewalls de seguridad.

---

## 🛠 Arquitectura Técnica

SMF está construido bajo un modelo de capas modular:

* **Controllers:** Gestionan la lógica específica de cada red social.
* **Puppeteer Engines:** (X, OnlyFans, TikTok, Instagram, Threads, DeviantArt) Utilizan automatización de navegador para bypass de seguridad.
* **REST Engines:** (Pinterest, Pixiv) Consumo directo de APIs internas para máxima velocidad.


* **Services:** Servicios universales de descarga con soporte para `Streams` y `Pipelines`.
* **Utils:** Herramientas de control de flujo, incluyendo el motor de concurrencia limitada (`mapLimit`), simuladores de comportamiento humano (`moveMouseInCircle`) y extractores de esquemas JSON.

---

## 🚀 Características Principales

* ✅ **DeviantArt Engine (Hybrid Puppeteer/REST):**
    * **Profile Metadata:** Extracción automática de **Header (Banner)** y **Avatar** mediante evaluación de CSS computado en el DOM.
    * **Smart Fallback:** Si no existe el botón de descarga original (`token[1]`), construye automáticamente la URL de **Fullview** (máxima calidad visual) usando el token de visualización (`token[0]`).
    * **Anti-Bot Bypass:** Inyección modular de cookies de **PerimeterX** (`_px`) e intercepción de red para captura de `csrf_token` en tiempo real.
    * **Dynamic Extensions:** Mapeo automático de la extensión del archivo (`.jpg`, `.png`) basado en el esquema `filetype` de la API.


* ✅ **OnlyFans Engine (Full Session Persistence):**
    * **Browser Profile Persistence:** Implementa `userDataDir` para mantener sesiones iniciadas, evitando re-logueos constantes y bloqueos.
    * **Reactive ID Interception:** Detecta dinámicamente el `userId` y metadatos del perfil mediante intercepción de red en tiempo real.
    * **Smart Scroll:** Sistema de desplazamiento que consulta la propiedad `hasMore` de la API para detenerse exactamente al finalizar el contenido.


* ✅ **Pixiv Engine (High-Speed REST):**
    * **Chunk Processing:** Procesa metadatos en bloques de 48 ítems para optimizar el tiempo de respuesta.
    * **Multi-Page Support:** Capacidad para extraer todas las imágenes de una sola publicación (mangas o sets de ilustraciones).
    * **Referer Spoofing:** Gestión automática de headers para evitar el error 403 en los servidores de imágenes de Pixiv.


* ✅ **X (Twitter) Engine:**
    * **Dual Method Processing:** Soporte para descarga en tiempo real (mientras scrollea) o procesamiento por lotes al finalizar la recolección.
    * **Stagnation Detection:** Algoritmo que detecta bloqueos de sesión o límites de contenido para evitar bucles infinitos en perfiles restringidos.


* ✅ **Threads/Instagram Engine:** Consumo de GraphQL y sistemas de detección de spoilers/contenido oculto.
* ✅ **Parallel Downloader:** Procesamiento concurrente basado en la variable `THREADS_DOWNLOAD` para manejar perfiles masivos sin saturar el stack de red.

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
THREADS_DOWNLOAD=5

# Auth Tokens / Sessions
X_AUTH_TOKEN=           # Cookie: auth_token de x.com
PIXIV_PHPSESSID=        # Cookie: PHPSESSID de pixiv.net
PINTEREST_COOKIE=       # Cookie de pinterest.com (valor de _pinterest_sess)
INSTA_SESSIONID=        # Cookie: sessionid de instagram.com
INSTA_CSRF_TOKEN=       # Cookie: csrftoken de instagram.com
THREADS_SESSIONID=      # Cookie: sessionid de threads.net
THREADS_CSRF_TOKEN=     # Cookie: csrftoken de threads.net
DA_AUTH=                # Cookie: auth de deviantart.com
DA_AUTH_SECURE=         # Cookie: auth_secure de deviantart.com
DA_USERINFO=            # Cookie: userinfo de deviantart.com
DA_PX=                  # Cookie: _px' (Larga duración) de deviantart.com
DA_PXVID=               # Cookie: _pxvid de deviantart.com
DA_PXCTS=               # Cookie: pxcts de deviantart.com
```

---

## 📡 Endpoints de la API

| Plataforma | Endpoint | Parámetros | Descripción |
| --- | --- | --- | --- |
| **DeviantArt** | `/deviantart/get-all-media` | `username, limit` | Extracción de galería completa incluyendo Header y Foto de Perfil. |
| **OnlyFans** | `/onlyfans/get-all-media` | `username, limit` | Descarga de contenido mediante persistencia de perfil y smart scroll. |
| **Pixiv** | `/pixiv/get-all-media` | `userId, limit, mediaType` | Extracción masiva de ilustraciones/mangas mediante API interna. |
| **X (Twitter)** | `/x/get-all-media` | `username, limit, method` | Intercepción de JSON `UserMedia` con evasión de estancamiento. |
| **Threads** | `/threads/get-all-media` | `username, limit` | Extracción de metadatos mediante GraphQL y detección de spoilers/ocultos. |
| **TikTok** | `/tiktok/get-all-media` | `username, limit` | Extracción de videos sin marca de agua y foto de perfil. |
| **Pinterest** | `/pinterest/get-all-media` | `username, limit` | Paginación por bookmarks y descarga de imágenes/videos. |
| **Instagram** | `/instagram/get-all-media` | `username, limit` | Descarga de Stories, Highlights, Posts y Reels. |

---

## ⚙️ Configuración de Concurrencia

El sistema implementa un algoritmo de **Pooling de Promesas** mediante la utilidad `mapLimit`.

A diferencia de `Promise.all` estándar, SMF gestiona una cola de ejecución activa. Si `THREADS_DOWNLOAD` es 5, el sistema mantendrá exactamente 5 descargas activas. Esto garantiza estabilidad térmica en el CPU y evita picos de tráfico que activan el *rate-limiting* (baneos por IP).

---

## 🛡 Seguridad y Buenas Prácticas

* **Persistencia de Perfil (OF):** El sistema crea una carpeta `config/of_profile`. Una vez que el usuario se loguea manualmente la primera vez, la sesión queda guardada localmente como un navegador Chrome real.
* **Referer Validation:** Pixiv y X validan el header `Referer`. SMF inyecta dinámicamente la URL del post original en cada descarga para simular tráfico orgánico.
* **Sanitización de Archivos:** Todos los títulos de posts se limpian de caracteres prohibidos (`\/:*?"<>|`) para asegurar compatibilidad con sistemas de archivos Windows/Linux.

---