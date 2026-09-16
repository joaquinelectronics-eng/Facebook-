/* Mide el costo REAL de un barrido: las tarjetas no aparecen todas juntas,
   van llegando de a tandas. Si cada pasada reprocesa todo lo acumulado, el
   trabajo total crece al cuadrado y el barrido se frena cada vez mas.
   Este banco reproduce eso. */
const { chromium } = require('playwright');
const path = require('path');
const { servir } = require('./servidor');

const TOTAL = Number(process.argv[2]) || 4000;
const TANDA = 200;
const archivo = (p) => path.join(__dirname, '..', 'extension', p);

(async () => {
  const { srv, base } = await servir(__dirname, { '/marketplace/search': 'fixture-marketplace.html' });
  const navegador = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const pagina = await navegador.newPage();
  await pagina.goto(base + '/marketplace/search/?query=audi%20a5&n=0');

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
                 sendMessage: (m, cb) => cb && cb(m && m.tipo === 'titulosConocidos'
                   ? { ok: true, titulos: {} } : { ok: true, total: 0 }) }
    };
  });
  for (const f of ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js', 'src/lib/zonas.js',
                   'src/content/scraper.js', 'src/content/panel.js',
                   'src/content/autoscroll.js', 'src/content/content.js']) {
    await pagina.addScriptTag({ path: archivo(f) });
  }
  await pagina.waitForTimeout(1200);

  const medidas = await pagina.evaluate(async ({ total, tanda }) => {
    const plantilla = document.createElement('div');
    let siguiente = 2000;

    function agregar(cuantas) {
      const grilla = document.getElementById('grilla');
      const trozo = document.createDocumentFragment();
      for (let i = 0; i < cuantas; i++) {
        const id = siguiente++;
        const celda = document.createElement('div');
        celda.className = 'x9f619 x1n2onr6 x1ja2u2z';
        const titulo = id % 3 === 0 ? 'Audi A5 2018 Quattro' : 'Audi A4 2017 TFSI';
        celda.innerHTML =
          '<div class="x1lliihq"><div class="x78zum5">' +
            '<a href="/marketplace/item/' + id + '/" class="x1i10hfl"><div class="xt7dq6l">' +
              '<img alt="' + titulo + '" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">' +
              '<div><span>US$ ' + (18000 + (id % 9) * 1000).toLocaleString('es-AR') + '</span></div>' +
              '<div><span>' + titulo + '</span></div>' +
              '<div><span>Usado · Olivos, BA</span></div>' +
            '</div></a>' +
          '</div></div>';
        trozo.appendChild(celda);
      }
      grilla.appendChild(trozo);
    }

    const out = [];
    let acumulado = 0;
    for (let n = tanda; n <= total; n += tanda) {
      agregar(tanda);
      const t = performance.now();
      window.MPF.diagnostico.aplicarFiltros();
      const ms = performance.now() - t;
      acumulado += ms;
      if (n % 1000 === 0 || n === tanda) {
        out.push({ tarjetas: n, pasadaMs: Math.round(ms), acumuladoMs: Math.round(acumulado) });
      }
    }
    return out;
  }, { total: TOTAL, tanda: TANDA });

  console.log('\n  tarjetas   pasada     total acumulado');
  console.log('  ' + '-'.repeat(42));
  for (const m of medidas) {
    console.log('  ' + String(m.tarjetas).padStart(6) + '   ' +
                String(m.pasadaMs).padStart(5) + ' ms' + '   ' +
                String(m.acumuladoMs).padStart(9) + ' ms');
  }
  console.log();
  await navegador.close();
  srv.close();
})();
