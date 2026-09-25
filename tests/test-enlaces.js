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
  /* La pagina de la publicacion tiene contenido con pinta de tarjeta, como la
     de verdad: la busqueda tiene que sacar el numero de la direccion y no
     guardar nada de lo que se ve adentro. */
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
  /* El catalogo de verdad, con la MISMA regla para juntar que usa el fondo.
     Antes esta prueba solo anotaba lo que se mandaba y nunca juntaba nada, asi
     que no podia ver lo que pasaba en el celular: el enlace se encontraba, y la
     relectura al volver a la lista lo borraba. */
  const { fusionar } = await import('../extension/src/lib/fusion.mjs');
  const catalogo = new Map();
  await pagina.exposeFunction('leerGuardado', () => guardado);
  await pagina.exposeFunction('escribirGuardado', (parche) => {
    guardado = Object.assign({}, guardado, parche);
    return true;
  });
  await pagina.exposeFunction('anotarCatalogo', (items) => {
    for (const it of items) {
      guardadosEnCatalogo.push(it);
      catalogo.set(it.id, fusionar(catalogo.get(it.id), it));
    }
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
  await pagina.waitForTimeout(1000);

  /* Primero se barre la lista entera, como hace uno antes de buscar enlaces:
     Facebook la va cargando de a pedazos al bajar. */
  const items = await pagina.evaluate(() => window.ITEMS_PRUEBA);
  for (let i = 0; i < 40; i++) {
    const n = await pagina.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return document.querySelectorAll('.celda').length;
    });
    if (n >= items.length) break;
    await pagina.waitForTimeout(300);
  }
  await pagina.waitForTimeout(2500);   // que se lea y se mande al catalogo

  let fallas = 0;
  const prueba = (nombre, fn) => {
    try { fn(); console.log('  ok   ' + nombre); }
    catch (e) { fallas++; console.error('  FALLA ' + nombre + '\n         ' + e.message); }
  };

  console.log('\nBuscar los enlaces entrando a la publicacion');

  const enlaceDe = (titulo) => {
    const it = items.find((x) => x.t === titulo);
    return it ? 'https://www.facebook.com/marketplace/item/' + it.id + '/' : null;
  };
  const idsAntes = new Set(catalogo.keys());
  const objetivos = Array.from(catalogo.values()).filter((x) => x.coincide);
  prueba('se parte de todas las que coinciden, sin enlace', () => {
    assert.strictEqual(objetivos.length, 5,
      JSON.stringify(objetivos.map((x) => x.titulo)));
    assert.ok(objetivos.every((x) => !x.url));
  });

  await pagina.evaluate(() => window.MPF.diagnostico.buscarEnlaces());

  // Se espera a que la cola quede vacia: entra, vuelve, entra, vuelve.
  for (let i = 0; i < 300 && guardado.cazaEnlaces; i++) {
    await pagina.waitForTimeout(500);
  }

  prueba('entro a las publicaciones y volvio', () =>
    assert.ok(/\/marketplace\/search/.test(pagina.url()), pagina.url()));

  /* Se da tiempo a que la lista se relea despues de la ultima vuelta: es esa
     relectura la que borraba el enlace. */
  await pagina.waitForTimeout(4000);

  /* Lo que importa es lo que QUEDA en el catalogo, no lo que se mando alguna
     vez: se mandaba bien y despues se borraba. Y TODAS: las que quedan mas
     abajo de lo que Facebook carga al volver tambien. */
  const finales = Array.from(catalogo.values());
  prueba('todas las que coinciden QUEDAN con su propio enlace', () => {
    const mal = objetivos.map((o) => catalogo.get(o.id))
      .filter((x) => x.url !== enlaceDe(x.titulo))
      .map((x) => x.titulo + ' -> ' + (x.url || 'sin enlace'));
    assert.deepStrictEqual(mal, []);
  });

  /* Tiene que haber llegado alguna relectura SIN enlace de una que si lo
     tiene: si no llega ninguna, esta prueba no estaria probando el caso que
     rompia en el celular. */
  prueba('llego la relectura sin enlace, que es la que lo borraba', () => {
    const relecturas = guardadosEnCatalogo.filter((x) => !x.url &&
      objetivos.some((o) => o.id === x.id && catalogo.get(o.id).url));
    assert.ok(relecturas.length > 0, 'no hubo relectura: la prueba no cubre el caso');
  });

  prueba('no entro a las que no coinciden', () => {
    const otras = finales.filter((x) => !x.coincide && x.url).map((x) => x.titulo);
    assert.deepStrictEqual(otras, []);
  });

  /* La publicacion por dentro tiene foto, precio, titulo y zona, y abajo
     "similares": leerla sumaba publicaciones que ya estaban, con otra zona. */
  prueba('entrar a una publicacion no suma nada al catalogo', () => {
    const nuevas = finales.filter((x) => !idsAntes.has(x.id))
      .map((x) => x.titulo + ' | ' + x.ubicacion);
    assert.deepStrictEqual(nuevas, []);
  });

  prueba('al terminar no queda ninguna busqueda a medias', () =>
    assert.ok(!guardado.cazaEnlaces, JSON.stringify(guardado.cazaEnlaces)));

  prueba('sin errores de javascript', () => assert.deepStrictEqual(errores, []));

  await navegador.close();
  srv.close();
  if (fallas) { console.error('\n' + fallas + ' pruebas de enlaces fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas de enlaces pasaron\n');
})();
