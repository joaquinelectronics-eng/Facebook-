/* Las publicaciones que Facebook le MANDA a la pagina, antes de dibujarlas.

   La pantalla no alcanza: en el celular las tarjetas no son enlaces, y en
   escritorio las que todavia no se dibujaron no tienen titulo. Pero antes de
   dibujar, Facebook le pasa a la pagina los datos de cada publicacion. Medido
   en la pagina real, busqueda "audi a4" en escritorio bajando cinco pantallas:
   48 publicaciones en los datos, las 48 con numero, titulo, precio, zona y
   fecha, y los 48 enlaces que habia en pantalla estaban todos ahi.

   Llegan por dos lados: un <script type="application/json"> metido en la
   pagina (las primeras) y las respuestas de /api/graphql/ (las que se cargan
   al bajar). Este archivo solo sabe leer ese texto; quien lo junta es
   escucha.js, y quien lo guarda es content.js.

   Las publicaciones se buscan POR SU FORMA -un objeto con un id numerico y
   un *_listing_title- y no por el camino donde estan hoy
   (data.marketplace_search.feed_units.edges[n].node.listing). El camino es lo
   que Facebook cambia; lo que es una publicacion, no.

   En el celular esto no trae nada, y no es un error: medido, la version de
   celular recibe las tarjetas ya armadas como HTML por un WebSocket, sin el
   numero de la publicacion en ningun lado. */
(() => {
  const MPF = (window.MPF = window.MPF || {});

  const PROFUNDIDAD_MAXIMA = 60;
  const RE_TITULO = /listing_title$/;
  const RE_ID = /^\d{5,25}$/;

  function vacio(v) {
    return v == null || v === '';
  }

  function texto(v) {
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' && isFinite(v)) return String(v);
    return '';
  }

  /* Facebook manda varios JSON pegados, uno por renglon, y a veces con
     "for (;;);" adelante para que nadie lo pueda ejecutar como script. */
  function partes(crudo) {
    const out = [];
    if (typeof crudo !== 'string') return out;
    const t = crudo.replace(/^\s*for \(;;\);/, '');
    try { out.push(JSON.parse(t)); return out; } catch (e) { /* vienen varios */ }
    for (const renglon of t.split('\n')) {
      const r = renglon.trim().replace(/^for \(;;\);/, '');
      if (r[0] !== '{' && r[0] !== '[') continue;
      try { out.push(JSON.parse(r)); } catch (e) { /* no era JSON */ }
    }
    return out;
  }

  function claveDeTitulo(o) {
    for (const k of Object.keys(o)) {
      if (RE_TITULO.test(k) && typeof o[k] === 'string' && o[k].trim()) return k;
    }
    return null;
  }

  /* Un id que no es un numero no sirve: con el se arma el enlace, y un enlace
     a otra cosa es peor que no tener enlace. */
  function esPublicacion(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    const id = o.id;
    if (typeof id !== 'string' && typeof id !== 'number') return false;
    return RE_ID.test(String(id)) && claveDeTitulo(o) !== null;
  }

  function buscar(nodo, encontradas, prof) {
    if (!nodo || typeof nodo !== 'object' || prof > PROFUNDIDAD_MAXIMA) return;
    if (Array.isArray(nodo)) {
      for (const x of nodo) buscar(x, encontradas, prof + 1);
      return;
    }
    if (esPublicacion(nodo)) encontradas.push(nodo);
    for (const k of Object.keys(nodo)) {
      const v = nodo[k];
      if (v && typeof v === 'object') buscar(v, encontradas, prof + 1);
    }
  }

  /* La primera direccion de una foto que aparezca adentro, este como este
     anidada (image.uri, listing_image.uri...). */
  function uriDe(nodo, prof) {
    if (!nodo || typeof nodo !== 'object' || (prof || 0) > 4) return '';
    if (typeof nodo.uri === 'string' && /^https?:\/\//.test(nodo.uri)) return nodo.uri;
    for (const k of Object.keys(nodo)) {
      const u = uriDe(nodo[k], (prof || 0) + 1);
      if (u) return u;
    }
    return '';
  }

  function urlDePublicacion(id) {
    return 'https://www.facebook.com/marketplace/item/' + id + '/';
  }

  /* De la publicacion de Facebook, solo lo que la extension usa. */
  function resumir(o) {
    const id = String(o.id);
    const titulo = texto(o.marketplace_listing_title) || texto(o[claveDeTitulo(o)]);
    const precio = o.listing_price || {};
    const tachado = o.strikethrough_price || {};
    const geo = (o.location && o.location.reverse_geocode) || {};
    const subs = Array.isArray(o.custom_sub_titles_with_rendering_flags)
      ? o.custom_sub_titles_with_rendering_flags : [];
    return {
      id,
      titulo,
      precioTexto: texto(precio.formatted_amount),
      precioAnteriorTexto: texto(tachado.formatted_amount),
      ubicacion: [texto(geo.city), texto(geo.state)].filter(Boolean).join(', '),
      subtitulos: subs.map((s) => texto(s && s.subtitle)).filter(Boolean),
      imagen: uriDe(o.primary_listing_photo),
      creado: typeof o.creation_time === 'number' ? o.creation_time * 1000 : null,
      vendida: o.is_sold === true,
      url: urlDePublicacion(id)
    };
  }

  /* Junta dos lecturas de la misma publicacion: manda la primera, y la segunda
     solo llena lo que la primera trajo vacio. Un dato vacio nunca pisa uno
     lleno, la misma regla que usa el catalogo (lib/fusion.mjs). */
  function completar(manda, relleno) {
    const r = Object.assign({}, manda);
    for (const k of Object.keys(relleno || {})) {
      if (vacio(r[k]) || (Array.isArray(r[k]) && !r[k].length)) r[k] = relleno[k];
    }
    return r;
  }

  /* Todas las publicaciones distintas que hay en un texto: una respuesta de
     graphql o el contenido de un <script type="application/json">. */
  function publicacionesDe(crudo) {
    if (typeof crudo !== 'string' || crudo.indexOf('listing_title') < 0) return [];
    const encontradas = [];
    for (const p of partes(crudo)) buscar(p, encontradas, 0);
    const porId = new Map();
    for (const o of encontradas) {
      const r = resumir(o);
      if (!r.titulo) continue;
      const previa = porId.get(r.id);
      porId.set(r.id, previa ? completar(previa, r) : r);
    }
    return Array.from(porId.values());
  }

  MPF.datos = { partes, esPublicacion, resumir, completar, publicacionesDe, urlDePublicacion };
})();
