const hideSidebar = async (page) => {
    const hideStyle = `
        nav, div[role="navigation"], 
        div[id^="mount"] > div > div > div > div > div > div > div > div > div > div { 
            display: none !important; 
            visibility: hidden !important; 
            width: 0px !important;
        }
    `;
    await page.addStyleTag({ content: hideStyle });
};

const removeSidebar = async (page) => {
    try {
        await hideSidebar(page);
        await page.evaluate(() => {
            const root = document.querySelector('div#mount_0_0_1, div[id^="mount"]');
            if (!root) return;

            const sidebar = root.querySelector('nav') || 
                            root.querySelector('div[role="navigation"]') ||
                            root.querySelector('div div div div div div div div div div');

            if (sidebar) {
                sidebar.remove();
                console.log("Sidebar eliminado");
            }
        });
    } catch (e) {
        console.log("Error al intentar borrar el elemento:", e.message);
    }
};



module.exports = { removeSidebar };