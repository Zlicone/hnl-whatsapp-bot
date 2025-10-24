const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

// HNL klubovi
const hnlKlubovi = {
    'dinamo': { naziv: 'GNK Dinamo Zagreb', url: 'https://www.transfermarkt.com/gnk-dinamo-zagreb/verletzungen/verein/419' },
    'hajduk': { naziv: 'HNK Hajduk Split', url: 'https://www.transfermarkt.com/hnk-hajduk-split/verletzungen/verein/760' },
    'rijeka': { naziv: 'HNK Rijeka', url: 'https://www.transfermarkt.com/hnk-rijeka/verletzungen/verein/3581' },
    'osijek': { naziv: 'NK Osijek', url: 'https://www.transfermarkt.com/nk-osijek/verletzungen/verein/2976' },
    'varaždin': { naziv: 'NK Varaždin', url: 'https://www.transfermarkt.com/nk-varazdin/verletzungen/verein/37057' },
    'varazdin': { naziv: 'NK Varaždin', url: 'https://www.transfermarkt.com/nk-varazdin/verletzungen/verein/37057' },
    'slaven belupo': { naziv: 'NK Slaven Belupo', url: 'https://www.transfermarkt.com/nk-slaven-belupo/verletzungen/verein/10104' },
    'slaven': { naziv: 'NK Slaven Belupo', url: 'https://www.transfermarkt.com/nk-slaven-belupo/verletzungen/verein/10104' },
    'istra': { naziv: 'NK Istra 1961', url: 'https://www.transfermarkt.com/nk-istra-1961/verletzungen/verein/4623' },
    'istra 1961': { naziv: 'NK Istra 1961', url: 'https://www.transfermarkt.com/nk-istra-1961/verletzungen/verein/4623' },
    'gorica': { naziv: 'HNK Gorica', url: 'https://www.transfermarkt.com/hnk-gorica/verletzungen/verein/17937' },
    'lokomotiva': { naziv: 'NK Lokomotiva Zagreb', url: 'https://www.transfermarkt.com/nk-lokomotiva-zagreb/verletzungen/verein/7998' },
    'vukovar': { naziv: 'NK Vukovar', url: 'https://www.transfermarkt.com/nk-vukovar/verletzungen/verein/70315' }
};

const klubPretraga = {
    'dinamo': ['dinamo', 'gnk dinamo', 'plavi'], 'hajduk': ['hajduk', 'hnk hajduk', 'bili'],
    'rijeka': ['rijeka', 'hnk rijeka'], 'osijek': ['osijek', 'nk osijek'],
    'varaždin': ['varaždin', 'varazdin'], 'varazdin': ['varaždin', 'varazdin'],
    'slaven belupo': ['slaven', 'belupo'], 'slaven': ['slaven', 'belupo'],
    'istra': ['istra', 'istra 1961'], 'istra 1961': ['istra', 'istra 1961'],
    'gorica': ['gorica'], 'lokomotiva': ['lokomotiva'], 'vukovar': ['vukovar']
};

let cacheOzljede = {}, cacheVrijeme = null, browser = null, scrapingEnabled = true;
const CACHE_TRAJANJE = 30 * 60 * 1000;

async function initBrowser() {
    if (!browser) {
        console.log('🌐 Pokrećem browser...');
        try {
            browser = await puppeteer.launch({
                args: chromium.args,
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

async function scrapeTransfermarkt(klub) {
    if (!scrapingEnabled) return [];
    try {
        const klubInfo = hnlKlubovi[klub];
        if (!klubInfo) return [];
        console.log(`[TM] ${klubInfo.naziv}...`);
        const b = await initBrowser();
        if (!b) return [];
        const page = await b.newPage();
        await page.goto(klubInfo.url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForSelector('.items', { timeout: 10000 });
        const ozljede = await page.evaluate(() => {
            const r = [];
            document.querySelectorAll('.items tbody tr').forEach(row => {
                if (row.classList.contains('thead')) return;
                try {
                    const ime = row.querySelector('.hauptlink a')?.textContent.trim();
                    if (!ime) return;
                    const poz = row.querySelector('.inline-table tr:first-child td:last-child')?.textContent.trim() || 'N/A';
                    const cells = row.querySelectorAll('td');
                    const ozl = cells[3]?.textContent.trim() || 'Nepoznato';
                    const povratak = cells[5]?.textContent.trim() || 'N/A';
                    r.push({
                        ime, pozicija: poz, razlog: ozl,
                        procjena: povratak !== '-' ? `Povratak: ${povratak}` : 'Nepoznato',
                        status: povratak === '-' || povratak === '?' ? 'upitan' : 'ozlijeđen'
                    });
                } catch (e) {}
            });
            return r;
        });
        await page.close();
        console.log(`✅ ${klubInfo.naziv}: ${ozljede.length}`);
        return ozljede;
    } catch (err) {
        console.error(`❌ ${klub}:`, err.message);
        return [];
    }
}

async function scrapeClanke(url, izvor, klub) {
    if (!scrapingEnabled) return [];
    try {
        const rijeci = klubPretraga[klub] || [];
        if (!rijeci.length) return [];
        const b = await initBrowser();
        if (!b) return [];
        const page = await b.newPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        const clanci = await page.evaluate((r) => {
            const res = [];
            document.querySelectorAll('article, .article').forEach(art => {
                try {
                    const link = art.querySelector('a[href]');
                    const naslov = art.querySelector('h2, h3, .title');
                    if (!link || !naslov) return;
                    const txt = naslov.textContent.trim().toLowerCase();
                    const sadrziKlub = r.some(rij => txt.includes(rij.toLowerCase()));
                    const sadrziOzl = txt.includes('ozljed') || txt.includes('propušta') || txt.includes('upitan');
                    if (sadrziKlub && sadrziOzl) res.push({ naslov: naslov.textContent.trim(), link: link.href });
                } catch (e) {}
            });
            return res.slice(0, 3);
        }, rijeci);
        await page.close();
        return clanci.map(c => ({ ...c, izvor }));
    } catch (err) {
        return [];
    }
}

async function dohvatiOzljede(klub) {
    const sada = Date.now();
    if (cacheVrijeme && (sada - cacheVrijeme) < CACHE_TRAJANJE && cacheOzljede[klub]) {
        return cacheOzljede[klub];
    }
    const ozljede = await scrapeTransfermarkt(klub);
    const [i, s, sp] = await Promise.allSettled([
        scrapeClanke('https://www.index.hr/sport/najnovije/nogomet', 'Index.hr', klub),
        scrapeClanke('https://www.24sata.hr/sport/nogomet', '24sata', klub),
        scrapeClanke('https://sportske.jutarnji.hr/sn/nogomet/hnl', 'Sportske', klub)
    ]);
    let clanci = [];
    if (i.status === 'fulfilled') clanci = [...clanci, ...i.value];
    if (s.status === 'fulfilled') clanci = [...clanci, ...s.value];
    if (sp.status === 'fulfilled') clanci = [...clanci, ...sp.value];
    cacheOzljede[klub] = { ozljede, clanci };
    cacheVrijeme = sada;
    return cacheOzljede[klub];
}

async function obradiKomandu(msg, tekst) {
    if (tekst === 'pomoć' || tekst === 'pomoc' || tekst === 'help') {
        return msg.reply('⚽ *HNL Bot*\n\n• Klub → ozljede\n• "klubovi"\n• "sve"\n• "refresh"');
    }
    if (tekst === 'klubovi') {
        const lista = [...new Set(Object.values(hnlKlubovi).map(k => k.naziv))].sort().map(k => `• ${k}`).join('\n');
        return msg.reply(`⚽ *HNL:*\n\n${lista}`);
    }
    if (tekst === 'refresh') {
        cacheOzljede = {}; cacheVrijeme = null;
        return msg.reply('✅ Cache očišćen!');
    }
    if (tekst === 'sve') {
        await msg.reply('🔄 Dohvaćam...');
        let odg = '🏥 *HNL Ozljede*\n\n', br = 0;
        const unik = {};
        for (const [k, i] of Object.entries(hnlKlubovi)) unik[i.naziv] = k;
        for (const [n, k] of Object.entries(unik)) {
            const p = await dohvatiOzljede(k);
            if (p.ozljede.length) {
                odg += `*${n}*\n`;
                p.ozljede.forEach(ig => {
                    odg += `${ig.status === 'ozlijeđen' ? '🔴' : '🟡'} ${ig.ime} - ${ig.razlog}\n`;
                    br++;
                });
                odg += '\n';
            }
        }
        return msg.reply(br ? odg + `_Ukupno: ${br}_` : '✅ Nema ozljeda!');
    }
    if (hnlKlubovi[tekst]) {
        await msg.reply('🔄 Dohvaćam...');
        const p = await dohvatiOzljede(tekst);
        const n = hnlKlubovi[tekst].naziv;
        if (!p.ozljede.length && !p.clanci.length) {
            return msg.reply(`✅ *${n}*\n\nNema ozljeda! 💪`);
        }
        let odg = `🏥 *${n}*\n\n`;
        if (p.ozljede.length) {
            odg += '*📊 Ozljede:*\n\n';
            p.ozljede.forEach(ig => {
                odg += `${ig.status === 'ozlijeđen' ? '🔴' : '🟡'} *${ig.ime}*`;
                if (ig.pozicija !== 'N/A') odg += ` (${ig.pozicija})`;
                odg += `\n   ${ig.razlog}\n`;
                if (ig.procjena !== 'Nepoznato') odg += `   ${ig.procjena}\n`;
                odg += '\n';
            });
        }
        if (p.clanci.length) {
            odg += '*📰 Vijesti:*\n\n';
            p.clanci.forEach(c => odg += `• *${c.izvor}*\n  "${c.naslov}"\n  ${c.link}\n\n`);
        }
        return msg.reply(odg);
    }
    return msg.reply(`❌ Nije pronađeno: "${msg.body}"`);
}

// === GLAVNI DIO ===
(async () => {
    console.log('🚀 Pokrećem HNL Bot...');
    const execPath = await chromium.executablePath();
    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: { args: chromium.args, executablePath: execPath, headless: chromium.headless }
    });
    
    client.on('qr', qr => {
        console.log('📱 QR:');
        if (process.env.RAILWAY_ENVIRONMENT || process.env.RENDER) {  // RENDER
        console.log(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`);
    } else {
        qrcode.generate(qr, { small: true });
    }
    });
    
    client.on('ready', () => console.log('✅ Bot spreman!'));
    
    client.on('message', async (msg) => {
        const chat = await msg.getChat();
        let tekst = msg.body.toLowerCase().trim();
        
        if (chat.isGroup) {
            if (!tekst.startsWith('@bot') && !tekst.startsWith('!hnl') && !tekst.startsWith('/hnl')) return;
            tekst = tekst.replace('@bot', '').replace('!hnl', '').replace('/hnl', '').trim();
            if (!tekst) return msg.reply('⚽ *HNL Bot*\n\n• `!hnl Dinamo`\n• `!hnl sve`\n• `!hnl klubovi`');
        }
        
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