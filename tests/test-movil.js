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
  const { srv, base } = await servir(__dirname, { '/marketplace/search': 'fixture-movil.html' });
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

  await navegador.close();
  srv.close();
  if (fallas) { console.error('\n' + fallas + ' pruebas de la version movil fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas de la version movil pasaron\n');
})();
