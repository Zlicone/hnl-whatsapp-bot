const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
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

let cacheClanci = {}, cacheVrijeme = null;
const CACHE_TRAJANJE = 30 * 60 * 1000;

// Dohvati članke iz Google News RSS
async function dohvatiClankeRSS(klub) {
    try {
        const klubNaziv = hnlKlubovi[klub];
        
        // Google News pretraga za klub + ozljeda keywords
        const searchQuery = `"${klubNaziv}" (ozljeda OR ozlijeđen OR propušta OR upitan OR "neće igrati" OR "van stroja")`;
        const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=hr&gl=HR&ceid=HR:hr`;
        
        console.log(`[Google News] Pretražujem za ${klubNaziv}...`);
        
        const response = await axios.get(rssUrl, { 
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        // Parsiraj XML (jednostavno)
        const clanci = [];
        const items = response.data.match(/<item>[\s\S]*?<\/item>/g) || [];
        
        items.slice(0, 5).forEach(item => {
            const naslovMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
            const linkMatch = item.match(/<link>(.*?)<\/link>/);
            const izvorMatch = item.match(/<source[^>]*>(.*?)<\/source>/);
            
            if (naslovMatch && linkMatch) {
                clanci.push({
                    naslov: naslovMatch[1].trim(),
                    link: linkMatch[1].trim(),
                    izvor: izvorMatch ? izvorMatch[1].trim() : 'Google News'
                });
            }
        });
        
        console.log(`✅ Google News: ${clanci.length} članaka`);
        return clanci;
        
    } catch (err) {
        console.error('❌ Google News greška:', err.message);
        return [];
    }
}

// Dohvati članke s cachingom
async function dohvatiClanke(klub) {
    const sada = Date.now();
    if (cacheVrijeme && (sada - cacheVrijeme) < CACHE_TRAJANJE && cacheClanci[klub]) {
        console.log(`[Cache] Koristim cache za ${klub}`);
        return cacheClanci[klub];
    }
    
    console.log(`\n🔍 Dohvaćam članke za ${klub}...`);
    
    const clanci = await dohvatiClankeRSS(klub);
    
    cacheClanci[klub] = clanci;
    cacheVrijeme = sada;
    
    return clanci;
}

// Obrada komandi
async function obradiKomandu(msg, tekst) {
    if (tekst === 'pomoć' || tekst === 'pomoc' || tekst === 'help') {
        return msg.reply(
            '⚽ *HNL Fantasy Bot*\n\n' +
            '📰 *Komande:*\n' +
            '• Naziv kluba → najnoviji članci\n' +
            '• "klubovi" → lista klubova\n' +
            '• "refresh" → osvježi podatke\n\n' +
            '_💡 U grupi: !hnl Dinamo_\n' +
            '_📰 Izvor: Google News (Index, 24sata, Sportske...)_'
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
        await msg.reply('🔄 Pretražujem Google News...');
        
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
    console.log('📰 Izvor: Google News (agregira Index, 24sata, Sportske...)');
    
    // HTTP server za Render
    const PORT = process.env.PORT || 3000;
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('✅ HNL WhatsApp Bot radi!\n');
    });
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Server na portu ${PORT}`);
    });
    
    // WhatsApp Client
    const client = new Client({
        authStrategy: new LocalAuth()
    });
    
    client.on('qr', qr => {
        console.log('📱 QR KOD:');
        if (process.env.RENDER || process.env.NODE_ENV === 'production') {
            console.log('🔗 Otvori link:');
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