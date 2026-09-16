/* Que al entrar a Marketplace se vaya sola a la version de celular.

   Es el paso que hacia falta a mano -herramientas del navegador, modo
   telefono, escribir m.facebook.com- y que nadie hace todos los dias. Como es
   invisible cuando anda, conviene tenerlo probado: se hace pasar una pagina
   nuestra por facebook.com y se mira a donde termina. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const archivo = (p) => path.join(__dirname, '..', 'extension', p);
const PAGINA = fs.readFileSync(path.join(__dirname, 'fixture-generico.html'), 'utf8');
const GUIONES = ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js',
                 'src/lib/zonas.js', 'src/content/scraper.js', 'src/content/panel.js',
                 'src/content/autoscroll.js', 'src/content/content.js'];

(async () => {
  const navegador = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });

  let fallas = 0;
  const prueba = (nombre, fn) => {
    try { fn(); console.log('  ok   ' + nombre); }
    catch (e) { fallas++; console.error('  FALLA ' + nombre + '\n         ' + e.message); }
  };

  async function abrir(url, config) {
    const pagina = await navegador.newPage({ viewport: { width: 393, height: 852 } });
    // Se hace pasar la pagina de prueba por Facebook, sin tocar Facebook.
    await pagina.route('**://*.facebook.com/**', (ruta) =>
      ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGINA }));
    await pagina.goto(url);
    await pagina.evaluate((c) => {
      window.chrome = {
        storage: { local: { get: (k, cb) => cb({ config: c }), set: () => {} } },
        runtime: { lastError: undefined, getURL: (p) => p,
                   onMessage: { addListener: () => {} },
                   sendMessage: (m, cb) => cb && cb({ ok: true, total: 0, titulos: {} }) }
      };
    }, config);
    for (const g of GUIONES) await pagina.addScriptTag({ path: archivo(g) });
    await pagina.waitForTimeout(2000);
    const donde = pagina.url();
    await pagina.close();
    return donde;
  }

  const BASE = { consulta: 'audi a5', provincias: ['BA'], zonaDesconocida: true,
                 ocultar: true, indexar: false };

  console.log('\nIr solo a la version de celular');

  const conMarketplace = await abrir('https://www.facebook.com/marketplace/category/search/?query=audi%20a5',
                                     Object.assign({}, BASE));
  prueba('desde www va sola a m.facebook.com', () =>
    assert.ok(/^https:\/\/m\.facebook\.com\//.test(conMarketplace), conMarketplace));

  prueba('y no pierde la busqueda por el camino', () =>
    assert.ok(/\/marketplace\/category\/search\/\?query=audi(%20|\+)a5/.test(conMarketplace),
              conMarketplace));

  const yaEnCelular = await abrir('https://m.facebook.com/marketplace/category/search/?query=audi%20a5',
                                  Object.assign({}, BASE));
  prueba('estando en m.facebook.com se queda ahi', () =>
    assert.ok(/^https:\/\/m\.facebook\.com\//.test(yaEnCelular), yaEnCelular));

  const fueraDeMarketplace = await abrir('https://www.facebook.com/',
                                         Object.assign({}, BASE));
  prueba('el Facebook de todos los dias no se toca', () =>
    assert.strictEqual(fueraDeMarketplace, 'https://www.facebook.com/'));

  const apagado = await abrir('https://www.facebook.com/marketplace/category/search/?query=audi%20a5',
                              Object.assign({}, BASE, { versionCelular: false }));
  prueba('con la casilla apagada se queda donde esta', () =>
    assert.ok(/^https:\/\/www\.facebook\.com\//.test(apagado), apagado));

  await navegador.close();
  if (fallas) { console.error('\n' + fallas + ' pruebas de la version de celular fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas de la version de celular pasaron\n');
})();
