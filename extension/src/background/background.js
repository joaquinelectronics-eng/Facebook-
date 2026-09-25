/* Service worker: base de datos local y corridas automaticas.

   El catalogo vive en IndexedDB del origen de la EXTENSION (no del de Facebook)
   para que la pagina del catalogo pueda leer lo mismo que guarda el content
   script. Facebook nunca ve ni toca estos datos, y nada sale de tu maquina. */

import { AUTO_POR_DEFECTO, calcularProxima } from '../lib/agenda.mjs';
import { fusionar } from '../lib/fusion.mjs';

const DB_NOMBRE = 'mpf';
const DB_VERSION = 1;
const STORE = 'items';

const TIMEOUT_CORRIDA_MS = 8 * 60 * 1000;
const ALARMA_CORRIDA = 'mpf-corrida';
const ALARMA_WATCHDOG = 'mpf-watchdog';

const azar = (min, max) => min + Math.random() * (max - min);
const azar0a1 = () => Math.random();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- base de datos

let dbPromesa = null;

function abrirDB() {
  if (dbPromesa) return dbPromesa;
  dbPromesa = new Promise((resolver, rechazar) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('vistoPrimera', 'vistoPrimera');
        store.createIndex('vistoUltima', 'vistoUltima');
        store.createIndex('precioUSD', 'precioUSD');
        store.createIndex('busqueda', 'busqueda');
      }
    };
    req.onsuccess = () => resolver(req.result);
    req.onerror = () => rechazar(req.error);
  });
  return dbPromesa;
}

function transaccion(modo) {
  return abrirDB().then((db) => db.transaction(STORE, modo).objectStore(STORE));
}

function comoPromesa(req) {
  return new Promise((resolver, rechazar) => {
    req.onsuccess = () => resolver(req.result);
    req.onerror = () => rechazar(req.error);
  });
}

/* Guarda o actualiza, y devuelve que publicaciones son nuevas y cuales bajaron
   de precio. Solo se reportan las que pasaron el filtro del usuario: no tiene
   sentido avisar por un auto que no coincide con lo que busca. */
async function guardarItems(items) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const ahora = Date.now();
  const nuevos = [];
  const bajadas = [];

  for (const nuevo of items) {
    const previo = await comoPromesa(store.get(nuevo.id)).catch(() => null);

    if (!previo) {
      /* Si Facebook mostraba el precio viejo tachado, el historial arranca ya
         con esa bajada: el catalogo la marca desde el primer dia en vez de
         tener que esperar semanas a detectarla por cuenta propia. */
      const historial = [];
      if (nuevo.precioAnteriorUSD != null) {
        historial.push({ t: ahora - 1, precioUSD: nuevo.precioAnteriorUSD,
                         precio: nuevo.precioAnterior, moneda: nuevo.moneda, segunFacebook: true });
      }
      if (nuevo.precioUSD != null) {
        historial.push({ t: ahora, precioUSD: nuevo.precioUSD, precio: nuevo.precio, moneda: nuevo.moneda });
      }
      store.put(Object.assign({}, nuevo, {
        vistoPrimera: ahora, vistoUltima: ahora, veces: 1, historial
      }));
      /* Se avisa como "nuevo", nunca como "bajada": en la primera corrida
         media Marketplace tiene precio tachado y seria una avalancha. */
      if (nuevo.coincide) nuevos.push(nuevo);
      continue;
    }

    const historial = Array.isArray(previo.historial) ? previo.historial.slice() : [];
    const ultimo = historial[historial.length - 1];
    const cambioPrecio =
      nuevo.precioUSD != null &&
      (!ultimo || Math.abs((ultimo.precioUSD || 0) - nuevo.precioUSD) > 0.5);

    if (cambioPrecio) {
      historial.push({ t: ahora, precioUSD: nuevo.precioUSD, precio: nuevo.precio, moneda: nuevo.moneda });
      const bajo = ultimo && nuevo.precioUSD < (ultimo.precioUSD || 0);
      if (bajo && nuevo.coincide) {
        bajadas.push(Object.assign({}, nuevo, { precioAnterior: ultimo.precioUSD }));
      }
    }

    /* Lo nuevo actualiza, pero un dato vacio no borra uno que ya se sabia: ver
       fusion.mjs. Sin esto la busqueda de enlaces encontraba cada enlace y la
       relectura siguiente lo borraba. */
    store.put(Object.assign(fusionar(previo, nuevo), {
      vistoPrimera: previo.vistoPrimera || ahora,
      vistoUltima: ahora,
      veces: (previo.veces || 1) + 1,
      historial
    }));
  }

  await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
  const total = await comoPromesa((await transaccion('readonly')).count());
  return { total, nuevos, bajadas };
}

async function listarTodo() {
  return comoPromesa((await transaccion('readonly')).getAll());
}

/* Solo los titulos, por id. Facebook manda algunas tarjetas sin titulo en
   ninguna parte -ni en el texto, ni en el aria-label, ni en el alt-, asi que
   la unica forma de saber que son es haberlas visto antes con titulo. El
   catalogo guarda eso desde el primer dia. */
async function titulosConocidos() {
  const store = await transaccion('readonly');
  const todos = await comoPromesa(store.getAll());
  const mapa = {};
  for (const it of todos) {
    if (it && it.id && it.titulo) mapa[it.id] = it.titulo;
  }
  return mapa;
}

async function contar() {
  return comoPromesa((await transaccion('readonly')).count());
}

async function vaciar() {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
  return 0;
}

// ------------------------------------------------------- busquedas y programacion

function leerStorage(claves) {
  return new Promise((r) => chrome.storage.local.get(claves, r));
}
function escribirStorage(obj) {
  return new Promise((r) => chrome.storage.local.set(obj, r));
}

async function leerAuto() {
  const { auto } = await leerStorage('auto');
  return Object.assign({}, AUTO_POR_DEFECTO, auto || {});
}

async function leerBusquedas() {
  const { busquedas } = await leerStorage('busquedas');
  return Array.isArray(busquedas) ? busquedas : [];
}

async function programarProxima() {
  const auto = await leerAuto();
  await chrome.alarms.clear(ALARMA_CORRIDA);
  if (!auto.activo) return null;
  const cuando = calcularProxima(auto, Date.now(), azar0a1);
  chrome.alarms.create(ALARMA_CORRIDA, { when: cuando });
  await escribirStorage({ proximaCorrida: cuando });
  return cuando;
}

// ------------------------------------------------------------------- la corrida

let corridaEnCurso = false;
const esperandoTab = new Map();   // tabId -> { resolver, temporizador }

function esperarCargaDeTab(tabId, msMax) {
  return new Promise((resolver) => {
    let listo = false;
    const terminar = (ok) => {
      if (listo) return;
      listo = true;
      chrome.tabs.onUpdated.removeListener(alCambiar);
      resolver(ok);
    };
    function alCambiar(id, info) {
      if (id === tabId && info.status === 'complete') terminar(true);
    }
    chrome.tabs.onUpdated.addListener(alCambiar);
    setTimeout(() => terminar(false), msMax);
    // Puede que ya haya cargado antes de suscribirnos.
    chrome.tabs.get(tabId, (t) => {
      if (!chrome.runtime.lastError && t && t.status === 'complete') terminar(true);
    });
  });
}

function esperarFinDeCorrida(tabId) {
  return new Promise((resolver) => {
    const temporizador = setTimeout(() => {
      esperandoTab.delete(tabId);
      resolver({ ok: false, motivo: 'se acabo el tiempo' });
    }, TIMEOUT_CORRIDA_MS);
    esperandoTab.set(tabId, { resolver, temporizador });
  });
}

async function cerrarTab(tabId) {
  try { await chrome.tabs.remove(tabId); } catch (e) { /* ya estaba cerrada */ }
}

async function correrUnaBusqueda(busqueda, auto, resumen) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: busqueda.url, active: false });
  } catch (e) {
    return { ok: false, motivo: 'no se pudo abrir la pestania' };
  }

  try {
    const cargo = await esperarCargaDeTab(tab.id, 60000);
    if (!cargo) return { ok: false, motivo: 'la pagina no termino de cargar' };

    // Un respiro para que Facebook termine de dibujar los resultados.
    await dormir(azar(3500, 6000));

    const orden = esperarFinDeCorrida(tab.id);

    let enviado = false;
    for (let intento = 0; intento < 3 && !enviado; intento++) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          tipo: 'corridaAutomatica',
          busqueda,
          limiteTandas: auto.limiteTandas
        });
        enviado = true;
      } catch (e) {
        await dormir(1500);   // el content script todavia no estaba listo
      }
    }
    if (!enviado) {
      const pendiente = esperandoTab.get(tab.id);
      if (pendiente) { clearTimeout(pendiente.temporizador); esperandoTab.delete(tab.id); }
      return { ok: false, motivo: 'la pagina no respondio' };
    }

    const r = await orden;
    if (r && r.resultado) {
      resumen.nuevos.push(...(r.resultado.nuevos || []));
      resumen.bajadas.push(...(r.resultado.bajadas || []));
      resumen.vistos += r.resultado.vistos || 0;
    }
    return r;
  } finally {
    await cerrarTab(tab.id);
  }
}

async function correrTodas(manual) {
  if (corridaEnCurso) return { ok: false, motivo: 'ya hay una corrida en marcha' };
  const auto = await leerAuto();
  const busquedas = await leerBusquedas();
  if (!busquedas.length) {
    await programarProxima();
    return { ok: false, motivo: 'no hay busquedas guardadas' };
  }

  corridaEnCurso = true;
  chrome.alarms.create(ALARMA_WATCHDOG, { delayInMinutes: 15 });
  const resumen = { nuevos: [], bajadas: [], vistos: 0, inicio: Date.now() };

  try {
    for (const b of busquedas) {
      await correrUnaBusqueda(b, auto, resumen);
      // Pausa corta entre busquedas: ni el service worker ni Facebook tienen
      // que ver una rafaga de pestanias.
      await dormir(azar(8000, 16000));
    }
  } finally {
    corridaEnCurso = false;
    chrome.alarms.clear(ALARMA_WATCHDOG);
    await escribirStorage({
      ultimaCorrida: Date.now(),
      ultimoResumen: {
        nuevos: resumen.nuevos.length,
        bajadas: resumen.bajadas.length,
        vistos: resumen.vistos,
        manual: !!manual
      }
    });
    if (!manual) await programarProxima();
  }

  await avisar(resumen, auto);
  return { ok: true, resumen };
}

// --------------------------------------------------------------- notificaciones

function textoPrecio(valor, moneda) {
  if (valor == null) return 'sin precio';
  const n = Math.round(valor).toLocaleString('es-AR');
  return moneda === 'USD' ? 'US$ ' + n : '$ ' + n;
}

/* Una sola notificacion por corrida, con el resumen. Diez avisos seguidos se
   ignoran; uno solo con lo importante, se lee. */
async function avisar(resumen, auto) {
  if (auto.notificar === 'nada') return;

  const bajadas = resumen.bajadas;
  const nuevos = auto.notificar === 'bajadas' ? [] : resumen.nuevos;
  if (!bajadas.length && !nuevos.length) return;

  const partes = [];
  if (bajadas.length) partes.push(bajadas.length + (bajadas.length === 1 ? ' bajo de precio' : ' bajaron de precio'));
  if (nuevos.length) partes.push(nuevos.length + (nuevos.length === 1 ? ' nuevo' : ' nuevos'));

  const detalle = bajadas.concat(nuevos).slice(0, 5).map((it) => {
    const antes = it.precioAnterior != null
      ? textoPrecio(it.precioAnterior, 'USD') + ' -> ' : '';
    return { title: (it.titulo || '').slice(0, 60),
             message: antes + textoPrecio(it.precio, it.moneda) };
  });

  const opciones = {
    type: detalle.length > 1 ? 'list' : 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: partes.join(' y '),
    message: detalle.length === 1 ? detalle[0].title + ' - ' + detalle[0].message : 'Tocá para ver el catálogo',
    items: detalle,
    priority: bajadas.length ? 2 : 0
  };
  if (opciones.type === 'basic') delete opciones.items;

  try {
    chrome.notifications.create('mpf-' + Date.now(), opciones);
  } catch (e) { /* el usuario puede tener las notificaciones bloqueadas */ }
}

function abrirCatalogo() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/catalog/catalog.html') });
}

chrome.notifications.onClicked.addListener((id) => {
  if (String(id).startsWith('mpf-')) { abrirCatalogo(); chrome.notifications.clear(id); }
});

// ------------------------------------------------------------------- mensajeria

chrome.runtime.onMessage.addListener((msg, remitente, responder) => {
  (async () => {
    try {
      switch (msg && msg.tipo) {
        case 'guardar': {
          const r = await guardarItems(msg.items || []);
          responder({ ok: true, total: r.total, nuevos: r.nuevos, bajadas: r.bajadas });
          break;
        }
        case 'titulosConocidos':
          responder({ ok: true, titulos: await titulosConocidos() });
          break;
        case 'stats':
          responder({ ok: true, total: await contar() });
          break;
        case 'listar':
          responder({ ok: true, items: await listarTodo() });
          break;
        case 'vaciar':
          responder({ ok: true, total: await vaciar() });
          break;
        case 'abrirCatalogo':
          abrirCatalogo();
          responder({ ok: true });
          break;

        // --- corridas automaticas ---
        case 'latido':
          responder({ ok: true });   // mantiene despierto al service worker
          break;
        case 'corridaTerminada': {
          const tabId = remitente && remitente.tab ? remitente.tab.id : null;
          const pendiente = tabId != null ? esperandoTab.get(tabId) : null;
          if (pendiente) {
            clearTimeout(pendiente.temporizador);
            esperandoTab.delete(tabId);
            pendiente.resolver({ ok: true, resultado: msg.resultado });
          }
          responder({ ok: true });
          break;
        }
        case 'leerAjustes':
          responder({
            ok: true,
            auto: await leerAuto(),
            busquedas: await leerBusquedas(),
            estado: await leerStorage(['ultimaCorrida', 'proximaCorrida', 'ultimoResumen'])
          });
          break;
        case 'guardarAuto': {
          const auto = Object.assign(await leerAuto(), msg.auto || {});
          await escribirStorage({ auto });
          const cuando = await programarProxima();
          responder({ ok: true, auto, proximaCorrida: cuando });
          break;
        }
        case 'guardarBusqueda': {
          const busquedas = await leerBusquedas();
          const b = msg.busqueda;
          b.id = b.id || 'b' + Date.now();
          const i = busquedas.findIndex((x) => x.url === b.url);
          if (i >= 0) busquedas[i] = Object.assign(busquedas[i], b);
          else busquedas.push(b);
          await escribirStorage({ busquedas });
          await programarProxima();
          responder({ ok: true, busquedas });
          break;
        }
        case 'borrarBusqueda': {
          const busquedas = (await leerBusquedas()).filter((x) => x.id !== msg.id);
          await escribirStorage({ busquedas });
          await programarProxima();
          responder({ ok: true, busquedas });
          break;
        }
        case 'correrAhora':
          correrTodas(true).then((r) => { /* corre en segundo plano */ });
          responder({ ok: true, lanzada: true });
          break;

        default:
          responder({ ok: false, error: 'mensaje desconocido' });
      }
    } catch (e) {
      responder({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true;   // respuesta asincronica
});

chrome.alarms.onAlarm.addListener((alarma) => {
  if (alarma.name === ALARMA_CORRIDA) correrTodas(false);
  if (alarma.name === ALARMA_WATCHDOG) {
    // La corrida quedo colgada (el worker se durmio o la pestania se trabo).
    corridaEnCurso = false;
    for (const [tabId, p] of esperandoTab) {
      clearTimeout(p.temporizador);
      p.resolver({ ok: false, motivo: 'watchdog' });
      cerrarTab(tabId);
    }
    esperandoTab.clear();
    programarProxima();
  }
});

chrome.action.onClicked.addListener(abrirCatalogo);
/* ------------------------------------------------ version de celular

   Los titulos de las publicaciones solo vienen completos en la version de
   celular de Facebook. Hasta ahora habia que pedirla a mano: abrir las
   herramientas del navegador, poner modo telefono y escribir m.facebook.com.
   Eso no lo hace nadie todos los dias.

   Con esta regla, a los pedidos que van a m.facebook.com se les cambia la
   firma del navegador por la de un telefono, asi Facebook manda la version
   buena. Se toca SOLO m.facebook.com: el Facebook de todos los dias, el de
   www, queda exactamente igual que siempre. */
const REGLA_CELULAR = 1;
const FIRMA_TELEFONO =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function aplicarVersionCelular(encendido) {
  if (!chrome.declarativeNetRequest) return;
  const reglas = encendido ? [{
    id: REGLA_CELULAR,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'user-agent', operation: 'set', value: FIRMA_TELEFONO }]
    },
    condition: {
      requestDomains: ['m.facebook.com'],
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'other']
    }
  }] : [];
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [REGLA_CELULAR],
      addRules: reglas
    });
  } catch (e) { /* sin permiso o navegador viejo: se sigue sin esto */ }
}

/* La regla va SIEMPRE, no siga el ajuste del panel.

   Son dos cosas distintas y yo las habia atado:
     - "Abrir Marketplace en la version de celular" es ir solo a m.facebook.com
     - la regla es que m.facebook.com sirva la version de celular cuando uno
       ya esta ahi

   Atadas, al apagar lo primero se apagaba lo segundo y la version de celular
   dejaba de funcionar aunque uno escribiera la direccion a mano. La regla solo
   toca m.facebook.com, un dominio al que no se llega sin querer, asi que
   tenerla puesta no molesta a nadie. */
async function sincronizarVersionCelular() {
  await aplicarVersionCelular(true);
}

/* La regla vive en el navegador, no en la pagina: si cambia el ajuste hay que
   volver a escribirla. */
chrome.storage.onChanged.addListener((cambios, area) => {
  if (area === 'local' && cambios.config) sincronizarVersionCelular();
});

chrome.runtime.onStartup.addListener(() => { programarProxima(); sincronizarVersionCelular(); });
chrome.runtime.onInstalled.addListener(() => { programarProxima(); sincronizarVersionCelular(); });
sincronizarVersionCelular();
