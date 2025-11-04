require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const http = require('http');
const parseString = require('xml2js').parseString;
const { chromium } = require('playwright');

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
let browser = null;

// Inicijaliziraj browser jednom
async function getBrowser() {
  if (!browser) {
    console.log('🎭 Pokrećem Playwright browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browser;
}

// Funkcija za scraping članka - PLAYWRIGHT (radi 100%)
async function dohvatiDetaljeClanka(url) {
  let page = null;
  let context = null;
  
  try {
    console.log(`  🌐 Playwright čita: ${url.substring(0, 50)}...`);
    
    const browserInstance = await getBrowser();
    
    // Napravi context s blokiranjem nepotrebnih resursa (brže)
    context = await browserInstance.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    
    // Blokiraj slike, CSS, fontove za brzinu
    await context.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    page = await context.newPage();
    
    // Navigiraj na stranicu
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 15000 
    });
    
    // Sačekaj malo da se sadržaj učita
    await page.waitForTimeout(2000);
    
    // Izvuci tekst i provjeri keywordove
    const result = await page.evaluate(() => {
      // Probaj razne selektore za članke
      const selectors = [
        'article',
        '.article-content',
        '.article-body',
        '.post-content',
        '.entry-content',
        'main article',
        '[class*="article"]',
        '[class*="content"]'
      ];
      
      let tekst = '';
      
      // Pokušaj svaki selektor
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.innerText.length > 200) {
          tekst = element.innerText;
          break;
        }
      }
      
      // Fallback - uzmi cijeli body ako ništa nije pronađeno
      if (!tekst || tekst.length < 200) {
        // Ukloni navigaciju, footer, sidebar
        const nav = document.querySelector('nav');
        const header = document.querySelector('header');
        const footer = document.querySelector('footer');
        const aside = document.querySelector('aside');
        
        [nav, header, footer, aside].forEach(el => {
          if (el) el.remove();
        });
        
        tekst = document.body.innerText;
      }
      
      // Očisti tekst
      tekst = tekst
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, ' ')
        .trim();
      
      // Keywordovi o ozljedama/nedostajućim igračima
      const keywords = [
        'ozljed', 'ozlijed', 'povrij', 'povred',
        'nedosta', 'propuš', 'propust', 
        'van stroja', 'izosta', 'bez',
        'neće igr', 'nece igr', 'upitan',
        'pauza', 'otpa', 'bolest', 'operac',
        'oporavak', 'liječenj', 'rekonvalesc'
      ];
      
      const tekstLower = tekst.toLowerCase();
      const pronadjeniKeywords = keywords.filter(k => tekstLower.includes(k));
      const relevantan = pronadjeniKeywords.length > 0;
      
      return { 
        tekst: tekst.substring(0, 800), 
        relevantan,
        duzina: tekst.length,
        keywords: pronadjeniKeywords
      };
    });
    
    await page.close();
    await context.close();
    
    if (result.relevantan) {
      console.log(`    ✅ RELEVANTAN! Ključne riječi: ${result.keywords.join(', ')}`);
    } else {
      console.log(`    ❌ Nije relevantan (${result.duzina} znakova)`);
    }
    
    return result;
    
  } catch (err) {
    console.error(`  ❌ Playwright greška: ${err.message}`);
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    return null;
  }
}

async function dohvatiClankeRSS(klub) {
  try {
    const klubNaziv = hnlKlubovi[klub];
    console.log(`\n[Google News] Pretražujem za ${klubNaziv}...`);

    const searchQuery = `"${klubNaziv}" (site:index.hr OR site:24sata.hr OR site:sportske.jutarnji.hr OR site:vecernji.hr OR site:jutarnji.hr OR site:tportal.hr)`;
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=hr&gl=HR&ceid=HR:hr`;

    const response = await axios.get(rssUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    const parsed = await new Promise((resolve, reject) => {
      parseString(response.data, { trim: true }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const items = parsed?.rss?.channel?.[0]?.item || [];
    console.log(`→ Pronađeno ${items.length} članaka na Google News`);

    const keywords = [
      'ozljed', 'ozlijed', 'povrij', 'povred',
      'propuš', 'propust', 'neće igr', 'nece igr',
      'van stroja', 'izosta', 'nedosta', 'upitan',
      'pauza', 'otpa', 'bolest', 'bez'
    ];

    const clanci = [];
    
    // FAZA 1: Brza provjera - keywordovi u naslovu
    console.log('🔍 Faza 1: Pretraga po naslovima...');
    for (const item of items.slice(0, 15)) {
      const naslov = item.title?.[0] || '';
      const link = item.link?.[0] || '';
      const izvor = item.source?.[0]?._ || item.source?.[0] || 'Google News';
      const pubDate = item.pubDate?.[0] || '';
      
      const naslovLower = naslov.toLowerCase();
      const imaKeyword = keywords.some(k => naslovLower.includes(k));
      
      if (link && imaKeyword) {
        clanci.push({ naslov, link, izvor, pubDate, metoda: 'naslov' });
        console.log(`  ✅ "${naslov.substring(0, 60)}..."`);
      }
    }

    // FAZA 2: Duboko skeniranje sa Playwright (samo ako nema rezultata)
    if (clanci.length === 0) {
      console.log('\n🎭 Faza 2: Duboko skeniranje sa Playwright...');
      
      const clanciZaSken = items.slice(0, 5); // Skeniraj prvih 5
      
      for (let i = 0; i < clanciZaSken.length; i++) {
        const item = clanciZaSken[i];
        const naslov = item.title?.[0] || '';
        const link = item.link?.[0] || '';
        const izvor = item.source?.[0]?._ || item.source?.[0] || 'Google News';
        const pubDate = item.pubDate?.[0] || '';
        
        if (!link) continue;
        
        console.log(`  [${i+1}/${clanciZaSken.length}] Skeniram...`);
        
        const detalji = await dohvatiDetaljeClanka(link);
        
        if (detalji && detalji.relevantan) {
          clanci.push({ naslov, link, izvor, pubDate, metoda: 'playwright' });
        }
        
        // Pauza između requestova (pristojno)
        if (i < clanciZaSken.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }

    // FAZA 3: Fallback - prikaži najnovije ako ništa nije pronađeno
    if (clanci.length === 0) {
      console.log('\n⚠️  Faza 3: Nema relevantnih - prikazujem najnovije');
      items.slice(0, 5).forEach(item => {
        const naslov = item.title?.[0] || '';
        const link = item.link?.[0] || '';
        const izvor = item.source?.[0]?._ || item.source?.[0] || 'Google News';
        const pubDate = item.pubDate?.[0] || '';
        
        if (naslov && link) {
          clanci.push({ naslov, link, izvor, pubDate, metoda: 'fallback' });
        }
      });
    }

    // Sortiraj po datumu
    clanci.sort((a, b) => {
      const dateA = new Date(a.pubDate || 0);
      const dateB = new Date(b.pubDate || 0);
      return dateB - dateA;
    });

    console.log(`\n✅ Rezultat: ${clanci.length} članaka pronađeno`);
    if (clanci.length > 0) {
      const metodaStat = clanci.reduce((acc, c) => {
        acc[c.metoda] = (acc[c.metoda] || 0) + 1;
        return acc;
      }, {});
      console.log(`   Metode: ${JSON.stringify(metodaStat)}`);
    }
    
    return clanci.slice(0, 7);
    
  } catch (err) {
    console.error('❌ Google News greška:', err.message);
    return [];
  }
}

async function dohvatiClankeDirektno(klub) {
    const rssIzvori = [
        'https://www.index.hr/rss',
        'https://www.24sata.hr/feeds/sport.xml',
        'https://sportske.jutarnji.hr/rss.xml',
        'https://www.vecernji.hr/rss/sport',
        'https://www.tportal.hr/rss/sport.xml'
    ];

    const keywords = [
        'ozljed', 'ozlijed', 'povrij', 'povred',
        'propuš', 'propust', 'neće igr', 'nece igr',
        'van stroja', 'izosta', 'nedosta', 'bez',
        'upitan', 'sumnjiv', 'pauza', 'otpa',
        'nedostup', 'bolest', 'rekonvalesc',
        'operac', 'liječenj', 'oporavak'
    ];

    const klubNaziv = hnlKlubovi[klub]?.toLowerCase() || klub.toLowerCase();
    const sviClanci = [];

    console.log(`\n[Direktni RSS] Pretražujem za ${klubNaziv}...`);

    for (const url of rssIzvori) {
        try {
            const res = await axios.get(url, { timeout: 15000 });
            const parsed = await new Promise((resolve, reject) => {
                parseString(res.data, { trim: true }, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });

            const items = parsed?.rss?.channel?.[0]?.item || [];

            items.forEach(item => {
                const naslov = item.title?.[0] || '';
                const opis = item.description?.[0] || '';
                const link = item.link?.[0] || '';
                const izvor = parsed?.rss?.channel?.[0]?.title?.[0] || 'Nepoznat izvor';
                const text = (naslov + opis).toLowerCase();

                const spominjeKlub = text.includes(klubNaziv);
                const imaKeyword = keywords.some(k => text.includes(k));

                if (spominjeKlub && imaKeyword) {
                    sviClanci.push({ naslov, link, izvor });
                }
            });

        } catch (err) {
            console.log(`⚠️ Greška ${url.split('/')[2]}: ${err.message}`);
        }
    }

    console.log(`✅ Pronađeno ${sviClanci.length} članaka`);
    return sviClanci.slice(0, 7);
}

async function dohvatiClanke(klub) {
    const sada = Date.now();
    if (cacheVrijeme && (sada - cacheVrijeme) < CACHE_TRAJANJE && cacheClanci[klub]) {
        console.log(`\n💾 [Cache] Koristim spremljene podatke za ${klub}`);
        return cacheClanci[klub];
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 DOHVAĆAM ČLANKE ZA: ${hnlKlubovi[klub]}`);
    console.log('='.repeat(60));
    
    let clanci = await dohvatiClankeRSS(klub);

    if (clanci.length === 0) {
        console.log(`\n⚙️  Fallback: Direktni RSS izvori...`);
        clanci = await dohvatiClankeDirektno(klub);
    }
    
    cacheClanci[klub] = clanci;
    cacheVrijeme = sada;
    
    console.log('='.repeat(60));
    
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
            '_🎭 Powered by Playwright_'
        );
    }
    
    if (tekst === 'klubovi') {
        const lista = [...new Set(Object.values(hnlKlubovi))].sort().map(k => `• ${k}`).join('\n');
        return msg.reply(`⚽ *HNL Klubovi:*\n\n${lista}`);
    }
    
    if (tekst === 'refresh') {
        cacheClanci = {};
        cacheVrijeme = null;
        return msg.reply('✅ Cache očišćen! Sljedeći upit će biti svjež.');
    }
    
    if (hnlKlubovi[tekst]) {
        await msg.reply('🔄 Pretražujem najnovije članke...');
        
        const clanci = await dohvatiClanke(tekst);
        const naziv = hnlKlubovi[tekst];
        
        if (clanci.length === 0) {
            return msg.reply(
                `✅ *${naziv}*\n\n` +
                `Nema novih članaka o ozljedama ili nedostajućim igračima.\n\n` +
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
    
    return msg.reply(
        `❌ Klub "${tekst}" nije pronađen.\n\n` +
        `Pošalji *"klubovi"* za listu svih HNL klubova.`
    );
}

(async () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 HNL FANTASY BOT - POKREĆEM...');
    console.log('='.repeat(60));
    console.log('📰 Izvor: Google News');
    console.log('🎭 Scraper: Playwright (Microsoft)');
    console.log('💾 Cache: 30 minuta');
    console.log('='.repeat(60) + '\n');
    
    const PORT = process.env.PORT || 3000;
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('✅ HNL WhatsApp Bot - Playwright Scraper\n🎭 Status: ONLINE\n');
    });
    
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 HTTP Server pokrenut na portu ${PORT}\n`);
    });
    
    const client = new Client({
        authStrategy: new LocalAuth({
            dataPath: process.env.WHATSAPP_SESSION_PATH || './whatsapp-session'
        })
    });
    
    client.on('qr', qr => {
        console.log('📱 SKENIRAJ QR KOD:\n');
        if (process.env.RENDER || process.env.NODE_ENV === 'production') {
            console.log('🔗 QR Link:');
            console.log(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}\n`);
        } else {
            qrcode.generate(qr, { small: true });
        }
    });
    
    client.on('ready', () => {
        console.log('✅ WhatsApp Bot spreman!\n');
        console.log('Čekam poruke...\n');
    });
    
    client.on('message', async (msg) => {
        try {
            const chat = await msg.getChat();
            let tekst = msg.body.toLowerCase().trim();
            
            if (chat.isGroup) {
                if (!tekst.startsWith('!hnl')) return;
                tekst = tekst.replace('!hnl', '').trim();
                if (!tekst) {
                    return msg.reply(
                        '⚽ *HNL Bot*\n\n' +
                        'Komande:\n' +
                        '• `!hnl Dinamo` - članci o klubu\n' +
                        '• `!hnl klubovi` - lista klubova\n' +
                        '• `!hnl pomoć` - pomoć'
                    );
                }
            }
            
            await obradiKomandu(msg, tekst);
            
        } catch (err) {
            console.error('❌ Greška pri obradi poruke:', err);
            msg.reply('⚠️ Došlo je do greške. Pokušaj ponovo.');
        }
    });
    
    client.on('disconnected', (reason) => {
        console.log('⚠️  WhatsApp disconnected:', reason);
        console.log('🔄 Pokušavam reconnect za 5 sekundi...');
        setTimeout(() => {
            console.log('🔄 Restartujem bot...');
            client.initialize();
        }, 5000);
    });
    
    process.on('SIGINT', async () => {
        console.log('\n\n👋 Zatvaram bot...');
        if (browser) {
            console.log('🎭 Zatvaram Playwright browser...');
            await browser.close();
        }
        console.log('✅ Gotovo!\n');
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n\n🛑 SIGTERM primljen, zatvaram...');
        if (browser) await browser.close();
        process.exit(0);
    });
    
    client.initialize();
})();