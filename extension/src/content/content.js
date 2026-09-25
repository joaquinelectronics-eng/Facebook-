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
    ocultar: true, sinPrecio: false, indexar: true,
    /* Por defecto encendido: entre ver una de mas y perder una buena, se ve
       una de mas. Se puede apagar desde el panel. */
    rescatarCortados: true,
    /* APAGADO. Se trabaja en escritorio.

       Se prendio porque en escritorio faltaban los titulos. Medido sobre 1990
       publicaciones guardadas: de las 454 que traen enlace, 454 tienen titulo
       y 0 no. O sea que escritorio da las dos cosas, y el celular ninguna de
       las dos por si solo -de ahi no viene ni un enlace-.

       Peor todavia: lo leido en el celular queda sin enlace para siempre.
       Emparejarlo despues tampoco sirve; medido, de 1357 sin enlace solo 130
       tienen una foto que aparezca tambien en alguna con enlace. El resto no
       tiene par en la base y nunca lo va a tener. */
    versionCelular: false,

    /* NO SE TOCA LA PAGINA DE FACEBOOK.

       Esconder las que no coinciden parecia lo mejor -uno ve directo lo que
       busca- pero salio mal de todas las maneras posibles: quedaban huecos
       blancos donde estaba la publicacion escondida, se escondia la celda
       equivocada, y sacar tarjetas del medio de la lista hacia que Facebook
       dejara de mandar mas y el barrido cortara antes de tiempo.

       Todos esos problemas eran el mismo problema: meterle mano al HTML de
       otro. Asi que ahora el barrido solo LEE y GUARDA, sin cambiar un pixel, y
       el filtrado se hace en el catalogo, que es nuestro y podemos armar como
       queramos. Lo que se junta no depende de si el filtro estaba bien puesto
       ese dia: las joyitas viejas quedan guardadas igual. */
    tocarLaPagina: false
  };

  let config = Object.assign({}, CONFIG_POR_DEFECTO);
  let configCargada = false;
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

  /* Titulos que ya vimos alguna vez, por id de publicacion. Facebook manda
     muchas tarjetas sin titulo en ninguna parte; si esa publicacion paso antes
     por el catalogo, de ahi sale. Cuanto mas se usa, mas titulos se conocen. */
  let titulosConocidos = Object.create(null);
  let versionPintada = -1;
  let contVistos = 0, contOk = 0, contEnDuda = 0;
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
  const MINIMO_PARA_ACTIVARSE = 3;

  /* Los titulos solo vienen completos en la version de celular. Antes habia que
     pedirla a mano cada vez -abrir las herramientas del navegador, modo
     telefono, escribir m.facebook.com-, y eso no lo hace nadie todos los dias.
     Aca se va sola al entrar a Marketplace; el resto de Facebook no se toca.

     Se anota el intento: si Facebook devolviera a www igual, no se vuelve a
     intentar enseguida y no queda rebotando de una direccion a la otra. */
  const CLAVE_INTENTO = 'mpfIntentoCelular';
  /* La marca de "esta direccion la pedi yo, no me lleves al celular" viaja en la
     propia direccion y no en el almacenamiento de la sesion. Tiene que ser asi:
     m.facebook.com y www.facebook.com son origenes distintos, asi que lo que se
     guarda en uno el otro no lo ve. Escrito con sessionStorage la marca se
     perdia justo al cambiar de version, que es el unico momento en que sirve. */
  const MARCA_ESCRITORIO = '#mpf=escritorio';
  const CLAVE_MODO_ESCRITORIO = 'mpfModoEscritorio';

  /* Una vez que se llego a escritorio, se queda en escritorio.

     La marca viaja en la direccion para poder cruzar de m.facebook.com a
     www.facebook.com, que son origenes distintos. Pero Facebook reescribe la
     direccion cuando uno toca sus filtros -al aplicar un limite de precio, por
     ejemplo- y se lleva puesta la marca. Sin nada mas, la pasada siguiente veia
     una direccion de www sin marca y te devolvia al celular en el peor momento.

     Asi que al llegar se anota en la sesion. Ahi ya estamos en www, que es un
     solo origen, y la anotacion sobrevive a todo lo que Facebook le haga a la
     direccion. */
  function pidieronEscritorio() {
    const enLaDireccion = location.hash.indexOf('mpf=escritorio') >= 0 ||
                          location.search.indexOf('mpf=escritorio') >= 0;
    if (enLaDireccion) {
      try { sessionStorage.setItem(CLAVE_MODO_ESCRITORIO, '1'); } catch (e) {}
      return true;
    }
    try { return sessionStorage.getItem(CLAVE_MODO_ESCRITORIO) === '1'; }
    catch (e) { return false; }
  }

  function salirDeEscritorio() {
    try { sessionStorage.removeItem(CLAVE_MODO_ESCRITORIO); } catch (e) {}
  }

  function conMarcaDeEscritorio(url) {
    if (!/^https:\/\/(www|web)\.facebook\.com\//i.test(url)) return url;
    return url.indexOf('mpf=escritorio') >= 0 ? url : url + MARCA_ESCRITORIO;
  }

  function irAVersionCelular() {
    /* Recien cuando se leyo lo guardado. Si no, la primera pasada corre con los
       valores de fabrica y te manda a la version de celular aunque la hayas
       apagado: el ajuste llega un instante despues, cuando ya te fuiste. */
    if (!configCargada) return false;
    if (config.versionCelular === false) return false;
    /* Solo dentro de Facebook. Sin esto, cualquier pagina con /marketplace en
       la direccion se iria a facebook, incluidas las pruebas. */
    if (!/(^|\.)facebook\.com$/.test(location.hostname)) return false;
    if (location.hostname === 'm.facebook.com') return false;
    if (!/(^|\/)marketplace(\/|$)/.test(location.pathname)) return false;
    /* Si la recorrida pidio expresamente una direccion de escritorio -porque el
       usuario pego una de www-, no se la lleva al celular. Hace falta para
       juntar los enlaces: en el celular Facebook no manda ninguno, y en
       escritorio las tarjetas si son enlaces. */
    if (pidieronEscritorio()) return false;
    try {
      const ultimo = Number(sessionStorage.getItem(CLAVE_INTENTO) || 0);
      if (Date.now() - ultimo < 20000) return false;
      sessionStorage.setItem(CLAVE_INTENTO, String(Date.now()));
    } catch (e) { /* sin sessionStorage se intenta igual, una sola vez */ }
    location.replace('https://m.facebook.com' + location.pathname + location.search);
    return true;
  }

  function enMarketplace() {
    if (/(^|\/)marketplace(\/|$)/.test(location.pathname)) return true;
    /* La version movil no cambia la direccion al entrar a Marketplace: se queda
       en facebook.com. Ahi hay que darse cuenta por lo que hay en pantalla, y
       sin pedir que la pagina "parezca movil": eso tambien era adivinar.
       Se piden varias publicaciones y no una para no confundir el inicio de
       Facebook, donde puede colarse algun aviso suelto con precio y foto. */
    return MPF.scraper.elementosTarjeta().length >= MINIMO_PARA_ACTIVARSE;
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
    /* Facebook manda las tarjetas que todavia no entraron en pantalla sin el
       titulo: ni en el texto ni en la etiqueta de accesibilidad, que en esos
       casos llega vacia (", $18.000, Lanus Este, BA, publicacion 8692...").
       No hay de donde sacarlo.

       Pero el precio y la zona SI estan, y son datos confiables. Asi que se
       filtra con lo que hay: si el precio y la zona no dan, se descarta igual
       que cualquier otra; si dan, se muestra marcada como sin verificar. Tirar
       la publicacion por lo que no se puede saber seria perder autos buenos;
       mostrarla sin filtrar nada seria llenar la pantalla de basura. */
    /* Se busca en TODO el texto de la tarjeta, no en el titulo aislado.
       Aislar el titulo dentro de la estructura de Facebook nunca fue
       confiable, y cuando fallaba se perdia la publicacion. Para saber si un
       aviso es un Audi A5 alcanza con que el modelo figure en su texto. */
    const textoParaFiltrar = datos.textoBusqueda || datos.titulo;

    /* Si Facebook todavia no dibujo el titulo, en el texto no hay nada que
       buscar: quedan el precio, la zona y el id, nada mas. Esas se filtran por
       precio y zona, que si estan. */
    const sinTitulo = !!datos.tituloDudoso;

    if (!sinTitulo && !filtro.vacia) {
      const r = filtro.evaluar(textoParaFiltrar);
      if (!r.coincide) {
        /* TITULO CORTADO: un "no" que no se puede sostener.

           Facebook manda el titulo recortado -"Audi Q2 1.4 Tfsi At 2..."- y lo
           que falta no esta en ningun lado. Si el modelo quedo del otro lado
           del corte, descartarla es perder una publicacion buena sin enterarse,
           que es justo lo que no queremos. Asi que cuando el filtro falla SOLO
           porque le falta una palabra, y el titulo viene cortado, no se
           descarta: queda en duda, a la vista y apagada.

           Si lo que fallo fue una palabra excluida, ahi si es un no de verdad:
           esa palabra esta, no es cuestion de lo que no se ve. */
        const soloLeFalta = /^falta:/.test(r.motivo || '');
        if (config.rescatarCortados && datos.tituloCortado && soloLeFalta) {
          datos.enDuda = true;
        } else {
          return { pasa: false, motivo: r.motivo };
        }
      }
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

    /* Las que Facebook todavia no dibujo pasan igual por precio y zona, pero
       no se pueden verificar contra el modelo. Quedan "en espera": NO se
       esconden con display:none, porque eso las saca del flujo y entonces
       nunca entran en pantalla; y Facebook dibuja el titulo justamente cuando
       entran. Esconderlas era morderse la cola: se quedaban sin titulo para
       siempre. Se dejan en su lugar, casi transparentes. */
    const aprobada = () => {
      if (sinTitulo && !filtro.vacia) {
        return { pasa: true, enEspera: true,
                 motivo: 'esperando que Facebook dibuje el titulo' };
      }
      if (datos.enDuda) {
        return { pasa: true, enDuda: true,
                 motivo: 'titulo cortado: no se puede confirmar' };
      }
      return { pasa: true, motivo: '' };
    };

    const hayRango = config.pmin != null || config.pmax != null;
    if (p.valor == null) {
      return hayRango && !config.sinPrecio
        ? { pasa: false, motivo: 'sin precio' }
        : aprobada();
    }
    if (!hayRango) return aprobada();

    // Todo se compara en dolares para que ARS y USD convivan en un mismo rango.
    const enUSD = datos.precioUSD;
    if (enUSD == null) return aprobada();
    const minUSD = config.pmin == null ? null
      : (config.moneda === 'USD' ? config.pmin : config.pmin / config.cotizacion);
    const maxUSD = config.pmax == null ? null
      : (config.moneda === 'USD' ? config.pmax : config.pmax / config.cotizacion);

    if (minUSD != null && enUSD < minUSD) return { pasa: false, motivo: 'barato fuera de rango' };
    if (maxUSD != null && enUSD > maxUSD) return { pasa: false, motivo: 'caro fuera de rango' };
    return aprobada();
  }

  function aplicarVisibilidad(link, datos, veredicto) {
    const caja = MPF.scraper.contenedorTarjeta(link);
    if (!caja || caja === document.body) return;

    /* En espera: visible para Facebook, invisible para el usuario. No se usa
       display:none porque eso impide que Facebook la dibuje. */
    if (veredicto.enEspera && config.ocultar) {
      if (caja.dataset.mpfOculto) {
        caja.style.display = caja.dataset.mpfDisplayPrevio || '';
        delete caja.dataset.mpfOculto;
        delete caja.dataset.mpfDisplayPrevio;
      }
      caja.style.opacity = '0.06';
      caja.style.pointerEvents = 'none';
      caja.dataset.mpfEspera = '1';
      caja.setAttribute('data-mpf-motivo', veredicto.motivo);
      return;
    }
    if (caja.dataset.mpfEspera) {
      caja.style.opacity = '';
      caja.style.pointerEvents = '';
      delete caja.dataset.mpfEspera;
    }

    /* En duda por titulo cortado: se ve, pero apagada, para que se note que la
       extension no pudo confirmarla y no se confunda con una que si coincide. */
    if (veredicto.enDuda && config.ocultar) {
      caja.style.opacity = '0.45';
      caja.dataset.mpfDuda = '1';
      caja.setAttribute('data-mpf-motivo', veredicto.motivo);
    } else if (caja.dataset.mpfDuda) {
      caja.style.opacity = '';
      delete caja.dataset.mpfDuda;
    }

    if (veredicto.pasa || !config.ocultar) {
      if (caja.dataset.mpfOculto) {
        caja.style.display = caja.dataset.mpfDisplayPrevio || '';
        delete caja.dataset.mpfOculto;
        delete caja.dataset.mpfDisplayPrevio;
      }
      /* La que quedo en duda se ve, pero conserva el motivo: es lo unico que
         explica por que aparece algo que el filtro no confirmo. */
      if (!veredicto.enDuda) caja.removeAttribute('data-mpf-motivo');
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
    /* Se pregunta por elementosTarjeta y no por un selector porque en la
       pantalla de busqueda movil las tarjetas hay que deducirlas: no hay
       ningun selector que las junte. */
    for (const link of MPF.scraper.elementosTarjeta()) {
      if (link.hasAttribute('data-mpf-id')) continue;
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
  /* Devuelve la pagina como estaba. Hace falta al apagar el filtrado en
     pantalla: si no, lo que quedo escondido de antes se queda escondido para
     siempre y parece que faltan resultados. */
  function restaurarPagina() {
    for (const link of MPF.scraper.elementosTarjeta()) {
      const caja = MPF.scraper.contenedorTarjeta(link);
      if (!caja || caja === document.body) continue;
      if (caja.dataset.mpfOculto) {
        caja.style.display = caja.dataset.mpfDisplayPrevio || '';
        delete caja.dataset.mpfOculto;
        delete caja.dataset.mpfDisplayPrevio;
      }
      if (caja.dataset.mpfEspera || caja.dataset.mpfDuda) {
        caja.style.opacity = '';
        caja.style.pointerEvents = '';
        delete caja.dataset.mpfEspera;
        delete caja.dataset.mpfDuda;
      }
      caja.removeAttribute('data-mpf-motivo');
    }
  }

  let tocabaLaPagina = false;

  function aplicarFiltros(completa) {
    const t0 = performance.now();

    /* Si se acaba de apagar el filtrado en pantalla, primero se deshace todo
       lo pintado. Despues de esto la extension no toca un solo pixel. */
    if (tocabaLaPagina && !config.tocarLaPagina) restaurarPagina();
    tocabaLaPagina = !!config.tocarLaPagina;

    // Al cambiar los filtros hay que reevaluar todo y recontar desde cero.
    const desdeCero = completa || versionPintada !== versionConfig;
    if (desdeCero) {
      contVistos = 0;
      contOk = 0;
      motivos = new Map();
      contEnDuda = 0;
      versionPintada = versionConfig;
    }

    const todas = MPF.scraper.elementosTarjeta();
    const aRevisar = desdeCero
      ? todas
      : todas.filter((e) => e.getAttribute('data-mpf-v') !== String(versionConfig));

    for (const link of aRevisar) {
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

      /* Una tarjeta que quedo sin titulo se vuelve a leer SIEMPRE, no un numero
         fijo de veces. Facebook la dibuja cuando quiere -a veces bastante
         despues de que entro en pantalla-, y con un tope de intentos quedaba
         marcada como ilegible para siempre: el usuario veia el titulo en
         pantalla y la extension seguia con el dato viejo, de cuando la tarjeta
         era un esqueleto. Releerla cuesta centesimas de milisegundo. */
      if (desdeCero && datos.tituloDudoso) {
        const frescos = MPF.scraper.extraerDeTarjeta(link);
        if (frescos) rescatarTitulo(frescos);
        if (frescos && !frescos.tituloDudoso) {
          cache.set(frescos.id, frescos);
          datos = frescos;
          datos._version = -1;          // hay que volver a evaluarla
        }
      }

      let veredicto = datos._version === versionConfig ? datos._veredicto : null;
      if (!veredicto) {
        veredicto = evaluar(datos);
        datos._version = versionConfig;
        datos._veredicto = veredicto;
        datos.coincide = veredicto.pasa;
      }

      contVistos++;
      if (veredicto.enDuda) contEnDuda++;
      if (veredicto.pasa && !veredicto.enEspera) {
        contOk++;
        if (veredicto.parcial) {
          let d = motivos.get(veredicto.motivo);
          if (!d) { d = { n: 0, ejemplos: [] }; motivos.set(veredicto.motivo, d); }
          d.n++;
          if (d.ejemplos.length < 3) {
            d.ejemplos.push((datos.precioTexto || 'sin precio') + ' en ' +
                            (datos.ubicacion || 'sin zona'));
          }
        }
      } else {
        if (veredicto.enEspera) contVistos--;   // todavia no se puede decidir
        let m = motivos.get(veredicto.motivo);
        if (!m) { m = { n: 0, ejemplos: [] }; motivos.set(veredicto.motivo, m); }
        m.n++;
        if (m.ejemplos.length < 3) m.ejemplos.push(datos.titulo);
      }
      if (config.tocarLaPagina) aplicarVisibilidad(link, datos, veredicto);
      link.setAttribute('data-mpf-v', versionConfig);
    }

    ultimoCostoMs = performance.now() - t0;
    if (ui) {
      ui.marcador(contVistos, contOk);
      const sinTit = motivos.get(MOTIVO_ESPERANDO);
      ui.costo(ultimoCostoMs, contVistos, sinTit ? sinTit.n : 0);
      ui.motivos(motivos, contVistos - contOk);
      /* Lo que esta en pantalla y todavia no se pudo leer. Sin este numero no
         hay manera de saber si faltan resultados porque los escondio el filtro
         o porque nunca se llegaron a leer, que es muy distinto. */
      ui.pendientes(sinLeerEnPantalla(), contEnDuda, cuantasConEnlace());
    }
    return { vistos: contVistos, ok: contOk, ms: ultimoCostoMs };
  }

  /* Cuantas de las leidas traen el enlace de la publicacion. Se cuenta sobre lo
     leido y no sumando en cada pasada: sumando, las pasadas que solo miran lo
     nuevo volvian a contar lo de antes y el numero terminaba siendo mas grande
     que la cantidad de publicaciones, que es imposible y no se le puede creer. */
  function cuantasConEnlace() {
    let n = 0;
    for (const d of cache.values()) if (d.url) n++;
    return n;
  }

  const MOTIVO_ESPERANDO = 'esperando que Facebook dibuje el titulo';

  function cuantasEsperando() {
    const m = motivos.get(MOTIVO_ESPERANDO);
    return m ? m.n : 0;
  }

  /* RELEER LAS QUE QUEDARON SIN TITULO.

     Facebook solo dibuja el titulo de las tarjetas que estan cerca de la
     pantalla. Barriendo rapido quedan cientos de esqueletos -foto y precio,
     sin titulo- lejos de la vista, y ahi se quedan: esperar no sirve, porque
     Facebook no va a dibujar algo que nadie esta mirando. Hay que volver a
     pasar por encima de ellas.

     Esto sube de a una pantalla, le da tiempo a que las dibuje, y las relee.
     Corta solo cuando no queda ninguna o cuando se llego arriba de todo. */
  let releyendo = false;

  function pararRelectura() { releyendo = false; }

  async function releerLasQueFaltan() {
    if (releyendo) { pararRelectura(); return; }
    releyendo = true;
    const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
    const cajon = MPF.autoscroll.cajonDeScroll();
    const alto = cajon ? cajon.clientHeight : window.innerHeight;
    const arriba = () => (cajon ? cajon.scrollTop : window.scrollY) <= 0;

    for (let paso = 0; releyendo && paso < 400; paso++) {
      aplicarFiltros(true);
      const faltan = cuantasEsperando();
      decir('releyendo las que faltan: ' + faltan, true);
      if (!faltan || arriba()) break;
      if (cajon) cajon.scrollBy(0, -Math.round(alto * 0.8));
      else window.scrollBy(0, -Math.round(alto * 0.8));
      /* La espera es lo que hace que funcione: hay que darle tiempo a Facebook
         a dibujar lo que acaba de entrar en pantalla antes de volver a leer. */
      await dormir(700);
    }
    aplicarFiltros(true);
    const quedan = cuantasEsperando();
    releyendo = false;
    decir(quedan ? 'quedaron ' + quedan + ' sin titulo' : 'listo: todas con titulo', false);
  }

  /* Tarjetas que estan en pantalla pero de las que todavia no se saco nada:
     Facebook no termino de dibujarlas, o se rindio con ellas. */
  function sinLeerEnPantalla() {
    let n = 0;
    for (const el of MPF.scraper.elementosTarjeta()) {
      if (!el.hasAttribute('data-mpf-id')) n++;
    }
    return n;
  }

  /* ---------------------------------------------- recorrida de busquedas

     Facebook corta cada busqueda: medido en la pagina real, "audi a5" devolvio
     261 publicaciones y ni una mas al llegar al fondo, sin ningun boton de
     "ver mas". Barrer mejor no cambia eso; preguntar distinto si.

     Entonces la extension recorre sola una lista de busquedas: barre una,
     guarda todo, se va a la siguiente. Como el catalogo no se borra, queda con
     la UNION de todas, que es donde estan las viejas enterradas.

     El estado vive en el almacenamiento y no en memoria, porque entre una
     busqueda y la otra la pagina se recarga entera y se pierde todo. */
  const CLAVE_RECORRIDA = 'recorrida';

  /* La recorrida sigue viva entre recargas, y en algunos momentos de la carga
     el panel todavia no existe. Avisar del avance no puede romperla. */
  function decir(texto, activo) {
    if (ui) ui.estado(texto, activo);
  }

  function leerRecorrida(cb) {
    try {
      chrome.storage.local.get(CLAVE_RECORRIDA, (g) => cb((g && g[CLAVE_RECORRIDA]) || null));
    } catch (e) { cb(null); }
  }

  function escribirRecorrida(estado, cb) {
    try {
      chrome.storage.local.set({ [CLAVE_RECORRIDA]: estado }, () => cb && cb());
    } catch (e) { cb && cb(); }
  }

  function pararRecorrida() {
    escribirRecorrida(null);
  }

  function barrerEstaPagina(alTerminar) {
    decir('barriendo', true);
    MPF.autoscroll.iniciar((p) => {
      const corriendo = MPF.autoscroll.estaCorriendo();
      decir(p.estado + ' · tanda ' + p.tanda, corriendo);
      if (!corriendo) {
        vaciarColaDeIndexado();
        pedirTotalCatalogo();
        if (alTerminar) alTerminar(p);
      }
    }, { velocidad: config.velocidad });
  }

  function arrancarRecorrida(lista, escritorio) {
    escribirRecorrida({ lista, indice: 0, escritorio: !!escritorio }, () => {
      const paso = MPF.recorrida.siguiente({ lista, indice: 0, escritorio: !!escritorio });
      decir('busqueda 1 de ' + paso.cuantas + ': ' + paso.consulta, true);
      location.assign(conMarcaDeEscritorio(paso.url));
    });
  }

  /* Al cargar cada pagina se mira si hay una recorrida a medias. Si la
     direccion es la que pedimos, se barre y despues se pasa a la siguiente. */
  function seguirRecorrida() {
    leerRecorrida((estado) => {
      if (!estado || !estado.lista || !estado.lista.length) return;
      const paso = MPF.recorrida.siguiente(estado);
      if (paso.terminada) {
        escribirRecorrida(null);
        decir('recorrida terminada: ' + estado.lista.length + ' busquedas', false);
        return;
      }
      const aca = MPF.recorrida.consultaDeUrl(location.href);
      if (MPF.normalizar(aca) !== MPF.normalizar(paso.consulta)) {
        // Todavia no llegamos a la pagina de esta busqueda.
        location.assign(conMarcaDeEscritorio(paso.url));
        return;
      }
      decir('busqueda ' + (paso.indice + 1) + ' de ' + paso.cuantas +
                ': ' + paso.consulta, true);
      barrerEstaPagina(() => {
        const nuevo = MPF.recorrida.avanzar(estado);
        if (nuevo.terminada) {
          escribirRecorrida(null);
          decir('recorrida terminada: ' + estado.lista.length + ' busquedas', false);
          return;
        }
        escribirRecorrida({ lista: nuevo.lista, indice: nuevo.indice,
                            escritorio: nuevo.escritorio }, () => {
          location.assign(conMarcaDeEscritorio(MPF.recorrida.siguiente(nuevo).url));
        });
      });
    });
  }

  /* ------------------------------------------------- buscar los enlaces que faltan

     En la version de celular las tarjetas no son enlaces y Facebook no escribe
     la direccion de la publicacion en ningun lado -medido: cero en toda la
     pagina-. Pero al TOCAR una tarjeta, la direccion del navegador pasa a ser
     .../marketplace/item/<numero>/. Ahi esta el enlace.

     Entonces se hace eso mismo, solo con las que coinciden con el filtro: se
     entra, se anota el numero, se vuelve atras y se sigue con la siguiente. Se
     hace solo con las que coinciden porque son pocas -las que uno de verdad
     quiere abrir- y asi son tres entradas y no doscientas.

     El estado vive en el almacenamiento: entrar a una publicacion recarga la
     pagina entera y en memoria no sobrevive nada. */
  const CLAVE_CAZA = 'cazaEnlaces';
  const TOPE_CAZA = 40;

  function idDeUrlItem(href) {
    const m = /\/marketplace\/item\/(\d+)/.exec(String(href || ''));
    return m ? m[1] : '';
  }

  /* Como se reconoce una tarjeta despues de volver atras: por lo que se ve en
     ella. El id que armamos nosotros no sirve si el titulo se leyo distinto. */
  function senia(d) {
    return MPF.normalizar((d.titulo || '') + '|' + (d.precioTexto || '') +
                          '|' + (d.ubicacion || ''));
  }

  function leerCaza(cb) {
    try {
      chrome.storage.local.get(CLAVE_CAZA, (g) => cb((g && g[CLAVE_CAZA]) || null));
    } catch (e) { cb(null); }
  }

  function escribirCaza(estado, cb) {
    try {
      chrome.storage.local.set({ [CLAVE_CAZA]: estado }, () => cb && cb());
    } catch (e) { cb && cb(); }
  }

  /* Las que coinciden con el filtro y todavia no tienen enlace. */
  function sinEnlaceQueCoinciden() {
    const out = [];
    for (const d of cache.values()) {
      if (d.url || !d.coincide) continue;
      out.push({ senia: senia(d), titulo: d.titulo, precio: d.precioTexto, id: d.id });
    }
    return out.slice(0, TOPE_CAZA);
  }

  function arrancarCaza() {
    const faltan = sinEnlaceQueCoinciden();
    if (!faltan.length) { decir('no falta ningun enlace de las que coinciden', false); return; }
    /* Se arranca desde arriba: la cola va en el orden en que se leyo la
       lista, asi que de ahi en adelante todo lo que falta queda para abajo. */
    irAPosicion(0);
    escribirCaza({ cola: faltan, hechos: 0 }, () => {
      decir('buscando ' + faltan.length + ' enlaces', true);
      programarCaza(0);
    });
  }

  function pararCaza() { clearTimeout(turnoCaza); tocandoHasta = 0; escribirCaza(null); }

  /* UNA SOLA busqueda a la vez. A seguirCaza la despiertan varias cosas -la
     vuelta atras, el cambio de direccion, la carga de la pagina- y al volver
     de cada publicacion llegaban dos o tres avisos juntos. Cada uno arrancaba
     su propia busqueda, y esas busquedas en paralelo tocaban dos veces la
     misma tarjeta o volvian atras dos veces: se salian de la lista y las que
     quedaban se daban por perdidas. Ahora cada aviso reemplaza al anterior. */
  let turnoCaza = null;
  function programarCaza(ms) {
    clearTimeout(turnoCaza);
    turnoCaza = setTimeout(seguirCaza, ms);
  }

  /* Mientras se esta por tocar una tarjeta no se busca otra. */
  let tocandoHasta = 0;
  /* La publicacion desde la que ya se pidio volver: volver dos veces saca de
     la lista. */
  let volviendoDe = '';
  /* Desde cuando se esta adentro de la publicacion actual, para darle tiempo
     a Facebook a dibujarla antes de decidir si es el auto buscado. */
  let adentroDe = '';
  let adentroDesde = 0;
  /* Cada toque tiene su numero: el vigilante de un toque viejo no decide nada. */
  let toqueActual = 0;

  /* Donde esta parada la lista. Hace falta para volver al mismo lugar despues
     de entrar a una publicacion: Facebook rearma la lista desde arriba. */
  function posicionScroll() {
    const c = MPF.autoscroll.cajonDeScroll();
    return c ? c.scrollTop : window.scrollY;
  }

  function irAPosicion(y) {
    const c = MPF.autoscroll.cajonDeScroll();
    if (c) c.scrollTop = y; else window.scrollTo(0, y);
  }

  function bajarUnaPantalla() {
    const c = MPF.autoscroll.cajonDeScroll();
    const alto = c ? c.clientHeight : window.innerHeight;
    if (c) c.scrollBy(0, Math.round(alto * 0.9));
    else window.scrollBy(0, Math.round(alto * 0.9));
  }

  /* ¿ES ESTE EL AUTO QUE SE BUSCABA?

     El toque puede ir a parar a otro auto, y antes se guardaba el enlace de
     donde se cayera: habia autos que abrian cualquier otro. Ahora, antes de
     guardar, se compara con la publicacion misma. Medido adentro de una en
     la version de celular: el titulo de la pestania es el del auto, el titulo
     aparece tambien solo en su renglon, la lista no queda escondida abajo y
     el primer precio dibujado es el del auto ("$7.500 por artículo ·
     Disponible"). Tienen que coincidir el titulo Y el precio. */
  const ESPERA_COMPROBAR = 5000;   // Facebook dibuja la publicacion de a poco
  const RE_MONEDA = /(?:u\$s|us\$|usd|ars|\$)/i;

  function renglonesDibujados(tope) {
    const out = [];
    // El panel propio vive en su propia raiz y este recorrido no entra ahi.
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode()) && out.length < tope) {
      const t = n.textContent.trim();
      const el = n.parentElement;
      if (t && el && el.getClientRects().length) out.push(t);
    }
    return out;
  }

  function mismoTitulo(visto, buscado) {
    // Facebook le antepone a la pestania los avisos sin leer: "(4) Audi ..."
    const a = MPF.normalizar(String(visto || '').replace(/^\(\d+\)\s*/, ''));
    const b = MPF.normalizar(String(buscado || '').replace(/\s*(?:\u2026|\.\.\.)\s*$/, ''));
    if (!a || !b) return false;
    // Si en la lista vino cortado, alcanza con que empiece igual.
    return MPF.scraper.pareceCortado(buscado) ? a.startsWith(b) : a === b;
  }

  function esLaPublicacionBuscada(objetivo) {
    const renglones = renglonesDibujados(60);
    if (!mismoTitulo(document.title, objetivo.titulo) &&
        !renglones.some((r) => mismoTitulo(r, objetivo.titulo))) return false;
    const buscado = objetivo.precio ? MPF.precio.parsearPrecio(objetivo.precio).valor : null;
    if (buscado == null) return true;
    const i = renglones.findIndex((r) => RE_MONEDA.test(r));
    if (i < 0) return false;
    // A veces el signo y el numero vienen en pedazos separados.
    const texto = /\d/.test(renglones[i]) ? renglones[i] : renglones[i] + ' ' + (renglones[i + 1] || '');
    const visto = MPF.precio.parsearPrecio(texto).valor;
    return visto != null && Math.abs(visto - buscado) < 0.5;
  }

  /* El renglon del titulo dentro de la tarjeta: es lo que se toca en el
     segundo intento. La foto puede ser la del auto de al lado cuando la caja
     que se dedujo agarro dos; el titulo es siempre el de este. */
  function elementoDelTitulo(el, titulo) {
    const buscado = MPF.normalizar(titulo);
    if (!buscado) return null;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (MPF.normalizar(n.textContent) === buscado) return n.parentElement;
    }
    return null;
  }

  /* Cuando una tarjeta no se deja abrir se sigue con la que viene. Quedarse
     trabado en una es peor que perderla.

     Se dice CUAL se saltea. El vigilante del toque salta a los 4 segundos, y
     si en ese tiempo ya se entro, se anoto el enlace y se volvio, la primera
     de la cola ya es otra: sin esta cuenta se salteaba esa otra sin haberla
     buscado. Una de cada dos se perdia asi. */
  function saltearObjetivo(idEsperado, hechosEsperados, reintentar) {
    leerCaza((estado) => {
      if (!estado || !estado.cola || !estado.cola.length) return;
      if (estado.cola[0].id !== idEsperado ||
          (estado.hechos || 0) !== hechosEsperados) return;
      // Si la foto no llevo a ningun lado, antes de rendirse se toca el titulo.
      if (reintentar && !estado.toque) {
        escribirCaza(Object.assign({}, estado, { toque: 1 }), () => programarCaza(0));
        return;
      }
      const resto = estado.cola.slice(1);
      const perdidas = (estado.perdidas || 0) + 1;
      if (!resto.length) {
        escribirCaza(null);
        decir(mensajeFinal(estado.hechos || 0, perdidas), false);
        return;
      }
      /* La siguiente esta debajo de la ultima donde se entro, no debajo de
         donde termino de buscar esta: se vuelve ahi. */
      if (estado.volverA != null) irAPosicion(estado.volverA);
      escribirCaza(Object.assign({}, estado, { cola: resto, perdidas, intentos: 0, saltos: 0, toque: 0 }),
                   () => programarCaza(0));
    });
  }

  function mensajeFinal(hechos, perdidas) {
    return 'listo: ' + hechos + ' enlaces guardados' +
           (perdidas ? ', ' + perdidas + ' no se pudieron abrir o no eran el auto' : '');
  }

  function seguirCaza() {
    leerCaza((estado) => {
      if (!estado || !estado.cola) return;
      if (!estado.cola.length) {
        /* Ya se busco la ultima: se limpia. Sin esto quedaba una busqueda
           "a medias" con la cola vacia, y al volver a entrar no arrancaba. */
        escribirCaza(null);
        decir(mensajeFinal(estado.hechos || 0, estado.perdidas || 0), false);
        return;
      }

      /* Estamos DENTRO de una publicacion: se comprueba que sea el auto
         buscado, se anota el enlace y se vuelve. */
      const id = idDeUrlItem(location.href);
      if (id) {
        tocandoHasta = 0;
        toqueActual++;   // se entro: el vigilante de ese toque ya no corre
        if (volviendoDe === location.href) return;   // ya se pidio volver
        if (adentroDe !== location.href) { adentroDe = location.href; adentroDesde = Date.now(); }
        const objetivo = estado.cola[0];
        const hallados = estado.hallados || [];
        /* Un numero que ya se le dio a otra es que se entro a la equivocada. */
        const repetida = hallados.includes(id);
        const esEsta = !repetida && esLaPublicacionBuscada(objetivo);
        if (!esEsta && !repetida && Date.now() - adentroDesde < ESPERA_COMPROBAR) {
          programarCaza(400);   // todavia se esta dibujando
          return;
        }
        volviendoDe = location.href;
        /* Se conserva todo lo demas -sobre todo donde estaba la lista-: antes
           se escribia de cero y eso se perdia. */
        let cambio;
        if (esEsta) {
          const datos = cache.get(objetivo.id) || { id: objetivo.id, titulo: objetivo.titulo };
          guardarEnlaceHallado(datos, 'https://www.facebook.com/marketplace/item/' + id + '/');
          cambio = { cola: estado.cola.slice(1), hechos: (estado.hechos || 0) + 1,
                     hallados: hallados.concat(id), toque: 0 };
        } else if (!estado.toque) {
          /* No era este auto: no se guarda nada y se vuelve a probar con la
             misma, esta vez tocando el titulo. */
          decir('no era ese auto: se prueba de nuevo con ' + (objetivo.titulo || 'sin titulo'), true);
          cambio = { toque: 1 };
        } else {
          decir('no se pudo entrar a ' + (objetivo.titulo || 'sin titulo') + ': se sigue', true);
          cambio = { cola: estado.cola.slice(1), perdidas: (estado.perdidas || 0) + 1, toque: 0 };
        }
        escribirCaza(Object.assign({}, estado, cambio, { intentos: 0, saltos: 0 }),
                     () => { history.back(); });
        return;
      }
      volviendoDe = '';
      if (Date.now() < tocandoHasta) return;   // hay un toque en curso

      /* Estamos en la lista: se busca la tarjeta y se la toca. */
      const objetivo = estado.cola[0];
      const hechos = estado.hechos || 0;
      const tarjetas = MPF.scraper.elementosTarjeta();
      for (const el of tarjetas) {
        const d = MPF.scraper.extraerDeTarjeta(el);
        if (!d || senia(d) !== objetivo.senia) continue;
        decir('entrando a: ' + (objetivo.titulo || 'sin titulo') +
              ' (' + (hechos + 1) + ' de ' + (hechos + estado.cola.length) + ')', true);
        el.scrollIntoView({ block: 'center' });
        tocandoHasta = Date.now() + 5000;
        /* Se anota donde quedo la lista antes de entrar: al volver, Facebook la
           rearma desde arriba y la siguiente tarjeta queda fuera de lo cargado. */
        escribirCaza(Object.assign({}, estado, { volverA: posicionScroll() }));
        /* Se toca en el MEDIO de la tarjeta, como haria una persona, y no sobre
           el elemento que nosotros dedujimos. La caja que deducimos suele ser
           la de afuera, y Facebook pone el manejador mas adentro: los eventos
           suben, no bajan, asi que un click sobre la de afuera no llega nunca
           al que escucha. */
        setTimeout(() => {
          /* Se toca la FOTO, no el centro de la caja. La caja que deducimos a
             veces es mas grande que la publicacion -puede ser la fila entera-,
             y ahi el centro cae en el vacio al lado del auto y el toque no le
             llega a nadie. La foto siempre esta adentro de lo que se puede
             tocar. */
          const ancla = (estado.toque ? elementoDelTitulo(el, d.titulo) : null) ||
                        el.querySelector('img') ||
                        el.querySelector('[data-mcomponent="ServerTextArea"]') || el;
          const r = ancla.getBoundingClientRect();
          const x = Math.round(r.left + r.width / 2);
          const y = Math.round(r.top + r.height / 2);
          /* elementsFromPoint y no elementFromPoint: arriba puede haber algo
             -nuestro propio panel, sin ir mas lejos- y entonces el de mas
             arriba no es el que hay que tocar. */
          const bajoElDedo = document.elementsFromPoint(x, y) || [];
          let aTocar = ancla;
          for (const cand of bajoElDedo) {
            if (el.contains(cand)) { aTocar = cand; break; }
          }
          const mio = ++toqueActual;
          aTocar.click();
          /* Si el toque no llevo a ningun lado, no se puede quedar esperando
             para siempre: se prueba con el titulo y despues se pasa a la
             siguiente. Solo si este toque sigue siendo el ultimo: ver
             saltearObjetivo. */
          setTimeout(() => {
            if (mio !== toqueActual || idDeUrlItem(location.href)) return;
            tocandoHasta = 0;
            saltearObjetivo(objetivo.id, hechos, true);
          }, 4000);
        }, 400);
        return;
      }

      /* Todavia no aparecio. Esperar no alcanza: al volver atras Facebook
         rearma la lista desde arriba y solo carga las primeras. Las que estaban
         mas abajo no existen hasta que alguien baja, y antes aca solo se
         esperaba: a partir de la veintena se salteaban todas sin buscarlas.

         Primero se salta a donde estaba la lista cuando se entro -la que sigue
         esta de ahi para abajo-. Si Facebook todavia no cargo hasta ahi, el
         salto llega al fondo de lo cargado, eso le hace cargar mas, y se
         vuelve a saltar. Recien pasando ese lugar se baja de a una pantalla. */
      const saltos = estado.saltos || 0;
      if (estado.volverA != null && posicionScroll() < estado.volverA - 50 && saltos < 60) {
        irAPosicion(estado.volverA);
        escribirCaza(Object.assign({}, estado, { saltos: saltos + 1 }),
                     () => programarCaza(1500));
        return;
      }
      const intentos = (estado.intentos || 0) + 1;
      if (intentos < 25) {
        bajarUnaPantalla();
        escribirCaza(Object.assign({}, estado, { intentos }),
                     () => programarCaza(1200));
        return;
      }
      saltearObjetivo(objetivo.id, hechos);
    });
  }

  /* El enlace hallado se guarda en el catalogo sobre la misma ficha: el fondo
     junta lo nuevo con lo que ya habia, asi que no se pierde nada de lo leido. */
  function guardarEnlaceHallado(datos, url) {
    datos.url = url;
    cache.set(datos.id, datos);
    try {
      chrome.runtime.sendMessage({ tipo: 'guardar', items: [Object.assign({}, datos, {
        _nodo: undefined, _link: undefined, _veredicto: undefined
      })] });
    } catch (e) {}
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
        /* Se guarda que el titulo vino cortado: el catalogo tiene que saber
           que ese texto esta incompleto y no puede tratarlo como un dato
           firme al buscar mas adelante. */
        tituloCortado: !!d.tituloCortado,
        enDuda: !!d.enDuda,
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
        const vistos = MPF.scraper.cantidadEnPantalla();
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
      /* En el celular, entrar a una publicacion NO recarga la pagina: Facebook
         cambia la direccion por adentro. Por eso mirar la carga, pageshow y
         popstate no alcanzaba: la busqueda de enlaces entraba a la primera y
         se quedaba ahi para siempre, porque nadie se enteraba de que ya
         estabamos adentro. El cambio de direccion se nota aca. */
      if (location.href !== urlPrevia) {
        urlPrevia = location.href;
        programarCaza(900);
      }

      // Si corresponde ir a la version de celular, se va y no se hace nada mas.
      if (irAVersionCelular()) return;

      // Fuera de Marketplace la extension no toca nada de la pagina.
      if (!enMarketplace()) {
        if (ui) ui.mostrar(false);
        return;
      }
      if (!ui) { montarPanel(); return; }   // recien entraste a Marketplace
      ui.mostrar(true);
      ui.modoEscritorio(pidieronEscritorio());

      /* ADENTRO DE UNA PUBLICACION NO SE LEE NADA.

         La pagina de una publicacion tiene foto, precio, titulo y zona: para
         el lector es "una tarjeta", y la guardaba como publicacion nueva, con
         la zona escrita de otra forma -"Publicado el viernes en ..."-. Mas las
         de "similares" que Facebook pone abajo. Cada vez que la busqueda de
         enlaces entraba a una, el catalogo sumaba duplicados. Aca solo se
         juntan resultados de busqueda. */
      if (idDeUrlItem(location.href)) return;

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
  function enPantalla(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 0;
  }

  function estructuraIlegible(cuantas) {
    const partes = [];
    const tope = cuantas || 2;
    /* Primero las que estan a la vista: si el usuario ve el titulo en pantalla
       y la extension no, esa tarjeta es la que hay que mirar. */
    const links = MPF.scraper.elementosTarjeta()
      .sort((a, b) => (enPantalla(b) ? 1 : 0) - (enPantalla(a) ? 1 : 0));
    for (const link of links) {
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
        'texto completo: ' + JSON.stringify(String(d.textoBusqueda || '').slice(0, 400)) + '\n' +
        'a la vista: ' + (enPantalla(link) ? 'si' : 'no') + '\n' +
        'forma del html:\n' + MPF.scraper.estructuraDe(caja, 1));
      if (partes.length >= tope) break;
    }
    if (!partes.length) return 'No hay ninguna tarjeta ilegible en pantalla.';
    return partes.join('\n\n');
  }

  MPF.diagnostico = {
    estructuraIlegible,
    /* Vuelve a pedir los titulos guardados y reevalua todo. Util despues de
       navegar un rato: cuantas mas publicaciones pasaron por el catalogo, mas
       titulos se conocen de las que Facebook manda sin titulo. */
    pedirTitulos: () => pedirTitulosConocidos(),
    aplicarFiltros,
    pasada,
    /* Arrancar la recorrida sin tocar el panel: asi se puede probar de punta a
       punta, y tambien dispararla desde la consola. */
    releer: () => releerLasQueFaltan(),
    buscarEnlaces: () => arrancarCaza(),
    pararBusquedaDeEnlaces: () => pararCaza(),
    recorrer: (texto, escritorio) =>
      arrancarRecorrida(MPF.recorrida.limpiarLista(texto), escritorio),
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

  /* Si la tarjeta llego sin titulo pero esa publicacion ya esta en el catalogo,
     se usa el titulo guardado. Es la unica fuente posible cuando Facebook no
     lo manda. */
  function rescatarTitulo(datos) {
    if (!datos || !datos.tituloDudoso) return;
    const guardado = titulosConocidos[datos.id];
    if (!guardado) return;
    datos.titulo = guardado;
    datos.tituloDelCatalogo = true;
    datos.tituloDudoso = false;
    datos.textoBusqueda = guardado + ' \u00b7 ' + (datos.textoBusqueda || '');
  }

  function pedirTitulosConocidos() {
    try {
      chrome.runtime.sendMessage({ tipo: 'titulosConocidos' }, (r) => {
        if (chrome.runtime.lastError || !r || !r.ok) return;
        titulosConocidos = r.titulos || Object.create(null);
        // Solo vale reevaluar si efectivamente hay titulos guardados.
        if (Object.keys(titulosConocidos).length) {
          versionConfig++;
          aplicarFiltros(true);
        }
      });
    } catch (e) {}
  }

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
          pararRecorrida();
          pararRelectura();
          pararCaza();
          MPF.autoscroll.parar();
          return;
        }
        barrerEstaPagina();
      },
      alRecorrer(texto, escritorio) {
        const lista = MPF.recorrida.limpiarLista(texto);
        if (!lista.length) { decir('escribi al menos una busqueda', false); return; }
        arrancarRecorrida(lista, escritorio);
      },
      /* Un boton para llegar a escritorio, porque a mano no se podia: la
         extension manda todo al celular y volvia a traerte. Y hace falta ir:
         en el celular Facebook no manda NI UN enlace de publicacion -medido: 0
         en toda la pagina- y en escritorio las tarjetas si son enlaces. */
      alReleer() { releerLasQueFaltan(); },
      alBuscarEnlaces() { arrancarCaza(); },
      alIrAEscritorio() {
        /* Ya en escritorio, el mismo boton vuelve al celular: si no, una vez
           que se entra no hay como salir sin cerrar la pestania. */
        if (pidieronEscritorio()) {
          salirDeEscritorio();
          decir('volviendo a la version de celular', true);
          location.assign('https://m.facebook.com' + location.pathname + location.search);
          return;
        }
        /* Con la emulacion de telefono de las herramientas del navegador
           encendida, Chrome firma TODOS los pedidos como si fuera un iPhone, asi
           que Facebook devuelve la version de celular tambien en www y el boton
           parece no hacer nada. La extension ya pide sola la version de celular
           para m.facebook.com, asi que esa emulacion ya no hace falta: apagarla
           es lo que destraba esto. Se avisa en vez de no hacer nada. */
        if (/iPhone|iPad|Android|Mobile/i.test(navigator.userAgent)) {
          decir('apaga el modo telefono del navegador y proba de nuevo', false);
          return;
        }
        const destino = conMarcaDeEscritorio(
          'https://www.facebook.com' + location.pathname + location.search);
        decir('yendo a escritorio a juntar los enlaces', true);
        location.assign(destino);
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
        configCargada = true;
        filtro = MPF.matcher.compilar(config.consulta);
        versionConfig++;
        ui.escribirConfig(config);
        pasada();
        pedirTotalCatalogo();
        pedirTitulosConocidos();
        /* Si quedo una recorrida a medias -aunque haya sido en otra pestania o
           antes de cerrar el navegador-, sigue sola desde donde iba. */
        setTimeout(seguirRecorrida, 2500);
        /* Si quedo una caza de enlaces a medias -entrar a una publicacion
           recarga la pagina- sigue sola desde donde iba. */
        programarCaza(3000);
      });
    } catch (e) {
      configCargada = true;   // sin almacenamiento se sigue con lo de fabrica
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

    /* Al volver atras el navegador puede restaurar la pagina tal cual estaba,
       sin volver a ejecutar nada. Sin esto, la busqueda de enlaces entraba a
       la primera publicacion y despues se quedaba quieta para siempre. */
    window.addEventListener('pageshow', () => { programarCaza(1200); });
    window.addEventListener('popstate', () => { programarCaza(1200); });

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
