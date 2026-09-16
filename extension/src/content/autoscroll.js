/* Barrido automatico a ritmo humano.

   Lo que delata a un bot no es scrollear: es el RITMO. Un script tipico hace
   scrollTo(0, 999999) cada 200ms, con pausas identicas y saltos imposibles.
   Aca se imita lo que hace una persona:
     - cada "tanda" son varios micro-scrolls del tamanio de un click de rueda,
       separados por decenas de milisegundos (asi baja una rueda real)
     - entre tanda y tanda hay una pausa larga y variable (estas mirando autos)
     - cada tantas tandas hay una pausa mas larga todavia (te distrajiste)
     - si el usuario toca el scroll, el barrido se aparta y espera
     - si no aparece nada nuevo varias veces seguidas, se termino la lista */
(() => {
  const MPF = (window.MPF = window.MPF || {});

  /* Tres ritmos. El lento es indistinguible de una persona; el rapido junta
     mucho mas por minuto pero genera un patron de carga mas marcado. La
     eleccion es del usuario, pero el ritmo siempre lleva variacion al azar:
     lo que canta no es la velocidad, es la regularidad. */
  const PERFILES = {
    tranquilo: {
      pasosPorTanda: [3, 7], pixelsPorPaso: [90, 190], pausaEntrePasos: [35, 110],
      pausaEntreTandas: [2600, 6200], tandasHastaDescanso: [7, 12], pausaDescanso: [14000, 32000]
    },
    normal: {
      pasosPorTanda: [4, 9], pixelsPorPaso: [120, 260], pausaEntrePasos: [22, 70],
      pausaEntreTandas: [1000, 2400], tandasHastaDescanso: [11, 18], pausaDescanso: [5000, 12000]
    },
    rapido: {
      pasosPorTanda: [6, 13], pixelsPorPaso: [180, 380], pausaEntrePasos: [10, 32],
      pausaEntreTandas: [320, 900], tandasHastaDescanso: [20, 34], pausaDescanso: [1800, 4500]
    },
    /* Todo lo que se puede pedir sin dejar de esperar a que Facebook cargue.
       Mas alla de esto el cuello de botella deja de ser el scroll. */
    turbo: {
      pasosPorTanda: [10, 22], pixelsPorPaso: [420, 950], pausaEntrePasos: [4, 16],
      pausaEntreTandas: [90, 320], tandasHastaDescanso: [40, 70], pausaDescanso: [700, 2000]
    }
  };

  const CFG = {
    tandasSinNovedadParaFrenar: 4,  // corta si la lista dejo de crecer
    limiteTandas: 140               // tope duro de seguridad por sesion
  };

  const azar = (min, max) => min + Math.random() * (max - min);
  const azarInt = (par) => Math.round(azar(par[0], par[1]));
  /* Espera cancelable: si se pide parar, corta al instante en vez de quedarse
     colgada hasta media hora en una pausa de descanso. */
  function dormir(ms) {
    return new Promise((resolver) => {
      const t = setTimeout(() => { esperaEnCurso = null; resolver(); }, ms);
      esperaEnCurso = () => { clearTimeout(t); esperaEnCurso = null; resolver(); };
    });
  }

  let corriendo = false;
  let pedidoDeParar = false;

  /* Token de corrida. Cada barrido se queda con un numero; si ese numero deja
     de ser el actual, el barrido se apaga solo en el proximo paso. Sirve para
     matar de verdad cualquier barrido en vuelo, incluso uno de otra instancia
     del script que haya quedado dando vueltas: parar() invalida a todos. */
  let corridaActual = 0;
  const cancelados = new Set();
  let esperaEnCurso = null;
  let pausadoPorUsuario = false;
  let ultimoScrollDelUsuario = 0;
  let scrollPropioEnCurso = false;

  /* QUIEN SCROLLEA. En escritorio es la ventana. En la version movil no: la
     pagina mide exactamente una pantalla y lo que se mueve es un cajon interno
     con overflow propio. Por eso window.scrollBy no hacia nada, la cuenta del
     fondo daba "ya llegamos" y el barrido cortaba a las pocas tandas diciendo
     que Facebook no tenia mas resultados, cuando si tenia.

     No se pregunta si "es movil": se busca cual es el elemento que de verdad
     se puede mover, arrancando de una publicacion y subiendo. */
  let cajonRecordado = null;

  function puedeScrollear(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.scrollHeight - el.clientHeight < 40) return false;
    const y = getComputedStyle(el).overflowY;
    return y === 'auto' || y === 'scroll';
  }

  function cajonDeScroll() {
    if (cajonRecordado && cajonRecordado.isConnected &&
        puedeScrollear(cajonRecordado)) return cajonRecordado;
    cajonRecordado = null;
    const tarjetas = (MPF.scraper && MPF.scraper.elementosTarjeta)
      ? MPF.scraper.elementosTarjeta() : [];
    let n = tarjetas.length ? tarjetas[0] : null;
    for (let i = 0; n && i < 14; i++, n = n.parentElement) {
      if (puedeScrollear(n)) { cajonRecordado = n; return n; }
    }
    return null;   // se mueve la ventana, como siempre
  }

  function moverse(pixeles) {
    const cajon = cajonDeScroll();
    if (cajon) cajon.scrollBy(0, pixeles);
    else window.scrollBy(0, pixeles);
  }

  /* Si el usuario mueve la pagina por su cuenta, el barrido se hace a un lado.
     Se escucha en fase de captura porque el scroll de un elemento no sube
     hasta la ventana por si solo. */
  window.addEventListener(
    'scroll',
    () => {
      if (scrollPropioEnCurso) return;
      ultimoScrollDelUsuario = Date.now();
      pausadoPorUsuario = true;
    },
    { passive: true, capture: true }
  );

  function usuarioSigueActivo() {
    return Date.now() - ultimoScrollDelUsuario < 4000;
  }

  async function unaTanda(perfil, token) {
    const pasos = azarInt(perfil.pasosPorTanda);
    for (let i = 0; i < pasos; i++) {
      if (pedidoDeParar || token !== corridaActual) return;
      scrollPropioEnCurso = true;
      moverse(azarInt(perfil.pixelsPorPaso));
      // El flag se libera despues del frame para no confundir el scroll propio
      // con el del usuario.
      setTimeout(() => { scrollPropioEnCurso = false; }, 60);
      await dormir(azarInt(perfil.pausaEntrePasos));
    }
  }

  function alFondo() {
    const cajon = cajonDeScroll();
    const resto = cajon
      ? cajon.scrollHeight - cajon.scrollTop - cajon.clientHeight
      : document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
    return resto < 900;
  }

  /* onProgreso recibe { tanda, enPantalla, sinNovedad, estado }.
     opciones.limiteTandas permite un barrido mas corto: en las corridas
     automaticas no hace falta llegar al fondo, lo nuevo esta arriba. */
  async function iniciar(onProgreso, opciones) {
    const opts = opciones || {};
    const limite = opts.limiteTandas || CFG.limiteTandas;
    const perfil = PERFILES[opts.velocidad] || PERFILES.tranquilo;
    if (corriendo) return;
    const token = ++corridaActual;
    corriendo = true;
    pedidoDeParar = false;
    pausadoPorUsuario = false;

    let tanda = 0;
    let sinNovedad = 0;
    let previos = MPF.scraper.cantidadEnPantalla();
    let tandasHastaDescanso = azarInt(perfil.tandasHastaDescanso);
    /* Por que termino el barrido. Antes el mensaje util ("se acabaron los
       resultados") se pisaba al instante con un "detenido" pelado, y desde
       afuera parecia que se habia trabado. */
    let motivoFinal = 'detenido';

    const avisar = (estado) =>
      onProgreso && onProgreso({ tanda, enPantalla: MPF.scraper.cantidadEnPantalla(), sinNovedad, estado });

    try {
      while (!pedidoDeParar && token === corridaActual && tanda < limite) {
        // Espera a que el usuario suelte la pagina antes de seguir.
        if (pausadoPorUsuario) {
          avisar('en espera (estas scrolleando vos)');
          while (usuarioSigueActivo() && !pedidoDeParar) await dormir(700);
          pausadoPorUsuario = false;
          if (pedidoDeParar) break;
        }

        await unaTanda(perfil, token);
        /* Hay que mirar el freno DESPUES de cada espera, no solo al empezar la
           vuelta: si se pide parar justo mientras scrollea, sin este chequeo se
           entraba igual a la pausa larga y seguia bajando varios segundos mas
           con el boton ya en "detenido". */
        if (pedidoDeParar || token !== corridaActual) break;
        tanda++;

        avisar('barriendo');
        await dormir(azarInt(perfil.pausaEntreTandas));
        if (pedidoDeParar || token !== corridaActual) break;

        const ahora = MPF.scraper.cantidadEnPantalla();
        if (ahora > previos) {
          sinNovedad = 0;
          previos = ahora;
        } else if (alFondo()) {
          sinNovedad++;
          if (sinNovedad >= CFG.tandasSinNovedadParaFrenar) {
            /* Se dice cuantas llego a juntar: "no hay mas" a secas no deja
               distinguir un barrido completo de uno que se corto solo. */
            motivoFinal = 'listo: Facebook dejo de mandar despues de ' +
                          previos + ' publicaciones';
            break;
          }
          // Al fondo sin novedades: Facebook puede estar cargando, se le da aire.
          await dormir(azarInt([1800, 3600]));
          if (pedidoDeParar || token !== corridaActual) break;
        }

        if (--tandasHastaDescanso <= 0) {
          tandasHastaDescanso = azarInt(perfil.tandasHastaDescanso);
          avisar('pausa (asi no llamamos la atencion)');
          await dormir(azarInt(perfil.pausaDescanso));
          if (pedidoDeParar || token !== corridaActual) break;
        }
      }

      if (tanda >= limite) {
        motivoFinal = 'freno por seguridad a las ' + limite +
                      ' tandas: puede haber mas, apreta de nuevo';
      }
      else if (pedidoDeParar) motivoFinal = 'detenido por vos';
    } finally {
      /* Solo la corrida vigente apaga las banderas. Una corrida vieja que
         termina tarde no puede decir que "ya no hay nada corriendo". */
      if (token === corridaActual) {
        corriendo = false;
        pedidoDeParar = false;
      }
      cancelados.delete(token);
      avisar(motivoFinal);
    }
  }

  /* Frena todo: la corrida vigente y cualquiera que haya quedado dando vueltas. */
  function parar() {
    pedidoDeParar = true;
    cancelados.add(corridaActual);
    corridaActual++;          // invalida cualquier barrido en vuelo
    corriendo = false;
    if (esperaEnCurso) esperaEnCurso();   // corta la espera al instante
  }
  function estaCorriendo() { return corriendo; }

  MPF.autoscroll = { iniciar, parar, estaCorriendo, CFG, PERFILES,
                     cajonDeScroll, puedeScrollear };
})();
