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
  provincias: ['BA', 'CABA', 'SF', 'ER', 'LP'],
  zonaDesconocida: true,
  ocultar: true, sinPrecio: false, indexar: true
};

// Lo que tiene que quedar visible con esa configuracion.
const ESPERADOS = ['101', '106', '108', '111', '114', '117'];

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

  for (const f of ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js', 'src/lib/zonas.js',
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
    km: d.km, anio: d.anio, url: d.url, provincia: d.provincia
  })));

  prueba('encuentra las 17 publicaciones', () => assert.strictEqual(leidas.length, 17));
  prueba('extrae el titulo completo', () => {
    const a = leidas.find((x) => x.id === '101');
    assert.strictEqual(a.titulo, 'Audi A5 2.0 TFSI Quattro 2018');
  });
  prueba('separa el precio del titulo', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').precioTexto, 'US$ 23.500');
  });
  prueba('separa la zona del "Usado" que Facebook le pega adelante', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').ubicacion, 'Olivos, BA');
  });
  prueba('separa la zona del kilometraje que le pega adelante', () => {
    assert.strictEqual(leidas.find((x) => x.id === '106').ubicacion, 'Ciudad de Buenos Aires');
  });
  prueba('entiende "128 mil km" como 128.000', () => {
    assert.strictEqual(leidas.find((x) => x.id === '106').km, 128000);
  });
  prueba('la zona larga no le gana al titulo', () => {
    assert.strictEqual(leidas.find((x) => x.id === '105').titulo, 'Audi A5 Sportback 2020');
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
    '110': 'excluido: permuto',          '113': 'barato fuera de rango',
    '112': 'sin precio',                 '115': 'fuera de zona: Cordoba',
    '116': 'fuera de zona: Mendoza'
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

  console.log('\nPrecios abreviados y trucos de vendedor');
  const detalle = await pagina.evaluate(() => {
    // innerText no lee elementos escondidos, asi que para esta inspeccion se
    // muestran todos de nuevo antes de releer el DOM.
    for (const e of document.querySelectorAll('[data-mpf-oculto]')) e.style.display = '';
    const out = {};
    for (const d of window.MPF.scraper.leerTodas()) {
      const r = window.MPF.precio.parsearPrecio(d.precioTexto, { umbralAmbiguo: 500000 });
      out[d.id] = { titulo: d.titulo, precioTexto: d.precioTexto, valor: r.valor,
                    moneda: r.moneda, abreviado: r.abreviado };
    }
    return out;
  });

  prueba('"$ 22" se entiende como 22.000 dolares', () => {
    assert.strictEqual(detalle['111'].valor, 22000);
    assert.strictEqual(detalle['111'].moneda, 'USD');
    assert.ok(detalle['111'].abreviado);
  });
  prueba('"26 palos" se entiende como 26 millones de pesos', () => {
    assert.strictEqual(detalle['114'].valor, 26000000);
    assert.strictEqual(detalle['114'].moneda, 'ARS');
  });
  prueba('"$ 13" se entiende como 13.000 dolares', () =>
    assert.strictEqual(detalle['113'].valor, 13000));
  prueba('"$1" queda sin precio y no se inventa nada', () => {
    assert.strictEqual(detalle['112'].valor, null);
  });
  prueba('el abreviado entra al rango en vez de perderse', () =>
    assert.ok(visibles.includes('111') && visibles.includes('114')));

  console.log('\nZona: Buenos Aires, CABA, Santa Fe, Entre Rios y La Pampa');
  prueba('reconoce la provincia por la abreviatura', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').provincia, 'BA');
    assert.strictEqual(leidas.find((x) => x.id === '111').provincia, 'ER');
  });
  prueba('reconoce CABA escrita completa', () =>
    assert.strictEqual(leidas.find((x) => x.id === '106').provincia, 'CABA'));
  prueba('reconoce la provincia por la localidad', () =>
    assert.strictEqual(leidas.find((x) => x.id === '109').provincia, 'CABA'));
  prueba('descarta Cordoba y Mendoza', () =>
    assert.ok(!visibles.includes('115') && !visibles.includes('116')));
  prueba('una localidad desconocida NO se descarta', () =>
    assert.ok(visibles.includes('117')));

  await navegador.close();

  if (fallas) { console.error('\n' + fallas + ' pruebas de DOM fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas de DOM pasaron\n');
})();
