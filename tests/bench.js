/* Mide cuanto tarda la extension en procesar una pagina con muchos resultados.
   Es lo que define si el barrido se siente rapido o se arrastra: si cada
   pasada bloquea el hilo principal, el scroll se frena aunque el perfil de
   velocidad diga lo contrario. */
const { chromium } = require('playwright');
const path = require('path');
const { servir } = require('./servidor');

const CANTIDAD = Number(process.argv[2]) || 3000;
const archivo = (p) => path.join(__dirname, '..', 'extension', p);

(async () => {
  const { srv, base } = await servir(__dirname, { '/marketplace/search': 'fixture-marketplace.html' });
  const navegador = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const pagina = await navegador.newPage();
  await pagina.goto(base + '/marketplace/search/?query=audi%20a5&n=' + CANTIDAD);

  await pagina.evaluate(() => {
    window.chrome = {
      storage: { local: { get: (k, cb) => cb({ config: {
        consulta: 'audi a5 -permuto', pmin: 15000, pmax: 30000, moneda: 'USD',
        cotizacion: 1000, umbralAmbiguo: 500000,
        provincias: ['BA', 'CABA', 'SF', 'ER', 'LP'], zonaDesconocida: true,
        ocultar: true, sinPrecio: false, indexar: false
      } }), set: () => {} } },
      runtime: { lastError: undefined, getURL: (p) => p,
                 onMessage: { addListener: () => {} },
                 sendMessage: (m, cb) => cb && cb({ ok: true, total: 0 }) }
    };
  });
  for (const f of ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js', 'src/lib/zonas.js',
                   'src/content/scraper.js', 'src/content/panel.js',
                   'src/content/autoscroll.js', 'src/content/content.js']) {
    await pagina.addScriptTag({ path: archivo(f) });
  }
  await pagina.waitForTimeout(3000);

  /* Primera medicion: el trabajo de leer y filtrar todo desde cero.
     Segunda: lo que cuesta cada pasada posterior, que es lo que se repite
     con cada mutacion del DOM mientras barre. */
  const r = await pagina.evaluate(() => {
    const t0 = performance.now();
    window.MPF.scraper.leerTodas();
    const leer = performance.now() - t0;

    // Una pasada con todo ya leido: es la que se repite todo el tiempo.
    const t1 = performance.now();
    for (const a of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      window.MPF.scraper.contenedorTarjeta(a);
    }
    const ubicar = performance.now() - t1;

    // La pasada de filtrado completa, que es lo que corre con cada mutacion.
    const t2 = performance.now();
    window.MPF.diagnostico.aplicarFiltros();
    const filtrarPrimera = performance.now() - t2;

    const t3 = performance.now();
    for (let i = 0; i < 5; i++) window.MPF.diagnostico.aplicarFiltros();
    const filtrarRepetida = (performance.now() - t3) / 5;

    const sh = document.getElementById('mpf-host').shadowRoot;
    return {
      tarjetas: document.querySelectorAll('a[href*="/marketplace/item/"]').length,
      vistos: sh.getElementById('mVistos').textContent,
      ok: sh.getElementById('mOk').textContent,
      leerMs: Math.round(leer),
      ubicarMs: Math.round(ubicar),
      filtrarPrimeraMs: Math.round(filtrarPrimera),
      filtrarRepetidaMs: Math.round(filtrarRepetida)
    };
  });

  console.log('\n  tarjetas en la pagina : ' + r.tarjetas);
  console.log('  panel dice            : ' + r.vistos + ' en pantalla, ' + r.ok + ' coinciden');
  console.log('  leer todo de cero     : ' + r.leerMs + ' ms');
  console.log('  ubicar cada tarjeta   : ' + r.ubicarMs + ' ms');
  console.log('  filtrar (1a vez)      : ' + r.filtrarPrimeraMs + ' ms');
  console.log('  filtrar (repetida)    : ' + r.filtrarRepetidaMs + ' ms   <- esto corre con cada cambio del DOM\n');

  await navegador.close();
  srv.close();
})();
