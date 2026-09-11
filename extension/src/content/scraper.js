/* Lectura de las tarjetas de resultados de Marketplace.

   REGLA DE DISENO: no se usa NINGUNA clase CSS de Facebook. Las clases estan
   ofuscadas y cambian cada pocas semanas; si el scraper dependiera de ellas se
   rompe sola. En su lugar se usan dos anclas que Facebook no puede cambiar sin
   romper su propio sitio:
     1) el link de la publicacion: a[href*="/marketplace/item/"]
     2) el texto visible de la tarjeta
   Todo lo demas se deduce por patrones (precio, kilometraje, anio). */
(() => {
  const MPF = (window.MPF = window.MPF || {});

  const SELECTOR_ITEM = 'a[href*="/marketplace/item/"]';

  function idDesdeUrl(href) {
    const m = String(href).match(/\/marketplace\/item\/(\d+)/);
    return m ? m[1] : null;
  }

  function urlLimpia(href) {
    const id = idDesdeUrl(href);
    return id ? 'https://www.facebook.com/marketplace/item/' + id + '/' : href;
  }

  /* Sube desde el link hasta el contenedor mas alto que todavia representa a
     ESTA sola tarjeta. Apenas un ancestro contiene mas de una publicacion,
     significa que nos pasamos: el anterior era la celda de la grilla.
     Esto funciona sin importar como este armado el HTML. */
  function contenedorTarjeta(link) {
    let el = link;
    let saltos = 0;
    while (el.parentElement && el.parentElement !== document.body && saltos < 12) {
      const padre = el.parentElement;
      if (padre.querySelectorAll(SELECTOR_ITEM).length > 1) return el;
      el = padre;
      saltos++;
    }
    return link;
  }

  /* El texto de la tarjeta viene en lineas sueltas y en orden variable.
     Se clasifica cada linea por lo que parece, no por su posicion. */
  /* Detectar "la linea del precio" no alcanza con buscar un signo $: un titulo
     como "Audi A5 u$s 19.500 titular" tambien lo tiene, y si se lo toma como
     precio se pierde el titulo. Por eso se mide cuanto de la linea ocupa el
     monto: si es casi toda la linea, es el precio; si es una parte chica de un
     texto largo, es un titulo que menciona el precio. */
  const RE_PRECIO_CAPTURA = /(?:u\$s|us\$|usd|ars|\$)\s*\d[\d.,]*\s*(?:k\b|mil\b|palos?|millones?|lucas?)?|\d[\d.,]*\s*(?:d[oó]lares?|usd|u\$s|palos?|millones?|melones?|lucas?|k\b|mil\b)/i;

  function esLineaDePrecio(linea) {
    const l = String(linea || '').trim();
    if (!l) return false;
    if (/^\d[\d.,]*$/.test(l)) return true;   // solo el numero: precio abreviado
    const m = l.match(RE_PRECIO_CAPTURA);
    if (!m) return false;
    return m[0].trim().length / l.length >= 0.6;
  }
  const RE_KM = /([\d.,]+)\s*(km|kil[oó]metros?)\b/i;
  const RE_ANIO = /\b(19[5-9]\d|20[0-4]\d)\b/;
  const RE_RUIDO = /^(nuevo|usado|ver m[aá]s|patrocinado|sponsored|gratis)$/i;

  function extraerDeTarjeta(link) {
    const id = idDesdeUrl(link.getAttribute('href') || '');
    if (!id) return null;

    const caja = contenedorTarjeta(link);
    const crudo = (caja.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);

    // El alt de la imagen suele traer el titulo completo sin recortar.
    const img = caja.querySelector('img[alt]');
    const altImagen = img ? (img.getAttribute('alt') || '').trim() : '';

    let lineaPrecio = '';
    const restantes = [];
    for (const linea of crudo) {
      if (!lineaPrecio && esLineaDePrecio(linea)) { lineaPrecio = linea; continue; }
      if (RE_RUIDO.test(linea)) continue;
      restantes.push(linea);
    }

    /* El titulo es la linea mas larga de las que quedan: la ubicacion y el
       kilometraje son cortos, el titulo del auto siempre es el mas descriptivo.
       Si el alt de la imagen es mas completo, gana el alt. */
    let titulo = restantes.reduce((a, b) => (b.length > a.length ? b : a), '');
    if (altImagen.length > titulo.length && !esLineaDePrecio(altImagen)) {
      titulo = altImagen;
    }

    // La ubicacion suele ser la ultima linea corta que no es el titulo.
    let ubicacion = '';
    for (let i = restantes.length - 1; i >= 0; i--) {
      const l = restantes[i];
      if (l !== titulo && l.length <= 60 && !RE_KM.test(l)) { ubicacion = l; break; }
    }

    const mKm = (caja.innerText || '').match(RE_KM);
    const mAnio = String(titulo).match(RE_ANIO);

    return {
      id,
      titulo: titulo || altImagen || '',
      precioTexto: lineaPrecio,
      ubicacion,
      km: mKm ? MPF.precio.aNumero(mKm[1]) : null,
      anio: mAnio ? Number(mAnio[1]) : null,
      url: urlLimpia(link.getAttribute('href') || ''),
      imagen: img ? img.getAttribute('src') || '' : '',
      _nodo: caja,
      _link: link
    };
  }

  /* Recorre el documento y devuelve las tarjetas que todavia no fueron leidas.
     Se marca cada link con un atributo propio para no reprocesar en cada
     mutacion del DOM (Marketplace dispara muchisimas). */
  function leerNuevas() {
    const encontradas = [];
    const links = document.querySelectorAll(SELECTOR_ITEM + ':not([data-mpf-leido])');
    for (const link of links) {
      const datos = extraerDeTarjeta(link);
      // Sin titulo todavia: la tarjeta aun no termino de renderizar, se reintenta luego.
      if (!datos || !datos.titulo) continue;
      link.setAttribute('data-mpf-leido', '1');
      encontradas.push(datos);
    }
    return encontradas;
  }

  /* Vuelve a listar TODAS las tarjetas presentes (para reaplicar filtros
     cuando el usuario cambia la busqueda sin recargar la pagina). */
  function leerTodas() {
    const out = [];
    for (const link of document.querySelectorAll(SELECTOR_ITEM)) {
      const datos = extraerDeTarjeta(link);
      if (datos && datos.titulo) out.push(datos);
    }
    return out;
  }

  function cantidadEnPantalla() {
    return document.querySelectorAll(SELECTOR_ITEM).length;
  }

  MPF.scraper = { leerNuevas, leerTodas, extraerDeTarjeta, esLineaDePrecio,
                  cantidadEnPantalla, contenedorTarjeta, SELECTOR_ITEM };
})();
