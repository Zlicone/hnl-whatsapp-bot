const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const http = require('http');

// HNL klubovi
const hnlKlubovi = {
    'dinamo': 'GNK Dinamo Zagreb',
    'hajduk': 'HNK Hajduk Split',
    'rijeka': 'HNK Rijeka',
    'osijek': 'NK Osijek',
    'varaždin': 'NK Varaždin',
    'varazdin': 'NK Varaždin',
    'slaven belupo': 'NK Slaven Belupo',
    'slaven': 'NK Slaven Belupo',
    'istra': 'NK Istra 1961',
    'istra 1961': 'NK Istra 1961',
    'gorica': 'HNK Gorica',
    'lokomotiva': 'NK Lokomotiva Zagreb',
    'vukovar': 'NK Vukovar'
};

const klubPretraga = {
    'dinamo': ['dinamo', 'gnk dinamo', 'plavi'],
    'hajduk': ['hajduk', 'hnk hajduk', 'bili'],
    'rijeka': ['rijeka', 'hnk rijeka'],
    'osijek': ['osijek', 'nk osijek'],
    'varaždin': ['varaždin', 'varazdin'],
    'varazdin': ['varaždin', 'varazdin'],
    'slaven belupo': ['slaven', 'belupo'],
    'slaven': ['slaven', 'belupo'],
    'istra': ['istra', 'istra 1961'],
    'istra 1961': ['istra', 'istra 1961'],
    'gorica': ['gorica'],
    'lokomotiva': ['lokomotiva'],
    'vukovar': ['vukovar']
};

let cacheClanci = {}, cacheVrijeme = null, browser = null, scrapingEnabled = true;
const CACHE_TRAJANJE = 30 * 60 * 1000;

async function initBrowser() {
    if (!browser) {
        console.log('🌐 Pokrećem browser...');
        try {
            browser = await puppeteer.launch({
                args: [
                    ...chromium.args,
                    '--disable-dev-shm-usage',      // Ne koristi /dev/shm
                    '--disable-gpu',                 // Bez GPU
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--single-process',              // Jedan proces (manje RAM-a)
                    '--no-zygote',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-default-apps',
                    '--disable-sync',
                    '--disable-translate',
                    '--disable-software-rasterizer',
                    '--disable-dev-tools'
                ],
                executablePath: await chromium.executablePath(),
                headless: chromium.headless
            });
            console.log('✅ Browser pokrenut!');
            scrapingEnabled = true;
        } catch (err) {
            console.error('❌ Browser greška:', err.message);
            scrapingEnabled = false;
        }
    }
    return browser;
}

async function scrapeClanke(url, izvor, klub) {
    if (!scrapingEnabled) return [];
    try {
        const rijeci = klubPretraga[klub] || [];
        if (!rijeci.length) return [];
        
        console.log(`[${izvor}] Tražim članke za ${klub}...`);
        
        const b = await initBrowser();
        if (!b) return [];
        
        const page = await b.newPage();
        
        // Blokiraj slike, CSS, fontove za brže učitavanje
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Duži timeout i domload samo (ne čekaj sve)
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 10000 
        });
        
        // Pričekaj malo da se elementi učitaju
        await page.waitForTimeout(2000);
        
        const clanci = await page.evaluate((r) => {
            const res = [];
            document.querySelectorAll('article, .article, [class*="article"]').forEach(art => {
                try {
                    const link = art.querySelector('a[href]');
                    const naslov = art.querySelector('h2, h3, .title, [class*="title"], [class*="headline"]');
                    if (!link || !naslov) return;
                    
                    const txt = naslov.textContent.trim().toLowerCase();
                    const sadrziKlub = r.some(rij => txt.includes(rij.toLowerCase()));
                    const sadrziOzl = txt.includes('ozljed') || txt.includes('ozlijed') || 
                                     txt.includes('propušta') || txt.includes('propusta') ||
                                     txt.includes('neće igrati') || txt.includes('nece igrati') ||
                                     txt.includes('upitan') || txt.includes('ozleda') ||
                                     txt.includes('van stroja') || txt.includes('izostao') ||
                                     txt.includes('nedostaje');
                    
                    if (sadrziKlub && sadrziOzl) {
                        res.push({ 
                            naslov: naslov.textContent.trim(), 
                            link: link.href 
                        });
                    }
                } catch (e) {}
            });
            return res.slice(0, 5);
        }, rijeci);
        
        await page.close();
        console.log(`✅ ${izvor}: ${clanci.length} članaka`);
        return clanci.map(c => ({ ...c, izvor }));
    } catch (err) {
        console.error(`❌ ${izvor} greška:`, err.message);
        return [];
    }
}

async function dohvatiClanke(klub) {
    const sada = Date.now();
    if (cacheVrijeme && (sada - cacheVrijeme) < CACHE_TRAJANJE && cacheClanci[klub]) {
        console.log(`[Cache] Koristim cache za ${klub}`);
        return cacheClanci[klub];
    }
    
    console.log(`\n🔍 Dohvaćam članke za ${klub}...`);
    
    const [index, sata, sportske] = await Promise.allSettled([
        scrapeClanke('https://www.index.hr/sport/najnovije/nogomet', 'Index.hr', klub),
        scrapeClanke('https://www.24sata.hr/sport/nogomet', '24sata', klub),
        scrapeClanke('https://sportske.jutarnji.hr/sn/nogomet/hnl', 'Sportske novosti', klub)
    ]);
    
    let sviClanke = [];
    if (index.status === 'fulfilled') sviClanke = [...sviClanke, ...index.value];
    if (sata.status === 'fulfilled') sviClanke = [...sviClanke, ...sata.value];
    if (sportske.status === 'fulfilled') sviClanke = [...sviClanke, ...sportske.value];
    
    cacheClanci[klub] = sviClanke;
    cacheVrijeme = sada;
    
    return sviClanke;
}

async function obradiKomandu(msg, tekst) {
    if (tekst === 'pomoć' || tekst === 'pomoc' || tekst === 'help') {
        return msg.reply(
            '⚽ *HNL Fantasy Bot*\n\n' +
            '📰 *Komande:*\n' +
            '• Naziv kluba → najnoviji članci\n' +
            '• "klubovi" → lista klubova\n' +
            '• "refresh" → osvježi podatke\n\n' +
            '_💡 U grupi: !hnl Dinamo_\n' +
            '_📰 Izvori: Index, 24sata, Sportske_'
        );
    }
    
    if (tekst === 'klubovi') {
        const lista = [...new Set(Object.values(hnlKlubovi))].sort().map(k => `• ${k}`).join('\n');
        return msg.reply(`⚽ *HNL Klubovi:*\n\n${lista}`);
    }
    
    if (tekst === 'refresh') {
        cacheClanci = {};
        cacheVrijeme = null;
        return msg.reply('✅ Cache očišćen!');
    }
    
    if (hnlKlubovi[tekst]) {
        await msg.reply('🔄 Pretražujem novine...');
        
        const clanci = await dohvatiClanke(tekst);
        const naziv = hnlKlubovi[tekst];
        
        if (clanci.length === 0) {
            return msg.reply(
                `✅ *${naziv}*\n\n` +
                `Nema najnovijih članaka o ozljedama.\n\n` +
                `_${new Date().toLocaleString('hr-HR')}_`
            );
        }
        
        let odg = `📰 *${naziv} - Najnovije vijesti*\n\n`;
        
        clanci.forEach((c, i) => {
            odg += `${i + 1}. *${c.izvor}*\n`;
            odg += `   "${c.naslov}"\n`;
            odg += `   ${c.link}\n`;
            if (i < clanci.length - 1) odg += '\n';
        });
        
        odg += `\n\n_Pronađeno: ${clanci.length} članak(a)_\n`;
        odg += `_Zadnje ažurirano: ${new Date().toLocaleString('hr-HR')}_`;
        
        return msg.reply(odg);
    }
    
    return msg.reply(`❌ Klub "${msg.body}" nije pronađen.\nPošalji "klubovi" za listu.`);
}

// === GLAVNI DIO ===
(async () => {
    console.log('🚀 Pokrećem HNL Fantasy Bot...');
    console.log('📰 Izvori: Index, 24sata, Sportske novosti');
    
    const execPath = await chromium.executablePath();
    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: { 
            args: chromium.args, 
            executablePath: execPath, 
            headless: chromium.headless 
        }
    });
    
    client.on('qr', qr => {
        console.log('📱 QR:');
        if (process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') {
            console.log('🔗 QR KOD LINK:');
            console.log(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`);
        } else {
            qrcode.generate(qr, { small: true });
        }
    });
    
    client.on('ready', () => console.log('✅ Bot spreman!'));
    
    client.on('message', async (msg) => {
        const chat = await msg.getChat();
        let tekst = msg.body.toLowerCase().trim();
        
        // U GRUPI - mora počinjati sa !hnl
        if (chat.isGroup) {
            // Ako NE počinje sa !hnl - IGNORIRAJ
            if (!tekst.startsWith('!hnl')) return;
            
            // Makni !hnl prefix
            tekst = tekst.replace('!hnl', '').trim();
            
            // Ako je samo "!hnl" bez ičega - pokaži pomoć
            if (!tekst) {
                return msg.reply('⚽ *HNL Bot*\n\n• `!hnl Dinamo`\n• `!hnl klubovi`\n• `!hnl pomoć`');
            }
        }
        
        // PRIVATNO - radi bez prefixa
        // (tekst ostaje kao što je)
        
        await obradiKomandu(msg, tekst);
    });
    
    client.on('disconnected', r => {
        console.log('⚠️  Disconnected:', r);
        setTimeout(() => client.initialize(), 5000);
    });
    
    process.on('SIGINT', async () => {
        if (browser) await browser.close();
        process.exit(0);
    });
    
    client.initialize();
})();