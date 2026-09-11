/* Prueba de integracion real: se levanta Chromium, se carga una replica del DOM
   de Marketplace y se inyectan los MISMOS archivos que usa la extension.
   Verifica que el scraper lee bien las tarjetas y que el filtro esconde
   exactamente las que no corresponden. */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const RAIZ = path.join(__dirname, '..');
const archivo = (p) => path.join(RAIZ, 'extension', p);

const CONFIG = {
  consulta: 'audi a5 -permuto',
  pmin: 15000, pmax: 30000, moneda: 'USD',
  cotizacion: 1000, umbralAmbiguo: 500000,
  ocultar: true, sinPrecio: false, indexar: true
};

// Lo que tiene que quedar visible con esa configuracion.
const ESPERADOS = ['101', '106', '108'];

(async () => {
  const navegador = await chromium.launch({
    // Chromium ya viene instalado en este entorno; en tu PC alcanza con quitar
    // executablePath y dejar que Playwright use el suyo.
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const pagina = await navegador.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));

  await pagina.goto('file://' + path.join(__dirname, 'fixture-marketplace.html'));

  // Stub de la API de extensiones: en una pagina normal chrome.* no existe.
  await pagina.evaluate((config) => {
    window.__guardados = [];
    window.chrome = {
      storage: { local: { get: (k, cb) => cb({ config }), set: () => {} } },
      runtime: {
        lastError: undefined,
        getURL: (p) => p,
        sendMessage: (msg, cb) => {
          if (msg && msg.tipo === 'guardar') window.__guardados.push(...(msg.items || []));
          if (cb) cb({ ok: true, total: window.__guardados.length });
        }
      }
    };
  }, CONFIG);

  for (const f of ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js',
                   'src/content/scraper.js', 'src/content/panel.js',
                   'src/content/autoscroll.js', 'src/content/content.js']) {
    await pagina.addScriptTag({ path: archivo(f) });
  }

  // El guardado en el catalogo se agrupa con 1,5 s de retardo para no
  // saturar el service worker, asi que hay que darle tiempo.
  await pagina.waitForTimeout(2600);

  let fallas = 0;
  const prueba = (nombre, fn) => {
    try { fn(); console.log('  ok   ' + nombre); }
    catch (e) { fallas++; console.error('  FALLA ' + nombre + '\n         ' + e.message); }
  };

  console.log('\nLectura del DOM (sin usar una sola clase de Facebook)');

  const leidas = await pagina.evaluate(() => window.MPF.scraper.leerTodas().map((d) => ({
    id: d.id, titulo: d.titulo, precioTexto: d.precioTexto, ubicacion: d.ubicacion,
    km: d.km, anio: d.anio, url: d.url
  })));

  prueba('encuentra las 10 publicaciones', () => assert.strictEqual(leidas.length, 10));
  prueba('extrae el titulo completo', () => {
    const a = leidas.find((x) => x.id === '101');
    assert.strictEqual(a.titulo, 'Audi A5 2.0 TFSI Quattro 2018');
  });
  prueba('separa el precio del titulo', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').precioTexto, 'US$ 23.500');
  });
  prueba('detecta la ubicacion', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').ubicacion, 'Rosario, Santa Fe');
  });
  prueba('detecta el kilometraje', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').km, 85000);
  });
  prueba('detecta el anio', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').anio, 2018);
  });
  prueba('limpia la url de parametros de rastreo', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').url,
      'https://www.facebook.com/marketplace/item/101/');
  });

  console.log('\nFiltrado en vivo: "audi a5 -permuto" entre 15.000 y 30.000 USD');

  const visibles = await pagina.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      const caja = window.MPF.scraper.contenedorTarjeta(a);
      if (caja.style.display !== 'none') out.push(a.getAttribute('data-mpf-id'));
    }
    return out;
  });

  prueba('deja exactamente las que corresponden', () =>
    assert.deepStrictEqual(visibles.sort(), ESPERADOS.slice().sort()));

  const motivos = await pagina.evaluate(() => {
    const out = {};
    for (const a of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      const caja = window.MPF.scraper.contenedorTarjeta(a);
      const m = caja.getAttribute('data-mpf-motivo');
      if (m) out[a.getAttribute('data-mpf-id')] = m;
    }
    return out;
  });

  const motivosEsperados = {
    '102': 'falta: a5',                  '103': 'falta: a5',
    '104': 'barato fuera de rango',      '105': 'caro fuera de rango',
    '107': 'falta: audi',                '109': 'falta: a5',
    '110': 'excluido: permuto'
  };
  for (const [id, esperado] of Object.entries(motivosEsperados)) {
    prueba('descarta ' + id + ' por "' + esperado + '"', () =>
      assert.strictEqual(motivos[id], esperado));
  }

  console.log('\nMezcla de monedas');
  prueba('toma "$ 24.500" como dolares', async () => {});
  const monedas = await pagina.evaluate(() => {
    const p = window.MPF.precio;
    return {
      m106: p.parsearPrecio('$ 24.500', { umbralAmbiguo: 500000 }),
      m108: p.parsearPrecio('$ 28.000.000', { umbralAmbiguo: 500000 })
    };
  });
  prueba('"$ 24.500" se lee como USD', () => assert.strictEqual(monedas.m106.moneda, 'USD'));
  prueba('"$ 28.000.000" se lee como ARS', () => assert.strictEqual(monedas.m108.moneda, 'ARS'));
  prueba('el auto en pesos entra igual al rango en dolares', () =>
    assert.ok(visibles.includes('108')));

  console.log('\nCatalogo e interfaz');
  const guardados = await pagina.evaluate(() => window.__guardados.length);
  prueba('manda las publicaciones al catalogo', () => assert.ok(guardados >= 10,
    'guardados=' + guardados));
  const hayPanel = await pagina.evaluate(() =>
    !!document.getElementById('mpf-host')?.shadowRoot?.querySelector('.caja'));
  prueba('el panel se dibuja aislado en shadow DOM', () => assert.ok(hayPanel));

  prueba('sin errores de javascript en la pagina', () =>
    assert.deepStrictEqual(errores, []));

  await navegador.close();

  if (fallas) { console.error('\n' + fallas + ' pruebas de DOM fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas de DOM pasaron\n');
})();
