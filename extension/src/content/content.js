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

  /* El content script se inyecta en todo facebook.com, no solo en /marketplace.
     Tiene que ser asi: Marketplace se abre navegando por dentro del sitio (sin
     recargar), y Chrome no reinyecta nada en esas navegaciones. Si el script
     solo se activara en /marketplace, entrando desde el inicio de Facebook el
     panel no aparecia nunca. Entonces se inyecta siempre y decide aca si actua. */
  function enMarketplace() {
    return /^\/marketplace(\/|$)/.test(location.pathname);
  }

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
      datos.coincide = veredicto.pasa;
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
        coincide: !!d.coincide,
        km: d.km, anio: d.anio, url: d.url, imagen: d.imagen, busqueda
      });
    }
    clearTimeout(temporizadorIndex);
    temporizadorIndex = setTimeout(vaciarColaDeIndexado, 1500);
  }

  /* Durante una corrida automatica se acumula lo nuevo y lo que bajo de precio,
     para poder mandar un unico resumen al final en vez de avisar de a uno. */
  let acumulado = null;

  function vaciarColaDeIndexado() {
    if (!porIndexar.size) return Promise.resolve(null);
    const lote = Array.from(porIndexar.values());
    porIndexar.clear();
    return new Promise((resolver) => {
      try {
        chrome.runtime.sendMessage({ tipo: 'guardar', items: lote }, (resp) => {
          if (chrome.runtime.lastError) return resolver(null);
          if (resp && acumulado) {
            acumulado.nuevos.push(...(resp.nuevos || []));
            acumulado.bajadas.push(...(resp.bajadas || []));
          }
          if (resp && resp.total != null && ui) ui.marcador(
            Number(document.querySelectorAll(MPF.scraper.SELECTOR_ITEM).length), undefined, resp.total
          );
          resolver(resp);
        });
      } catch (e) { resolver(null); }   // contexto invalidado tras recargar la extension
    });
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

      // Fuera de Marketplace la extension no toca nada de la pagina.
      if (!enMarketplace()) {
        if (ui) ui.mostrar(false);
        return;
      }
      if (!ui) { montarPanel(); return; }   // recien entraste a Marketplace
      ui.mostrar(true);

      const nuevas = leerNuevas();
      /* aplicarFiltros() es lo que completa precio, moneda y provincia sobre
         cada tarjeta, asi que tiene que correr ANTES de encolar para guardar;
         si no, el catalogo se llena de publicaciones sin precio. */
      aplicarFiltros();
      if (nuevas.length) encolarParaIndexar(nuevas);
    });
  }

  /* ---------------------------------------------------------- corrida automatica
     El service worker abre esta pagina en una pestania de fondo y manda un
     mensaje para que se aplique la busqueda guardada y se barra un tramo corto.
     El latido mantiene despierto al service worker mientras dura. */
  async function correrAutomatica(busqueda, limiteTandas) {
    config = Object.assign({}, CONFIG_POR_DEFECTO, busqueda.config || {});
    filtro = MPF.matcher.compilar(config.consulta);
    if (ui) { ui.escribirConfig(config); ui.estado('corrida automatica', true); }

    acumulado = { nuevos: [], bajadas: [], vistos: 0 };
    const latido = setInterval(() => {
      try { chrome.runtime.sendMessage({ tipo: 'latido' }, () => chrome.runtime.lastError); }
      catch (e) {}
    }, 20000);

    try {
      pasada();
      await MPF.autoscroll.iniciar(() => {}, { limiteTandas });
      pasada();
      await vaciarColaDeIndexado();
      acumulado.vistos = MPF.scraper.cantidadEnPantalla();
    } finally {
      clearInterval(latido);
    }

    const resultado = acumulado;
    acumulado = null;
    return resultado;
  }

  /* Datos de la busqueda que se esta viendo, para poder guardarla. */
  function busquedaActual() {
    const texto = (config.consulta || '').trim();
    const precio = config.pmax != null ? ' hasta ' + config.pmax + ' ' + config.moneda : '';
    return {
      url: location.href,
      nombre: (texto || 'busqueda sin texto') + precio,
      config: Object.assign({}, config)
    };
  }

  chrome.runtime.onMessage.addListener((msg, remitente, responder) => {
    if (!msg || msg.tipo !== 'corridaAutomatica') return;
    correrAutomatica(msg.busqueda, msg.limiteTandas)
      .then((resultado) => {
        try { chrome.runtime.sendMessage({ tipo: 'corridaTerminada', resultado }); } catch (e) {}
      })
      .catch(() => {
        try { chrome.runtime.sendMessage({ tipo: 'corridaTerminada', resultado: null }); } catch (e) {}
      });
    responder({ ok: true });
    return true;
  });

  function guardarConfig() {
    try { chrome.storage.local.set({ config }); } catch (e) {}
  }

  /* El panel se crea la primera vez que entras a Marketplace, no antes: no
     tiene sentido dibujarlo mientras mirás el muro. */
  function montarPanel() {
    if (ui) return;
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
      },
      alGuardarBusqueda() {
        try {
          chrome.runtime.sendMessage({ tipo: 'guardarBusqueda', busqueda: busquedaActual() }, (r) => {
            if (chrome.runtime.lastError || !r || !r.ok) return ui.avisoBusqueda('no se pudo guardar');
            ui.avisoBusqueda('guardada (' + r.busquedas.length + ' en total)');
          });
        } catch (e) { ui.avisoBusqueda('no se pudo guardar'); }
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
  }

  function arrancar() {
    new MutationObserver(pasada).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', vaciarColaDeIndexado);
    /* Ademas del observer, se vigila la URL: Marketplace cambia de busqueda sin
       recargar y hay que darse cuenta igual. */
    setInterval(pasada, 2500);
    pasada();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }
})();
