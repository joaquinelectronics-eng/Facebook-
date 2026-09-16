/* Orquestador: une el scraper, el matcher, el panel y el barrido.

   Marketplace es una SPA que muta el DOM constantemente, asi que todo el
   trabajo se hace de forma incremental: cada tarjeta se lee UNA vez y despues
   solo se decide si se muestra o se esconde, que es barato. */
(() => {
  const MPF = window.MPF;
  if (!MPF) return;

  /* Candado de instancia unica. El panel se crea recien al entrar a
     Marketplace, asi que mirar si existe el panel ya no alcanza como candado:
     dos inyecciones antes de ese momento pasarian las dos, y despues habria
     dos barridos scrolleando la misma pagina, uno de ellos invisible. */
  if (window.__mpfActivo || document.getElementById('mpf-host')) return;
  window.__mpfActivo = true;

  const CONFIG_POR_DEFECTO = {
    consulta: '', pmin: null, pmax: null, moneda: 'USD',
    cotizacion: 1000, umbralAmbiguo: 500000,
    provincias: ['BA', 'CABA', 'SF', 'ER', 'LP'],
    zonaDesconocida: true,
    velocidad: 'tranquilo', soloBajadas: false,
    ocultar: true, sinPrecio: false, indexar: true
  };

  let config = Object.assign({}, CONFIG_POR_DEFECTO);
  let filtro = MPF.matcher.compilar('');
  let ui = null;
  const cache = new Map();       // id -> datos de la tarjeta
  const porIndexar = new Map();  // id -> datos pendientes de guardar
  let temporizadorIndex = null;
  let urlPrevia = location.href;

  /* Cada cambio de configuracion sube este numero. Las tarjetas recuerdan con
     que version fueron evaluadas, asi una pasada sobre miles de resultados no
     vuelve a correr el matcher y el parseo de precios por cada una. */
  let versionConfig = 0;
  let versionPintada = -1;
  let contVistos = 0, contOk = 0;
  /* Cuenta por que se descarto cada tarjeta, con ejemplos. Es la unica forma
     de saber si faltan resultados por culpa del filtro o porque Facebook no
     los mando: sin esto hay que adivinar. */
  let motivos = new Map();
  let ultimoCostoMs = 0;

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
    /* Una tarjeta cuyo titulo no se pudo leer no se puede evaluar. Se descarta,
       pero queda contada aparte en el desglose: si ese numero crece, es que hay
       una forma de tarjeta que no estamos entendiendo y hay que arreglarla, no
       taparla mostrando todo. */
    if (datos.tituloDudoso) {
      return { pasa: false, motivo: 'no se pudo leer el titulo' };
    }

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

    /* Facebook ya muestra el precio viejo tachado cuando el vendedor lo baja.
       Es la señal mas valiosa que hay y no cuesta nada leerla. */
    if (datos.precioAnteriorTexto) {
      const ant = MPF.precio.parsearPrecio(datos.precioAnteriorTexto,
                                           { umbralAmbiguo: config.umbralAmbiguo });
      datos.precioAnterior = ant.valor;
      datos.precioAnteriorUSD = MPF.precio.aDolares(ant.valor, ant.moneda || p.moneda, config.cotizacion);
      if (datos.precioAnteriorUSD && datos.precioUSD) {
        datos.bajoPct = Math.round((1 - datos.precioUSD / datos.precioAnteriorUSD) * 100);
      }
    }

    if (config.soloBajadas && !datos.bajoPct) {
      return { pasa: false, motivo: 'no bajo de precio' };
    }

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
    } else if (caja.style.display !== 'none') {
      /* Se mira el display de verdad, no solo nuestra marca: si Facebook
         redibuja la tarjeta y le pierde el estilo, hay que volver a
         esconderla. Fiarse de la marca dejaba pasar tarjetas descartadas. */
      if (!caja.dataset.mpfOculto) {
        caja.dataset.mpfDisplayPrevio = caja.style.display || '';
        caja.dataset.mpfOculto = '1';
      }
      caja.setAttribute('data-mpf-motivo', veredicto.motivo);
      caja.style.display = 'none';
    }
  }

  /* Lee las tarjetas que todavia no fueron procesadas y las agrega al cache. */
  function leerNuevas() {
    const nuevas = [];
    for (const link of document.querySelectorAll(MPF.scraper.SELECTOR_ITEM + ':not([data-mpf-id])')) {
      const datos = MPF.scraper.extraerDeTarjeta(link);
      if (!datos) continue;              // todavia no se dibujo nada
      /* Sin titulo todavia: Facebook dibuja las tarjetas por partes, asi que se
         vuelve a mirar unas cuantas veces antes de darla por ilegible. */
      if (MPF.scraper.convieneReintentar(link, datos)) continue;
      link.setAttribute('data-mpf-id', datos.id);
      cache.set(datos.id, datos);
      nuevas.push(datos);
    }
    return nuevas;
  }

  /* Recorre lo que hay en pantalla y decide que se ve y que no.

     Clave para que el barrido no se frene: una tarjeta ya resuelta con la
     configuracion vigente queda marcada en el DOM y no se vuelve a mirar. Sin
     eso, cada pasada reprocesaba todo lo acumulado y el trabajo total crecia al
     cuadrado: con 4000 avisos, una pasada tardaba mas de un segundo. */
  function aplicarFiltros(completa) {
    const t0 = performance.now();

    // Al cambiar los filtros hay que reevaluar todo y recontar desde cero.
    const desdeCero = completa || versionPintada !== versionConfig;
    if (desdeCero) {
      contVistos = 0;
      contOk = 0;
      motivos = new Map();
      versionPintada = versionConfig;
    }

    const selector = desdeCero
      ? MPF.scraper.SELECTOR_ITEM
      : MPF.scraper.SELECTOR_ITEM + ':not([data-mpf-v="' + versionConfig + '"])';

    for (const link of document.querySelectorAll(selector)) {
      const id = link.getAttribute('data-mpf-id');
      let datos = id ? cache.get(id) : null;

      /* Red de seguridad: si una tarjeta quedo marcada pero sin datos, se
         vuelve a leer en vez de saltearla. Saltearla la dejaba visible sin
         pasar por el filtro, que es justo lo que no queremos. */
      if (!datos) {
        /* Tarjeta marcada pero sin datos. Se relee, aunque implique un
           recalculo de layout: es un caso raro y perderla seria peor. */
        datos = MPF.scraper.extraerDeTarjeta(link);
        if (!datos) continue;
        link.setAttribute('data-mpf-id', datos.id);
        cache.set(datos.id, datos);
      }

      let veredicto = datos._version === versionConfig ? datos._veredicto : null;
      if (!veredicto) {
        veredicto = evaluar(datos);
        datos._version = versionConfig;
        datos._veredicto = veredicto;
        datos.coincide = veredicto.pasa;
      }

      contVistos++;
      if (veredicto.pasa) {
        contOk++;
        if (veredicto.dudosa) {
          let d = motivos.get(veredicto.motivo);
          if (!d) { d = { n: 0, ejemplos: [] }; motivos.set(veredicto.motivo, d); }
          d.n++;
          if (d.ejemplos.length < 3) d.ejemplos.push(datos.ubicacion || '(sin zona)');
        }
      } else {
        let m = motivos.get(veredicto.motivo);
        if (!m) { m = { n: 0, ejemplos: [] }; motivos.set(veredicto.motivo, m); }
        m.n++;
        if (m.ejemplos.length < 3) m.ejemplos.push(datos.titulo);
      }
      aplicarVisibilidad(link, datos, veredicto);
      link.setAttribute('data-mpf-v', versionConfig);
    }

    ultimoCostoMs = performance.now() - t0;
    if (ui) {
      ui.marcador(contVistos, contOk);
      const ileg = motivos.get('no se pudo leer el titulo');
      ui.costo(ultimoCostoMs, contVistos, ileg ? ileg.n : 0);
      ui.motivos(motivos, contVistos - contOk);
    }
    return { vistos: contVistos, ok: contOk, ms: ultimoCostoMs };
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
        precioAnterior: d.precioAnterior ?? null,
        precioAnteriorUSD: d.precioAnteriorUSD ?? null,
        ubicacion: d.ubicacion, provincia: d.provincia ?? null,
        tituloDudoso: !!d.tituloDudoso,
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
          /* Solo se actualiza el total del catalogo. Antes se pisaba tambien
             "en pantalla" con el conteo crudo del DOM, y quedaba al lado de un
             "coinciden" calculado sobre otra cosa: dos numeros que no se podian
             comparar entre si. */
          if (resp && resp.total != null && ui) ui.marcador(null, null, resp.total);
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
  let ultimaPasada = 0;
  const MINIMO_ENTRE_PASADAS = 250;   // ms

  /* Facebook muta el DOM constantemente; sin este freno la pasada corria
     decenas de veces por segundo y le robaba el hilo principal al scroll. */
  function pasada() {
    if (pendiente) return;
    pendiente = true;
    const espera = Math.max(0, MINIMO_ENTRE_PASADAS - (Date.now() - ultimaPasada));
    setTimeout(() => requestAnimationFrame(() => {
      pendiente = false;
      ultimaPasada = Date.now();
      /* Marketplace cambia su propia URL mientras scrolleas (le agrega el id
         de ciudad, el locale, parametros de seguimiento). Antes eso vaciaba el
         cache, y como las tarjetas ya quedaban marcadas como leidas nadie las
         volvia a mirar: quedaban huerfanas, sin filtrar y sin contar. El cache
         esta indexado por id de publicacion y esos datos no cambian porque uno
         navegue, asi que no hay ninguna razon para tirarlo. */
      urlPrevia = location.href;

      // Fuera de Marketplace la extension no toca nada de la pagina.
      if (!enMarketplace()) {
        if (ui) ui.mostrar(false);
        return;
      }
      if (!ui) { montarPanel(); return; }   // recien entraste a Marketplace
      ui.mostrar(true);

      /* PRIMERO se lee todo lo nuevo, sin tocar un solo estilo. Leer el texto
         de una tarjeta obliga al navegador a recalcular el layout, y si entre
         lectura y lectura se cambia un display, ese recalculo se repite por
         cada tarjeta. Leyendo todo de una, el navegador lo hace una sola vez. */
      const nuevas = leerNuevas();

      /* RECIEN AHORA se decide y se toca el estilo. aplicarFiltros() completa
         precio, moneda y provincia, asi que va antes de encolar para guardar:
         si no, el catalogo se llena de publicaciones sin precio. */
      aplicarFiltros();
      if (nuevas.length) encolarParaIndexar(nuevas);
    }), espera);
  }

  /* Expuesto para medir y diagnosticar desde la consola del navegador. */
  /* Busca entre TODAS las tarjetas leidas, esten visibles o escondidas, y dice
     que paso con cada una. Sirve para contestar la unica pregunta que importa
     cuando faltan resultados: la publicacion esta en la pagina y la escondi, o
     Facebook nunca la mando. */
  function buscarEnLeidas(texto) {
    const t = MPF.normalizar(texto || '');
    if (!t) return [];
    const out = [];
    for (const d of cache.values()) {
      const enTitulo = MPF.normalizar(d.titulo || '').indexOf(t) >= 0;
      const enZona = MPF.normalizar(d.ubicacion || '').indexOf(t) >= 0;
      if (!enTitulo && !enZona) continue;
      out.push({
        titulo: d.titulo, ubicacion: d.ubicacion, precio: d.precioTexto,
        pasa: d._veredicto ? d._veredicto.pasa : null,
        motivo: d._veredicto ? d._veredicto.motivo : 'sin evaluar',
        url: d.url
      });
    }
    return out;
  }

  /* Arma un volcado de las tarjetas que no se pudieron leer: la forma del HTML
     sin las clases ofuscadas, mas lo que la extension entendio de cada una.
     Es lo unico que permite arreglar de verdad una forma de tarjeta nueva en
     vez de seguir adivinando. */
  function estructuraIlegible(cuantas) {
    const partes = [];
    const tope = cuantas || 2;
    for (const link of document.querySelectorAll(MPF.scraper.SELECTOR_ITEM)) {
      const id = link.getAttribute('data-mpf-id');
      const d = id ? cache.get(id) : null;
      if (!d || !d.tituloDudoso) continue;
      const caja = MPF.scraper.contenedorTarjeta(link);
      partes.push(
        '--- tarjeta ' + d.id + ' ---\n' +
        'la extension leyo:\n' +
        '  titulo: ' + JSON.stringify(d.titulo) + '\n' +
        '  zona:   ' + JSON.stringify(d.ubicacion) + '\n' +
        '  precio: ' + JSON.stringify(d.precioTexto) + '\n' +
        'lineas: ' + JSON.stringify(MPF.scraper.lineasDe(caja)) + '\n' +
        'forma del html:\n' + MPF.scraper.estructuraDe(caja, 1));
      if (partes.length >= tope) break;
    }
    if (!partes.length) return 'No hay ninguna tarjeta ilegible en pantalla.';
    return partes.join('\n\n');
  }

  MPF.diagnostico = {
    estructuraIlegible,
    aplicarFiltros,
    pasada,
    buscar: buscarEnLeidas,
    titulos: () => Array.from(cache.values()).map((d) => d.titulo),
    cuantasEnCache: () => cache.size,
    motivos: () => Array.from(motivos.entries())
      .sort((a, b) => b[1].n - a[1].n)
      .map(([motivo, m]) => ({ motivo, n: m.n, ejemplos: m.ejemplos })),
    ultimoCostoMs: () => ultimoCostoMs,
    config: () => config
  };

  /* ---------------------------------------------------------- corrida automatica
     El service worker abre esta pagina en una pestania de fondo y manda un
     mensaje para que se aplique la busqueda guardada y se barra un tramo corto.
     El latido mantiene despierto al service worker mientras dura. */
  async function correrAutomatica(busqueda, limiteTandas) {
    config = Object.assign({}, CONFIG_POR_DEFECTO, busqueda.config || {});
    filtro = MPF.matcher.compilar(config.consulta);
    versionConfig++;
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
        versionConfig++;          // obliga a reevaluar todo con los filtros nuevos
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
        }, { velocidad: config.velocidad });
      },
      alAbrirCatalogo() {
        try { chrome.runtime.sendMessage({ tipo: 'abrirCatalogo' }); } catch (e) {}
      },
      alBuscarEnLeidas(texto) {
        return buscarEnLeidas(texto);
      },
      alCopiarIlegible() {
        return estructuraIlegible(2);
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
        versionConfig++;
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
    // Freno de emergencia: Escape corta el barrido pase lo que pase.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && MPF.autoscroll.estaCorriendo()) {
        MPF.autoscroll.parar();
        if (ui) ui.estado('detenido con Escape', false);
      }
    }, true);

    new MutationObserver(pasada).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', vaciarColaDeIndexado);
    /* Ademas del observer, se vigila la URL: Marketplace cambia de busqueda sin
       recargar y hay que darse cuenta igual. */
    setInterval(pasada, 2500);
    /* Revision completa periodica. Las pasadas normales saltean las tarjetas
       ya resueltas, asi que si algo externo le cambia el estilo a una tarjeta
       nadie la corregiria; esta pasada la vuelve a poner en su lugar. Medida:
       23 ms con 4000 avisos, o sea que cada 5 segundos no molesta a nadie. */
    setInterval(() => { if (enMarketplace() && ui) aplicarFiltros(true); }, 5000);
    pasada();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }
})();
