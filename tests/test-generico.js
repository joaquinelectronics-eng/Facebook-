/* La prueba que mas vale de todas: una pagina SIN un solo atributo de Facebook.
   Si la extension lee esto, no esta adivinando nombres de componentes. Cada vez
   que Facebook cambio como arma las tarjetas, la extension dejo de leer; esto
   es lo que evita que vuelva a pasar. */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const { servir } = require('./servidor');

const CONFIG = {
  consulta: 'audi a5 -permuto', pmin: 15000, pmax: 30000, moneda: 'USD',
  cotizacion: 1000, umbralAmbiguo: 500000,
  provincias: ['BA', 'CABA', 'SF', 'ER', 'LP'], zonaDesconocida: true,
  velocidad: 'tranquilo', ocultar: true, sinPrecio: false, indexar: true
};
const ESPERADOS = ['Audi A5 Sportback 2.0t', 'Audi a5 quattro 3.2 At'];
/* El de titulo cortado no coincide con el filtro, pero tampoco se puede
   descartar: el modelo quedo del otro lado del corte. Se muestra en duda. */
const EN_DUDA = 'Vendo Audi Cabriolet 2.0 Tfsi A\u2026';
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
  prueba('igual encuentra las 8 publicaciones', () => assert.strictEqual(cuantas, 8));

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
    assert.strictEqual(new Set(t).size, 8, JSON.stringify(t));
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

  /* Se mira si de verdad se ve, y no si la caja tiene display:none encima: lo
     que se esconde puede ser la celda que la contiene. */
  const visibles = await pagina.evaluate(() =>
    window.MPF.scraper.elementosTarjeta()
      .filter((c) => c.getClientRects().length > 0)
      .map((c) => window.MPF.scraper.lineasMovil(c).find((x) => /audi/i.test(x)) || '?'));
  prueba('y filtra: deja los que coinciden y el que no se puede confirmar', () =>
    assert.deepStrictEqual(visibles.sort(),
      ESPERADOS.concat([EN_DUDA]).sort()));

  /* Lo importante del titulo cortado: no se descarta, pero tampoco se hace
     pasar por una que coincide. Queda a la vista y apagada. */
  const duda = await pagina.evaluate((cortado) => {
    const salida = { marcadas: 0, opacidadDelCortado: null, motivo: null };
    for (const c of window.MPF.scraper.elementosTarjeta()) {
      const caja = window.MPF.scraper.contenedorTarjeta(c);
      if (caja.dataset.mpfDuda) salida.marcadas++;
      if (window.MPF.scraper.lineasMovil(c).some((x) => x === cortado)) {
        salida.opacidadDelCortado = caja.style.opacity;
        salida.motivo = caja.getAttribute('data-mpf-motivo');
      }
    }
    return salida;
  }, EN_DUDA);
  prueba('el de titulo cortado queda en duda, no aprobado', () =>
    assert.deepStrictEqual(duda, { marcadas: 1, opacidadDelCortado: '0.45',
                                   motivo: 'titulo cortado: no se puede confirmar' }));

  /* Y el limite: un titulo cortado que ademas trae una palabra excluida NO es
     duda. Esa palabra esta escrita, no es cuestion de lo que no se ve. */
  const excluido = await pagina.evaluate(() =>
    window.MPF.scraper.elementosTarjeta()
      .filter((c) => window.MPF.scraper.lineasMovil(c).some((x) => /permuto/.test(x)))
      .map((c) => window.MPF.scraper.contenedorTarjeta(c).style.display));
  prueba('pero uno cortado con palabra excluida se descarta igual', () =>
    assert.deepStrictEqual(excluido, ['none']));

  /* Lo que se esconde tiene que ser la celda entera. Escondiendo la cajita de
     adentro, la celda queda vacia ocupando su lugar: la pantalla se llena de
     huecos blancos y parece que no hubiera resultados. */
  const huecos = await pagina.evaluate(() => {
    const salida = { celdasEscondidas: 0, cajasSueltas: 0, celdasVaciasVisibles: 0 };
    for (const celda of document.querySelectorAll('.celda')) {
      const escondida = celda.style.display === 'none';
      if (escondida) salida.celdasEscondidas++;
      const caja = celda.firstElementChild;
      if (!escondida && caja && caja.style.display === 'none') salida.cajasSueltas++;
      if (!escondida && celda.offsetHeight > 0 &&
          (!caja || caja.style.display === 'none')) salida.celdasVaciasVisibles++;
    }
    return salida;
  });
  prueba('esconde la celda entera y no deja huecos blancos', () =>
    assert.deepStrictEqual(huecos,
      { celdasEscondidas: 5, cajasSueltas: 0, celdasVaciasVisibles: 0 }));

  /* En la version movil la que scrollea no es la ventana sino un cajon interno.
     Mientras el barrido movia la ventana no pasaba nada, la cuenta del fondo
     daba "ya llegamos" y cortaba diciendo que no habia mas resultados. */
  const cajon = await pagina.evaluate(() => {
    const c = window.MPF.autoscroll.cajonDeScroll();
    return { id: c ? c.id : null, laVentanaNoSeMueve:
      document.documentElement.scrollHeight <= window.innerHeight };
  });
  prueba('encuentra el cajon que de verdad scrollea', () =>
    assert.deepStrictEqual(cajon, { id: 'cajon', laVentanaNoSeMueve: true }));

  /* Y que el barrido mueva ese cajon de verdad, no solo que sepa cual es. */
  const movio = await pagina.evaluate(async () => {
    const c = document.getElementById('cajon');
    const antes = c.scrollTop;
    await new Promise((listo) => {
      window.MPF.autoscroll.iniciar(
        (p) => { if (p.estado && /listo|detenido/.test(p.estado)) listo(); },
        { velocidad: 'turbo', limiteTandas: 1 });
      setTimeout(listo, 4000);
    });
    return { antes, despues: document.getElementById('cajon').scrollTop };
  });
  prueba('y el barrido lo mueve', () =>
    assert.ok(movio.despues > movio.antes, JSON.stringify(movio)));

  prueba('sin errores de javascript en la pagina', () => assert.deepStrictEqual(errores, []));

  await navegador.close();
  srv.close();
  if (fallas) { console.error('\n' + fallas + ' pruebas sin atributos fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas sin atributos pasaron\n');
})();
