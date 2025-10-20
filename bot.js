const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const puppeteer = require('puppeteer');

// Inicijalizacija WhatsApp klijenta
const client = new Client({
    authStrategy: new LocalAuth()
});

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

// Cache za podatke
let cacheOzljede = {};
let cacheVrijeme = null;
const CACHE_TRAJANJE = 30 * 60 * 1000; // 30 minuta

// Puppeteer browser instance (pokreće se jednom)
let browser = null;

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

// Inicijaliziraj browser
async function initBrowser() {
    if (!browser) {
        console.log('🌐 Pokrećem Puppeteer browser...');
        
        // Puppeteer config za Railway/Linux hosting
        const puppeteerOptions = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-extensions'
            ]
        };
        
        // Ako je Railway ili production, dodaj executable path
        if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') {
            puppeteerOptions.executablePath = '/usr/bin/chromium-browser';
        }
        
        browser = await puppeteer.launch(puppeteerOptions);
        console.log('✅ Browser pokrenut!\n');
    }
    return browser;
}

// Funkcija za scraping Transfermarkt s Puppeteer
async function scrapeTransfermarkt(klub) {
    try {
        const klubInfo = hnlKlubovi[klub];
        if (!klubInfo) {
            return [];
        }

        console.log(`[Transfermarkt] Dohvaćam ${klubInfo.naziv}...`);

        const browser = await initBrowser();
        const page = await browser.newPage();

        // Postavi User-Agent da izgleda kao pravi browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Idi na stranicu
        await page.goto(klubInfo.url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Čekaj da se tablica učita
        await page.waitForSelector('.items', { timeout: 10000 });

        // Izvuci podatke iz tablice
        const ozljede = await page.evaluate(() => {
            const rezultati = [];
            const rows = document.querySelectorAll('.items tbody tr');

            rows.forEach(row => {
                // Preskoči header redove
                if (row.classList.contains('thead')) return;

                try {
                    // Ime igrača
                    const imeElement = row.querySelector('.hauptlink a');
                    if (!imeElement) return;
                    const ime = imeElement.textContent.trim();

                    // Pozicija
                    const pozicijaElement = row.querySelector('.inline-table tr:first-child td:last-child');
                    const pozicija = pozicijaElement ? pozicijaElement.textContent.trim() : 'N/A';

                    // Vrsta ozljede (4. kolona)
                    const cells = row.querySelectorAll('td');
                    const vrstaOzljede = cells[3] ? cells[3].textContent.trim() : 'Nepoznato';

                    // Datumi (5. i 6. kolona)
                    const od = cells[4] ? cells[4].textContent.trim() : 'N/A';
                    const do_kada = cells[5] ? cells[5].textContent.trim() : 'N/A';

                    // Odredi status
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
                    // Preskoči problematične redove
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

// Funkcija za scraping članaka s Index.hr
async function scrapeIndexClanke(klub) {
    try {
        const klubKljucneRijeci = klubPretraga[klub] || [];
        if (klubKljucneRijeci.length === 0) return [];

        console.log(`[Index] Tražim članke za ${klub}...`);

        const browser = await initBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        await page.goto('https://www.index.hr/sport/najnovije/nogomet', {
            waitUntil: 'networkidle2',
            timeout: 20000
        });

        const clanci = await page.evaluate((kljucneRijeci) => {
            const rezultati = [];
            const artikli = document.querySelectorAll('article, .article, [class*="article"]');

            artikli.forEach(article => {
                try {
                    const linkEl = article.querySelector('a[href*="/clanak/"]');
                    const naslovEl = article.querySelector('h2, h3, .title, [class*="title"]');
                    
                    if (!linkEl || !naslovEl) return;

                    const naslov = naslovEl.textContent.trim().toLowerCase();
                    const link = linkEl.href;

                    // Provjeri sadrži li naslov ključne riječi za klub + ozljeda
                    const sadrziKlub = kljucneRijeci.some(rijec => naslov.includes(rijec.toLowerCase()));
                    const sadrziOzljeda = naslov.includes('ozljed') || naslov.includes('ozlijed') || 
                                         naslov.includes('propušta') || naslov.includes('nece igrati') ||
                                         naslov.includes('neće igrati') || naslov.includes('upitan');

                    if (sadrziKlub && sadrziOzljeda) {
                        rezultati.push({
                            naslov: naslovEl.textContent.trim(),
                            link: link,
                            izvor: 'Index.hr'
                        });
                    }
                } catch (err) {
                    // Preskoči problematične članke
                }
            });

            return rezultati.slice(0, 3); // Maksimalno 3 članka
        }, klubKljucneRijeci);

        await page.close();
        console.log(`✅ Index: ${clanci.length} članaka\n`);
        return clanci;

    } catch (error) {
        console.error(`❌ Index greška:`, error.message);
        return [];
    }
}

// Funkcija za scraping članaka s 24sata
async function scrape24sataClanke(klub) {
    try {
        const klubKljucneRijeci = klubPretraga[klub] || [];
        if (klubKljucneRijeci.length === 0) return [];

        console.log(`[24sata] Tražim članke za ${klub}...`);

        const browser = await initBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        await page.goto('https://www.24sata.hr/sport/nogomet', {
            waitUntil: 'networkidle2',
            timeout: 20000
        });

        const clanci = await page.evaluate((kljucneRijeci) => {
            const rezultati = [];
            const artikli = document.querySelectorAll('article, .article, [class*="article"]');

            artikli.forEach(article => {
                try {
                    const linkEl = article.querySelector('a[href*="/sport/"]');
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
                            link: link,
                            izvor: '24sata'
                        });
                    }
                } catch (err) {
                    // Preskoči problematične članke
                }
            });

            return rezultati.slice(0, 3);
        }, klubKljucneRijeci);

        await page.close();
        console.log(`✅ 24sata: ${clanci.length} članaka\n`);
        return clanci;

    } catch (error) {
        console.error(`❌ 24sata greška:`, error.message);
        return [];
    }
}

// Funkcija za scraping članaka sa Sportskih novosti
async function scrapeSportskeClanke(klub) {
    try {
        const klubKljucneRijeci = klubPretraga[klub] || [];
        if (klubKljucneRijeci.length === 0) return [];

        console.log(`[Sportske] Tražim članke za ${klub}...`);

        const browser = await initBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        await page.goto('https://sportske.jutarnji.hr/sn/nogomet/hnl', {
            waitUntil: 'networkidle2',
            timeout: 20000
        });

        const clanci = await page.evaluate((kljucneRijeci) => {
            const rezultati = [];
            const artikli = document.querySelectorAll('article, .article, [class*="article"]');

            artikli.forEach(article => {
                try {
                    const linkEl = article.querySelector('a[href*="/clanak/"]');
                    const naslovEl = article.querySelector('h2, h3, .title, [class*="headline"]');
                    
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
                            link: link,
                            izvor: 'Sportske novosti'
                        });
                    }
                } catch (err) {
                    // Preskoči
                }
            });

            return rezultati.slice(0, 3);
        }, klubKljucneRijeci);

        await page.close();
        console.log(`✅ Sportske: ${clanci.length} članaka\n`);
        return clanci;

    } catch (error) {
        console.error(`❌ Sportske greška:`, error.message);
        return [];
    }
}

// Glavna funkcija za dohvaćanje ozljeda
async function dohvatiOzljede(klub) {
    // Provjeri cache
    const sada = Date.now();
    if (cacheVrijeme && (sada - cacheVrijeme) < CACHE_TRAJANJE && cacheOzljede[klub]) {
        console.log(`[Cache] Koristim cache za ${klub}`);
        return cacheOzljede[klub];
    }

    console.log(`\n🔍 Dohvaćam podatke za ${klub}...`);

    // Dohvati ozljede s Transfermarkta
    const ozljede = await scrapeTransfermarkt(klub);

    // Dohvati najnovije članke paralelno
    const [indexClanke, sataClanke, sportskeClanke] = await Promise.allSettled([
        scrapeIndexClanke(klub),
        scrape24sataClanke(klub),
        scrapeSportskeClanke(klub)
    ]);

    // Kombiniraj članke
    let sviClanke = [];
    if (indexClanke.status === 'fulfilled') sviClanke = [...sviClanke, ...indexClanke.value];
    if (sataClanke.status === 'fulfilled') sviClanke = [...sviClanke, ...sataClanke.value];
    if (sportskeClanke.status === 'fulfilled') sviClanke = [...sviClanke, ...sportskeClanke.value];

    // Spremi u cache
    cacheOzljede[klub] = {
        ozljede: ozljede,
        clanci: sviClanke
    };
    cacheVrijeme = sada;

    return cacheOzljede[klub];
}

// QR kod za skeniranje
client.on('qr', (qr) => {
    console.log('📱 QR kod generiran!');
    
    // Za lokalni development - prikaži u terminalu
    if (!process.env.RAILWAY_ENVIRONMENT) {
        console.log('\nSkeniraj QR kod s WhatsApp aplikacijom:\n');
        qrcode.generate(qr, { small: true });
    } else {
        // Za Railway - ispiši link
        console.log('\n⚠️  RAILWAY DEPLOYMENT - QR kod link:');
        console.log('Otvori ovaj link da vidiš QR kod:');
        console.log(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`);
        console.log('\nSkeniraj QR kod sa svog mobitela!\n');
    }
});

// Kad je bot spreman
client.on('ready', () => {
    console.log('\n✅ WhatsApp bot je spreman!');
    console.log('📱 Možeš slati poruke botu\n');
});

// Obrada poruka
client.on('message', async (msg) => {
    const chat = await msg.getChat();
    const tekst = msg.body.toLowerCase().trim();

    // Ako je poruka iz grupe, reagiraj samo na posebne pozive
    if (chat.isGroup) {
        const prefixOK = tekst.startsWith('@bot') ||
                         tekst.startsWith('!hnl') ||
                         tekst.startsWith('/hnl') ||
                         msg.mentionedIds.length > 0;

        if (!prefixOK) {
            return;
        }

        let cleanTekst = tekst
            .replace('@bot', '')
            .replace('!hnl', '')
            .replace('/hnl', '')
            .trim();

        if (!cleanTekst) {
            await msg.reply(
                '⚽ *HNL Fantasy Bot*\n\n' +
                '🏥 *Korištenje u grupi:*\n' +
                '• `!hnl Dinamo` - ozljede Dinama\n' +
                '• `!hnl sve` - sve ozljede\n' +
                '• `!hnl klubovi` - lista klubova\n' +
                '• `!hnl pomoć` - sve komande\n\n' +
                '_Možeš koristiti i @bot ili /hnl umjesto !hnl_'
            );
            return;
        }

        await obradiKomandu(msg, cleanTekst);
        return;
    }

    // Za privatne poruke - normalna obrada
    await obradiKomandu(msg, tekst);
});

// Funkcija za obradu komandi
async function obradiKomandu(msg, tekst) {
    // Komanda: pomoć
    if (tekst === 'pomoć' || tekst === 'pomoc' || tekst === 'help') {
        await msg.reply(
            '⚽ *HNL Fantasy Bot - Pomoć*\n\n' +
            '🏥 *Dostupne komande:*\n' +
            '• Pošalji naziv kluba za ozljede\n' +
            '• "klubovi" - lista svih HNL klubova\n' +
            '• "sve" - sve ozljede u ligi\n' +
            '• "refresh" - osvježi podatke\n' +
            '• "pomoć" - ova poruka\n\n' +
            '📋 *Primjeri:*\n' +
            '• "Dinamo"\n' +
            '• "Hajduk"\n' +
            '• "Varaždin"\n\n' +
            '_💡 U grupi koristi: !hnl Dinamo_\n' +
            '_📊 Izvor: Transfermarkt_'
        );
        return;
    }

    // Komanda: klubovi
    if (tekst === 'klubovi' || tekst === 'svi klubovi') {
        const lista = Object.values(hnlKlubovi)
            .map(k => k.naziv)
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort()
            .map(k => `• ${k}`)
            .join('\n');
        await msg.reply(`⚽ *HNL Klubovi 2024/25:*\n\n${lista}`);
        return;
    }

    // Komanda: refresh
    if (tekst === 'refresh' || tekst === 'osvježi' || tekst === 'osvjezi') {
        cacheOzljede = {};
        cacheVrijeme = null;
        await msg.reply('✅ Cache očišćen! Sljedeći upit će dohvatiti nove podatke.');
        return;
    }

    // Komanda: sve ozljede
    if (tekst === 'sve' || tekst === 'sve ozljede' || tekst === 'all') {
        await msg.reply('🔄 Dohvaćam podatke za sve klubove... Ovo može potrajati 2-3 minute.');

        let odgovor = '🏥 *HNL - Sve ozljede i upitni igrači*\n\n';
        let brojOzljeda = 0;

        // Uzmi samo jedinstvene klubove
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
            odgovor = '✅ Trenutno nema prijavljenih ozljeda u HNL-u! 💪';
        } else {
            odgovor += `_Ukupno: ${brojOzljeda} igrač(a)_\n`;
            odgovor += `_Izvor: Transfermarkt_`;
        }

        await msg.reply(odgovor);
        return;
    }

    // Provjera za naziv kluba
    if (hnlKlubovi[tekst]) {
        await msg.reply('🔄 Dohvaćam najnovije podatke...');

        const podaci = await dohvatiOzljede(tekst);
        const ozljede = podaci.ozljede || [];
        const clanci = podaci.clanci || [];
        const nazivKluba = hnlKlubovi[tekst].naziv;

        if (ozljede.length === 0 && clanci.length === 0) {
            await msg.reply(
                `✅ *${nazivKluba}*\n\n` +
                `Nema prijavljenih ozljeda ili vijesti! 💪\n\n` +
                `_Zadnje ažurirano: ${new Date().toLocaleString('hr-HR')}_\n` +
                `_Izvor: Transfermarkt_`
            );
            return;
        }

        let odgovor = `🏥 *${nazivKluba}*\n\n`;

        // Ozljede s Transfermarkta
        if (ozljede.length > 0) {
            odgovor += `*📊 Ozljede (Transfermarkt):*\n\n`;
            
            ozljede.forEach((igrac, index) => {
                const emoji = igrac.status === 'ozlijeđen' ? '🔴' : '🟡';
                odgovor += `${emoji} *${igrac.ime}*`;
                if (igrac.pozicija !== 'N/A') {
                    odgovor += ` (${igrac.pozicija})`;
                }
                odgovor += `\n`;
                odgovor += `   Ozljeda: ${igrac.razlog}\n`;
                if (igrac.procjena && igrac.procjena !== 'Nepoznato') {
                    odgovor += `   ${igrac.procjena}\n`;
                }
                if (index < ozljede.length - 1) odgovor += '\n';
            });
        } else {
            odgovor += `✅ Nema aktivnih ozljeda na Transfermarktu\n`;
        }

        // Najnoviji članci iz novina
        if (clanci.length > 0) {
            odgovor += `\n\n*📰 Najnovije vijesti:*\n\n`;
            
            clanci.forEach((clanak, index) => {
                odgovor += `• *${clanak.izvor}*\n`;
                odgovor += `  "${clanak.naslov}"\n`;
                odgovor += `  ${clanak.link}\n`;
                if (index < clanci.length - 1) odgovor += '\n';
            });
        }

        odgovor += `\n\n_Zadnje ažurirano: ${new Date().toLocaleString('hr-HR')}_`;
        odgovor += `\n_💡 Pošalji "sve" za pregled cijele lige_`;

        await msg.reply(odgovor);
    } else {
        // Klub nije pronađen
        await msg.reply(
            `❌ Klub "${msg.body}" nije pronađen.\n\n` +
            `Pošalji "klubovi" za popis svih HNL klubova.\n` +
            `Pošalji "pomoć" za sve komande.`
        );
    }
}

// Error handling
client.on('auth_failure', () => {
    console.error('❌ Autentifikacija nije uspjela!');
});

client.on('disconnected', (reason) => {
    console.log('⚠️  Bot je diskonektiran:', reason);
});

// Cleanup kad se program gasi
process.on('SIGINT', async () => {
    console.log('\n\n🛑 Gasim bota...');
    if (browser) {
        await browser.close();
        console.log('✅ Browser zatvoren');
    }
    process.exit(0);
});

// Pokretanje bota
client.initialize();

console.log('🚀 Pokrećem HNL Fantasy WhatsApp bot...');
console.log('📊 Izvori: Transfermarkt (ozljede) + Index, 24sata, Sportske novosti (vijesti)');