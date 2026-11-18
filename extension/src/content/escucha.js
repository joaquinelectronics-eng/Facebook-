/* Escucha lo que Facebook le manda a la pagina.

   Corre en el mundo de la pagina ("world": "MAIN") y desde el arranque
   ("run_at": "document_start"). Tiene que ser asi: las respuestas de
   /api/graphql/ solo se ven desde adentro de la pagina, y el content script
   normal vive aparte y llega cuando la pagina ya cargo.

   Que hace y que NO hace:
   - Lee una COPIA de cada respuesta que la pagina ya pidio. Lo que recibe
     Facebook no cambia en nada.
   - No pide nada. No hay un solo pedido que salga de aca.
   - No manda nada fuera de la PC: lo que tiene pinta de publicaciones se le
     pasa al content script de la extension con postMessage, dentro de la misma
     pestania. Leerlo y guardarlo es cosa de content.js y lib/datos.js. */
(() => {
  const MARCA = '__mpfDatos';
  /* Lo que llega antes de que el content script este escuchando se guarda un
     rato: las primeras respuestas llegan antes de que el termine de cargar. */
  const TOPE_EN_ESPERA = 40;
  const enEspera = [];
  let hayQuienEscuche = false;

  function pasar(texto) {
    if (typeof texto !== 'string' || texto.indexOf('listing_title') < 0) return;
    if (!hayQuienEscuche) {
      enEspera.push(texto);
      if (enEspera.length > TOPE_EN_ESPERA) enEspera.shift();
      return;
    }
    window.postMessage({ [MARCA]: 'respuesta', texto }, location.origin);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data[MARCA] !== 'escucho') return;
    hayQuienEscuche = true;
    while (enEspera.length) {
      window.postMessage({ [MARCA]: 'respuesta', texto: enEspera.shift() }, location.origin);
    }
  });

  /* Solo respuestas de texto de la propia pagina. Las fotos y los videos
     vienen de otro lado (fbcdn) y no traen publicaciones: copiar un video
     entero para no encontrar nada era tirar memoria. */
  function valeLaPena(url, tipo) {
    let u;
    try { u = new URL(url, location.href); } catch (e) { return false; }
    if (u.origin !== location.origin && !/(^|\.)facebook\.com$/.test(u.hostname)) return false;
    return !/^(image|video|audio|font)\//i.test(tipo || '');
  }

  const fetchOriginal = window.fetch;
  if (typeof fetchOriginal === 'function') {
    window.fetch = function () {
      const promesa = fetchOriginal.apply(this, arguments);
      promesa.then((r) => {
        try {
          if (!r || r.bodyUsed || !valeLaPena(r.url, r.headers && r.headers.get('content-type'))) return;
          r.clone().text().then(pasar, () => {});
        } catch (e) { /* una copia que no se pudo leer no rompe nada */ }
      }, () => {});
      return promesa;
    };
  }

  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const abrir = XHR.open;
    const enviar = XHR.send;
    const direcciones = new WeakMap();
    XHR.open = function (metodo, url) {
      try { direcciones.set(this, String(url)); } catch (e) { /* sigue igual */ }
      return abrir.apply(this, arguments);
    };
    XHR.send = function () {
      try {
        this.addEventListener('load', () => {
          try {
            const url = this.responseURL || direcciones.get(this) || '';
            if (!valeLaPena(url, this.getResponseHeader('content-type'))) return;
            if (this.responseType === '' || this.responseType === 'text') pasar(this.responseText);
            else if (this.responseType === 'json' && this.response) pasar(JSON.stringify(this.response));
          } catch (e) { /* idem */ }
        });
      } catch (e) { /* idem */ }
      return enviar.apply(this, arguments);
    };
  }
})();
