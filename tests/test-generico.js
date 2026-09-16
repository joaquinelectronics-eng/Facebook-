/* La prueba que mas vale de todas: una pagina SIN un solo atributo de Facebook.
   Si la extension lee esto, no esta adivinando nombres de componentes. Cada vez
   que Facebook cambio como arma las tarjetas, la extension dejo de leer; esto
   es lo que evita que vuelva a pasar. */
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
  const { srv, base } = await servir(__dirname, { '/': 'fixture-generico.html' });
  const navegador = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const pagina = await navegador.newPage({ viewport: { width: 393, height: 852 } });
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));
  await pagina.goto(base + '/');
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

  console.log('\nPagina sin un solo atributo de Facebook');

  const nada = await pagina.evaluate(() => ({
    enlaces: document.querySelectorAll(window.MPF.scraper.SELECTOR_ITEM).length,
    componentes: document.querySelectorAll(window.MPF.scraper.SELECTOR_MOVIL).length,
    pantalla: document.querySelectorAll('[data-mcomponent]').length
  }));
  prueba('no hay enlaces, ni componentes de Facebook, ni nada conocido', () =>
    assert.deepStrictEqual(nada, { enlaces: 0, componentes: 0, pantalla: 0 }));

  const cuantas = await pagina.evaluate(() => window.MPF.scraper.cantidadEnPantalla());
  prueba('igual encuentra las 6 publicaciones', () => assert.strictEqual(cuantas, 6));

  const leidas = await pagina.evaluate(() => window.MPF.scraper.leerTodas().map((d) => ({
    t: d.titulo, p: d.precioTexto, z: d.ubicacion, ant: d.precioAnteriorTexto, km: d.km
  })));

  prueba('junta el precio aunque venga partido en pedazos', () => {
    const a = leidas.find((x) => x.t === 'Audi A5 Sportback 2.0t');
    assert.ok(a, JSON.stringify(leidas));
    assert.strictEqual(a.p, '$19.500');
    assert.strictEqual(a.z, 'Lanús Este, BA');
  });

  prueba('no junta dos publicaciones de la misma fila en una sola', () => {
    const t = leidas.map((x) => x.t);
    assert.strictEqual(new Set(t).size, 6, JSON.stringify(t));
    assert.ok(t.includes('Audi A1 Sportback Único'), JSON.stringify(t));
  });

  prueba('capta el precio tachado de la publicacion rebajada', () => {
    const a = leidas.find((x) => x.t === 'Audi a5 quattro 3.2 At');
    assert.ok(a, JSON.stringify(leidas));
    assert.strictEqual(a.p, '$22.000');
    assert.strictEqual(a.ant, '$26.500');
  });

  prueba('lee el kilometraje', () => {
    const a = leidas.find((x) => x.t === '2008 audi A5 Cupe');
    assert.strictEqual(a.km, 100000);
  });

  const visibles = await pagina.evaluate(() =>
    window.MPF.scraper.elementosTarjeta()
      .filter((c) => c.style.display !== 'none')
      .map((c) => window.MPF.scraper.lineasMovil(c).find((x) => /audi/i.test(x)) || '?'));
  prueba('y filtra: deja solo los dos que coinciden', () =>
    assert.deepStrictEqual(visibles.sort(), ESPERADOS.slice().sort()));

  prueba('sin errores de javascript en la pagina', () => assert.deepStrictEqual(errores, []));

  await navegador.close();
  srv.close();
  if (fallas) { console.error('\n' + fallas + ' pruebas sin atributos fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas sin atributos pasaron\n');
})();
