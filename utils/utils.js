const mapLimit = async (items, limit, fn) => {
    const results = [];
    const executing = [];
    for (const item of items) {
        const p = Promise.resolve().then(() => fn(item));
        results.push(p);
        if (limit <= items.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= limit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(results);
}

const injectVisualCursor = async (page) => {
    await page.evaluateOnNewDocument(() => {
        const createCursor = () => {
            const box = document.createElement('div');
            box.id = 'puppeteer-mouse-pointer';
            box.style = `
                position: fixed; top: 0; left: 0;
                width: 20px; height: 20px;
                background: rgba(255, 0, 0, 0.9);
                border: 3px solid white; border-radius: 50%;
                margin: -10px 0 0 -10px;
                padding: 0; pointer-events: none;
                z-index: 10000000;
                box-shadow: 0 0 10px rgba(0,0,0,0.5);
                transition: transform 0.05s linear;
            `;
            document.documentElement.appendChild(box);
            document.addEventListener('mousemove', (e) => {
                box.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
            }, true);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', createCursor);
        } else {
            createCursor();
        }
    });
};

const moveMouseInCircle = async (p) => {
    const { w, h } = await p.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

    const centerX = (w / 2) + (Math.random() * 20 - 10);
    const centerY = (h / 2) + (Math.random() * 20 - 10);
    
    const baseRadius = 100;
    const steps = 40;

    for (let i = 0; i <= steps; i++) {
        const drift = Math.sin(i * 0.5) * 0.1; 
        const angle = ((i / steps) * (Math.PI * 2)) + drift;

        const irregularRadius = baseRadius + (Math.random() * 15 - 7.5) + (Math.cos(i * 0.3) * 10);

        const x = centerX + irregularRadius * Math.cos(angle);
        const y = centerY + irregularRadius * Math.sin(angle);

        await p.mouse.move(x, y);
        
        const delay = 15 + Math.random() * 25;
        await new Promise(r => setTimeout(r, delay));
    }
};

module.exports = { mapLimit, injectVisualCursor, moveMouseInCircle };