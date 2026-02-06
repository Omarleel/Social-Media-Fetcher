const smartScroll = async (page, checkHasMore) => {
    let continueScrolling = true;
    
    while (continueScrolling) {
        await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight * 2);
        });

        // Espera de 1 segundo para permitir que la API responda y el interceptor actualice hasMore
        await new Promise(r => setTimeout(r, 1200));

        continueScrolling = checkHasMore();
        
        if (continueScrolling) {
            //console.log("⏬ Scrolleando... (la API dice que hay más)");
        } else {
            console.log("🛑 Fin del contenido alcanzado.");
        }

        // Seguridad adicional: si el botón de "fin" aparece en el DOM
        const isEnd = await page.evaluate(() => {
            return document.body.innerText.includes("No more posts");
        });
        if (isEnd) break;
    }
}

module.exports = { smartScroll };