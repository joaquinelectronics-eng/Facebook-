/* La version movil de Facebook no usa enlaces: arma las tarjetas con su propio
   sistema de componentes. A cambio, manda los titulos, que en la version de
   escritorio faltan en la mayoria de las publicaciones. */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const { servir } = require('./servidor');

const CONFIG = {
  consulta: 'audi a5', pmin: 15000, pmax: 30000, moneda: 'USD',
  cotizacion: 1000, umbralAmbiguo: 500000,
  provincias: ['BA', 'CABA', 'SF', 'ER', 'LP'], zonaDesconocida: true,
  velocidad: 'tranquilo', ocultar: true, sinPrecio: false, indexar: true
};
const ESPERADOS = ['Audi A5 Sportback 2.0t', 'Audi a5 quattro 3.2 At'];
const archivo = (p) => path.join(__dirname, '..', 'extension', p);

(async () => {
  const { srv, base } = await servir(__dirname, {
    '/marketplace/search': 'fixture-movil.html',
    /* La version movil entra a Marketplace sin cambiar la direccion: se queda
       en facebook.com. Por eso el mismo fixture se sirve tambien en la raiz. */
    '/': 'fixture-movil.html'
  });
  const navegador = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const pagina = await navegador.newPage({ viewport: { width: 393, height: 852 } });
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));
  await pagina.goto(base + '/marketplace/search/?query=audi%20a5');

  await pagina.evaluate((config) => {
    window.chrome = {
      storage: { local: { get: (k, cb) => cb({ config }), set: () => {} } },
      runtime: { lastError: undefined, getURL: (p) => p,
                 onMessage: { addListener: () => {} },
                 sendMessage: (m, cb) => cb && cb(m && m.tipo === 'titulosConocidos'
                   ? { ok: true, titulos: {} } : { ok: true, total: 0 }) }
    };
  }, CONFIG);
  for (const f of ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js', 'src/lib/zonas.js',
                   'src/content/scraper.js', 'src/content/panel.js',
                   'src/content/autoscroll.js', 'src/content/content.js']) {
    await pagina.addScriptTag({ path: archivo(f) });
  }
  await pagina.waitForTimeout(1500);

  let fallas = 0;
  const prueba = (nombre, fn) => {
    try { fn(); console.log('  ok   ' + nombre); }
    catch (e) { fallas++; console.error('  FALLA ' + nombre + '\n         ' + e.message); }
  };

  console.log('\nVersion movil: se reconocen las tarjetas sin enlaces');
  const detectado = await pagina.evaluate(() => window.MPF.scraper.esVersionMovil());
  prueba('detecta que es la version movil', () => assert.strictEqual(detectado, true));

  const leidas = await pagina.evaluate(() => window.MPF.scraper.leerTodas().map((d) => ({
    titulo: d.titulo, precio: d.precioTexto, zona: d.ubicacion,
    provincia: d.provincia, km: d.km, anterior: d.precioAnteriorTexto, id: d.id
  })));
  prueba('lee las 6 publicaciones y descarta el boton de la interfaz', () =>
    assert.strictEqual(leidas.length, 6, JSON.stringify(leidas.map((x) => x.titulo))));
  prueba('separa titulo, precio y zona', () => {
    const a = leidas.find((x) => x.titulo === 'Audi A5 Sportback 2.0t');
    assert.ok(a, JSON.stringify(leidas));
    assert.strictEqual(a.precio, '$19.500');
    assert.strictEqual(a.zona, 'Lanús Este, BA');
    assert.strictEqual(a.provincia, 'BA');
  });
  prueba('lee el kilometraje cuando viene en otra linea', () => {
    const a = leidas.find((x) => /2008 audi A5/.test(x.titulo));
    assert.ok(a, JSON.stringify(leidas.map((x) => x.titulo)));
  });
  prueba('capta el precio anterior tachado', () => {
    const a = leidas.find((x) => x.titulo === 'Audi a5 quattro 3.2 At');
    assert.strictEqual(a.anterior, '$26.500');
  });
  prueba('cada publicacion tiene un id propio y estable', () => {
    const ids = leidas.map((x) => x.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'hay ids repetidos');
    assert.ok(ids.every((x) => /^m[a-z0-9]+$/.test(x)), JSON.stringify(ids));
  });

  console.log('\nFiltrado sobre la version movil');
  const visibles = await pagina.evaluate(() => {
    const out = [];
    for (const c of document.querySelectorAll(window.MPF.scraper.SELECTOR_MOVIL)) {
      if (c.style.display === 'none') continue;
      const t = window.MPF.scraper.lineasMovil(c);
      if (t.length >= 2) out.push(t);
    }
    return out;
  });
  const titulosVisibles = visibles.map((t) => t.find((x) => /audi/i.test(x)) || t[1]);
  prueba('deja solo las que coinciden', () =>
    assert.deepStrictEqual(titulosVisibles.sort(), ESPERADOS.slice().sort()));
  prueba('descarta el A1 aunque diga Audi', () =>
    assert.ok(!titulosVisibles.some((t) => /A1/.test(t))));
  prueba('descarta las que estan fuera de rango', () =>
    assert.ok(!titulosVisibles.some((t) => /2008 audi A5/.test(t))));
  prueba('descarta Villa Carlos Paz por zona', () =>
    assert.ok(!titulosVisibles.some((t) => /Coupe 2013/.test(t))));

  prueba('sin errores de javascript en la pagina', () => assert.deepStrictEqual(errores, []));

  /* Esto es lo que fallaba en el telefono: la version movil no pone
     /marketplace en la direccion, asi que mirando solo la URL la extension
     nunca se daba cuenta de que estaba viendo publicaciones y el panel no
     aparecia. Ahora se tiene que dar cuenta por lo que hay en pantalla. */
  console.log('\nMarketplace movil sin /marketplace en la direccion');
  const otra = await navegador.newPage({ viewport: { width: 393, height: 852 } });
  const erroresOtra = [];
  otra.on('pageerror', (e) => erroresOtra.push(String(e)));
  await otra.goto(base + '/');
  await otra.evaluate((config) => {
    window.chrome = {
      storage: { local: { get: (k, cb) => cb({ config }), set: () => {} } },
      runtime: { lastError: undefined, getURL: (p) => p,
                 onMessage: { addListener: () => {} },
                 sendMessage: (m, cb) => cb && cb(m && m.tipo === 'titulosConocidos'
                   ? { ok: true, titulos: {} } : { ok: true, total: 0 }) }
    };
  }, CONFIG);
  for (const f of ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js', 'src/lib/zonas.js',
                   'src/content/scraper.js', 'src/content/panel.js',
                   'src/content/autoscroll.js', 'src/content/content.js']) {
    await otra.addScriptTag({ path: archivo(f) });
  }
  await otra.waitForTimeout(1500);

  const rutaSinMarketplace = await otra.evaluate(() => location.pathname);
  prueba('la direccion no dice marketplace', () =>
    assert.ok(!/marketplace/.test(rutaSinMarketplace), rutaSinMarketplace));

  const panelVisible = await otra.evaluate(() => {
    const host = document.getElementById('mpf-host');
    if (!host || !host.shadowRoot) return null;
    const caja = host.shadowRoot.querySelector('.caja');
    return caja ? getComputedStyle(caja).display : null;
  });
  prueba('igual aparece el panel', () => assert.strictEqual(panelVisible, 'block'));

  const titulosOtra = await otra.evaluate(() => {
    const out = [];
    for (const c of document.querySelectorAll(window.MPF.scraper.SELECTOR_MOVIL)) {
      if (c.style.display === 'none') continue;
      const t = window.MPF.scraper.lineasMovil(c);
      if (t.length >= 2) out.push(t.find((x) => /audi/i.test(x)) || t[1]);
    }
    return out;
  });
  prueba('y filtra igual que con /marketplace en la direccion', () =>
    assert.deepStrictEqual(titulosOtra.sort(), ESPERADOS.slice().sort()));

  prueba('sin errores de javascript en la otra pagina', () =>
    assert.deepStrictEqual(erroresOtra, []));

  /* La pantalla de busqueda arma las tarjetas de otra forma y el selector por
     atributos no engancha nada: el panel aparecia leyendo cero publicaciones.
     Aca se simula justamente eso, sacandole a las tarjetas los atributos en
     los que se apoyaba el selector. */
  console.log('\nPantalla donde el selector por atributos no engancha');
  const rara = await navegador.newPage({ viewport: { width: 393, height: 852 } });
  const erroresRara = [];
  rara.on('pageerror', (e) => erroresRara.push(String(e)));
  await rara.goto(base + '/');
  await rara.evaluate(() => {
    for (const e of document.querySelectorAll('[data-action-id]')) {
      e.removeAttribute('data-action-id');
      e.removeAttribute('tabindex');
    }
  });
  await rara.evaluate((config) => {
    window.chrome = {
      storage: { local: { get: (k, cb) => cb({ config }), set: () => {} } },
      runtime: { lastError: undefined, getURL: (p) => p,
                 onMessage: { addListener: () => {} },
                 sendMessage: (m, cb) => cb && cb(m && m.tipo === 'titulosConocidos'
                   ? { ok: true, titulos: {} } : { ok: true, total: 0 }) }
    };
  }, CONFIG);
  for (const f of ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js', 'src/lib/zonas.js',
                   'src/content/scraper.js', 'src/content/panel.js',
                   'src/content/autoscroll.js', 'src/content/content.js']) {
    await rara.addScriptTag({ path: archivo(f) });
  }
  await rara.waitForTimeout(1500);

  const sinSelector = await rara.evaluate(() =>
    document.querySelectorAll(window.MPF.scraper.SELECTOR_MOVIL).length);
  prueba('el selector por atributos no encuentra nada', () =>
    assert.strictEqual(sinSelector, 0));

  const cuantas = await rara.evaluate(() => window.MPF.scraper.cantidadEnPantalla());
  prueba('igual cuenta las 6 publicaciones', () => assert.strictEqual(cuantas, 6));

  const leidasRara = await rara.evaluate(() =>
    window.MPF.scraper.leerTodas().map((d) => ({ t: d.titulo, p: d.precioTexto, z: d.ubicacion })));
  prueba('y les saca titulo, precio y zona', () => {
    const a = leidasRara.find((x) => x.t === 'Audi A5 Sportback 2.0t');
    assert.ok(a, JSON.stringify(leidasRara));
    assert.strictEqual(a.p, '$19.500');
    assert.strictEqual(a.z, 'Lanús Este, BA');
  });

  const titulosRara = await rara.evaluate(() => {
    const out = [];
    for (const c of window.MPF.scraper.elementosTarjeta()) {
      if (c.style.display === 'none') continue;
      const t = window.MPF.scraper.lineasMovil(c);
      if (t.length >= 2) out.push(t.find((x) => /audi/i.test(x)) || t[1]);
    }
    return out;
  });
  prueba('y filtra igual que siempre', () =>
    assert.deepStrictEqual(titulosRara.sort(), ESPERADOS.slice().sort()));

  prueba('sin errores de javascript en la pantalla rara', () =>
    assert.deepStrictEqual(erroresRara, []));

  await navegador.close();
  srv.close();
  if (fallas) { console.error('\n' + fallas + ' pruebas de la version movil fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas de la version movil pasaron\n');
})();
