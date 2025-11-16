const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');

// Steel browser URL - ZAMIJENI SA SVOJIM!
const STEEL_URL = process.env.STEEL_URL || 'https://hnl-whatsapp-bot.fly.dev';

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

let cacheClanci = {}, cacheVrijeme = null;
const CACHE_TRAJANJE = 30 * 60 * 1000;

// Scrape stranicu kroz steel-browser
async function scrapeWithSteel(url) {
    try {
        console.log(`[Steel] Scraping ${url}...`);
        
        const response = await axios.post(`${STEEL_URL}/v1/scrape`, {
            url: url,
            delay: 2000
        }, {
            timeout: 30000
        });
        
        return response.data;
    } catch (err) {
        console.error(`[Steel] Greška:`, err.message);
        return null;
    }
}

// Scrape Index.hr
async function scrapeIndex(klub) {
    try {
        const html = await scrapeWithSteel('https://www.index.hr/sport/najnovije/nogomet');
        if (!html) return [];
        
        const $ = cheerio.load(html);
        const clanci = [];
        
        const klubNaziv = hnlKlubovi[klub].toLowerCase();
        const keywords = ['ozljed', 'propuš', 'upitan', 'van stroja', 'nedosta', 'bez'];
        
        $('article, .article, [class*="article"]').each((i, el) => {
            const $el = $(el);
            const naslov = $el.find('h2, h3, .title, [class*="title"]').text().trim();
            const link = $el.find('a').attr('href');
            
            if (!naslov || !link) return;
            
            const tekst = naslov.toLowerCase();
            const sadrziKlub = klubNaziv.split(' ').some(k => tekst.includes(k));
            const sadrziKeyword = keywords.some(k => tekst.includes(k));
            
            if (sadrziKlub && sadrziKeyword) {
                clanci.push({
                    naslov,
                    link: link.startsWith('http') ? link : `https://www.index.hr${link}`,
                    izvor: 'Index.hr'
                });
            }
        });
        
        console.log(`[Index] ${clanci.length} članaka`);
        return clanci.slice(0, 3);
    } catch (err) {
        console.error('[Index] Greška:', err.message);
        return [];
    }
}

// Scrape 24sata
async function scrape24sata(klub) {
    try {
        const html = await scrapeWithSteel('https://www.24sata.hr/sport/nogomet');
        if (!html) return [];
        
        const $ = cheerio.load(html);
        const clanci = [];
        
        const klubNaziv = hnlKlubovi[klub].toLowerCase();
        const keywords = ['ozljed', 'propuš', 'upitan', 'van stroja', 'nedosta', 'bez'];
        
        $('article, .article, [class*="article"]').each((i, el) => {
            const $el = $(el);
            const naslov = $el.find('h2, h3, .title, [class*="title"]').text().trim();
            const link = $el.find('a').attr('href');
            
            if (!naslov || !link) return;
            
            const tekst = naslov.toLowerCase();
            const sadrziKlub = klubNaziv.split(' ').some(k => tekst.includes(k));
            const sadrziKeyword = keywords.some(k => tekst.includes(k));
            
            if (sadrziKlub && sadrziKeyword) {
                clanci.push({
                    naslov,
                    link: link.startsWith('http') ? link : `https://www.24sata.hr${link}`,
                    izvor: '24sata'
                });
            }
        });
        
        console.log(`[24sata] ${clanci.length} članaka`);
        return clanci.slice(0, 3);
    } catch (err) {
        console.error('[24sata] Greška:', err.message);
        return [];
    }
}

// Scrape Sportske novosti
async function scrapeSportske(klub) {
    try {
        const html = await scrapeWithSteel('https://sportske.jutarnji.hr/sn/nogomet/hnl');
        if (!html) return [];
        
        const $ = cheerio.load(html);
        const clanci = [];
        
        const klubNaziv = hnlKlubovi[klub].toLowerCase();
        const keywords = ['ozljed', 'propuš', 'upitan', 'van stroja', 'nedosta', 'bez'];
        
        $('article, .article, [class*="article"]').each((i, el) => {
            const $el = $(el);
            const naslov = $el.find('h2, h3, .title, [class*="title"]').text().trim();
            const link = $el.find('a').attr('href');
            
            if (!naslov || !link) return;
            
            const tekst = naslov.toLowerCase();
            const sadrziKlub = klubNaziv.split(' ').some(k => tekst.includes(k));
            const sadrziKeyword = keywords.some(k => tekst.includes(k));
            
            if (sadrziKlub && sadrziKeyword) {
                clanci.push({
                    naslov,
                    link: link.startsWith('http') ? link : `https://sportske.jutarnji.hr${link}`,
                    izvor: 'Sportske novosti'
                });
            }
        });
        
        console.log(`[Sportske] ${clanci.length} članaka`);
        return clanci.slice(0, 3);
    } catch (err) {
        console.error('[Sportske] Greška:', err.message);
        return [];
    }
}

// Dohvati sve članke
async function dohvatiClanke(klub) {
    const sada = Date.now();
    if (cacheVrijeme && (sada - cacheVrijeme) < CACHE_TRAJANJE && cacheClanci[klub]) {
        console.log(`[Cache] Koristim cache za ${klub}`);
        return cacheClanci[klub];
    }
    
    console.log(`\n🔍 Dohvaćam članke za ${klub}...`);
    
    const [index, sata, sportske] = await Promise.allSettled([
        scrapeIndex(klub),
        scrape24sata(klub),
        scrapeSportske(klub)
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
        odg += `_${new Date().toLocaleString('hr-HR')}_`;
        
        return msg.reply(odg);
    }
    
    return msg.reply(`❌ Klub "${msg.body}" nije pronađen.\nPošalji "klubovi" za listu.`);
}

(async () => {
    console.log('🚀 Pokrećem HNL Fantasy Bot...');
    console.log(`📡 Steel Browser: ${STEEL_URL}`);
    
    const PORT = process.env.PORT || 3000;
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('✅ HNL WhatsApp Bot!\n');
    });
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Server na portu ${PORT}`);
    });
    
    const client = new Client({ authStrategy: new LocalAuth() });
    
    client.on('qr', qr => {
        console.log('📱 QR KOD:');
        if (process.env.RENDER || process.env.NODE_ENV === 'production') {
            console.log('🔗 Link:');
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
            if (!tekst.startsWith('!hnl')) return;
            tekst = tekst.replace('!hnl', '').trim();
            if (!tekst) {
                return msg.reply('⚽ *HNL Bot*\n\n• `!hnl Dinamo`\n• `!hnl klubovi`\n• `!hnl pomoć`');
            }
        }
        
        await obradiKomandu(msg, tekst);
    });
    
    client.on('disconnected', r => {
        console.log('⚠️  Disconnected:', r);
        setTimeout(() => client.initialize(), 5000);
    });
    
    process.on('SIGINT', () => process.exit(0));
    
    client.initialize();
})();