Aquí tienes la documentación actualizada para el motor de **DeviantArt**, integrando las capacidades de extracción de metadatos del DOM, gestión de cookies de seguridad y el sistema de reintentos por tokens de visualización.

---

## Documentación Actualizada: DeviantArt Engine

He añadido la sección específica de DeviantArt y actualizado las variables de entorno necesarias.

### ✅ **DeviantArt Engine (Hybrid Scraper):**

* **Deep Metadata Extraction:**
* **Profile Header Detection:** Utiliza evaluación de DOM en tiempo real para extraer la URL del banner de perfil desde los estilos computados del contenedor CSS (`background-image`).
* **Profile Class:** Implementación de la clase `Profile` con limpieza implícita de `@` en el `username`, garantizando rutas de almacenamiento normalizadas.


* **Multi-Token Fallback Logic:** * Detecta si una obra tiene habilitado el botón de "Download" (Token de descarga original).
* Si no es descargable, el sistema construye dinámicamente la URL de **Fullview** combinando el `baseUri`, el `prettyName` y las dimensiones del esquema `media.types`.


* **PerimeterX & CSRF Bypass:**
* **Puppeteer Stealth Interception:** Captura el `csrf_token` directamente desde el tráfico de red de la API Puppy.
* **Cookie Sync:** Inyecta cookies críticas (`_px`, `_pxvid`) para mimetizar la huella digital del navegador y evitar el error 403 en peticiones masivas.



---

### 📡 Nuevos Endpoints

| Plataforma | Endpoint | Parámetros | Descripción |
| --- | --- | --- | --- |
| **DeviantArt** | `/deviantart/get-all-media` | `username, limit` | Extracción de galería completa incluyendo Header y Foto de Perfil. |

---

### ⚙️ Variables de Entorno (Actualizado)

Debes añadir estas variables a tu archivo `.env` para que el motor de DeviantArt funcione correctamente:

```env
# --- DEVIANTART AUTH (Cookies de Sesión) ---
DA_AUTH=                # Valor de la cookie 'auth'
DA_AUTH_SECURE=         # Valor de la cookie 'auth_secure'
DA_USERINFO=            # Valor de la cookie 'userinfo'

# --- DEVIANTART SECURITY (PerimeterX) ---
DA_PX=                  # Valor de la cookie '_px' (Larga duración)
DA_PXVID=               # Valor de la cookie '_pxvid'
DA_PXCTS=               # Valor de la cookie 'pxcts'

```

---

### 🛡 Lógica de Descarga Inteligente

El sistema utiliza un diagrama de flujo para decidir qué calidad descargar según la disponibilidad de los tokens en la API Puppy de DeviantArt:

1. **¿Existe token[1]?** Descarga el archivo original.
2. **¿Solo existe token[0]?** Construye la URL de Fullview (máxima calidad de visualización) y ajusta los headers de `Sec-Fetch` para evitar el bloqueo 403.
3. **Sanitización:** Utiliza el campo `filetype` del JSON para asignar la extensión correcta (`.jpg`, `.png`) evitando archivos corruptos.

---

### 🚀 Próximos Pasos Sugeridos

¿Te gustaría que implementara un **Logger visual** en la consola que muestre una tabla comparativa entre las imágenes que se descargaron como "Original" frente a las de "Fullview"?