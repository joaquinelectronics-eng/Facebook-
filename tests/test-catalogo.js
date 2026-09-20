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
    historial:[] },

  /* El mismo auto visto de los dos lados. En el celular viene el titulo pero
     sin direccion; en escritorio viene la direccion pero sin titulo. Se
     emparejan por precio y zona, que los dos lados si traen. */
  { id:'m6', titulo:'Audi A5 Coupe Quattro 2015', precio:26000, moneda:'USD', precioUSD:26000,
    ubicacion:'Pilar, BA', provincia:'BA', veces:1,
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA, url:'', historial:[] },
  { id:'d6', titulo:'', precio:26000, moneda:'USD', precioUSD:26000,
    ubicacion:'Pilar, BA', provincia:'BA', veces:1, tituloDudoso:true,
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA,
    url:'https://www.facebook.com/marketplace/item/999888777/', historial:[] },

  /* El caso que fallaba de verdad: varios A4 al mismo precio en la misma
     provincia. Por precio y zona empatan todos y no se emparejaba ninguno,
     pero el titulo cortado alcanza para decidir, porque es el principio del
     titulo de verdad. */
  { id:'m8', titulo:'VENDO Audi A4 1.8T Nafta Manu\u2026', precio:9000, moneda:'USD', precioUSD:9000,
    ubicacion:'Mar del Plata, BA', provincia:'BA', veces:1, tituloCortado:true,
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA, url:'', historial:[] },
  { id:'d8', titulo:'VENDO Audi A4 1.8T Nafta Manual 2009', precio:9000, moneda:'USD', precioUSD:9000,
    ubicacion:'Mar del Plata, BA', provincia:'BA', veces:1,
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA,
    url:'https://www.facebook.com/marketplace/item/444555/', historial:[] },
  { id:'d8b', titulo:'Audi A4 permuto financio', precio:9000, moneda:'USD', precioUSD:9000,
    ubicacion:'Mar del Plata, BA', provincia:'BA', veces:1,
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA,
    url:'https://www.facebook.com/marketplace/item/666777/', historial:[] },

  /* La foto es la llave mas firme: el nombre del archivo lleva el id adentro y
     es el mismo desde el celular y desde escritorio. Aca ni el precio ni el
     titulo alcanzarian -hay otro al mismo precio y el titulo no se parece-,
     pero la foto no deja lugar a dudas. */
  { id:'m9', titulo:'Oportunidad unica\u2026', precio:9000, moneda:'USD', precioUSD:9000,
    ubicacion:'Tigre, BA', provincia:'BA', veces:1, tituloCortado:true,
    imagen:'https://scontent.xx.fbcdn.net/v/t45.5328-4/492118012_7788990011_n.jpg?oh=aa&oe=bb',
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA, url:'', historial:[] },
  { id:'d9', titulo:'Audi A4 2.0 TDI impecable', precio:9000, moneda:'USD', precioUSD:9000,
    ubicacion:'San Isidro, BA', provincia:'BA', veces:1,
    imagen:'https://scontent.yy.fbcdn.net/v/t45.5328-4/492118012_7788990011_n.jpg?oh=zz&oe=ww&stp=c0',
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA,
    url:'https://www.facebook.com/marketplace/item/121212/', historial:[] },

  /* Un concesionario que usa la misma foto -su cartel- en dos publicaciones.
     Ahi la foto no dice nada y no se empareja. */
  { id:'m10', titulo:'Audi A4 del concesionario\u2026', precio:15000, moneda:'USD', precioUSD:15000,
    ubicacion:'Colon, ER', provincia:'ER', veces:1, tituloCortado:true,
    imagen:'https://scontent.xx.fbcdn.net/v/t45.5328-4/777000111_5566778899_n.jpg',
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA, url:'', historial:[] },
  { id:'d10a', titulo:'Audi A4 usado', precio:15000, moneda:'USD', precioUSD:15000,
    ubicacion:'Colon, ER', provincia:'ER', veces:1,
    imagen:'https://scontent.xx.fbcdn.net/v/t45.5328-4/777000111_5566778899_n.jpg',
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA,
    url:'https://www.facebook.com/marketplace/item/333/', historial:[] },
  { id:'d10b', titulo:'Audi A6 usado', precio:15000, moneda:'USD', precioUSD:15000,
    ubicacion:'Colon, ER', provincia:'ER', veces:1,
    imagen:'https://scontent.xx.fbcdn.net/v/t45.5328-4/777000111_5566778899_n.jpg',
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA,
    url:'https://www.facebook.com/marketplace/item/444/', historial:[] },

  /* Dos publicaciones distintas con el mismo precio y la misma zona: ahi no se
     puede saber cual es cual, asi que no se empareja ninguna. */
  { id:'m7', titulo:'Audi A5 Ambiente 2014', precio:27000, moneda:'USD', precioUSD:27000,
    ubicacion:'Tigre, BA', provincia:'BA', veces:1,
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA, url:'', historial:[] },
  { id:'d7a', titulo:'', precio:27000, moneda:'USD', precioUSD:27000,
    ubicacion:'Tigre, BA', provincia:'BA', veces:1, tituloDudoso:true,
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA,
    url:'https://www.facebook.com/marketplace/item/111/', historial:[] },
  { id:'d7b', titulo:'', precio:27000, moneda:'USD', precioUSD:27000,
    ubicacion:'Tigre, BA', provincia:'BA', veces:1, tituloDudoso:true,
    vistoPrimera:AHORA-3*DIA, vistoUltima:AHORA,
    url:'https://www.facebook.com/marketplace/item/222/', historial:[] }
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
  prueba('pinta las publicaciones guardadas', () => assert.strictEqual(tarjetas.length, 17));
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
  /* Los A4 con el titulo entero se descartan. El que viene cortado no: lo que
     falta podria decir a5, y perder una buena es peor que ver una de mas. */
  prueba('la busqueda estricta filtra los A4 que se leyeron enteros', () => {
    const enteros = conDudosas.filter((t) => /A4/.test(t) && !/\u2026|\.\.\./.test(t));
    assert.deepStrictEqual(enteros, [], JSON.stringify(conDudosas));
  });

  /* Las que Facebook mando con el titulo cortado o sin titulo no se pueden
     descartar: no se sabe que decia. Se guardaron justamente para no perderlas,
     asi que el catalogo tampoco las tira. */
  prueba('pero deja las que no se pudieron leer enteras', () => {
    // El titulo cortado no dice "a5": podria decirlo del otro lado del corte.
    assert.ok(conDudosas.some((t) => /Cabriolet/.test(t)), JSON.stringify(conDudosas));
    assert.ok(conDudosas.some((t) => !t), JSON.stringify(conDudosas));
    assert.strictEqual(conDudosas.length, 11);
  });

  await pagina.uncheck('#dudosas');
  await pagina.waitForTimeout(200);
  const sinDudosas = await pagina.$$eval('.tarjeta .tit', (n) => n.map((x) => x.textContent));
  prueba('y se pueden sacar con la casilla', () => {
    assert.strictEqual(sinDudosas.length, 4, JSON.stringify(sinDudosas));
    assert.ok(!sinDudosas.some((t) => /Cabriolet/.test(t)), JSON.stringify(sinDudosas));
  });
  await pagina.check('#dudosas');
  await pagina.waitForTimeout(200);

  /* El boton llevaba al catalogo de vuelta: una direccion vacia apunta a la
     pagina donde uno esta. Pasa con todo lo leido en la version de celular,
     que es casi todo. */
  console.log('\nEl boton de abrir');
  /* Sin filtro de busqueda: lo que se prueba aca es de donde sale el enlace de
     cada publicacion, no que busqueda la trae. */
  await pagina.fill('#consulta', '');
  await pagina.check('#dudosas');
  await pagina.waitForTimeout(200);
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

  /* En el celular Facebook no manda NINGUNA direccion -medido: 0 en toda la
     pagina-, pero en escritorio las tarjetas si son enlaces. Cada lado tiene la
     mitad, asi que se juntan por precio y zona. */
  prueba('consigue el enlace cruzando con lo leido en escritorio', () => {
    const a = porTitulo('Audi A5 Coupe Quattro');
    assert.ok(a, JSON.stringify(enlaces.map((x) => x.titulo)));
    assert.strictEqual(a.href, 'https://www.facebook.com/marketplace/item/999888777/');
    assert.strictEqual(a.texto, 'Abrir en Facebook');
  });

  prueba('pero no empareja si hay dos candidatas', () => {
    const a = porTitulo('Audi A5 Ambiente');
    assert.ok(a, JSON.stringify(enlaces.map((x) => x.titulo)));
    assert.strictEqual(a.texto, 'sin enlace');
    assert.strictEqual(a.href, '');
  });

  const resumenEnlaces = await pagina.textContent('#resumen');
  prueba('el resumen dice cuantas se pueden abrir y cuantas no', () => {
    assert.ok(/enlace: \d+ propio, \d+ emparejado, \d+ sin enlace/.test(resumenEnlaces),
              resumenEnlaces);
  });

  prueba('el titulo cortado desempata entre varias al mismo precio', () => {
    const a = porTitulo('VENDO Audi A4 1.8T Nafta Manu');
    assert.ok(a, JSON.stringify(enlaces.map((x) => x.titulo)));
    assert.strictEqual(a.href, 'https://www.facebook.com/marketplace/item/444555/');
  });

  /* El mismo auto leido de los dos lados queda en UNA tarjeta, con el enlace de
     escritorio y el mejor de los dos titulos. Antes se veian dos, y la del
     celular -sin enlace- hacia parecer que faltaban enlaces. */
  prueba('junta el mismo auto leido de los dos lados', () => {
    const a = porTitulo('Audi A4 2.0 TDI impecable');
    assert.ok(a, JSON.stringify(enlaces.map((x) => x.titulo)));
    assert.strictEqual(a.href, 'https://www.facebook.com/marketplace/item/121212/');
    assert.ok(!enlaces.some((x) => /Oportunidad unica/.test(x.titulo)),
              'quedo la copia sin enlace: ' + JSON.stringify(enlaces.map((x) => x.titulo)));
  });

  prueba('pero una foto repetida en dos publicaciones no empareja', () => {
    const a = porTitulo('Audi A4 del concesionario');
    assert.ok(a, JSON.stringify(enlaces.map((x) => x.titulo)));
    assert.strictEqual(a.texto, 'sin enlace');
  });

  /* Para poder trabajar hoy con lo que ya sirve, sin esperar a que todo
     empareje: los enlaces solo vienen de escritorio y juntarlos lleva tiempo. */
  await pagina.check('#soloAbribles');
  await pagina.waitForTimeout(200);
  const abribles = await pagina.evaluate(() =>
    Array.from(document.querySelectorAll('#grilla .tarjeta a.abrir'))
      .map((a) => a.getAttribute('href') || ''));
  prueba('se puede ver solo lo que se puede abrir', () => {
    assert.ok(abribles.length > 0, 'no quedo ninguna');
    assert.deepStrictEqual(abribles.filter((h) => !h), []);
  });
  await pagina.uncheck('#soloAbribles');
  await pagina.waitForTimeout(200);

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
