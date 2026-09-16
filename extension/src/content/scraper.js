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
  const normalizar = MPF.normalizar;

  /* Vale para la version de escritorio y para la movil: "/marketplace/item/123"
     tambien contiene "/item/". Tiene que ser UN solo selector, no dos separados
     por coma: al agregarle despues un ":not(...)" para saltear lo ya procesado,
     esa condicion se aplicaria solo a la ultima parte y todo se contaria dos
     veces. Lo que no tenga un id numerico se descarta al leerlo. */
  const SELECTOR_ITEM = 'a[href*="/item/"]';

  /* ---------------------------------------------------------------- version movil

     Facebook sirve dos paginas distintas. La de escritorio arma cada tarjeta
     como un enlace y manda muchas SIN titulo. La movil usa su propio sistema de
     componentes -MContainer, ServerTextArea- sin un solo enlace, y ahi los
     titulos SI vienen. Por eso conviene trabajar sobre la movil.

     En esa version una tarjeta es un contenedor enfocable con accion propia, y
     cada texto suyo -precio, titulo, zona- es un ServerTextArea. */
  const SELECTOR_MOVIL =
    'div[data-mcomponent="MContainer"][data-type="container"][tabindex="0"][data-action-id]';
  const SELECTOR_TEXTO_MOVIL = '[data-mcomponent="ServerTextArea"]';

  function esVersionMovil() {
    return !!document.querySelector('[data-mcomponent="MScreen"]');
  }

  function selectorItem() {
    return esVersionMovil() ? SELECTOR_MOVIL : SELECTOR_ITEM;
  }

  /* En la version movil no hay id de publicacion en ninguna parte: las tarjetas
     no son enlaces. Se arma uno propio a partir del titulo y la zona, que no
     cambian entre cargas, para que el catalogo pueda reconocer la misma
     publicacion y llevarle el historial de precios. */
  function idSintetico(titulo, zona) {
    const base = normalizar(titulo + '|' + zona);
    let h = 5381;
    for (let i = 0; i < base.length; i++) h = ((h * 33) ^ base.charCodeAt(i)) >>> 0;
    return 'm' + h.toString(36);
  }

  function lineasMovil(caja) {
    return Array.from(caja.querySelectorAll(SELECTOR_TEXTO_MOVIL))
      .map((e) => (e.textContent || '').trim())
      .filter(Boolean);
  }

  /* No todo contenedor enfocable es una tarjeta: tambien lo son los botones de
     filtro y de orden. Una tarjeta tiene un precio entre sus textos. */
  function esTarjetaMovil(el) {
    const lineas = lineasMovil(el);
    return lineas.length >= 2 && lineas.some(esLineaDePrecio);
  }

  /* Lee el texto de una tarjeta SIN usar innerText.

     innerText obliga al navegador a recalcular el layout de la pagina entera
     para saber que se ve y que no. Con miles de resultados en pantalla eso
     cuesta milisegundos por tarjeta, y hay que leer cientos por pasada: medido,
     1130 ms por pasada con 4000 avisos. Recorrer los nodos de texto da lo mismo
     y no toca el layout.

     De paso resuelve otra cosa: innerText devuelve vacio en un elemento
     escondido, asi que una tarjeta ya filtrada no se podia releer. Asi si. */
  /* Un elemento es un "bloque de texto" si su contenido no tiene mas de un
     nivel de anidado con texto. Sirve para agarrar el titulo entero cuando
     Facebook le mete un span adentro -por ejemplo resaltando lo que buscaste-:
        <span>Audi A5 <span>Coupe</span> 2012</span>
     Tomando solo las hojas quedaba "Coupe" y se perdia el resto del titulo,
     que es lo que hacia ilegibles a la mayoria de las tarjetas. */
  function esBloqueDeTexto(el) {
    for (const hijo of el.children) {
      for (const nieto of hijo.children) {
        if ((nieto.textContent || '').trim()) return false;
      }
    }
    return true;
  }

  /* TODO el texto de la tarjeta, sin importar como este armada por dentro.

     Este es el dato con el que se filtra. Buscar el titulo "limpio" dentro de
     la estructura de Facebook resulto imposible de sostener: cada vez que se
     acierta una forma aparece otra con un anidado distinto, y cuando falla se
     pierde la publicacion entera. Para saber si un aviso es un Audi A5 no hace
     falta aislar el titulo: alcanza con que el modelo aparezca en el texto.

     Se juntan todos los nodos de texto del enlace, que es la tarjeta completa,
     mas la etiqueta de accesibilidad y el alt de la foto. Si el dato esta en
     alguna parte, aca esta. */
  function textoCompletoDe(link, caja) {
    const partes = [];
    const paso = document.createTreeWalker(link || caja, NodeFilter.SHOW_TEXT);
    let nodo;
    while ((nodo = paso.nextNode())) {
      const t = (nodo.nodeValue || '').trim();
      if (t) partes.push(t);
    }
    if (link) {
      const aria = link.getAttribute('aria-label');
      const tit = link.getAttribute('title');
      if (aria) partes.push(aria);
      if (tit) partes.push(tit);
    }
    const img = (caja || link).querySelector('img[alt]');
    if (img) {
      const alt = img.getAttribute('alt');
      if (alt) partes.push(alt);
    }
    return partes.join(' \u00b7 ');
  }

  function lineasDe(caja) {
    /* Se recorre de afuera hacia adentro y se corta en el primer bloque de
       texto: asi cada linea sale entera. No se usa innerText porque obliga a
       recalcular el layout de toda la pagina y con miles de resultados eso
       hace que todo se arrastre. */
    const out = [];
    const visitar = (el) => {
      if ((el.textContent || '').trim() === '') return;
      if (esBloqueDeTexto(el)) {
        const t = (el.textContent || '').trim();
        if (t) out.push(t);
        return;
      }
      for (const hijo of el.children) visitar(hijo);
    };
    for (const hijo of caja.children) visitar(hijo);
    return out;
  }

  /* Vuelca la forma de una tarjeta sin las clases ofuscadas de Facebook, para
     poder ver por que no se pudo leer sin tener que mandar medio documento. */
  function estructuraDe(caja, nivel) {
    const sangria = '  '.repeat(nivel || 0);
    const lineas = [];
    for (const hijo of caja.children) {
      const etiqueta = hijo.tagName.toLowerCase();
      const alt = hijo.getAttribute && hijo.getAttribute('alt');
      const aria = hijo.getAttribute && hijo.getAttribute('aria-label');
      const tit = hijo.getAttribute && hijo.getAttribute('title');
      const propio = Array.from(hijo.childNodes)
        .filter((n) => n.nodeType === 3 && (n.nodeValue || '').trim())
        .map((n) => n.nodeValue.trim()).join(' ');
      let linea = sangria + etiqueta;
      if (alt) linea += ' alt=' + JSON.stringify(alt.slice(0, 120));
      if (aria) linea += ' aria-label=' + JSON.stringify(aria.slice(0, 160));
      if (tit) linea += ' title=' + JSON.stringify(tit.slice(0, 120));
      if (propio) linea += ' "' + propio.slice(0, 120) + '"';
      lineas.push(linea);
      if (hijo.children.length && (nivel || 0) < 14) {
        lineas.push(estructuraDe(hijo, (nivel || 0) + 1));
      }
    }
    return lineas.filter(Boolean).join('\n');
  }

  /* Facebook pone el titulo completo en el aria-label del enlace (el texto que
     leen los lectores de pantalla) y ademas lo dibuja en la tarjeta. Pero el
     texto visible lo dibuja recien cuando la tarjeta esta por entrar en
     pantalla: hasta entonces la tarjeta solo tiene el precio y la zona, y el
     titulo parece no existir. El aria-label, en cambio, esta siempre.

     Suele venir con el precio y la zona adentro, asi que se limpian. */
  function tituloDesdeEtiqueta(texto) {
    let t = String(texto || '').trim();
    if (!t) return '';
    /* La etiqueta viene como:
         "Audi A5 Coupe 2012, $18.000, Lanus Este, BA, publicacion 8692192..."
         "Audi A5 Sportback, reducido de Ciudad de Buenos Aires, CF, public..."
       Todo lo que va del precio en adelante es data de Facebook, no titulo. */
    t = t.replace(/,?\s*publicaci[o\u00f3]n\s+\d+\s*$/i, '');
    t = t.replace(/,?\s*reducido de\s.*$/i, '');
    // El patron de precios trae alternativas con |, asi que hay que agruparlo:
    // si no, el .* final solo aplica a la ultima y el resto queda sin borrar.
    t = t.replace(new RegExp('[,\\s]*(?:' + RE_PRECIO_CAPTURA.source + ').*$', 'i'), '');
    t = t.replace(/\s{2,}/g, ' ');
    t = t.replace(/^[\s,;:.\u00b7\u2022|-]+|[\s,;:.\u00b7\u2022|-]+$/g, '');
    return t.trim();
  }

  /* Facebook arma el alt de la foto como "Titulo en Ciudad, Provincia".
     Hay que separarlos: si no, la zona queda pegada al titulo y ensucia todo. */
  const RE_TITULO_CON_ZONA = /^(.{3,}?)\s+en\s+([^,]{2,40}(?:,\s*[^,]{2,40})?)$/i;

  function partirTituloYZona(texto) {
    const t = String(texto || '').trim();
    const m = t.match(RE_TITULO_CON_ZONA);
    if (!m) return { titulo: t, zona: '' };
    return { titulo: m[1].trim(), zona: m[2].trim() };
  }

  /* Una linea que arranca con "en " es un pedazo de zona, no un titulo. */
  function pareceZonaSuelta(linea) {
    return /^en\s+\S/i.test(String(linea || '').trim());
  }

  function idDesdeUrl(href) {
    const h = String(href || '');
    const m = h.match(/\/marketplace\/item\/(\d+)/) || h.match(/\/item\/(\d+)/);
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
  /* El resultado se recuerda por tarjeta. Sin esto hay que subir por el arbol
     preguntando en cada nivel cuantas publicaciones cuelgan de ahi, y con miles
     de resultados en pantalla eso escanea el documento entero una vez por
     tarjeta: medido, 2,4 segundos por pasada con 3000 avisos. Como la pasada se
     repite con cada cambio del DOM, la pagina se arrastra y el barrido se
     siente lento aunque el scroll no tenga nada que ver. */
  const cajaDe = new WeakMap();

  function contenedorTarjeta(link) {
    if (esVersionMovil()) return link;   // la tarjeta ya es el contenedor
    const recordado = cajaDe.get(link);
    if (recordado && recordado.isConnected) return recordado;

    let el = link;
    let saltos = 0;
    while (el.parentElement && el.parentElement !== document.body && saltos < 12) {
      const padre = el.parentElement;

      /* Se llego a la celda cuando el padre tiene varias y alguna vecina
         tambien es una publicacion. Antes esto se resolvia preguntandole al
         padre cuantas publicaciones tenia adentro, pero el ultimo padre es la
         grilla entera: con miles de resultados eso escanea todo el documento
         una vez por tarjeta. Mirar a los dos vecinos cuesta lo mismo tenga la
         grilla diez avisos o diez mil. */
      if (padre.childElementCount > 1) {
        const previo = el.previousElementSibling;
        const siguiente = el.nextElementSibling;
        if ((previo && previo.querySelector(SELECTOR_ITEM)) ||
            (siguiente && siguiente.querySelector(SELECTOR_ITEM)) ||
            padre.childElementCount > 3) {
          cajaDe.set(link, el);
          return el;
        }
      }
      el = padre;
      saltos++;
    }
    cajaDe.set(link, el);
    return el;
  }

  /* El texto de la tarjeta viene en lineas sueltas y en orden variable.
     Se clasifica cada linea por lo que parece, no por su posicion. */
  /* Detectar "la linea del precio" no alcanza con buscar un signo $: un titulo
     como "Audi A5 u$s 19.500 titular" tambien lo tiene, y si se lo toma como
     precio se pierde el titulo. Por eso se mide cuanto de la linea ocupa el
     monto: si es casi toda la linea, es el precio; si es una parte chica de un
     texto largo, es un titulo que menciona el precio. */
  const RE_PRECIO_CAPTURA = /(?:u\$s|us\$|usd|ars|\$)\s*\d[\d.,]*\s*(?:k\b|mil\b|palos?|millones?|lucas?)?|\d[\d.,]*\s*(?:d[oó]lares?|usd|u\$s|palos?|millones?|melones?|lucas?|k\b|mil\b)/i;

  const RE_PRECIO_TODOS = new RegExp(RE_PRECIO_CAPTURA.source, 'gi');

  function preciosEn(texto) {
    return String(texto || '').match(RE_PRECIO_TODOS) || [];
  }

  function esLineaDePrecio(linea) {
    const l = String(linea || '').trim();
    if (!l) return false;
    if (/^\d[\d.,]*$/.test(l)) return true;   // solo el numero: precio abreviado
    const encontrados = preciosEn(l);
    if (!encontrados.length) return false;
    /* Se suman todos: "$11.000 $13.000" (precio nuevo y precio viejo tachado)
       es una linea de precio, aunque ningun monto por separado llegue al 60%. */
    const cubierto = encontrados.reduce((a, m) => a + m.trim().length, 0);
    return cubierto / l.length >= 0.6;
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
  /* Etiquetas que Facebook pega en las tarjetas y que no son el titulo. Si no
     se filtran, una tarjeta cuyo unico texto sea "Recien publicado" termina con
     ese cartel como titulo, y por supuesto no contiene el modelo buscado. */
  const RE_RUIDO = new RegExp('^(' + [
    'nuevo', 'usado', 'gratis', 'cerca', 'reservado', 'vendido', 'pausado',
    'ver m[aá]s', 'patrocinado', 'sponsored',
    'patrocinado por el vendedor',
    'reci[eé]n publicad[oa]', 'publicado hace .*', 'listado hace .*',
    'env[ií]o disponible', 'se puede enviar', 'entrega a domicilio',
    'disponible', 'en stock', 'destacado'
  ].join('|') + ')$', 'i');

  /* Lectura de una tarjeta de la version movil. Los textos vienen limpios y
     separados, asi que no hace falta adivinar nada: el precio es la linea que
     parece precio, la zona la que se reconoce como zona, y el titulo el resto. */
  function extraerDeTarjetaMovil(caja) {
    const lineas = lineasMovil(caja);
    if (!lineas.length) return null;

    let precioTexto = '';
    let precioAnteriorTexto = '';
    const otras = [];
    for (const linea of lineas) {
      if (esLineaDePrecio(linea)) {
        if (!precioTexto) precioTexto = linea;
        else if (!precioAnteriorTexto) precioAnteriorTexto = linea;
        continue;
      }
      if (RE_RUIDO.test(linea)) continue;
      otras.push(linea);
    }

    let ubicacion = '';
    for (let i = otras.length - 1; i >= 0; i--) {
      const limpia = limpiarUbicacion(otras[i]);
      if (limpia && MPF.zonas && MPF.zonas.detectarProvincia(limpia)) {
        ubicacion = limpia;
        otras.splice(i, 1);
        break;
      }
    }
    if (!ubicacion && otras.length > 1) ubicacion = limpiarUbicacion(otras.pop());

    // El titulo es el texto mas descriptivo de los que quedan.
    const titulo = otras.reduce((a, b) => (b.length > a.length ? b : a), '');
    const km = extraerKm(lineas.join(' '));
    const mAnio = String(titulo).match(RE_ANIO);
    const img = caja.querySelector('img');

    // Si el segundo monto es mas alto, es el precio viejo tachado.
    if (precioAnteriorTexto) {
      const actual = MPF.precio.parsearPrecio(precioTexto);
      const otro = MPF.precio.parsearPrecio(precioAnteriorTexto);
      if (!(actual.valor != null && otro.valor != null && otro.valor > actual.valor)) {
        precioAnteriorTexto = '';
      }
    }

    return {
      id: idSintetico(titulo, ubicacion),
      titulo,
      tituloDudoso: !titulo,
      textoBusqueda: lineas.join(' \u00b7 '),
      precioTexto,
      precioAnteriorTexto,
      ubicacion,
      km,
      anio: mAnio ? Number(mAnio[1]) : null,
      provincia: MPF.zonas ? MPF.zonas.detectarProvincia(ubicacion) : null,
      url: '',            // la version movil no expone el enlace de la publicacion
      imagen: img ? img.getAttribute('src') || '' : '',
      _nodo: caja,
      _link: caja
    };
  }

  function extraerDeTarjeta(link) {
    if (esVersionMovil()) {
      return esTarjetaMovil(link) ? extraerDeTarjetaMovil(link) : null;
    }

    const id = idDesdeUrl(link.getAttribute('href') || '');
    if (!id) return null;

    const caja = contenedorTarjeta(link);
    const crudo = lineasDe(caja);

    // El alt de la imagen suele traer el titulo completo sin recortar.
    const img = caja.querySelector('img[alt]');
    const altImagen = img ? (img.getAttribute('alt') || '').trim() : '';

    /* La etiqueta de accesibilidad del enlace es la fuente mas confiable de
       todas: esta aunque la tarjeta todavia no se haya dibujado. */
    const etiquetaLink = tituloDesdeEtiqueta(
      link.getAttribute('aria-label') || link.getAttribute('title') || '');

    let lineaPrecio = '';
    let lineaPrecioExtra = '';
    const candidatosTitulo = [];
    const candidatosZona = [];
    for (const linea of crudo) {
      if (esLineaDePrecio(linea)) {
        /* Cuando el vendedor baja el precio, Facebook muestra el viejo tachado.
           Puede venir en la misma linea o en la de abajo; las dos se guardan. */
        if (!lineaPrecio) lineaPrecio = linea;
        else if (!lineaPrecioExtra) lineaPrecioExtra = linea;
        continue;
      }
      if (RE_RUIDO.test(linea)) continue;
      /* Una linea con separador ("Usado · Olivos, BA") o que arranca con
         "en " es la fila de estado y zona, nunca el titulo. */
      if (RE_SEPARADOR.test(linea) || pareceZonaSuelta(linea)) candidatosZona.push(linea);
      else candidatosTitulo.push(linea);
    }

    /* Orden de confianza para el titulo: la etiqueta del enlace, despues el
       alt de la foto, y por ultimo el texto de la tarjeta. */
    const delEtiqueta = partirTituloYZona(etiquetaLink);
    const delAlt = partirTituloYZona(altImagen);
    let titulo = '';
    let zonaDelAlt = delEtiqueta.zona || delAlt.zona;

    if (delEtiqueta.titulo && !esLineaDePrecio(delEtiqueta.titulo) &&
        !pareceZonaSuelta(delEtiqueta.titulo) && !RE_RUIDO.test(delEtiqueta.titulo)) {
      titulo = delEtiqueta.titulo;
    }

    /* Ojo: a veces el alt trae SOLO la zona ("en Villa Gobernador Udaondo,
       BA"). Eso no es un titulo, y tomarlo como tal hacia que la publicacion
       se descartara por no contener el modelo. */
    if (!titulo && delAlt.titulo && !esLineaDePrecio(delAlt.titulo) &&
        !pareceZonaSuelta(delAlt.titulo) && !RE_RUIDO.test(delAlt.titulo)) {
      titulo = delAlt.titulo;
    } else if (pareceZonaSuelta(altImagen) && !zonaDelAlt) {
      zonaDelAlt = altImagen.replace(/^en\s+/i, '').trim();
    }
    /* Si el unico candidato a titulo es reconocible como una zona y no tiene
       ningun numero, es la zona: Facebook todavia no dibujo el titulo. Un
       titulo de auto casi siempre trae un anio, una cilindrada o una version;
       "Moreno, BA" no trae nada de eso. */
    if (!titulo && candidatosTitulo.length === 1 &&
        !/\d/.test(candidatosTitulo[0]) &&
        MPF.zonas && MPF.zonas.detectarProvincia(candidatosTitulo[0])) {
      candidatosZona.push(candidatosTitulo.pop());
    }

    // Si no hubo alt, se usa el candidato mas descriptivo del texto.
    const mejorLinea = candidatosTitulo.reduce((a, b) => (b.length > a.length ? b : a), '');
    if (!titulo || mejorLinea.length > titulo.length + 4) {
      const partido = partirTituloYZona(mejorLinea);
      if (partido.titulo.length > titulo.length) {
        titulo = partido.titulo;
        if (!zonaDelAlt) zonaDelAlt = partido.zona;
      }
    }

    let ubicacion = zonaDelAlt;
    if (!ubicacion) {
      for (const linea of candidatosZona.concat(candidatosTitulo).reverse()) {
        if (linea === titulo) continue;
        const limpia = limpiarUbicacion(linea.replace(/^en\s+/i, ''));
        if (limpia && limpia.length <= 70) { ubicacion = limpia; break; }
      }
    }

    /* La etiqueta de accesibilidad suele terminar con la zona separada por
       coma ("Audi A5 Coupe 2012, Lanus Este, BA"). Si el titulo termina justo
       con la zona que detectamos, se la saca. */
    if (ubicacion && titulo) {
      const sinZona = titulo.replace(
        new RegExp('[\\s,;:\u00b7\u2022|-]+' + MPF.escaparRegex(ubicacion) + '$', 'i'), '');
      if (sinZona.trim().length >= 3) titulo = sinZona.trim();
    }

    /* De los montos que trae la tarjeta, el primero es el precio actual. Si hay
       un segundo y es MAS ALTO, es el precio viejo tachado: el aviso bajo de
       precio, y eso se sabe sin esperar a tener historial propio. */
    const montos = preciosEn(lineaPrecio).concat(preciosEn(lineaPrecioExtra));
    const precioTexto = montos[0] || lineaPrecio;
    let precioAnteriorTexto = '';
    if (montos.length > 1) {
      const actual = MPF.precio.parsearPrecio(montos[0]);
      const otro = MPF.precio.parsearPrecio(montos[1]);
      if (actual.valor != null && otro.valor != null && otro.valor > actual.valor) {
        precioAnteriorTexto = montos[1];
      }
    }

    /* El texto completo es lo que se usa para filtrar; el titulo, solo para
       mostrar. Asi un titulo mal aislado deja de costar la publicacion. */
    const textoBusqueda = textoCompletoDe(link, caja);

    const mAnio = String(titulo || textoBusqueda).match(RE_ANIO);

    /* Si no se pudo sacar un titulo de verdad, se dice. Quien filtre despues
       tiene que saber que no puede confiar en este dato. */
    const tituloDudoso = !titulo || pareceZonaSuelta(titulo) ||
                         normalizar(titulo) === normalizar(ubicacion);

    /* Una tarjeta sin NADA de texto todavia no termino de dibujarse: se
       devuelve null para volver a leerla despues. Pero si trajo zona o precio,
       aunque el titulo sea ilegible, ya es una publicacion de verdad y hay que
       tenerla en cuenta. */
    if (!titulo && !ubicacion && !lineaPrecio) return null;

    return {
      id,
      titulo: tituloDudoso ? '' : titulo,
      tituloDudoso,
      textoBusqueda,
      precioTexto,
      precioAnteriorTexto,
      ubicacion,
      km: extraerKm(crudo.join(' ')),
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
  /* Cuantas pasadas se espera antes de empezar a mostrar una tarjeta sin
     titulo. No es un limite para dejar de mirarla: la que sigue sin titulo se
     relee en cada pasada, para siempre (ver aplicarFiltros). Esto solo evita
     que aparezca y desaparezca en el primer segundo. */
  const MAX_REINTENTOS = 3;

  function convieneReintentar(link, datos) {
    if (!datos || !datos.tituloDudoso) return false;
    const n = Number(link.getAttribute('data-mpf-intentos') || 0) + 1;
    link.setAttribute('data-mpf-intentos', String(n));
    return n < MAX_REINTENTOS;
  }

  function leerNuevas() {
    const encontradas = [];
    const links = document.querySelectorAll(selectorItem() + ':not([data-mpf-leido])');
    for (const link of links) {
      const datos = extraerDeTarjeta(link);
      if (!datos) continue;                          // todavia no se dibujo nada
      if (convieneReintentar(link, datos)) continue;  // sin titulo aun
      link.setAttribute('data-mpf-leido', '1');
      encontradas.push(datos);
    }
    return encontradas;
  }

  /* Vuelve a listar TODAS las tarjetas presentes, esten visibles o escondidas. */
  function leerTodas() {
    const out = [];
    for (const link of document.querySelectorAll(selectorItem())) {
      const datos = extraerDeTarjeta(link);
      if (datos) out.push(datos);
    }
    return out;
  }

  function cantidadEnPantalla() {
    return document.querySelectorAll(selectorItem()).length;
  }

  MPF.scraper = { leerNuevas, leerTodas, extraerDeTarjeta, esLineaDePrecio, preciosEn, lineasDe,
                  esVersionMovil, selectorItem, SELECTOR_MOVIL, lineasMovil,
                  textoCompletoDe,
                  tituloDesdeEtiqueta,
                  estructuraDe, esBloqueDeTexto,
                  MAX_REINTENTOS, convieneReintentar,
                  partirTituloYZona, pareceZonaSuelta,
                  limpiarUbicacion, extraerKm, cantidadEnPantalla, contenedorTarjeta,
                  SELECTOR_ITEM };
})();
