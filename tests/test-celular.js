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
const recorrida = require(path.join(__dirname, '..', 'extension', 'src', 'lib', 'recorrida.js'));
const GUIONES = ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js',
                 'src/lib/zonas.js', 'src/lib/recorrida.js', 'src/content/scraper.js', 'src/content/panel.js',
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

  async function abrir(url, config, antes) {
    const pagina = await navegador.newPage({ viewport: { width: 393, height: 852 } });
    // Se hace pasar la pagina de prueba por Facebook, sin tocar Facebook.
    await pagina.route('**://*.facebook.com/**', (ruta) =>
      ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGINA }));
    if (antes) await antes(pagina, url);
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

  /* Se trabaja en escritorio -es de donde vienen los enlaces y los titulos-,
     asi que ir sola al celular esta APAGADO por defecto. Estas pruebas lo
     prenden a proposito, que es la unica forma de probar ese camino. */
  const BASE = { consulta: 'audi a5', provincias: ['BA'], zonaDesconocida: true,
                 ocultar: true, indexar: false, versionCelular: true };

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

  /* Y de fabrica viene apagada: se trabaja en escritorio, que es de donde
     salen los enlaces y los titulos. Medido sobre 1990 publicaciones: de las
     454 con enlace, 454 tienen titulo y 0 no. */
  const deFabrica = await abrir(
    'https://www.facebook.com/marketplace/category/search/?query=audi%20a5',
    { consulta: 'audi a5', provincias: ['BA'], zonaDesconocida: true,
      ocultar: true, indexar: false });
  prueba('de fabrica se queda en escritorio', () =>
    assert.ok(/^https:\/\/www\.facebook\.com\//.test(deFabrica), deFabrica));

  /* Hace falta poder ir a escritorio a proposito: en el celular Facebook no
     manda ni un enlace de publicacion -medido: 0 en toda la pagina- y en
     escritorio las tarjetas si son enlaces. Si la recorrida pide una direccion
     de www, no se la puede llevar al celular. */
  const pedidoDeEscritorio = await abrir(
    'https://www.facebook.com/marketplace/category/search/?query=audi%20a5#mpf=escritorio',
    Object.assign({}, BASE));
  prueba('si la recorrida pide escritorio, no la manda al celular', () =>
    assert.ok(/^https:\/\/www\.facebook\.com\//.test(pedidoDeEscritorio),
              pedidoDeEscritorio));

  /* A mano no se podia llegar a escritorio: la extension manda todo al celular
     y te vuelve a traer. Y hay que poder ir, porque en el celular Facebook no
     manda ni un enlace de publicacion y en escritorio las tarjetas si lo son.
     Se prueba apretando el boton de verdad, adentro del panel. */
  console.log('\nIr a escritorio a buscar los enlaces');
  const pEsc = await navegador.newPage({ viewport: { width: 393, height: 852 } });
  await pEsc.route('**://*.facebook.com/**', (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGINA }));
  await pEsc.addInitScript((c) => {
    window.chrome = {
      storage: { local: { get: (k, cb) => cb({ config: c }), set: () => {} } },
      runtime: { lastError: undefined, getURL: (p) => p,
                 onMessage: { addListener: () => {} },
                 sendMessage: (m, cb) => cb && cb({ ok: true, total: 0, titulos: {} }) }
    };
  }, Object.assign({}, BASE));
  await pEsc.addInitScript(GUIONES.map((g) => fs.readFileSync(archivo(g), 'utf8')).join('\n;\n'));
  await pEsc.goto('https://m.facebook.com/marketplace/category/search/?query=audi%20a5');
  await pEsc.waitForTimeout(2500);
  await pEsc.evaluate(() =>
    document.getElementById('mpf-host').shadowRoot.getElementById('escritorio').click());
  await pEsc.waitForTimeout(3500);
  const dondeQuedo = pEsc.url();
  prueba('el boton lleva a escritorio', () =>
    assert.ok(/^https:\/\/www\.facebook\.com\//.test(dondeQuedo), dondeQuedo));
  prueba('y no lo rebota de vuelta al celular', () => {
    assert.ok(!/m\.facebook\.com/.test(dondeQuedo), dondeQuedo);
    assert.ok(/query=audi(%20|\+)a5/.test(dondeQuedo), dondeQuedo);
  });
  await pEsc.close();

  /* El caso que rompia de verdad: ya en escritorio, al aplicar un filtro de
     precio Facebook reescribe la direccion y se lleva puesta la marca. Sin
     nada mas, la pasada siguiente veia www sin marca y devolvia al celular
     justo cuando uno estaba trabajando. */
  console.log('\nQuedarse en escritorio aunque Facebook borre la marca');
  const pFiltro = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
  await pFiltro.route('**://*.facebook.com/**', (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGINA }));
  await pFiltro.addInitScript((c) => {
    window.chrome = {
      storage: { local: { get: (k, cb) => cb({ config: c }), set: () => {} } },
      runtime: { lastError: undefined, getURL: (p) => p,
                 onMessage: { addListener: () => {} },
                 sendMessage: (m, cb) => cb && cb({ ok: true, total: 0, titulos: {} }) }
    };
  }, Object.assign({}, BASE));
  await pFiltro.addInitScript(GUIONES.map((g) => fs.readFileSync(archivo(g), 'utf8')).join('\n;\n'));
  await pFiltro.goto('https://www.facebook.com/marketplace/category/search/?query=audi%20a5#mpf=escritorio');
  await pFiltro.waitForTimeout(2500);

  // Facebook cambia la direccion al aplicar un filtro, y la marca se pierde.
  await pFiltro.evaluate(() => history.replaceState({}, '',
    '/marketplace/category/search/?query=audi%20a5&maxPrice=16000'));
  await pFiltro.waitForTimeout(4000);

  prueba('sigue en escritorio despues de aplicar un filtro', () =>
    assert.ok(/^https:\/\/www\.facebook\.com\//.test(pFiltro.url()), pFiltro.url()));
  prueba('y la marca ya no esta en la direccion', () =>
    assert.ok(!/mpf=escritorio/.test(pFiltro.url()), pFiltro.url()));
  await pFiltro.close();

  /* Y si el navegador esta en modo telefono, ese boton no puede funcionar:
     Chrome firma todo como iPhone y Facebook devuelve la version de celular
     tambien en www. Antes se quedaba quieto sin decir nada, que es lo peor. */
  const pMovil = await navegador.newPage({
    viewport: { width: 393, height: 852 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
               '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  });
  await pMovil.route('**://*.facebook.com/**', (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGINA }));
  await pMovil.addInitScript((c) => {
    window.chrome = {
      storage: { local: { get: (k, cb) => cb({ config: c }), set: () => {} } },
      runtime: { lastError: undefined, getURL: (p) => p,
                 onMessage: { addListener: () => {} },
                 sendMessage: (m, cb) => cb && cb({ ok: true, total: 0, titulos: {} }) }
    };
  }, Object.assign({}, BASE));
  await pMovil.addInitScript(GUIONES.map((g) => fs.readFileSync(archivo(g), 'utf8')).join('\n;\n'));
  await pMovil.goto('https://m.facebook.com/marketplace/category/search/?query=audi%20a5');
  await pMovil.waitForTimeout(2500);
  await pMovil.evaluate(() =>
    document.getElementById('mpf-host').shadowRoot.getElementById('escritorio').click());
  await pMovil.waitForTimeout(2000);
  const avisoModoTelefono = await pMovil.evaluate(() =>
    document.getElementById('mpf-host').shadowRoot.getElementById('estado').textContent);
  prueba('en modo telefono no se queda mudo: avisa', () =>
    assert.ok(/modo telefono/.test(avisoModoTelefono), JSON.stringify(avisoModoTelefono)));
  prueba('y no se mueve de donde esta', () =>
    assert.ok(/m\.facebook\.com/.test(pMovil.url()), pMovil.url()));
  await pMovil.close();

  /* --------------------------------------------------------------
     Recorrer varias busquedas sola.

     Facebook corta cada busqueda: medido en la pagina real, "audi a5" devolvio
     261 y ni una mas. Por eso la extension recorre una lista, barre cada una y
     el catalogo se queda con la union. Aca se comprueba que pase de la primera
     a la segunda y que al final se de por terminada. */
  console.log('\nRecorrer varias busquedas');
  const visitadas = [];
  const pagina = await navegador.newPage({ viewport: { width: 393, height: 852 } });
  const erroresR = [];
  pagina.on('pageerror', (e) => erroresR.push(String(e)));

  /* El almacenamiento tiene que sobrevivir a las recargas, igual que el de
     verdad: si viviera en la pagina, al navegar se perderia y la recorrida se
     cortaria en la primera. */
  let guardado = { config: Object.assign({}, BASE, { velocidad: 'turbo' }) };
  await pagina.exposeFunction('leerGuardado', () => guardado);
  await pagina.exposeFunction('escribirGuardado', (parche) => {
    guardado = Object.assign({}, guardado, parche);
    return true;
  });
  await pagina.exposeFunction('anotarVisita', (url) => { visitadas.push(url); });

  await pagina.route('**://*.facebook.com/**', (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGINA }));

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
      runtime: { lastError: undefined, getURL: (p) => p,
                 onMessage: { addListener: () => {} },
                 sendMessage: (m, cb) => cb && cb({ ok: true, total: 0, titulos: {} }) }
    };
  });

  pagina.on('framenavigated', (f) => { if (f === pagina.mainFrame()) visitadas.push(f.url()); });

  /* La extension de verdad se inyecta sola en cada pagina. Aca hay que hacer
     lo mismo a mano: si se inyecta una sola vez, al navegar a la segunda
     busqueda no queda nadie para seguir la recorrida. */
  const fuente = GUIONES.map((g) => fs.readFileSync(archivo(g), 'utf8')).join('\n;\n');
  await pagina.addInitScript(fuente);

  await pagina.goto('https://m.facebook.com/marketplace/category/search/?query=audi%20a5');
  // Se pide la recorrida como la pediria el usuario desde el panel.
  await pagina.evaluate(() =>
    window.MPF.diagnostico.recorrer('audi a5\na5 sportback'));

  /* Se espera a que la recorrida se de por terminada, no una cantidad fija de
     segundos: con un tiempo fijo la prueba salia verde 2 de cada 3 veces,
     segun cuanto tardara el barrido. Una prueba asi no sirve para nada. */
  for (let i = 0; i < 120 && guardado.recorrida; i++) {
    await pagina.waitForTimeout(500);
  }

  const consultas = visitadas
    .map((u) => recorrida.consultaDeUrl(u))
    .filter(Boolean);
  prueba('pasa de la primera busqueda a la segunda', () => {
    assert.ok(consultas.indexOf('audi a5') >= 0, JSON.stringify(visitadas));
    assert.ok(consultas.indexOf('a5 sportback') >= 0, JSON.stringify(visitadas));
  });

  prueba('al terminar no queda ninguna recorrida a medias', () =>
    assert.ok(!guardado.recorrida, JSON.stringify(guardado.recorrida)));

  prueba('sin errores de javascript durante la recorrida', () =>
    assert.deepStrictEqual(erroresR, []));

  /* La misma recorrida, pero en escritorio: es de donde salen los enlaces.
     Barriendo solo el celular el catalogo queda lleno de publicaciones que no
     se pueden abrir, que es exactamente lo que estaba pasando. */
  const visitadasEsc = [];
  const pRec = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
  let guardadoEsc = { config: Object.assign({}, BASE, { velocidad: 'turbo' }) };
  await pRec.exposeFunction('leerGuardadoEsc', () => guardadoEsc);
  await pRec.exposeFunction('escribirGuardadoEsc', (parche) => {
    guardadoEsc = Object.assign({}, guardadoEsc, parche);
    return true;
  });
  await pRec.route('**://*.facebook.com/**', (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGINA }));
  await pRec.addInitScript(() => {
    window.chrome = {
      storage: {
        local: {
          get: (claves, cb) => window.leerGuardadoEsc().then((g) => {
            if (typeof claves === 'string') { const o = {}; o[claves] = g[claves]; return cb(o); }
            cb(g);
          }),
          set: (parche, cb) => window.escribirGuardadoEsc(parche).then(() => cb && cb())
        },
        onChanged: { addListener: () => {} }
      },
      runtime: { lastError: undefined, getURL: (p) => p,
                 onMessage: { addListener: () => {} },
                 sendMessage: (m, cb) => cb && cb({ ok: true, total: 0, titulos: {} }) }
    };
  });
  await pRec.addInitScript(GUIONES.map((g) => fs.readFileSync(archivo(g), 'utf8')).join('\n;\n'));
  pRec.on('framenavigated', (f) => {
    if (f === pRec.mainFrame()) visitadasEsc.push(f.url());
  });
  await pRec.goto('https://m.facebook.com/marketplace/category/search/?query=audi%20a5');
  await pRec.waitForTimeout(2500);
  await pRec.evaluate(() =>
    window.MPF.diagnostico.recorrer('audi a5\na5 sportback', true));
  for (let i = 0; i < 120 && guardadoEsc.recorrida; i++) {
    await pRec.waitForTimeout(500);
  }

  prueba('la recorrida en escritorio va a www y no al celular', () => {
    const enWww = visitadasEsc.filter((u) => /^https:\/\/www\.facebook\.com\//.test(u));
    assert.ok(enWww.length >= 2, JSON.stringify(visitadasEsc));
    const consultas = enWww.map((u) => recorrida.consultaDeUrl(u));
    assert.ok(consultas.indexOf('audi a5') >= 0, JSON.stringify(visitadasEsc));
    assert.ok(consultas.indexOf('a5 sportback') >= 0, JSON.stringify(visitadasEsc));
  });
  await pRec.close();

  await pagina.close();

  await navegador.close();
  if (fallas) { console.error('\n' + fallas + ' pruebas de la version de celular fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas de la version de celular pasaron\n');
})();
