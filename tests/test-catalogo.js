/* Prueba del catalogo: que pinte las publicaciones guardadas, ordene por las
   mas viejas, marque las bajadas de precio y avise cuando la frecuencia de las
   corridas automaticas es alta. */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const { servir } = require('./servidor');

const AHORA = Date.now(), DIA = 86400000;

const ITEMS = [
  { id:'1', titulo:'Audi A5 2.0 TFSI Quattro 2018', precio:23500, moneda:'USD', precioUSD:23500,
    ubicacion:'Olivos, BA', provincia:'BA', km:85000, anio:2018, veces:7,
    vistoPrimera:AHORA-64*DIA, vistoUltima:AHORA-DIA, url:'https://www.facebook.com/marketplace/item/1/',
    historial:[{t:AHORA-64*DIA,precioUSD:27000},{t:AHORA-DIA,precioUSD:23500}] },
  { id:'2', titulo:'Audi A5 Sportback 2017', precio:21900, moneda:'USD', precioUSD:21900,
    ubicacion:'Parana, ER', provincia:'ER', km:99000, anio:2017, veces:12,
    vistoPrimera:AHORA-120*DIA, vistoUltima:AHORA-4*DIA, url:'https://www.facebook.com/marketplace/item/2/',
    historial:[{t:AHORA-120*DIA,precioUSD:26500},{t:AHORA-4*DIA,precioUSD:21900}] },
  { id:'3', titulo:'Audi A4 2.0 2016', precio:19000, moneda:'USD', precioUSD:19000,
    ubicacion:'Cordoba, CB', provincia:'CB', anio:2016, veces:2,
    vistoPrimera:AHORA-5*DIA, vistoUltima:AHORA, url:'https://www.facebook.com/marketplace/item/3/',
    historial:[] },
  /* Leida en la version de celular: ahi las tarjetas no son enlaces, asi que no
     hay direccion de la publicacion. El titulo ademas viene recortado. */
  { id:'m4', titulo:'Audi Cabriolet 2.0 Tfsi Quattro A\u2026', precio:24000, moneda:'USD', precioUSD:24000,
    ubicacion:'Tigre, BA', provincia:'BA', anio:2016, veces:1,
    vistoPrimera:AHORA-2*DIA, vistoUltima:AHORA, url:'', tituloCortado:true,
    historial:[] },
  // Ni direccion ni titulo: no hay a donde mandarlo.
  { id:'m5', titulo:'', precio:18000, moneda:'USD', precioUSD:18000,
    ubicacion:'Moron, BA', provincia:'BA', veces:1,
    vistoPrimera:AHORA-DIA, vistoUltima:AHORA, url:'', tituloDudoso:true,
    historial:[] }
];

const BUSQUEDAS = [
  { id:'b1', nombre:'audi a5 -permuto hasta 30000 USD', url:'https://www.facebook.com/marketplace/search/?query=audi%20a5',
    config:{ consulta:'audi a5 -permuto', pmin:15000, pmax:30000, moneda:'USD' } }
];

(async () => {
  const { srv, base } = await servir(path.join(__dirname, '..', 'extension'));
  const navegador = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const pagina = await navegador.newPage({ viewport: { width: 1180, height: 900 } });
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));

  /* El stub se comporta como el service worker de verdad: lo que se guarda,
     se devuelve en la siguiente lectura. Asi la prueba cubre el ciclo entero
     cambiar -> guardar -> releer -> repintar. */
  await pagina.addInitScript((datos) => {
    window.__escrito = [];
    let auto = datos.auto;
    let busquedas = datos.busquedas;
    window.chrome = {
      runtime: {
        lastError: undefined,
        sendMessage: (msg, cb) => {
          if (msg.tipo === 'listar') return cb({ ok: true, items: datos.items });
          if (msg.tipo === 'leerAjustes') return cb({
            ok: true, auto, busquedas, estado: datos.estado });
          window.__escrito.push(msg);
          if (msg.tipo === 'guardarAuto') auto = Object.assign({}, auto, msg.auto);
          if (msg.tipo === 'borrarBusqueda') busquedas = busquedas.filter((b) => b.id !== msg.id);
          cb({ ok: true });
        }
      }
    };
  }, { items: ITEMS, busquedas: BUSQUEDAS,
       auto: { activo: true, cadaMinutos: 60, desdeHora: 8, hastaHora: 23, notificar: 'ambos' },
       estado: { ultimaCorrida: AHORA - 3600000, proximaCorrida: AHORA + 1800000,
                 ultimoResumen: { nuevos: 2, bajadas: 1, vistos: 140 } } });

  await pagina.goto(base + '/src/catalog/catalog.html');
  await pagina.waitForTimeout(700);

  let fallas = 0;
  const prueba = (nombre, fn) => {
    try { fn(); console.log('  ok   ' + nombre); }
    catch (e) { fallas++; console.error('  FALLA ' + nombre + '\n         ' + e.message); }
  };

  console.log('\nCatalogo');
  const tarjetas = await pagina.$$eval('.tarjeta .tit', (n) => n.map((x) => x.textContent));
  prueba('pinta las publicaciones guardadas', () => assert.strictEqual(tarjetas.length, 5));
  prueba('ordena de la mas vieja a la mas nueva', () =>
    assert.strictEqual(tarjetas[0], 'Audi A5 Sportback 2017'));

  const bajadas = await pagina.$$eval('.etiqueta.baja', (n) => n.map((x) => x.textContent));
  prueba('marca las dos bajadas de precio', () => assert.strictEqual(bajadas.length, 2));
  prueba('calcula bien el porcentaje que bajo', () => assert.ok(bajadas.includes('bajo 17%')));

  const zonas = await pagina.$$eval('#zona option', (n) => n.map((x) => x.textContent));
  prueba('el selector de zona ofrece solo las zonas guardadas', () =>
    assert.deepStrictEqual(zonas, ['Todas', 'Bs As', 'Entre Rios', 'Cordoba']));

  await pagina.fill('#consulta', 'audi a5');
  await pagina.waitForTimeout(200);
  const conDudosas = await pagina.$$eval('.tarjeta .tit', (n) => n.map((x) => x.textContent));
  prueba('la busqueda estricta filtra el A4', () =>
    assert.ok(!conDudosas.some((t) => /A4/.test(t)), JSON.stringify(conDudosas)));

  /* Las que Facebook mando con el titulo cortado o sin titulo no se pueden
     descartar: no se sabe que decia. Se guardaron justamente para no perderlas,
     asi que el catalogo tampoco las tira. */
  prueba('pero deja las que no se pudieron leer enteras', () => {
    // El titulo cortado no dice "a5": podria decirlo del otro lado del corte.
    assert.ok(conDudosas.some((t) => /Cabriolet/.test(t)), JSON.stringify(conDudosas));
    assert.ok(conDudosas.some((t) => !t), JSON.stringify(conDudosas));
    assert.strictEqual(conDudosas.length, 4);
  });

  await pagina.uncheck('#dudosas');
  await pagina.waitForTimeout(200);
  const sinDudosas = await pagina.$$eval('.tarjeta .tit', (n) => n.map((x) => x.textContent));
  prueba('y se pueden sacar con la casilla', () => {
    assert.strictEqual(sinDudosas.length, 2, JSON.stringify(sinDudosas));
    assert.ok(!sinDudosas.some((t) => /Cabriolet/.test(t)), JSON.stringify(sinDudosas));
  });
  await pagina.check('#dudosas');
  await pagina.waitForTimeout(200);

  /* El boton llevaba al catalogo de vuelta: una direccion vacia apunta a la
     pagina donde uno esta. Pasa con todo lo leido en la version de celular,
     que es casi todo. */
  console.log('\nEl boton de abrir');
  const enlaces = await pagina.evaluate(() => {
    const salida = [];
    for (const t of document.querySelectorAll('#grilla .tarjeta')) {
      const a = t.querySelector('a.abrir');
      salida.push({
        titulo: (t.querySelector('.tit') || {}).textContent || '',
        href: a.getAttribute('href') || '',
        texto: (a.textContent || '').trim()
      });
    }
    return salida;
  });
  const porTitulo = (t) => enlaces.find((x) => x.titulo.indexOf(t) === 0);

  prueba('con direccion, lleva a la publicacion', () => {
    const a = porTitulo('Audi A5 2.0 TFSI');
    assert.strictEqual(a.href, 'https://www.facebook.com/marketplace/item/1/');
    assert.strictEqual(a.texto, 'Abrir en Facebook');
  });

  /* Mandar a buscar el titulo en Marketplace no sirve: Facebook no encuentra la
     publicacion asi. Entre un boton que no lleva a ningun lado y ninguno,
     ninguno: hace perder menos tiempo. */
  prueba('sin direccion, el boton queda apagado en vez de mentir', () => {
    const a = porTitulo('Audi Cabriolet');
    assert.strictEqual(a.texto, 'sin enlace');
    assert.strictEqual(a.href, '');
  });

  prueba('ninguno apunta a la pagina del catalogo', () =>
    assert.deepStrictEqual(
      enlaces.filter((x) => x.href === '' && x.texto !== 'sin enlace'), []));

  console.log('\nCorridas automaticas');
  await pagina.evaluate(() => { document.getElementById('detAuto').open = true; });
  await pagina.waitForTimeout(150);
  const aviso = await pagina.textContent('#autoAviso');
  prueba('avisa que 15 corridas por dia es mucho', () => {
    assert.ok(/15 corridas por d/.test(aviso), aviso);
    assert.ok(/patr/.test(aviso), 'deberia explicar el riesgo');
  });
  const clase = await pagina.getAttribute('#autoAviso', 'class');
  prueba('el aviso de frecuencia alta se destaca', () => assert.strictEqual(clase, 'aviso'));

  const busq = await pagina.$$eval('.busq .nom', (n) => n.map((x) => x.textContent));
  prueba('lista las busquedas guardadas', () =>
    assert.deepStrictEqual(busq, ['audi a5 -permuto hasta 30000 USD']));

  const ayudaVisible = await pagina.evaluate(() =>
    getComputedStyle(document.getElementById('sinBusquedas')).display !== 'none');
  prueba('no muestra la ayuda de "sin busquedas" si hay busquedas', () =>
    assert.strictEqual(ayudaVisible, false));

  const resumen = await pagina.textContent('#autoResumen');
  prueba('muestra el resultado de la ultima corrida', () =>
    assert.ok(/2 nuevos, 1 bajaron/.test(resumen), resumen));

  await pagina.selectOption('#autoCada', '180');
  await pagina.waitForTimeout(200);
  const aviso2 = await pagina.textContent('#autoAviso');
  prueba('bajando a cada 3 horas el aviso se tranquiliza', () => {
    assert.ok(/5 corridas por d/.test(aviso2), aviso2);
    assert.ok(/indistinguible/.test(aviso2), aviso2);
  });
  const guardado = await pagina.evaluate(() => window.__escrito.filter((m) => m.tipo === 'guardarAuto'));
  prueba('el cambio de frecuencia se guarda', () => {
    assert.ok(guardado.length >= 1);
    assert.strictEqual(guardado[guardado.length - 1].auto.cadaMinutos, 180);
  });

  await pagina.click('.busq button');
  await pagina.waitForTimeout(300);
  const quedan = await pagina.$$eval('.busq', (n) => n.length);
  prueba('se puede borrar una busqueda guardada', () => assert.strictEqual(quedan, 0));
  prueba('al quedarse sin busquedas explica como agregar una', async () => {});
  const sinB = await pagina.evaluate(() =>
    getComputedStyle(document.getElementById('sinBusquedas')).display !== 'none');
  prueba('muestra la ayuda cuando no quedan busquedas', () => assert.ok(sinB));

  prueba('sin errores de javascript en la pagina', () => assert.deepStrictEqual(errores, []));

  await navegador.close();
  srv.close();

  if (fallas) { console.error('\n' + fallas + ' pruebas del catalogo fallaron\n'); process.exit(1); }
  console.log('\nTodas las pruebas del catalogo pasaron\n');
})();
