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

  const CFG = {
    pasosPorTanda: [3, 7],          // micro-scrolls por tanda
    pixelsPorPaso: [90, 190],       // alto de cada micro-scroll
    pausaEntrePasos: [35, 110],     // ms entre micro-scrolls
    pausaEntreTandas: [2600, 6200], // ms de lectura entre tandas
    tandasHastaDescanso: [7, 12],   // cada cuantas tandas hace una pausa larga
    pausaDescanso: [14000, 32000],  // ms de la pausa larga
    tandasSinNovedadParaFrenar: 4,  // corta si la lista dejo de crecer
    limiteTandas: 140               // tope duro de seguridad por sesion
  };

  const azar = (min, max) => min + Math.random() * (max - min);
  const azarInt = (par) => Math.round(azar(par[0], par[1]));
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  let corriendo = false;
  let pedidoDeParar = false;
  let pausadoPorUsuario = false;
  let ultimoScrollDelUsuario = 0;
  let scrollPropioEnCurso = false;

  // Si el usuario mueve la pagina por su cuenta, el barrido se hace a un lado.
  window.addEventListener(
    'scroll',
    () => {
      if (scrollPropioEnCurso) return;
      ultimoScrollDelUsuario = Date.now();
      pausadoPorUsuario = true;
    },
    { passive: true }
  );

  function usuarioSigueActivo() {
    return Date.now() - ultimoScrollDelUsuario < 4000;
  }

  async function unaTanda() {
    const pasos = azarInt(CFG.pasosPorTanda);
    for (let i = 0; i < pasos; i++) {
      if (pedidoDeParar) return;
      scrollPropioEnCurso = true;
      window.scrollBy(0, azarInt(CFG.pixelsPorPaso));
      // El flag se libera despues del frame para no confundir el scroll propio
      // con el del usuario.
      setTimeout(() => { scrollPropioEnCurso = false; }, 60);
      await dormir(azarInt(CFG.pausaEntrePasos));
    }
  }

  function alFondo() {
    const resto = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
    return resto < 900;
  }

  /* onProgreso recibe { tanda, enPantalla, sinNovedad, estado } */
  async function iniciar(onProgreso) {
    if (corriendo) return;
    corriendo = true;
    pedidoDeParar = false;
    pausadoPorUsuario = false;

    let tanda = 0;
    let sinNovedad = 0;
    let previos = MPF.scraper.cantidadEnPantalla();
    let tandasHastaDescanso = azarInt(CFG.tandasHastaDescanso);

    const avisar = (estado) =>
      onProgreso && onProgreso({ tanda, enPantalla: MPF.scraper.cantidadEnPantalla(), sinNovedad, estado });

    try {
      while (!pedidoDeParar && tanda < CFG.limiteTandas) {
        // Espera a que el usuario suelte la pagina antes de seguir.
        if (pausadoPorUsuario) {
          avisar('en espera (estas scrolleando vos)');
          while (usuarioSigueActivo() && !pedidoDeParar) await dormir(700);
          pausadoPorUsuario = false;
          if (pedidoDeParar) break;
        }

        await unaTanda();
        tanda++;

        avisar('barriendo');
        await dormir(azarInt(CFG.pausaEntreTandas));

        const ahora = MPF.scraper.cantidadEnPantalla();
        if (ahora > previos) {
          sinNovedad = 0;
          previos = ahora;
        } else if (alFondo()) {
          sinNovedad++;
          if (sinNovedad >= CFG.tandasSinNovedadParaFrenar) {
            avisar('listo: se acabaron los resultados');
            break;
          }
          // Al fondo sin novedades: Facebook puede estar cargando, se le da aire.
          await dormir(azarInt([1800, 3600]));
        }

        if (--tandasHastaDescanso <= 0) {
          tandasHastaDescanso = azarInt(CFG.tandasHastaDescanso);
          avisar('pausa (asi no llamamos la atencion)');
          await dormir(azarInt(CFG.pausaDescanso));
        }
      }

      if (tanda >= CFG.limiteTandas) avisar('listo: limite de la sesion alcanzado');
      else if (pedidoDeParar) avisar('detenido');
    } finally {
      corriendo = false;
      pedidoDeParar = false;
      avisar('detenido');
    }
  }

  function parar() { pedidoDeParar = true; }
  function estaCorriendo() { return corriendo; }

  MPF.autoscroll = { iniciar, parar, estaCorriendo, CFG };
})();
