/* Orquestador: une el scraper, el matcher, el panel y el barrido.

   Marketplace es una SPA que muta el DOM constantemente, asi que todo el
   trabajo se hace de forma incremental: cada tarjeta se lee UNA vez y despues
   solo se decide si se muestra o se esconde, que es barato. */
(() => {
  const MPF = window.MPF;
  if (!MPF || document.getElementById('mpf-host')) return;

  const CONFIG_POR_DEFECTO = {
    consulta: '', pmin: null, pmax: null, moneda: 'USD',
    cotizacion: 1000, umbralAmbiguo: 500000,
    provincias: ['BA', 'CABA', 'SF', 'ER', 'LP'],
    zonaDesconocida: true,
    ocultar: true, sinPrecio: false, indexar: true
  };

  let config = Object.assign({}, CONFIG_POR_DEFECTO);
  let filtro = MPF.matcher.compilar('');
  let ui = null;
  const cache = new Map();       // id -> datos de la tarjeta
  const porIndexar = new Map();  // id -> datos pendientes de guardar
  let temporizadorIndex = null;
  let urlPrevia = location.href;

  // --- busqueda actual, para saber en que contexto aparecio cada aviso ---
  function busquedaDeLaUrl() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('query') || decodeURIComponent((u.pathname.match(/\/search\/?\?/) ? '' : '')) || '';
    } catch (e) { return ''; }
  }

  // --- decision de si una tarjeta pasa el filtro ---
  function evaluar(datos) {
    if (!filtro.vacia) {
      const r = filtro.evaluar(datos.titulo);
      if (!r.coincide) return { pasa: false, motivo: r.motivo };
    }

    /* Zona. Si no se pudo determinar la provincia, el aviso NO se descarta por
       defecto: perder una publicacion buena por una localidad desconocida es
       peor que ver una de mas. */
    if (config.provincias && config.provincias.length) {
      if (datos.provincia == null) datos.provincia = MPF.zonas.detectarProvincia(datos.ubicacion);
      if (datos.provincia == null) {
        if (!config.zonaDesconocida) return { pasa: false, motivo: 'zona no reconocida' };
      } else if (config.provincias.indexOf(datos.provincia) < 0) {
        return { pasa: false, motivo: 'fuera de zona: ' + (MPF.zonas.cortoDe(datos.provincia) || datos.provincia) };
      }
    }

    const p = MPF.precio.parsearPrecio(datos.precioTexto,
                                       { umbralAmbiguo: config.umbralAmbiguo });
    datos.precio = p.valor;
    datos.moneda = p.moneda;
    datos.confianzaMoneda = p.confianza;
    datos.precioAbreviado = p.abreviado;
    datos.precioUSD = MPF.precio.aDolares(p.valor, p.moneda, config.cotizacion);

    const hayRango = config.pmin != null || config.pmax != null;
    if (p.valor == null) {
      return hayRango && !config.sinPrecio
        ? { pasa: false, motivo: 'sin precio' }
        : { pasa: true, motivo: '' };
    }
    if (!hayRango) return { pasa: true, motivo: '' };

    // Todo se compara en dolares para que ARS y USD convivan en un mismo rango.
    const enUSD = datos.precioUSD;
    if (enUSD == null) return { pasa: true, motivo: '' };
    const minUSD = config.pmin == null ? null
      : (config.moneda === 'USD' ? config.pmin : config.pmin / config.cotizacion);
    const maxUSD = config.pmax == null ? null
      : (config.moneda === 'USD' ? config.pmax : config.pmax / config.cotizacion);

    if (minUSD != null && enUSD < minUSD) return { pasa: false, motivo: 'barato fuera de rango' };
    if (maxUSD != null && enUSD > maxUSD) return { pasa: false, motivo: 'caro fuera de rango' };
    return { pasa: true, motivo: '' };
  }

  function aplicarVisibilidad(link, datos, veredicto) {
    const caja = MPF.scraper.contenedorTarjeta(link);
    if (!caja || caja === document.body) return;
    if (veredicto.pasa || !config.ocultar) {
      if (caja.dataset.mpfOculto) {
        caja.style.display = caja.dataset.mpfDisplayPrevio || '';
        delete caja.dataset.mpfOculto;
        delete caja.dataset.mpfDisplayPrevio;
      }
      caja.removeAttribute('data-mpf-motivo');
    } else if (!caja.dataset.mpfOculto) {
      caja.dataset.mpfDisplayPrevio = caja.style.display || '';
      caja.dataset.mpfOculto = '1';
      caja.setAttribute('data-mpf-motivo', veredicto.motivo);
      caja.style.display = 'none';
    }
  }

  /* Lee las tarjetas que todavia no fueron procesadas y las agrega al cache. */
  function leerNuevas() {
    const nuevas = [];
    for (const link of document.querySelectorAll(MPF.scraper.SELECTOR_ITEM + ':not([data-mpf-id])')) {
      const datos = MPF.scraper.extraerDeTarjeta
        ? MPF.scraper.extraerDeTarjeta(link)
        : null;
      if (!datos || !datos.titulo) continue;  // todavia no renderizo, se reintenta
      link.setAttribute('data-mpf-id', datos.id);
      cache.set(datos.id, datos);
      nuevas.push(datos);
    }
    return nuevas;
  }

  /* Recorre todo lo que hay en pantalla y decide que se ve y que no. */
  function aplicarFiltros() {
    let vistos = 0, ok = 0;
    for (const link of document.querySelectorAll(MPF.scraper.SELECTOR_ITEM)) {
      const id = link.getAttribute('data-mpf-id');
      const datos = id ? cache.get(id) : null;
      if (!datos) continue;
      vistos++;
      const veredicto = evaluar(datos);
      if (veredicto.pasa) ok++;
      aplicarVisibilidad(link, datos, veredicto);
    }
    if (ui) ui.marcador(vistos, ok);
    return { vistos, ok };
  }

  // --- guardado en el catalogo, en lotes para no saturar el service worker ---
  function encolarParaIndexar(items) {
    if (!config.indexar) return;
    const busqueda = busquedaDeLaUrl();
    for (const d of items) {
      porIndexar.set(d.id, {
        id: d.id, titulo: d.titulo, precioTexto: d.precioTexto,
        precio: d.precio ?? null, moneda: d.moneda ?? null,
        precioUSD: d.precioUSD ?? null, confianzaMoneda: d.confianzaMoneda ?? null,
        precioAbreviado: !!d.precioAbreviado,
        ubicacion: d.ubicacion, provincia: d.provincia ?? null,
        km: d.km, anio: d.anio, url: d.url, imagen: d.imagen, busqueda
      });
    }
    clearTimeout(temporizadorIndex);
    temporizadorIndex = setTimeout(vaciarColaDeIndexado, 1500);
  }

  function vaciarColaDeIndexado() {
    if (!porIndexar.size) return;
    const lote = Array.from(porIndexar.values());
    porIndexar.clear();
    try {
      chrome.runtime.sendMessage({ tipo: 'guardar', items: lote }, (resp) => {
        if (chrome.runtime.lastError) return;  // el worker estaba dormido, no pasa nada
        if (resp && resp.total != null && ui) ui.marcador(
          Number(document.querySelectorAll(MPF.scraper.SELECTOR_ITEM).length), undefined, resp.total
        );
      });
    } catch (e) { /* contexto invalidado tras recargar la extension */ }
  }

  function pedirTotalCatalogo() {
    try {
      chrome.runtime.sendMessage({ tipo: 'stats' }, (resp) => {
        if (chrome.runtime.lastError || !resp || !ui) return;
        const vistos = document.querySelectorAll(MPF.scraper.SELECTOR_ITEM).length;
        ui.marcador(vistos, undefined, resp.total);
      });
    } catch (e) {}
  }

  // --- ciclo principal, disparado por las mutaciones del DOM ---
  let pendiente = false;
  function pasada() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      if (location.href !== urlPrevia) {  // navegaste a otra busqueda
        urlPrevia = location.href;
        cache.clear();
      }
      const nuevas = leerNuevas();
      /* aplicarFiltros() es lo que completa precio, moneda y provincia sobre
         cada tarjeta, asi que tiene que correr ANTES de encolar para guardar;
         si no, el catalogo se llena de publicaciones sin precio. */
      aplicarFiltros();
      if (nuevas.length) encolarParaIndexar(nuevas);
    });
  }

  function guardarConfig() {
    try { chrome.storage.local.set({ config }); } catch (e) {}
  }

  function arrancar() {
    ui = MPF.panel.crear({
      alCambiar(nueva) {
        config = Object.assign({}, config, nueva);
        filtro = MPF.matcher.compilar(config.consulta);
        guardarConfig();
        aplicarFiltros();
      },
      alBarrer() {
        if (MPF.autoscroll.estaCorriendo()) {
          MPF.autoscroll.parar();
          return;
        }
        ui.estado('barriendo', true);
        MPF.autoscroll.iniciar((p) => {
          const corriendo = MPF.autoscroll.estaCorriendo();
          ui.estado(p.estado + ' · tanda ' + p.tanda, corriendo);
          if (!corriendo) { vaciarColaDeIndexado(); pedirTotalCatalogo(); }
        });
      },
      alAbrirCatalogo() {
        try { chrome.runtime.sendMessage({ tipo: 'abrirCatalogo' }); } catch (e) {}
      }
    });

    try {
      chrome.storage.local.get('config', (guardada) => {
        config = Object.assign({}, CONFIG_POR_DEFECTO, (guardada && guardada.config) || {});
        filtro = MPF.matcher.compilar(config.consulta);
        ui.escribirConfig(config);
        pasada();
        pedirTotalCatalogo();
      });
    } catch (e) {
      ui.escribirConfig(config);
      pasada();
    }

    new MutationObserver(pasada).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', vaciarColaDeIndexado);
    setInterval(pasada, 2500);  // red de seguridad por si el observer se pierde algo
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }
})();
