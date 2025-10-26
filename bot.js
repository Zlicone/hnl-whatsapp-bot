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
const parseString = require('xml2js').parseString;

async function dohvatiClankeRSS(klub) {
    try {
        const klubNaziv = hnlKlubovi[klub];
        
        // PROŠIRENE ključne riječi
        const keywords = [
            'ozljeda', 'ozlijeđen', 'ozlijedio',
            'propušta', 'propustio', 'neće igrati',
            'van stroja', 'izostao', 'nedostaje',
            'upitan', 'sumnjiv', 'pauza',
            'povrijeđen', 'povreda'
        ];
        
        // Sve kombinacije: Dinamo + svaka ključna riječ
        const searches = keywords.map(k => `"${klubNaziv}" ${k}`);
        const allClanci = [];
        
        console.log(`[Google News] Pretražujem ${searches.length} kombinacija za ${klubNaziv}...`);
        
        // Pokušaj sa nekoliko različitih pretraga
        for (let i = 0; i < Math.min(3, searches.length); i++) {
            const searchQuery = searches[i];
            const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=hr&gl=HR&ceid=HR:hr`;
            
            try {
                const response = await axios.get(rssUrl, { 
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                const parsed = await new Promise((resolve, reject) => {
                    parseString(response.data, { trim: true }, (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    });
                });
                
                const items = parsed?.rss?.channel?.[0]?.item || [];
                console.log(`  → "${searchQuery}": ${items.length} rezultata`);
                
                items.forEach(item => {
                    const naslov = item.title?.[0] || '';
                    const link = item.link?.[0] || '';
                    const izvor = item.source?.[0]?._ || item.source?.[0] || 'Nepoznat izvor';
                    
                    if (naslov && link) {
                        // Provjeri je li već dodan (izbjegni duplikate)
                        const postoji = allClanci.some(c => c.link === link);
                        if (!postoji) {
                            allClanci.push({ naslov, link, izvor });
                        }
                    }
                });
                
            } catch (searchErr) {
                console.error(`  ✗ Greška za "${searchQuery}":`, searchErr.message);
            }
        }
        
        // Dodatna pretraga - samo naziv kluba (bez ključnih riječi)
        // Možda ima članak koji ne spominje "ozljeda" direktno
        try {
            const basicUrl = `https://news.google.com/rss/search?q="${klubNaziv}"&hl=hr&gl=HR&ceid=HR:hr&num=10`;
            const response = await axios.get(basicUrl, { timeout: 10000 });
            
            const parsed = await new Promise((resolve, reject) => {
                parseString(response.data, { trim: true }, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });
            
            const items = parsed?.rss?.channel?.[0]?.item || [];
            console.log(`  → Osnovna pretraga "${klubNaziv}": ${items.length} rezultata`);
            
            items.forEach(item => {
                const naslov = (item.title?.[0] || '').toLowerCase();
                const link = item.link?.[0] || '';
                const izvor = item.source?.[0]?._ || item.source?.[0] || 'Nepoznat izvor';
                
                // Filtriraj po naslovu - mora sadržavati barem jednu ključnu riječ
                const imaKeyword = keywords.some(k => naslov.includes(k));
                
                if (imaKeyword && link) {
                    const postoji = allClanci.some(c => c.link === link);
                    if (!postoji) {
                        allClanci.push({ 
                            naslov: item.title?.[0] || '', 
                            link, 
                            izvor 
                        });
                    }
                }
            });
            
        } catch (basicErr) {
            console.error('  ✗ Osnovna pretraga greška:', basicErr.message);
        }
        
        // Sortiraj po relevantnosti - stavi Index, 24sata, Sportske na vrh
        const prioritetIzvori = ['index.hr', '24sata', 'sportske', 'jutarnji', 'vecernji', 'slobodna'];
        allClanci.sort((a, b) => {
            const aPrioritet = prioritetIzvori.some(p => a.izvor.toLowerCase().includes(p));
            const bPrioritet = prioritetIzvori.some(p => b.izvor.toLowerCase().includes(p));
            if (aPrioritet && !bPrioritet) return -1;
            if (!aPrioritet && bPrioritet) return 1;
            return 0;
        });
        
        console.log(`✅ Google News: ${allClanci.length} jedinstvenih članaka`);
        return allClanci.slice(0, 7); // Top 7
        
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