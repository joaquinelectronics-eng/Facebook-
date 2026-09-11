/* Service worker: duenio de la base de datos local.

   El catalogo vive en IndexedDB del origen de la EXTENSION (no del de Facebook)
   para que la pagina del catalogo pueda leer lo mismo que guarda el content
   script. Facebook nunca ve ni toca estos datos, y nada sale de tu maquina. */

const DB_NOMBRE = 'mpf';
const DB_VERSION = 1;
const STORE = 'items';

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

/* Guarda o actualiza. Si el precio cambio respecto de la ultima vez, lo agrega
   al historial: de ahi salen las bajadas de precio, que es cuando conviene
   escribirle al vendedor. */
async function guardarItems(items) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const ahora = Date.now();

  for (const nuevo of items) {
    const previo = await comoPromesa(store.get(nuevo.id)).catch(() => null);
    if (!previo) {
      store.put(Object.assign({}, nuevo, {
        vistoPrimera: ahora,
        vistoUltima: ahora,
        veces: 1,
        historial: nuevo.precioUSD != null
          ? [{ t: ahora, precioUSD: nuevo.precioUSD, precio: nuevo.precio, moneda: nuevo.moneda }]
          : []
      }));
      continue;
    }

    const historial = Array.isArray(previo.historial) ? previo.historial.slice() : [];
    const ultimo = historial[historial.length - 1];
    const cambioPrecio =
      nuevo.precioUSD != null &&
      (!ultimo || Math.abs((ultimo.precioUSD || 0) - nuevo.precioUSD) > 0.5);
    if (cambioPrecio) {
      historial.push({ t: ahora, precioUSD: nuevo.precioUSD, precio: nuevo.precio, moneda: nuevo.moneda });
    }

    store.put(Object.assign({}, previo, nuevo, {
      vistoPrimera: previo.vistoPrimera || ahora,
      vistoUltima: ahora,
      veces: (previo.veces || 1) + 1,
      historial
    }));
  }

  await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
  return comoPromesa((await transaccion('readonly')).count());
}

async function listarTodo() {
  const store = await transaccion('readonly');
  return comoPromesa(store.getAll());
}

async function contar() {
  const store = await transaccion('readonly');
  return comoPromesa(store.count());
}

async function borrarItems(ids) {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  for (const id of ids) tx.objectStore(STORE).delete(id);
  await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
  return contar();
}

async function vaciar() {
  const db = await abrirDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
  return 0;
}

function abrirCatalogo() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/catalog/catalog.html') });
}

chrome.runtime.onMessage.addListener((msg, remitente, responder) => {
  (async () => {
    try {
      switch (msg && msg.tipo) {
        case 'guardar':
          responder({ ok: true, total: await guardarItems(msg.items || []) });
          break;
        case 'stats':
          responder({ ok: true, total: await contar() });
          break;
        case 'listar':
          responder({ ok: true, items: await listarTodo() });
          break;
        case 'borrar':
          responder({ ok: true, total: await borrarItems(msg.ids || []) });
          break;
        case 'vaciar':
          responder({ ok: true, total: await vaciar() });
          break;
        case 'abrirCatalogo':
          abrirCatalogo();
          responder({ ok: true });
          break;
        default:
          responder({ ok: false, error: 'mensaje desconocido' });
      }
    } catch (e) {
      responder({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true;  // respuesta asincronica
});

chrome.action.onClicked.addListener(abrirCatalogo);
