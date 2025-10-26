const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const http = require('http');
const parseString = require('xml2js').parseString;

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

async function dohvatiClankeRSS(klub) {
  try {
    const klubNaziv = hnlKlubovi[klub];
    console.log(`[Google News] Pretražujem za ${klubNaziv}...`);

    const searchQuery = `${klubNaziv} (ozljeda OR povreda OR neće igrati OR pauza OR upitan OR van stroja) site:(index.hr OR 24sata.hr OR sportske.jutarnji.hr OR tportal.hr OR vecernji.hr OR gol.dnevnik.hr) when:7d`;
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=hr&gl=HR&ceid=HR:hr`;

    const response = await axios.get(rssUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const parsed = await new Promise((resolve, reject) => {
      parseString(response.data, { trim: true }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const items = parsed?.rss?.channel?.[0]?.item || [];
    const sad = new Date();
    const sedamDana = 7 * 24 * 60 * 60 * 1000;
    const itemsRecent = items.filter(item => {
      const pubDate = new Date(item.pubDate?.[0]);
      return sad - pubDate < sedamDana;
    });

    const keywords = [
      'ozljed', 'ozlijed', 'povrij', 'povred',
      'propuš', 'propust', 'neće igr', 'nece igr',
      'van stroja', 'izosta', 'nedosta', 'upitan',
      'pauza', 'otpa', 'bolest', 'rekonvalesc', 'oporavak'
    ];

    const clanci = [];
    itemsRecent.forEach(item => {
      const naslov = item.title?.[0] || '';
      const opis = item.description?.[0] || '';
      const link = item.link?.[0] || '';
      const izvor = item.source?.[0]?._ || item.source?.[0] || 'Google News';
      const tekst = `${naslov} ${opis}`.toLowerCase();
      const imaKeyword = keywords.some(k => tekst.includes(k));

      const klubRegex = new RegExp(`\\b${klubNaziv.split(' ')[0]}\\b`, 'i');
      const sadrziKlub = klubRegex.test(tekst);

      if (imaKeyword && sadrziKlub) {
        clanci.push({
          naslov,
          link,
          izvor,
          pubDate: item.pubDate?.[0]
        });
      }
    });

    const prioritetIzvori = ['index', '24sata', 'sportske', 'jutarnji', 'tportal', 'vecernji', 'gol.dnevnik'];
    clanci.sort((a, b) => {
      const da = new Date(a.pubDate || 0);
      const db = new Date(b.pubDate || 0);
      const priorA = prioritetIzvori.some(p => a.izvor.toLowerCase().includes(p));
      const priorB = prioritetIzvori.some(p => b.izvor.toLowerCase().includes(p));
      if (priorA && !priorB) return -1;
      if (!priorA && priorB) return 1;
      return db - da;
    });

    console.log(`✅ Google News: ${clanci.length} članaka`);
    return clanci.slice(0, 7);
  } catch (err) {
    console.error('❌ Google News greška:', err.message);
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
    
    const clanci = await dohvatiClankeRSS(klub);
    
    cacheClanci[klub] = clanci;
    cacheVrijeme = sada;
    
    return clanci;
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
            '_📰 Izvor: Google News_'
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
        await msg.reply('🔄 Pretražujem...');
        
        const clanci = await dohvatiClanke(tekst);
        const naziv = hnlKlubovi[tekst];
        
        if (clanci.length === 0) {
            return msg.reply(
                `✅ *${naziv}*\n\n` +
                `Nema najnovijih članaka.\n\n` +
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
    console.log('📰 Izvor: Google News');
    
    const PORT = process.env.PORT || 3000;
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('✅ HNL WhatsApp Bot!\n');
    });
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Server na portu ${PORT}`);
    });
    
    const client = new Client({
        authStrategy: new LocalAuth()
    });
    
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