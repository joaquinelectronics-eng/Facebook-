/* De punta a punta: escucha.js en la pagina, content.js guardando en el
   catalogo.

   La pagina se sirve bajo https://www.facebook.com, pero NO sale nada a la
   red: todos los pedidos los contesta esta prueba y cualquier otro se corta.
   Las respuestas son las reales anonimizadas de tests/datos/.

   Lo que se arma es el caso de la pagina real: Facebook escribe las primeras
   publicaciones en un <script type="application/json">, pide las siguientes a
   /api/graphql/ y dibuja solo algunas tarjetas, varias sin titulo. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const CONFIG = {
  consulta: 'audi a4', pmin: null, pmax: null, moneda: 'USD',
  cotizacion: 1000, umbralAmbiguo: 500000,
  provincias: ['BA', 'CABA', 'SF', 'ER', 'LP'], zonaDesconocida: true,
  velocidad: 'turbo', ocultar: false, tocarLaPagina: false,
  sinPrecio: true, indexar: true, versionCelular: false
};
const archivo = (p) => path.join(__dirname, '..', 'extension', p);
/* El mismo orden que el manifest: escucha.js va primero y solo (en la
   extension corre en el mundo de la pagina y al arrancar). */
const ESCUCHA = fs.readFileSync(archivo('src/content/escucha.js'), 'utf8');
const GUIONES = ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js',
                 'src/lib/zonas.js', 'src/lib/recorrida.js', 'src/lib/datos.js',
                 'src/content/scraper.js', 'src/content/panel.js',
                 'src/content/autoscroll.js', 'src/content/content.js'];

const GRAPHQL = fs.readFileSync(path.join(__dirname, 'datos', 'escritorio-graphql.json'), 'utf8');
const PAGINA = fs.readFileSync(path.join(__dirname, 'datos', 'escritorio-pagina.json'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'fixture-datos.html'), 'utf8')
  .replace('<!--DATOS_DE_LA_PAGINA-->',
           '<script type="application/json">' + PAGINA + '</script>');
/* Una pagina que trae publicaciones en los datos pero no es una busqueda: la
   de una publicacion o el inicio de Facebook. */
const SOLO_DATOS = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
  '<script type="application/json">' + PAGINA + '</script><p>otra pagina</p></body></html>';
/* Una respuesta por fetch, con "for (;;);" y dos renglones, armada a mano. */
const OTRA = 'for (;;);' + JSON.stringify({ nada: 1 }) + '\n' + JSON.stringify({
  payload: { cosas: [{ id: '9100000000999991', marketplace_listing_title: 'Audi A4 Avant 2008',
    listing_price: { formatted_amount: '$9.900' },
    location: { reverse_geocode: { city: 'Tigre', state: 'BA' } } }] } });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/* Lo que tiene que quedar: cada numero con SU titulo. Si un enlace llevara a
   otro auto, aca se ve: el titulo guardado no seria el de ese numero. */
const ESPERADAS = {
  '9100000000205894': 'Audi a4',
  '9100000000245488': 'Audi a4 2.0 T 2011',
  '9100000000285084': 'Audi A4 2012',
  '9100000000324680': 'Vendo o permuto Audi a4 1.8tfsi 2009, titular, vtv, automático, 138.000km',
  '9100000000015838': '2010 Audi A4',
  '9100000000055432': 'Vendo permuto Audi a4 2.0t tfsi',
  '9100000000095028': 'Audi A4 Quattro 1.8 Turbo Integral enfierrado',
  '9100000000134624': 'Vendo Audi A4 1.8 tfsi 2009',
  '9100000000174218': 'Audi A4 Quattro',
  '9100000000999991': 'Audi A4 Avant 2008'
};
const DIBUJADAS = ['9100000000205894', '9100000000245488', '9100000000095028', '9100000000134624'];

(async () => {
  const navegador = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });

  /* Nada sale de la PC: se contesta todo desde aca, y lo que no se espera se
     corta y se anota. */
  const inesperados = [];
  await contexto.route('**/*', (ruta) => {
    const u = new URL(ruta.request().url());
    if (u.hostname !== 'www.facebook.com') { inesperados.push(u.href); return ruta.abort(); }
    if (u.pathname === '/api/graphql/') {
      return ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: GRAPHQL });
    }
    if (u.pathname === '/ajax/otra/') {
      return ruta.fulfill({ status: 200, contentType: 'application/x-javascript; charset=utf-8', body: OTRA });
    }
    if (u.pathname === '/foto.png') return ruta.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (u.pathname.startsWith('/marketplace/item/') || u.pathname === '/') {
      return ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SOLO_DATOS });
    }
    if (u.pathname.startsWith('/marketplace/')) {
      return ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
    }
    inesperados.push(u.href);
    return ruta.abort();
  });

  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));

  let guardado = { config: CONFIG };
  const { fusionar } = await import('../extension/src/lib/fusion.mjs');
  const catalogo = new Map();
  await pagina.exposeFunction('leerGuardado', () => guardado);
  await pagina.exposeFunction('escribirGuardado', (parche) => {
    guardado = Object.assign({}, guardado, parche);
    return true;
  });
  await pagina.exposeFunction('anotarCatalogo', (items) => {
    for (const it of items) catalogo.set(it.id, fusionar(catalogo.get(it.id), it));
    return true;
  });

  await pagina.addInitScript(ESCUCHA);
  await pagina.addInitScript(() => {
    window.chrome = {
      storage: {
        local: {
          get: (claves, cb) => window.leerGuardado().then((g) => {
            if (typeof claves === 'string') { const o = {}; o[claves] = g[claves]; return cb(o); }
            cb(g);
          }),
          set: (parche, cb) => window.escribirGuardado(parche).then(() => cb && cb()),
          remove: (clave, cb) => cb && cb()
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

  await pagina.goto('https://www.facebook.com/marketplace/search/?query=audi%20a4');
  await pagina.waitForTimeout(4500);   // la tanda de graphql, el fetch y el guardado en lotes

  let fallas = 0;
  const prueba = (nombre, fn) => {
    try { fn(); console.log('  ok   ' + nombre); }
    catch (e) { fallas++; console.error('  FALLA ' + nombre + '\n         ' + e.message); }
  };

  console.log('\nLo que manda Facebook, de la pagina al catalogo');

  prueba('quedan TODAS en el catalogo: las dibujadas y las que no', () =>
    assert.deepStrictEqual(Array.from(catalogo.keys()).sort(), Object.keys(ESPERADAS).sort()));

  prueba('cada una con el enlace de SU numero y SU titulo: el enlace abre ese auto', () => {
    const mal = [];
    for (const [id, titulo] of Object.entries(ESPERADAS)) {
      const it = catalogo.get(id);
      if (!it) { mal.push(id + ' no esta'); continue; }
      if (it.url !== 'https://www.facebook.com/marketplace/item/' + id + '/') mal.push(id + ' -> ' + it.url);
      if (it.titulo !== titulo) mal.push(id + ': "' + it.titulo + '" en vez de "' + titulo + '"');
    }
    assert.deepStrictEqual(mal, []);
  });

  prueba('ninguna sin enlace y ninguna con numero inventado', () => {
    const malas = Array.from(catalogo.values()).filter((x) => !x.url || /^m/.test(x.id));
    assert.deepStrictEqual(malas.map((x) => x.id + ' ' + x.titulo), []);
  });

  prueba('la tarjeta dibujada SIN titulo queda con el titulo de los datos', () => {
    assert.strictEqual(catalogo.get('9100000000205894').titulo, 'Audi a4');
    assert.strictEqual(catalogo.get('9100000000205894').tituloDudoso, false);
  });

  prueba('la tarjeta con el titulo CORTADO queda con el titulo entero', () => {
    const it = catalogo.get('9100000000095028');
    assert.strictEqual(it.titulo, 'Audi A4 Quattro 1.8 Turbo Integral enfierrado');
    assert.strictEqual(it.tituloCortado, false);
  });

  prueba('precio, zona, provincia y la bajada de precio de los datos', () => {
    const it = catalogo.get('9100000000245488');
    assert.strictEqual(it.precioTexto, '$7.500');
    assert.strictEqual(it.ubicacion, 'Ricardo Rojas, BA');
    assert.strictEqual(it.provincia, 'BA');
    assert.ok(it.precioAnterior > it.precio, JSON.stringify(it));
  });

  prueba('el kilometraje de los datos', () =>
    assert.strictEqual(catalogo.get('9100000000015838').km, 125000));

  prueba('se evaluan contra el filtro del usuario', () =>
    assert.ok(Array.from(catalogo.values()).every((x) => x.coincide === true)));

  const dibujadas = await pagina.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/marketplace/item/"]'))
      .map((a) => a.getAttribute('href').match(/item\/(\d+)/)[1]));
  prueba('en pantalla habia solo cuatro: las demas salieron de los datos', () =>
    assert.deepStrictEqual(dibujadas.sort(), DIBUJADAS.slice().sort()));

  const recibido = await pagina.evaluate(() => window.PAGINA);
  prueba('a la pagina le llegan sus respuestas enteras, igual que sin la extension', () => {
    assert.strictEqual(recibido.xhr, 6);
    assert.strictEqual(recibido.fetch, OTRA.length);
    assert.strictEqual(recibido.foto, PNG.length);
  });

  const botones = await pagina.evaluate(() => {
    const host = document.getElementById('mpf-host');
    const raiz = host && host.shadowRoot;
    return raiz ? Array.from(raiz.querySelectorAll('button')).map((b) => b.textContent.trim()) : null;
  });
  prueba('el panel esta, sin "Buscar los enlaces que faltan"', () => {
    assert.ok(Array.isArray(botones) && botones.length, 'no aparecio el panel');
    assert.ok(!botones.some((b) => /buscar los enlaces/i.test(b)), JSON.stringify(botones));
  });

  /* Adentro de una publicacion Facebook tambien manda datos (la publicacion y
     "similares"), y en el inicio puede mandar alguna suelta. Nada de eso es
     una busqueda: no se guarda. */
  catalogo.clear();
  await pagina.goto('https://www.facebook.com/marketplace/item/9100000000015838/');
  await pagina.waitForTimeout(3500);
  prueba('adentro de una publicacion no se guarda nada de los datos', () =>
    assert.deepStrictEqual(Array.from(catalogo.keys()), []));

  await pagina.goto('https://www.facebook.com/');
  await pagina.waitForTimeout(3000);
  prueba('fuera de Marketplace no se guarda nada de los datos', () =>
    assert.deepStrictEqual(Array.from(catalogo.keys()), []));

  prueba('nada intento salir a la red', () => assert.deepStrictEqual(inesperados, []));
  prueba('sin errores de javascript', () => assert.deepStrictEqual(errores, []));

  await navegador.close();
  if (fallas) { console.error('\n' + fallas + ' pruebas de datos en la pagina fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas de datos en la pagina pasaron\n');
})();
