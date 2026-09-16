/* Prueba de integracion real: se levanta Chromium, se carga una replica del DOM
   de Marketplace y se inyectan los MISMOS archivos que usa la extension.
   Verifica que el scraper lee bien las tarjetas y que el filtro esconde
   exactamente las que no corresponden. */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const { servir } = require('./servidor');

const RAIZ = path.join(__dirname, '..');
const archivo = (p) => path.join(RAIZ, 'extension', p);

const CONFIG = {
  consulta: 'audi a5 -permuto',
  pmin: 15000, pmax: 30000, moneda: 'USD',
  cotizacion: 1000, umbralAmbiguo: 500000,
  provincias: ['BA', 'CABA', 'SF', 'ER', 'LP'],
  zonaDesconocida: true,
  ocultar: true, sinPrecio: false, indexar: true
};

// Lo que tiene que quedar visible con esa configuracion.
const ESPERADOS = ['101', '106', '108', '111', '114', '117', '118', '119', '120', '121', '122', '123', '124', '125', '127', '128'];

(async () => {
  const navegador = await chromium.launch({
    // Chromium ya viene instalado en este entorno; en tu PC alcanza con quitar
    // executablePath y dejar que Playwright use el suyo.
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const pagina = await navegador.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));

  /* El fixture se sirve bajo /marketplace/search porque el content script se
     activa segun la ruta, igual que en Facebook. */
  const { srv, base } = await servir(__dirname, { '/marketplace/search': 'fixture-marketplace.html' });
  await pagina.goto(base + '/marketplace/search/?query=audi%20a5');

  // Stub de la API de extensiones: en una pagina normal chrome.* no existe.
  await pagina.evaluate((config) => {
    window.__guardados = [];
    window.chrome = {
      storage: { local: { get: (k, cb) => cb({ config }), set: () => {} } },
      runtime: {
        lastError: undefined,
        getURL: (p) => p,
        onMessage: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          if (msg && msg.tipo === 'guardar') window.__guardados.push(...(msg.items || []));
          if (cb) cb({ ok: true, total: window.__guardados.length });
        }
      }
    };
  }, CONFIG);

  for (const f of ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js', 'src/lib/zonas.js',
                   'src/content/scraper.js', 'src/content/panel.js',
                   'src/content/autoscroll.js', 'src/content/content.js']) {
    await pagina.addScriptTag({ path: archivo(f) });
  }

  // El guardado en el catalogo se agrupa con 1,5 s de retardo para no
  // saturar el service worker, asi que hay que darle tiempo.
  await pagina.waitForTimeout(2600);

  let fallas = 0;
  const prueba = (nombre, fn) => {
    try { fn(); console.log('  ok   ' + nombre); }
    catch (e) { fallas++; console.error('  FALLA ' + nombre + '\n         ' + e.message); }
  };

  console.log('\nLectura del DOM (sin usar una sola clase de Facebook)');

  const leidas = await pagina.evaluate(() => window.MPF.scraper.leerTodas().map((d) => ({
    id: d.id, titulo: d.titulo, precioTexto: d.precioTexto, ubicacion: d.ubicacion,
    km: d.km, anio: d.anio, url: d.url, provincia: d.provincia,
    precioAnteriorTexto: d.precioAnteriorTexto, tituloDudoso: d.tituloDudoso
  })));

  prueba('encuentra las 28 publicaciones', () => assert.strictEqual(leidas.length, 28));
  prueba('extrae el titulo completo', () => {
    const a = leidas.find((x) => x.id === '101');
    assert.strictEqual(a.titulo, 'Audi A5 2.0 TFSI Quattro 2018');
  });
  prueba('separa el precio del titulo', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').precioTexto, 'US$ 23.500');
  });
  prueba('separa la zona del "Usado" que Facebook le pega adelante', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').ubicacion, 'Olivos, BA');
  });
  prueba('separa la zona del kilometraje que le pega adelante', () => {
    assert.strictEqual(leidas.find((x) => x.id === '106').ubicacion, 'Ciudad de Buenos Aires');
  });
  prueba('entiende "128 mil km" como 128.000', () => {
    assert.strictEqual(leidas.find((x) => x.id === '106').km, 128000);
  });
  prueba('la zona larga no le gana al titulo', () => {
    assert.strictEqual(leidas.find((x) => x.id === '105').titulo, 'Audi A5 Sportback 2020');
  });
  prueba('detecta el anio', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').anio, 2018);
  });
  prueba('limpia la url de parametros de rastreo', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').url,
      'https://www.facebook.com/marketplace/item/101/');
  });

  console.log('\nTitulo y zona: Facebook los manda pegados o partidos');
  prueba('separa el titulo de la zona en el alt de la foto', () => {
    const a = leidas.find((x) => x.id === '121');
    assert.strictEqual(a.titulo, '2017 Audi a5 2.0 t fsi quattro');
    assert.strictEqual(a.ubicacion, 'Nordelta, BA');
  });
  prueba('lee el titulo aunque la foto no haya cargado', () => {
    const a = leidas.find((x) => x.id === '120');
    assert.strictEqual(a.titulo, 'Audi A5 Sportback 2.0t');
    assert.strictEqual(a.ubicacion, 'Tigre, BA');
  });
  prueba('nunca toma la zona como si fuera el titulo', () => {
    for (const d of leidas) {
      assert.ok(!/^en\s/i.test(d.titulo), 'titulo mal leido: ' + JSON.stringify(d.titulo));
    }
  });
  prueba('una tarjeta que solo trae la zona NO se toma como titulo', () => {
    const a = leidas.find((x) => x.id === '122');
    assert.strictEqual(a.titulo, '');
    assert.strictEqual(a.tituloDudoso, true);
    assert.strictEqual(a.ubicacion, 'Villa Gobernador Udaondo, BA');
  });
  prueba('lee el titulo entero aunque Facebook resalte una parte', () => {
    const a = leidas.find((x) => x.id === '123');
    assert.strictEqual(a.titulo, 'Audi A5 Coupe 2014 quattro');
    assert.strictEqual(a.tituloDudoso, false);
  });

  prueba('las etiquetas de Facebook no se usan como titulo', () => {
    const a = leidas.find((x) => x.id === '124');
    assert.strictEqual(a.titulo, 'Audi A5 2016 quattro');
    assert.strictEqual(a.tituloDudoso, false);
  });
  prueba('ninguna publicacion queda titulada "Recien publicado"', () => {
    for (const d of leidas) {
      assert.ok(!/^reci[e\u00e9]n publicad/i.test(d.titulo),
        'una etiqueta quedo como titulo: ' + JSON.stringify(d.titulo));
    }
  });

  /* El caso que aparecio en el uso real: la tarjeta llega sin el titulo
     dibujado y solo se puede sacar del aria-label del enlace. */
  prueba('limpia el "publicacion <id>" que Facebook pega al final', () => {
    const a = leidas.find((x) => x.id === '125');
    assert.ok(!/publicaci/i.test(a.titulo), 'quedo el id en el titulo: ' + a.titulo);
  });
  prueba('saca el titulo del aria-label cuando no esta dibujado', () => {
    const a = leidas.find((x) => x.id === '125');
    assert.strictEqual(a.titulo, 'Audi A5 Coupe 2012 2.0tfsi');
    assert.strictEqual(a.tituloDudoso, false);
    assert.strictEqual(a.ubicacion, 'Lan\u00fas Este, BA');
  });
  prueba('ningun titulo se queda con la zona pegada', () => {
    for (const d of leidas) {
      assert.ok(!/\sen\s+[A-Z]\w+,\s*\w+$/.test(d.titulo),
        'zona pegada al titulo: ' + JSON.stringify(d.titulo));
    }
  });

  console.log('\nFiltrado en vivo: "audi a5 -permuto" entre 15.000 y 30.000 USD');

  const visibles = await pagina.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      const caja = window.MPF.scraper.contenedorTarjeta(a);
      if (caja.style.display !== 'none') out.push(a.getAttribute('data-mpf-id'));
    }
    return out;
  });

  /* Facebook manda las tarjetas que todavia no entraron en pantalla sin titulo
     en ninguna parte. No se puede verificar el modelo, pero el precio y la zona
     si, asi que se filtra con eso: es la diferencia entre perder el auto y
     tenerlo a la vista aunque sea sin confirmar. */
  /* La prueba que resume el cambio de enfoque: no importa como este armado el
     titulo por dentro, alcanza con que el modelo figure en el texto. */
  prueba('encuentra el modelo aunque el titulo este partido en tres niveles', () =>
    assert.ok(visibles.includes('128'),
      'se perdio una publicacion por como Facebook arma el titulo por dentro'));

  prueba('sin titulo pero en rango y en zona: se muestra', () =>
    assert.ok(visibles.includes('127'),
      'se perdio una publicacion que cumplia precio y zona'));
  prueba('sin titulo y fuera de rango: se descarta igual', () =>
    assert.ok(!visibles.includes('126'),
      'no se filtro por precio una publicacion sin titulo'));

  prueba('la publicacion sin titulo dibujado entra al filtro como cualquier otra', () =>
    assert.ok(visibles.includes('125'),
      'quedo escondida una publicacion cuyo titulo solo estaba en el aria-label'));

  prueba('deja exactamente las que corresponden', () =>
    assert.deepStrictEqual(visibles.sort(), ESPERADOS.slice().sort()));

  const motivos = await pagina.evaluate(() => {
    const out = {};
    for (const a of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      const caja = window.MPF.scraper.contenedorTarjeta(a);
      const m = caja.getAttribute('data-mpf-motivo');
      if (m) out[a.getAttribute('data-mpf-id')] = m;
    }
    return out;
  });

  const motivosEsperados = {
    '102': 'falta: a5',                  '103': 'falta: a5',
    '104': 'barato fuera de rango',      '105': 'caro fuera de rango',
    '107': 'falta: audi',                '109': 'falta: a5',
    '110': 'excluido: permuto',          '113': 'barato fuera de rango',
    '112': 'sin precio',                 '115': 'fuera de zona: Cordoba',
    '116': 'fuera de zona: Mendoza',   '126': 'barato fuera de rango'
  };
  for (const [id, esperado] of Object.entries(motivosEsperados)) {
    prueba('descarta ' + id + ' por "' + esperado + '"', () =>
      assert.strictEqual(motivos[id], esperado));
  }

  console.log('\nMezcla de monedas');
  prueba('toma "$ 24.500" como dolares', async () => {});
  const monedas = await pagina.evaluate(() => {
    const p = window.MPF.precio;
    return {
      m106: p.parsearPrecio('$ 24.500', { umbralAmbiguo: 500000 }),
      m108: p.parsearPrecio('$ 28.000.000', { umbralAmbiguo: 500000 })
    };
  });
  prueba('"$ 24.500" se lee como USD', () => assert.strictEqual(monedas.m106.moneda, 'USD'));
  prueba('"$ 28.000.000" se lee como ARS', () => assert.strictEqual(monedas.m108.moneda, 'ARS'));
  prueba('el auto en pesos entra igual al rango en dolares', () =>
    assert.ok(visibles.includes('108')));

  console.log('\nCatalogo e interfaz');
  const guardados = await pagina.evaluate(() => window.__guardados.length);
  prueba('manda las publicaciones al catalogo', () => assert.ok(guardados >= 10,
    'guardados=' + guardados));
  const hayPanel = await pagina.evaluate(() =>
    !!document.getElementById('mpf-host')?.shadowRoot?.querySelector('.caja'));
  prueba('el panel se dibuja aislado en shadow DOM', () => assert.ok(hayPanel));

  prueba('sin errores de javascript en la pagina', () =>
    assert.deepStrictEqual(errores, []));

  console.log('\nPrecios abreviados y trucos de vendedor');
  const detalle = await pagina.evaluate(() => {
    // innerText no lee elementos escondidos, asi que para esta inspeccion se
    // muestran todos de nuevo antes de releer el DOM.
    for (const e of document.querySelectorAll('[data-mpf-oculto]')) e.style.display = '';
    const out = {};
    for (const d of window.MPF.scraper.leerTodas()) {
      const r = window.MPF.precio.parsearPrecio(d.precioTexto, { umbralAmbiguo: 500000 });
      out[d.id] = { titulo: d.titulo, precioTexto: d.precioTexto, valor: r.valor,
                    moneda: r.moneda, abreviado: r.abreviado };
    }
    return out;
  });

  prueba('"$ 22" se entiende como 22.000 dolares', () => {
    assert.strictEqual(detalle['111'].valor, 22000);
    assert.strictEqual(detalle['111'].moneda, 'USD');
    assert.ok(detalle['111'].abreviado);
  });
  prueba('"26 palos" se entiende como 26 millones de pesos', () => {
    assert.strictEqual(detalle['114'].valor, 26000000);
    assert.strictEqual(detalle['114'].moneda, 'ARS');
  });
  prueba('"$ 13" se entiende como 13.000 dolares', () =>
    assert.strictEqual(detalle['113'].valor, 13000));
  prueba('"$1" queda sin precio y no se inventa nada', () => {
    assert.strictEqual(detalle['112'].valor, null);
  });
  prueba('el abreviado entra al rango en vez de perderse', () =>
    assert.ok(visibles.includes('111') && visibles.includes('114')));

  console.log('\nZona: Buenos Aires, CABA, Santa Fe, Entre Rios y La Pampa');
  prueba('reconoce la provincia por la abreviatura', () => {
    assert.strictEqual(leidas.find((x) => x.id === '101').provincia, 'BA');
    assert.strictEqual(leidas.find((x) => x.id === '111').provincia, 'ER');
  });
  prueba('reconoce CABA escrita completa', () =>
    assert.strictEqual(leidas.find((x) => x.id === '106').provincia, 'CABA'));
  prueba('reconoce la provincia por la localidad', () =>
    assert.strictEqual(leidas.find((x) => x.id === '109').provincia, 'CABA'));
  prueba('descarta Cordoba y Mendoza', () =>
    assert.ok(!visibles.includes('115') && !visibles.includes('116')));
  prueba('una localidad desconocida NO se descarta', () =>
    assert.ok(visibles.includes('117')));

  console.log('\nBajadas de precio que informa el propio Facebook');
  const conBaja = await pagina.evaluate(() => {
    for (const e of document.querySelectorAll('[data-mpf-oculto]')) e.style.display = '';
    const out = {};
    for (const d of window.MPF.scraper.leerTodas()) {
      if (['118', '119', '101'].includes(d.id)) {
        const p = window.MPF.precio.parsearPrecio(d.precioTexto);
        const a = window.MPF.precio.parsearPrecio(d.precioAnteriorTexto);
        out[d.id] = { actual: p.valor, anterior: a.valor };
      }
    }
    return out;
  });
  prueba('lee el precio actual, no el tachado', () =>
    assert.strictEqual(conBaja['118'].actual, 19000));
  prueba('captura el precio anterior tachado', () =>
    assert.strictEqual(conBaja['118'].anterior, 23000));
  prueba('calcula bien la segunda bajada', () => {
    assert.strictEqual(conBaja['119'].actual, 27000);
    assert.strictEqual(conBaja['119'].anterior, 29500);
  });
  prueba('un aviso sin baja no inventa un precio anterior', () =>
    assert.strictEqual(conBaja['101'].anterior, null));
  prueba('los avisos con baja entran igual al filtro', () =>
    assert.ok(visibles.includes('118') && visibles.includes('119')));

  /* La inspeccion de arriba desescondio tarjetas para poder leerlas; se
     restaura el estado antes de seguir midiendo. */
  await pagina.evaluate(() => window.MPF.diagnostico.aplicarFiltros(true));
  await pagina.waitForTimeout(200);

  console.log('\nMarketplace cambia su URL mientras scrolleas');

  function leerContadores() {
    return pagina.evaluate(() => {
      const sh = document.getElementById('mpf-host').shadowRoot;
      return { vistos: Number(sh.getElementById('mVistos').textContent),
               ok: Number(sh.getElementById('mOk').textContent) };
    });
  }

  const antes = await leerContadores();
  prueba('antes del cambio de URL cuenta todas las tarjetas', () =>
    assert.strictEqual(antes.vistos, 28));
  prueba('antes del cambio de URL coinciden las esperadas', () =>
    assert.strictEqual(antes.ok, ESPERADOS.length));

  // Esto es lo que hace Facebook solo: le agrega el id de ciudad y el locale.
  await pagina.evaluate(() => {
    history.replaceState({}, '', '/marketplace/115456271801133/search/?query=audi%20a5&locale=es_LA');
  });
  await pagina.waitForTimeout(3000);

  const despues = await leerContadores();
  prueba('despues del cambio sigue contando todas', () =>
    assert.strictEqual(despues.vistos, 28));
  prueba('despues del cambio el filtro sigue aplicado', () =>
    assert.strictEqual(despues.ok, ESPERADOS.length));

  const visiblesDespues = await pagina.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      const caja = window.MPF.scraper.contenedorTarjeta(a);
      if (caja.style.display !== 'none') out.push(a.getAttribute('data-mpf-id'));
    }
    return out;
  });
  prueba('ninguna tarjeta queda sin filtrar tras el cambio de URL', () =>
    assert.deepStrictEqual(visiblesDespues.sort(), ESPERADOS.slice().sort()));

  const huerfanas = await pagina.evaluate(() =>
    document.querySelectorAll('a[href*="/marketplace/item/"]:not([data-mpf-id])').length);
  prueba('no quedan tarjetas sin leer', () => assert.strictEqual(huerfanas, 0));

  console.log('\nDesglose de por que se descarto cada tarjeta');
  const desglose = await pagina.evaluate(() => window.MPF.diagnostico.motivos());
  const porMotivo = Object.fromEntries(desglose.map((d) => [d.motivo, d.n]));

  prueba('cuenta los descartes por falta del modelo', () =>
    assert.ok(porMotivo['falta: a5'] >= 3, JSON.stringify(porMotivo)));
  prueba('cuenta los descartes por zona', () =>
    assert.strictEqual((porMotivo['fuera de zona: Cordoba'] || 0) +
                       (porMotivo['fuera de zona: Mendoza'] || 0), 2));
  prueba('cuenta los descartes por precio', () =>
    assert.ok((porMotivo['barato fuera de rango'] || 0) >= 2, JSON.stringify(porMotivo)));
  prueba('todo lo descartado suma lo que no coincide', () => {
    // El motivo "titulo ilegible" figura en el desglose pero NO es un descarte:
    // esas publicaciones se muestran igual, por eso no entran en la suma.
    // Las "sin titulo todavia" figuran en el desglose pero se muestran, asi
    // que no son descartes y no entran en la suma.
    const suma = desglose
      .filter((d) => !/sin titulo todavia/.test(d.motivo))
      .reduce((a, d) => a + d.n, 0);
    assert.strictEqual(suma, 28 - ESPERADOS.length);
  });
  prueba('las no verificadas se cuentan aparte y se pueden ver', () => {
    const av = desglose.find((d) => /sin titulo todavia/.test(d.motivo));
    assert.ok(av && av.n >= 1, JSON.stringify(desglose.map((d) => d.motivo)));
    assert.ok(av.ejemplos.length > 0);
  });
  prueba('guarda ejemplos de titulo para poder mirarlos', () => {
    const faltaA5 = desglose.find((d) => d.motivo === 'falta: a5');
    assert.ok(faltaA5.ejemplos.length > 0);
    assert.ok(faltaA5.ejemplos.every((t) => typeof t === 'string' && t.length > 0));
  });
  prueba('el desglose se ordena por cantidad', () => {
    for (let i = 1; i < desglose.length; i++) {
      assert.ok(desglose[i - 1].n >= desglose[i].n);
    }
  });

  const enPanel = await pagina.evaluate(() => {
    const sh = document.getElementById('mpf-host').shadowRoot;
    sh.getElementById('detMotivos').open = true;
    window.MPF.diagnostico.aplicarFiltros(true);
    return { titulo: sh.getElementById('resMotivos').textContent,
             filas: sh.querySelectorAll('.motivo').length };
  });
  prueba('el panel muestra cuantas se ocultaron', () =>
    assert.match(enPanel.titulo, new RegExp(String(28 - ESPERADOS.length))));
  prueba('el panel lista los motivos', () => assert.ok(enPanel.filas >= 3));

  console.log('\nBuscador de diagnostico');
  const hallado = await pagina.evaluate(() => window.MPF.diagnostico.buscar('sportback'));
  prueba('encuentra publicaciones leidas por parte del titulo', () =>
    assert.ok(hallado.length >= 2, JSON.stringify(hallado)));
  prueba('dice de cada una si se muestra o por que no', () => {
    for (const h of hallado) {
      assert.ok(typeof h.pasa === 'boolean');
      if (!h.pasa) assert.ok(h.motivo.length > 0);
    }
  });
  prueba('tambien busca por zona', async () => {});
  const porZona = await pagina.evaluate(() => window.MPF.diagnostico.buscar('nordelta'));
  prueba('encuentra por zona', () => assert.strictEqual(porZona.length, 1));
  prueba('encuentra tambien las que estan escondidas', async () => {});
  const ocultaHallada = await pagina.evaluate(() => window.MPF.diagnostico.buscar('vento'));
  prueba('encuentra una publicacion oculta y explica el motivo', () => {
    assert.strictEqual(ocultaHallada.length, 1);
    assert.strictEqual(ocultaHallada[0].pasa, false);
    assert.strictEqual(ocultaHallada[0].motivo, 'falta: audi');
  });
  const inexistente = await pagina.evaluate(() => window.MPF.diagnostico.buscar('lamborghini'));
  prueba('no inventa nada si la publicacion nunca llego', () =>
    assert.strictEqual(inexistente.length, 0));

  const enPanelBusq = await pagina.evaluate(async () => {
    const sh = document.getElementById('mpf-host').shadowRoot;
    sh.getElementById('detMotivos').open = true;
    const inp = sh.getElementById('buscarLeidas');
    inp.value = 'lamborghini';
    inp.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 100));
    return sh.getElementById('hallazgos').textContent;
  });
  prueba('el panel avisa cuando Facebook nunca la mando', () =>
    assert.match(enPanelBusq, /no la mando/i));

  console.log('\nBoton de detener');

  function panel(fn) { return pagina.evaluate(fn); }

  const antesDeBarrer = await panel(() => {
    const sh = document.getElementById('mpf-host').shadowRoot;
    return { frenoVisible: sh.getElementById('frenar').classList.contains('visible'),
             textoBoton: sh.getElementById('barrer').textContent };
  });
  prueba('sin barrido no se muestra el freno', () =>
    assert.strictEqual(antesDeBarrer.frenoVisible, false));
  prueba('sin barrido el boton invita a barrer', () =>
    assert.match(antesDeBarrer.textoBoton, /Barrer/));

  await panel(() => document.getElementById('mpf-host').shadowRoot.getElementById('barrer').click());
  await pagina.waitForTimeout(500);

  const barriendo = await panel(() => {
    const sh = document.getElementById('mpf-host').shadowRoot;
    const freno = sh.getElementById('frenar');
    return { frenoVisible: freno.classList.contains('visible'),
             frenoSeVe: getComputedStyle(freno).display !== 'none',
             textoBoton: sh.getElementById('barrer').textContent,
             corriendo: window.MPF.autoscroll.estaCorriendo() };
  });
  prueba('al barrer aparece el freno en la barra de titulo', () =>
    assert.ok(barriendo.frenoVisible && barriendo.frenoSeVe));
  prueba('al barrer el boton principal pasa a Detener', () =>
    assert.match(barriendo.textoBoton, /Detener/));
  prueba('el barrido esta realmente corriendo', () =>
    assert.strictEqual(barriendo.corriendo, true));

  /* El freno tiene que seguir a la vista con el panel plegado: es justo cuando
     uno lo necesita y no quiere ponerse a desplegar nada. */
  const plegado = await panel(() => {
    const sh = document.getElementById('mpf-host').shadowRoot;
    sh.getElementById('plegar').click();
    return getComputedStyle(sh.getElementById('frenar')).display !== 'none';
  });
  prueba('el freno se ve aunque el panel este plegado', () => assert.ok(plegado));

  await panel(() => document.getElementById('mpf-host').shadowRoot.getElementById('frenar').click());
  await pagina.waitForTimeout(600);

  const frenado = await panel(() => {
    const sh = document.getElementById('mpf-host').shadowRoot;
    sh.getElementById('plegar').click();   // se vuelve a desplegar
    return { frenoVisible: sh.getElementById('frenar').classList.contains('visible'),
             corriendo: window.MPF.autoscroll.estaCorriendo(),
             estado: sh.getElementById('estado').textContent };
  });
  prueba('el freno detiene el barrido', () =>
    assert.strictEqual(frenado.corriendo, false));
  prueba('detenido el freno se esconde', () =>
    assert.strictEqual(frenado.frenoVisible, false));
  prueba('dice que lo detuviste vos', () =>
    assert.match(frenado.estado, /detenido por vos/));

  console.log('\nActivacion segun la URL');
  const fuera = await navegador.newPage();
  await fuera.goto(base + '/otra-cosa.html').catch(() => {});
  await fuera.evaluate(() => {
    window.chrome = { storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
      runtime: { lastError: undefined, getURL: (p) => p,
                 onMessage: { addListener: () => {} }, sendMessage: (m, cb) => cb && cb({ ok: true }) } };
  });
  for (const f of ['src/lib/normalize.js', 'src/lib/price.js', 'src/lib/matcher.js', 'src/lib/zonas.js',
                   'src/content/scraper.js', 'src/content/panel.js',
                   'src/content/autoscroll.js', 'src/content/content.js']) {
    await fuera.addScriptTag({ path: archivo(f) }).catch(() => {});
  }
  await fuera.waitForTimeout(600);
  const panelFuera = await fuera.evaluate(() => {
    const h = document.getElementById('mpf-host');
    return !h || h.style.display === 'none';
  });
  prueba('fuera de Marketplace no dibuja el panel', () => assert.ok(panelFuera));
  await fuera.close();

  await navegador.close();
  srv.close();

  if (fallas) { console.error('\n' + fallas + ' pruebas de DOM fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas de DOM pasaron\n');
})();
