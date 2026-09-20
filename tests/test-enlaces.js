/* Buscar los enlaces que faltan entrando a la publicacion.

   En la version de celular las tarjetas no son enlaces y Facebook no escribe
   la direccion en ningun lado -medido en la pagina real: cero en todo el
   documento-. Pero al TOCAR una tarjeta la direccion pasa a ser
   .../marketplace/item/<numero>/. Idea del usuario, y es la unica que hay.

   Aca se arma esa situacion completa: una lista que al tocar una tarjeta
   navega a la publicacion, y la vuelta atras. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { servir } = require('./servidor');

const CONFIG = {
  consulta: 'audi a5', pmin: null, pmax: null, moneda: 'USD',
  cotizacion: 1000, umbralAmbiguo: 500000,
  provincias: ['BA', 'CABA', 'SF', 'ER', 'LP'], zonaDesconocida: true,
  velocidad: 'turbo', ocultar: false, tocarLaPagina: false,
  sinPrecio: true, indexar: true, versionCelular: false
};
const archivo = (p) => path.join(__dirname, '..', 'extension', p);
const GUIONES = ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js',
                 'src/lib/zonas.js', 'src/lib/recorrida.js', 'src/content/scraper.js',
                 'src/content/panel.js', 'src/content/autoscroll.js', 'src/content/content.js'];

(async () => {
  /* La pagina de la publicacion no necesita contenido: lo unico que importa es
     que la direccion tenga el numero, que es de donde sale el enlace. */
  const { srv, base } = await servir(__dirname, {
    '/marketplace/search': 'fixture-enlaces.html',
    '/marketplace/item': 'fixture-item.html'
  });
  const navegador = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const pagina = await navegador.newPage({ viewport: { width: 393, height: 852 } });
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));

  /* El almacenamiento tiene que sobrevivir a las navegaciones: entrar a una
     publicacion recarga la pagina entera y en memoria no queda nada. */
  let guardado = { config: CONFIG };
  const guardadosEnCatalogo = [];
  await pagina.exposeFunction('leerGuardado', () => guardado);
  await pagina.exposeFunction('escribirGuardado', (parche) => {
    guardado = Object.assign({}, guardado, parche);
    return true;
  });
  await pagina.exposeFunction('anotarCatalogo', (items) => {
    for (const it of items) guardadosEnCatalogo.push(it);
    return true;
  });

  await pagina.addInitScript(() => {
    window.chrome = {
      storage: {
        local: {
          get: (claves, cb) => window.leerGuardado().then((g) => {
            if (typeof claves === 'string') { const o = {}; o[claves] = g[claves]; return cb(o); }
            cb(g);
          }),
          set: (parche, cb) => window.escribirGuardado(parche).then(() => cb && cb())
        },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        lastError: undefined, getURL: (p) => p,
        onMessage: { addListener: () => {} },
        sendMessage: (m, cb) => {
          if (m && m.tipo === 'guardar') window.anotarCatalogo(m.items || []);
          if (cb) cb({ ok: true, total: 0, titulos: {} });
        }
      }
    };
  });
  await pagina.addInitScript(GUIONES.map((g) => fs.readFileSync(archivo(g), 'utf8')).join('\n;\n'));

  await pagina.goto(base + '/marketplace/search/?query=audi%20a5');
  await pagina.waitForTimeout(1500);

  let fallas = 0;
  const prueba = (nombre, fn) => {
    try { fn(); console.log('  ok   ' + nombre); }
    catch (e) { fallas++; console.error('  FALLA ' + nombre + '\n         ' + e.message); }
  };

  console.log('\nBuscar los enlaces entrando a la publicacion');

  const antes = await pagina.evaluate(() =>
    window.MPF.scraper.leerTodas().filter((d) => !d.url).length);
  prueba('se parte de publicaciones sin enlace', () => assert.ok(antes >= 2, String(antes)));

  await pagina.evaluate(() => window.MPF.diagnostico.buscarEnlaces());

  // Se espera a que la cola quede vacia: entra, vuelve, entra, vuelve.
  for (let i = 0; i < 60 && guardado.cazaEnlaces; i++) {
    await pagina.waitForTimeout(500);
  }

  prueba('entro a las publicaciones y volvio', () =>
    assert.ok(/\/marketplace\/search/.test(pagina.url()), pagina.url()));

  const conEnlace = guardadosEnCatalogo.filter((x) => x.url);
  prueba('guardo el enlace de las que coinciden', () => {
    assert.ok(conEnlace.length >= 2, JSON.stringify(guardadosEnCatalogo.map((x) => x.url)));
    for (const x of conEnlace) {
      assert.ok(/^https:\/\/www\.facebook\.com\/marketplace\/item\/\d+\/$/.test(x.url), x.url);
    }
  });

  prueba('no entro a las que no coinciden', () => {
    const titulos = conEnlace.map((x) => x.titulo).join(' | ');
    assert.ok(!/A1 Sportback/.test(titulos), titulos);
  });

  prueba('al terminar no queda ninguna busqueda a medias', () =>
    assert.ok(!guardado.cazaEnlaces, JSON.stringify(guardado.cazaEnlaces)));

  prueba('sin errores de javascript', () => assert.deepStrictEqual(errores, []));

  await navegador.close();
  srv.close();
  if (fallas) { console.error('\n' + fallas + ' pruebas de enlaces fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas de enlaces pasaron\n');
})();
