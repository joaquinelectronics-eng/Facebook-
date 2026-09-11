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
  /* El kilometraje tambien viene abreviado: Facebook muestra "128 mil km" y
     "150mil k...". Se prueba primero la forma con "mil" para no leer 128. */
  const RE_KM_MIL = /([\d.,]+)\s*mil\s*(?:km|k\b)/i;
  const RE_KM = /([\d.,]+)\s*(?:km|kil[oó]metros?)\b/i;

  function extraerKm(texto) {
    const conMil = String(texto).match(RE_KM_MIL);
    if (conMil) {
      const n = MPF.precio.aNumero(conMil[1]);
      return n == null ? null : n * 1000;
    }
    const suelto = String(texto).match(RE_KM);
    return suelto ? MPF.precio.aNumero(suelto[1]) : null;
  }

  /* Facebook pega el estado y el kilometraje delante de la zona:
       "Usado · Olivos, BA"
       "128 mil km · Ciudad de Buenos Aires"
     La zona es siempre lo que va despues del ultimo separador. */
  const RE_SEPARADOR = /[\u00b7\u2022|]/;

  function limpiarUbicacion(linea) {
    const partes = String(linea || '').split(/\s*[\u00b7\u2022|]\s*/);
    const l = partes[partes.length - 1].trim();
    if (!l) return '';
    if (/^(usado|nuevo|gratis)$/i.test(l)) return '';
    if (/^[\d.,]+\s*(?:mil\s*)?(?:km|kil[oó]metros?)\.?$/i.test(l)) return '';
    return l;
  }
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
    const candidatosTitulo = [];
    const candidatosZona = [];
    for (const linea of crudo) {
      if (!lineaPrecio && esLineaDePrecio(linea)) { lineaPrecio = linea; continue; }
      if (RE_RUIDO.test(linea)) continue;
      /* Una linea con separador ("Usado · Olivos, BA") es siempre la fila de
         estado y zona, nunca el titulo. Separarlas evita que una zona larga le
         gane al titulo por cantidad de caracteres. */
      if (RE_SEPARADOR.test(linea)) candidatosZona.push(linea);
      else candidatosTitulo.push(linea);
    }

    /* El titulo es el candidato mas descriptivo: la zona y el kilometraje son
       cortos, el titulo del auto es el mas largo. El alt de la imagen compite
       en igualdad de condiciones porque suele traerlo completo, sin recortar. */
    let titulo = candidatosTitulo.reduce((a, b) => (b.length > a.length ? b : a), '');
    if (altImagen && !esLineaDePrecio(altImagen) && altImagen.length > titulo.length) {
      titulo = altImagen;
    }

    let ubicacion = '';
    for (const linea of candidatosZona.concat(candidatosTitulo).reverse()) {
      if (linea === titulo) continue;
      const limpia = limpiarUbicacion(linea);
      if (limpia && limpia.length <= 70) { ubicacion = limpia; break; }
    }

    const mAnio = String(titulo).match(RE_ANIO);

    return {
      id,
      titulo: titulo || altImagen || '',
      precioTexto: lineaPrecio,
      ubicacion,
      km: extraerKm(caja.innerText || ''),
      anio: mAnio ? Number(mAnio[1]) : null,
      provincia: MPF.zonas ? MPF.zonas.detectarProvincia(ubicacion) : null,
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

  /* Vuelve a listar TODAS las tarjetas presentes.

     OJO: innerText devuelve vacio en un elemento con display:none, asi que esto
     no relee una tarjeta que el filtro ya escondio. No es un problema en el uso
     real porque cada tarjeta se lee y se guarda ANTES de ocultarse, y despues
     se trabaja sobre esa copia en memoria. */
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
                  limpiarUbicacion, extraerKm, cantidadEnPantalla, contenedorTarjeta,
                  SELECTOR_ITEM };
})();
