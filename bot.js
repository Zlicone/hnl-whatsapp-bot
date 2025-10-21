const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

// Svi HNL klubovi s Transfermarkt URL-ovima
const hnlKlubovi = {
    'dinamo': {
        naziv: 'GNK Dinamo Zagreb',
        url: 'https://www.transfermarkt.com/gnk-dinamo-zagreb/verletzungen/verein/419'
    },
    'hajduk': {
        naziv: 'HNK Hajduk Split',
        url: 'https://www.transfermarkt.com/hnk-hajduk-split/verletzungen/verein/760'
    },
    'rijeka': {
        naziv: 'HNK Rijeka',
        url: 'https://www.transfermarkt.com/hnk-rijeka/verletzungen/verein/3581'
    },
    'osijek': {
        naziv: 'NK Osijek',
        url: 'https://www.transfermarkt.com/nk-osijek/verletzungen/verein/2976'
    },
    'varaždin': {
        naziv: 'NK Varaždin',
        url: 'https://www.transfermarkt.com/nk-varazdin/verletzungen/verein/37057'
    },
    'varazdin': {
        naziv: 'NK Varaždin',
        url: 'https://www.transfermarkt.com/nk-varazdin/verletzungen/verein/37057'
    },
    'slaven belupo': {
        naziv: 'NK Slaven Belupo',
        url: 'https://www.transfermarkt.com/nk-slaven-belupo/verletzungen/verein/10104'
    },
    'slaven': {
        naziv: 'NK Slaven Belupo',
        url: 'https://www.transfermarkt.com/nk-slaven-belupo/verletzungen/verein/10104'
    },
    'istra': {
        naziv: 'NK Istra 1961',
        url: 'https://www.transfermarkt.com/nk-istra-1961/verletzungen/verein/4623'
    },
    'istra 1961': {
        naziv: 'NK Istra 1961',
        url: 'https://www.transfermarkt.com/nk-istra-1961/verletzungen/verein/4623'
    },
    'gorica': {
        naziv: 'HNK Gorica',
        url: 'https://www.transfermarkt.com/hnk-gorica/verletzungen/verein/17937'
    },
    'lokomotiva': {
        naziv: 'NK Lokomotiva Zagreb',
        url: 'https://www.transfermarkt.com/nk-lokomotiva-zagreb/verletzungen/verein/7998'
    },
    'vukovar': {
        naziv: 'NK Vukovar',
        url: 'https://www.transfermarkt.com/nk-vukovar/verletzungen/verein/70315'
    }
};

// Mapiranje klubova za pretragu u novinama
const klubPretraga = {
    'dinamo': ['dinamo', 'gnk dinamo', 'plavi'],
    'hajduk': ['hajduk', 'hnk hajduk', 'bili'],
    'rijeka': ['rijeka', 'hnk rijeka', 'armada'],
    'osijek': ['osijek', 'nk osijek'],
    'varaždin': ['varaždin', 'varazdin'],
    'varazdin': ['varaždin', 'varazdin'],
    'slaven belupo': ['slaven', 'belupo', 'slaven belupo'],
    'slaven': ['slaven', 'belupo'],
    'istra': ['istra', 'istra 1961'],
    'istra 1961': ['istra', 'istra 1961'],
    'gorica': ['gorica', 'hnk gorica'],
    'lokomotiva': ['lokomotiva'],
    'vukovar': ['vukovar', 'nk vukovar']
};

// Cache za podatke
let cacheOzljede = {};
let cacheVrijeme = null;
const CACHE_TRAJANJE = 30 * 60 * 1000; // 30 minuta

// Puppeteer browser instance
let browser = null;
let scrapingEnabled = true;

// Inicijaliziraj browser
async function initBrowser() {
    if (!browser) {
        console.log('🌐 Pokrećem Chromium browser...');
        
        try {
            browser = await puppeteer.launch({
                args: chromium.args,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
            });
            console.log('✅ Browser pokrenut!\n');
            scrapingEnabled = true;
        } catch (error) {
            console.error('❌ Greška pri pokretanju browsera:', error.message);
            console.error('⚠️  Bot će raditi bez scrapinga');
            browser = null;
            scrapingEnabled = false;
        }
    }
    return browser;
}

// Funkcija za scraping Transfermarkt
async function scrapeTransfermarkt(klub) {
    if (!scrapingEnabled) {
        console.log(`[Transfermarkt] Scraping onemogućen`);
        return [];
    }

    try {
        const klubInfo = hnlKlubovi[klub];
        if (!klubInfo) return [];

        console.log(`[Transfermarkt] Dohvaćam ${klubInfo.naziv}...`);

        const browser = await initBrowser();
        if (!browser) return [];

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        await page.goto(klubInfo.url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        await page.waitForSelector('.items', { timeout: 10000 });

        const ozljede = await page.evaluate(() => {
            const rezultati = [];
            const rows = document.querySelectorAll('.items tbody tr');

            rows.forEach(row => {
                if (row.classList.contains('thead')) return;

                try {
                    const imeElement = row.querySelector('.hauptlink a');
                    if (!imeElement) return;
                    const ime = imeElement.textContent.trim();

                    const pozicijaElement = row.querySelector('.inline-table tr:first-child td:last-child');
                    const pozicija = pozicijaElement ? pozicijaElement.textContent.trim() : 'N/A';

                    const cells = row.querySelectorAll('td');
                    const vrstaOzljede = cells[3] ? cells[3].textContent.trim() : 'Nepoznato';
                    const od = cells[4] ? cells[4].textContent.trim() : 'N/A';
                    const do_kada = cells[5] ? cells[5].textContent.trim() : 'N/A';

                    let status = 'ozlijeđen';
                    if (do_kada === '-' || do_kada === '?' || do_kada === 'N/A') {
                        status = 'upitan';
                    }

                    rezultati.push({
                        ime: ime,
                        pozicija: pozicija,
                        razlog: vrstaOzljede,
                        od: od,
                        procjena: do_kada !== '-' ? `Povratak: ${do_kada}` : 'Nepoznato',
                        status: status,
                        izvor: 'Transfermarkt'
                    });
                } catch (err) {
                    // Preskoči
                }
            });

            return rezultati;
        });

        await page.close();
        console.log(`✅ ${klubInfo.naziv}: ${ozljede.length} igrača\n`);

        return ozljede;

    } catch (error) {
        console.error(`❌ Greška za ${klub}:`, error.message);
        return [];
    }
}

// Funkcija za scraping članaka (generička)
async function scrapeClanke(url, izvor, klub) {
    if (!scrapingEnabled) return [];

    try {
        const klubKljucneRijeci = klubPretraga[klub] || [];
        if (klubKljucneRijeci.length === 0) return [];

        console.log(`[${izvor}] Tražim članke za ${klub}...`);

        const browser = await initBrowser();
        if (!browser) return [];

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 20000
        });

        const clanci = await page.evaluate((kljucneRijeci) => {
            const rezultati = [];
            const artikli = document.querySelectorAll('article, .article, [class*="article"]');

            artikli.forEach(article => {
                try {
                    const linkEl = article.querySelector('a[href]');
                    const naslovEl = article.querySelector('h2, h3, .title, [class*="title"]');
                    
                    if (!linkEl || !naslovEl) return;

                    const naslov = naslovEl.textContent.trim().toLowerCase();
                    const link = linkEl.href;

                    const sadrziKlub = kljucneRijeci.some(rijec => naslov.includes(rijec.toLowerCase()));
                    const sadrziOzljeda = naslov.includes('ozljed') || naslov.includes('ozlijed') || 
                                         naslov.includes('propušta') || naslov.includes('nece igrati') ||
                                         naslov.includes('neće igrati') || naslov.includes('upitan');

                    if (sadrziKlub && sadrziOzljeda) {
                        rezultati.push({
                            naslov: naslovEl.textContent.trim(),
                            link: link
                        });
                    }
                } catch (err) {
                    // Preskoči
                }
            });

            return rezultati.slice(0, 3);
        }, klubKljucneRijeci);

        await page.close();
        console.log(`✅ ${izvor}: ${clanci.length} članaka\n`);
        return clanci.map(c => ({ ...c, izvor }));

    } catch (error) {
        console.error(`❌ ${izvor} greška:`, error.message);
        return [];
    }
}

// Glavna funkcija za dohvaćanje podataka
async function dohvatiOzljede(klub) {
    const sada = Date.now();
    if (cacheVrijeme && (sada - cacheVrijeme) < CACHE_TRAJANJE && cacheOzljede[klub]) {
        console.log(`[Cache] Koristim cache za ${klub}`);
        return cacheOzljede[klub];
    }

    console.log(`\n🔍 Dohvaćam podatke za ${klub}...`);

    const ozljede = await scrapeTransfermarkt(klub);

    const [indexClanke, sataClanke, sportskeClanke] = await Promise.allSettled([
        scrapeClanke('https://www.index.hr/sport/najnovije/nogomet', 'Index.hr', klub),
        scrapeClanke('https://www.24sata.hr/sport/nogomet', '24sata', klub),
        scrapeClanke('https://sportske.jutarnji.hr/sn/nogomet/hnl', 'Sportske novosti', klub)
    ]);

    let sviClanke = [];
    if (indexClanke.status === 'fulfilled') sviClanke = [...sviClanke, ...indexClanke.value];
    if (sataClanke.status === 'fulfilled') sviClanke = [...sviClanke, ...sataClanke.value];
    if (sportskeClanke.status === 'fulfilled') sviClanke = [...sviClanke, ...sportskeClanke.value];

    cacheOzljede[klub] = {
        ozljede: ozljede,
        clanci: sviClanke
    };
    cacheVrijeme = sada;

    return cacheOzljede[klub];
}

// Inicijalizacija WhatsApp klijenta
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: chromium.args,
        executablePath: chromium.executablePath(),
        headless: chromium.headless,
    }
});

// QR kod
client.on('qr', (qr) => {
    console.log('📱 QR kod generiran!');
    
    if (!process.env.RAILWAY_ENVIRONMENT) {
        console.log('\nSkeniraj QR kod:\n');
        qrcode.generate(qr, { small: true });
    } else {
        console.log('\n⚠️  RAILWAY - QR kod link:');
        console.log(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`);
        console.log('\nSkeniraj QR kod!\n');
    }
});

// Bot spreman
client.on('ready', () => {
    console.log('\n✅ WhatsApp bot je spreman!');
    console.log('📱 Možeš slati poruke botu\n');
});

// Obrada poruka
client.on('message', async (msg) => {
    const chat = await msg.getChat();
    const tekst = msg.body.toLowerCase().trim();

    if (chat.isGroup) {
        const prefixOK = tekst.startsWith('@bot') ||
                         tekst.startsWith('!hnl') ||
                         tekst.startsWith('/hnl') ||
                         msg.mentionedIds.length > 0;

        if (!prefixOK) return;

        let cleanTekst = tekst
            .replace('@bot', '')
            .replace('!hnl', '')
            .replace('/hnl', '')
            .trim();

        if (!cleanTekst) {
            await msg.reply(
                '⚽ *HNL Fantasy Bot*\n\n' +
                '🏥 *Korištenje:*\n' +
                '• `!hnl Dinamo`\n' +
                '• `!hnl sve`\n' +
                '• `!hnl klubovi`\n' +
                '• `!hnl pomoć`'
            );
            return;
        }

        await obradiKomandu(msg, cleanTekst);
        return;
    }

    await obradiKomandu(msg, tekst);
});

// Funkcija za obradu komandi
async function obradiKomandu(msg, tekst) {
    if (tekst === 'pomoć' || tekst === 'pomoc' || tekst === 'help') {
        await msg.reply(
            '⚽ *HNL Fantasy Bot*\n\n' +
            '• Naziv kluba → ozljede\n' +
            '• "klubovi" → lista\n' +
            '• "sve" → sve ozljede\n' +
            '• "refresh" → novi podaci\n\n' +
            '_💡 U grupi: !hnl Dinamo_'
        );
        return;
    }

    if (tekst === 'klubovi' || tekst === 'svi klubovi') {
        const lista = Object.values(hnlKlubovi)
            .map(k => k.naziv)
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort()
            .map(k => `• ${k}`)
            .join('\n');
        await msg.reply(`⚽ *HNL Klubovi:*\n\n${lista}`);
        return;
    }

    if (tekst === 'refresh' || tekst === 'osvježi' || tekst === 'osvjezi') {
        cacheOzljede = {};
        cacheVrijeme = null;
        await msg.reply('✅ Cache očišćen!');
        return;
    }

    if (tekst === 'sve' || tekst === 'sve ozljede' || tekst === 'all') {
        await msg.reply('🔄 Dohvaćam sve klubove...');

        let odgovor = '🏥 *HNL - Sve ozljede*\n\n';
        let brojOzljeda = 0;

        const jedinstveniKlubovi = {};
        for (const [kljuc, info] of Object.entries(hnlKlubovi)) {
            jedinstveniKlubovi[info.naziv] = kljuc;
        }

        for (const [naziv, kljuc] of Object.entries(jedinstveniKlubovi)) {
            const podaci = await dohvatiOzljede(kljuc);
            const ozljede = podaci.ozljede || [];

            if (ozljede.length > 0) {
                odgovor += `*${naziv}*\n`;
                ozljede.forEach(igrac => {
                    const emoji = igrac.status === 'ozlijeđen' ? '🔴' : '🟡';
                    odgovor += `${emoji} ${igrac.ime} - ${igrac.razlog}\n`;
                    brojOzljeda++;
                });
                odgovor += '\n';
            }
        }

        if (brojOzljeda === 0) {
            odgovor = '✅ Nema ozljeda! 💪';
        } else {
            odgovor += `_Ukupno: ${brojOzljeda} igrač(a)_`;
        }

        await msg.reply(odgovor);
        return;
    }

    if (hnlKlubovi[tekst]) {
        await msg.reply('🔄 Dohvaćam podatke...');

        const podaci = await dohvatiOzljede(tekst);
        const ozljede = podaci.ozljede || [];
        const clanci = podaci.clanci || [];
        const nazivKluba = hnlKlubovi[tekst].naziv;

        if (ozljede.length === 0 && clanci.length === 0) {
            await msg.reply(
                `✅ *${nazivKluba}*\n\n` +
                `Nema ozljeda! 💪\n\n` +
                `_${new Date().toLocaleString('hr-HR')}_`
            );
            return;
        }

        let odgovor = `🏥 *${nazivKluba}*\n\n`;

        if (ozljede.length > 0) {
            odgovor += `*📊 Ozljede:*\n\n`;
            
            ozljede.forEach((igrac, index) => {
                const emoji = igrac.status === 'ozlijeđen' ? '🔴' : '🟡';
                odgovor += `${emoji} *${igrac.ime}*`;
                if (igrac.pozicija !== 'N/A') {
                    odgovor += ` (${igrac.pozicija})`;
                }
                odgovor += `\n   ${igrac.razlog}\n`;
                if (igrac.procjena && igrac.procjena !== 'Nepoznato') {
                    odgovor += `   ${igrac.procjena}\n`;
                }
                if (index < ozljede.length - 1) odgovor += '\n';
            });
        } else {
            odgovor += `✅ Nema ozljeda\n`;
        }

        if (clanci.length > 0) {
            odgovor += `\n\n*📰 Vijesti:*\n\n`;
            
            clanci.forEach((clanak, index) => {
                odgovor += `• *${clanak.izvor}*\n`;
                odgovor += `  "${clanak.naslov}"\n`;
                odgovor += `  ${clanak.link}\n`;
                if (index < clanci.length - 1) odgovor += '\n';
            });
        }

        odgovor += `\n\n_${new Date().toLocaleString('hr-HR')}_`;

        await msg.reply(odgovor);
    } else {
        await msg.reply(
            `❌ Klub "${msg.body}" nije pronađen.\n` +
            `Pošalji "klubovi" za listu.`
        );
    }
}

// Error handling
client.on('auth_failure', () => {
    console.error('❌ Autentifikacija nije uspjela!');
});

client.on('disconnected', (reason) => {
    console.log('⚠️  Diskonektiran:', reason);
    setTimeout(() => {
        console.log('🔄 Reconnecting...');
        client.initialize();
    }, 5000);
});

// Cleanup
process.on('SIGINT', async () => {
    console.log('\n🛑 Gasim...');
    if (browser) {
        await browser.close();
    }
    process.exit(0);
});

// Pokretanje
client.initialize();

console.log('🚀 Pokrećem HNL Fantasy WhatsApp bot...');
console.log('📊 Izvori: Transfermarkt + novine');