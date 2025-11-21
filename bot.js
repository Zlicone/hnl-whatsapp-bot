const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');
const P = require('pino');

// Logger (Baileys ga traži)
const logger = P({ level: 'silent' });

// Steel browser URL
const STEEL_URL = process.env.STEEL_URL || 'https://steel-browser-hnl.fly.dev';

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

// Scrape kroz Steel
async function scrapeWithSteel(url) {
    try {
        console.log(`[Steel] Scraping ${url}...`);
        const response = await axios.post(`${STEEL_URL}/v1/scrape`, {
            url: url,
            delay: 2000
        }, { timeout: 30000 });
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

// Scrape Sportske
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

// Obrada komandi
async function obradiKomandu(sock, from, tekst) {
    if (tekst === 'pomoć' || tekst === 'pomoc' || tekst === 'help') {
        await sock.sendMessage(from, {
            text: '⚽ *HNL Fantasy Bot*\n\n' +
                  '📰 *Komande:*\n' +
                  '• Naziv kluba → najnoviji članci\n' +
                  '• "klubovi" → lista klubova\n' +
                  '• "refresh" → osvježi podatke\n\n' +
                  '_💡 U grupi: !hnl Dinamo_\n' +
                  '_📰 Izvori: Index, 24sata, Sportske_'
        });
        return;
    }
    
    if (tekst === 'klubovi') {
        const lista = [...new Set(Object.values(hnlKlubovi))].sort().map(k => `• ${k}`).join('\n');
        await sock.sendMessage(from, { text: `⚽ *HNL Klubovi:*\n\n${lista}` });
        return;
    }
    
    if (tekst === 'refresh') {
        cacheClanci = {};
        cacheVrijeme = null;
        await sock.sendMessage(from, { text: '✅ Cache očišćen!' });
        return;
    }
    
    if (hnlKlubovi[tekst]) {
        await sock.sendMessage(from, { text: '🔄 Pretražujem novine...' });
        
        const clanci = await dohvatiClanke(tekst);
        const naziv = hnlKlubovi[tekst];
        
        if (clanci.length === 0) {
            await sock.sendMessage(from, {
                text: `✅ *${naziv}*\n\nNema najnovijih članaka o ozljedama.\n\n_${new Date().toLocaleString('hr-HR')}_`
            });
            return;
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
        
        await sock.sendMessage(from, { text: odg });
        return;
    }
    
    await sock.sendMessage(from, { text: `❌ Klub "${tekst}" nije pronađen.\nPošalji "klubovi" za listu.` });
}

// Pokreni WhatsApp bota
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger
    });
    
    // QR kod
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📱 QR KOD:');
            if (process.env.RENDER || process.env.NODE_ENV === 'production') {
                console.log('🔗 Link:');
                console.log(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`);
            } else {
                qrcode.generate(qr, { small: true });
            }
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️  Disconnected:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot spreman!');
        }
    });
    
    // Spremi credentials
    sock.ev.on('creds.update', saveCreds);
    
    // Poruke
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;
        
        const from = m.key.remoteJid;
        const messageText = m.message.conversation || m.message.extendedTextMessage?.text || '';
        let tekst = messageText.toLowerCase().trim();
        
        // Grupa
        const isGroup = from.endsWith('@g.us');
        
        if (isGroup) {
            if (!tekst.startsWith('!hnl')) return;
            tekst = tekst.replace('!hnl', '').trim();
            if (!tekst) {
                await sock.sendMessage(from, {
                    text: '⚽ *HNL Bot*\n\n• `!hnl Dinamo`\n• `!hnl klubovi`\n• `!hnl pomoć`'
                });
                return;
            }
        }
        
        await obradiKomandu(sock, from, tekst);
    });
}

// HTTP server za Render
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('✅ HNL WhatsApp Bot!\n');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server na portu ${PORT}`);
});

// Start
console.log('🚀 Pokrećem HNL Fantasy Bot (Baileys)...');
console.log(`📡 Steel Browser: ${STEEL_URL}`);
startBot();