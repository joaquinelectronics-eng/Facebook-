/* Genera capturas de pantalla del panel y del catalogo, para documentacion. */
const { chromium } = require('playwright');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const archivo = (p) => path.join(RAIZ, 'extension', p);
const salida = process.env.SALIDA || path.join(RAIZ, 'docs');

const CONFIG = {
  consulta: 'audi a5 -permuto', pmin: 15000, pmax: 30000, moneda: 'USD',
  cotizacion: 1000, umbralAmbiguo: 500000, ocultar: true, sinPrecio: false, indexar: true
};

const AHORA = Date.now(), DIA = 86400000;
const EJEMPLO = [
  { id:'101', titulo:'Audi A5 2.0 TFSI Quattro 2018', precio:23500, moneda:'USD', precioUSD:23500,
    ubicacion:'Rosario, Santa Fe', km:85000, anio:2018, veces:7,
    vistoPrimera:AHORA-64*DIA, vistoUltima:AHORA-DIA,
    url:'https://www.facebook.com/marketplace/item/101/',
    historial:[{t:AHORA-64*DIA,precioUSD:27000},{t:AHORA-20*DIA,precioUSD:24800},{t:AHORA-DIA,precioUSD:23500}] },
  { id:'106', titulo:'AUDI A 5 impecable 2019 unico duenio', precio:24500, moneda:'USD', precioUSD:24500,
    confianzaMoneda:'inferida', ubicacion:'Rosario, Santa Fe', km:60000, anio:2019, veces:3,
    vistoPrimera:AHORA-41*DIA, vistoUltima:AHORA-2*DIA,
    url:'https://www.facebook.com/marketplace/item/106/', historial:[] },
  { id:'108', titulo:'Audi A5 2019 full cuero techo', precio:28000000, moneda:'ARS', precioUSD:28000,
    confianzaMoneda:'inferida', ubicacion:'Funes, Santa Fe', km:55000, anio:2019, veces:2,
    vistoPrimera:AHORA-9*DIA, vistoUltima:AHORA,
    url:'https://www.facebook.com/marketplace/item/108/',
    historial:[{t:AHORA-9*DIA,precioUSD:31000},{t:AHORA,precioUSD:28000}] },
  { id:'111', titulo:'Audi A5 Sportback 2017 service oficial', precio:21900, moneda:'USD', precioUSD:21900,
    ubicacion:'Villa Gobernador Galvez', km:99000, anio:2017, veces:12,
    vistoPrimera:AHORA-120*DIA, vistoUltima:AHORA-4*DIA,
    url:'https://www.facebook.com/marketplace/item/111/',
    historial:[{t:AHORA-120*DIA,precioUSD:26500},{t:AHORA-4*DIA,precioUSD:21900}] }
];

(async () => {
  const navegador = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });

  // --- panel sobre la replica de Marketplace ---
  const p1 = await navegador.newPage({ viewport: { width: 1180, height: 760 } });
  await p1.goto('file://' + path.join(__dirname, 'fixture-marketplace.html'));
  await p1.evaluate((config) => {
    window.chrome = {
      storage: { local: { get: (k, cb) => cb({ config }), set: () => {} } },
      runtime: { lastError: undefined, getURL: (x) => x,
                 sendMessage: (m, cb) => cb && cb({ ok: true, total: 428 }) }
    };
  }, CONFIG);
  for (const f of ['src/lib/normalize.js','src/lib/price.js','src/lib/matcher.js',
                   'src/content/scraper.js','src/content/panel.js',
                   'src/content/autoscroll.js','src/content/content.js']) {
    await p1.addScriptTag({ path: archivo(f) });
  }
  await p1.waitForTimeout(2600);
  await p1.screenshot({ path: path.join(salida, 'panel.png') });

  // --- catalogo con datos de ejemplo ---
  const p2 = await navegador.newPage({ viewport: { width: 1180, height: 860 } });
  await p2.addInitScript((items) => {
    window.chrome = { runtime: { lastError: undefined,
      sendMessage: (msg, cb) => { if (msg.tipo === 'listar') cb({ ok: true, items }); else cb({ ok: true }); } } };
  }, EJEMPLO);
  await p2.goto('file://' + archivo('src/catalog/catalog.html'));
  await p2.waitForTimeout(700);
  await p2.screenshot({ path: path.join(salida, 'catalogo.png') });

  await navegador.close();
  console.log('capturas listas en ' + salida);
})();
