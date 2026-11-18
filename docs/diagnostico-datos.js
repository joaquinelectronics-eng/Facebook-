/* Diagnostico: ¿los DATOS que Facebook le manda a la pagina traen todo?

   Hasta ahora la extension lee la PANTALLA: lo que Facebook dibuja. Y ahi
   faltan cosas: en celular no hay enlace, en escritorio faltan titulos de lo
   que no se dibujo. Pero antes de dibujar, Facebook le manda a la pagina los
   datos de cada publicacion. Si ahi vienen numero, titulo, precio y zona,
   alcanza con leer eso: sin entrar a ninguna publicacion y sin tocar nada.

   Como se usa:
     1. Abri una busqueda de Marketplace y RECARGA la pagina (F5).
     2. F12 -> pestania Console. Pega todo esto y Enter.
     3. Baja a mano, despacio, unas 4 o 5 pantallas.
     4. Escribi   mpfDatos()   y Enter.
     5. Manda lo que aparece (queda copiado solo, si Chrome lo deja).

   No pide nada a Facebook ni manda nada a ningun lado: mira lo que ya llega. */
(() => {
  if (window.__mpfDiag) { console.log('Ya estaba puesto. Baja un poco y escribi mpfDatos()'); return; }
  const D = (window.__mpfDiag = { capturas: [], errores: 0, desde: Date.now() });

  const anotar = (via, url, texto) => {
    if (typeof texto === 'string' && texto.length > 200) {
      D.capturas.push({ via, url: String(url || '').split('?')[0].slice(-60), texto });
    }
  };

  /* Se escucha lo que llega por las dos vias que usa una pagina. Solo se lee
     una copia: lo que recibe Facebook no cambia en nada. */
  const fetch0 = window.fetch;
  window.fetch = function (...args) {
    const p = fetch0.apply(this, args);
    p.then((r) => { r.clone().text().then((t) => anotar('fetch', r.url, t), () => {}); }, () => {});
    return p;
  };
  const open0 = XMLHttpRequest.prototype.open;
  const send0 = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url, ...resto) {
    this.__mpfUrl = url;
    return open0.call(this, m, url, ...resto);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        if (this.responseType === '' || this.responseType === 'text') anotar('xhr', this.__mpfUrl, this.responseText);
        else if (this.responseType === 'json') anotar('xhr', this.__mpfUrl, JSON.stringify(this.response));
      } catch (e) { D.errores++; }
    });
    return send0.apply(this, args);
  };

  /* Facebook manda varios JSON pegados, a veces con "for (;;);" adelante. */
  function partes(texto) {
    const out = [];
    const t = texto.replace(/^for \(;;\);/, '');
    try { out.push(JSON.parse(t)); return out; } catch (e) { /* sigue */ }
    for (const linea of t.split('\n')) {
      const l = linea.trim().replace(/^for \(;;\);/, '');
      if (l[0] !== '{' && l[0] !== '[') continue;
      try { out.push(JSON.parse(l)); } catch (e) { /* no era JSON */ }
    }
    return out;
  }

  /* Una publicacion es cualquier objeto que tenga id y un titulo de
     publicacion, este donde este. No se depende del camino exacto, que es lo
     que Facebook cambia. */
  function recorrer(nodo, enc, prof) {
    if (!nodo || typeof nodo !== 'object' || prof > 60) return;
    if (Array.isArray(nodo)) { for (const x of nodo) recorrer(x, enc, prof + 1); return; }
    const claves = Object.keys(nodo);
    const kTit = claves.find((k) => /listing_title$/.test(k) && typeof nodo[k] === 'string');
    if (kTit && (typeof nodo.id === 'string' || typeof nodo.id === 'number')) enc.push(nodo);
    for (const k of claves) recorrer(nodo[k], enc, prof + 1);
  }

  const buscarClave = (obj, re, prof = 0) => {
    if (!obj || typeof obj !== 'object' || prof > 6) return undefined;
    for (const k of Object.keys(obj)) {
      if (re.test(k) && obj[k] != null && typeof obj[k] !== 'object') return obj[k];
    }
    for (const k of Object.keys(obj)) {
      const v = buscarClave(obj[k], re, prof + 1);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  function resumir(o) {
    const precio = o.listing_price || {};
    const geo = (o.location && o.location.reverse_geocode) || {};
    const tach = o.strikethrough_price || {};
    return {
      id: String(o.id),
      titulo: o.marketplace_listing_title || o[Object.keys(o).find((k) => /listing_title$/.test(k))],
      precio: precio.formatted_amount || precio.amount || buscarClave(o, /formatted_amount|^amount$/),
      tachado: tach.formatted_amount || '',
      zona: [geo.city, geo.state].filter(Boolean).join(', '),
      fecha: buscarClave(o, /creation_time|created_time|creation_timestamp/),
      vendido: o.is_sold, pendiente: o.is_pending
    };
  }

  /* Textos con pinta de titulo que hay en la pantalla: para ver si los datos
     traen los MISMOS autos que se ven, y no otra cosa. */
  function titulosEnPantalla() {
    const vistos = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = n.nodeValue.trim();
      if (t.length < 8 || t.length > 120) continue;
      if (/^[$u]|^\d|km$|hace |·/i.test(t)) continue;
      if (!/\d{4}|\b(audi|vw|volkswagen|ford|fiat|chevrolet|peugeot|renault|toyota|honda|bmw|mercedes|citro|nissan|jeep|kia|hyundai)\b/i.test(t)) continue;
      vistos.add(t);
    }
    return Array.from(vistos);
  }

  window.mpfDatos = function () {
    const out = [];
    const di = (s) => out.push(s);
    const fuentes = D.capturas.slice();
    for (const s of document.querySelectorAll('script')) {
      const t = s.textContent || '';
      if (t.length > 200 && /listing|marketplace/i.test(t)) fuentes.push({ via: 'pagina', url: s.type || 'script', texto: t });
    }

    di('== diagnostico de datos ==');
    di('direccion: ' + location.href.split('?')[0]);
    di('pantalla: ' + innerWidth + 'px de ancho' + (document.querySelector('[data-mcomponent]') ? ' (version de celular)' : ''));
    di('segundos escuchando: ' + Math.round((Date.now() - D.desde) / 1000));
    di('respuestas escuchadas: ' + D.capturas.length +
       ' (fetch ' + D.capturas.filter((c) => c.via === 'fetch').length +
       ', xhr ' + D.capturas.filter((c) => c.via === 'xhr').length + ')  errores: ' + D.errores);

    const porId = new Map();
    const porFuente = [];
    let crudas = 0;
    for (const f of fuentes) {
      const enc = [];
      for (const p of partes(f.texto)) recorrer(p, enc, 0);
      crudas += (f.texto.match(/marketplace_listing_title/g) || []).length;
      if (enc.length) porFuente.push(f.via + ' ' + f.url + ': ' + enc.length);
      for (const o of enc) if (!porId.has(String(o.id))) porId.set(String(o.id), o);
    }
    di('veces que aparece "marketplace_listing_title" en crudo: ' + crudas);
    di('PUBLICACIONES DISTINTAS EN LOS DATOS: ' + porId.size);
    for (const s of porFuente.slice(0, 12)) di('   ' + s);

    const enlacesDom = new Set(Array.from(document.querySelectorAll('a[href*="/marketplace/item/"]'))
      .map((a) => (a.getAttribute('href').match(/item\/(\d+)/) || [])[1]).filter(Boolean));
    if (enlacesDom.size) {
      const tambien = Array.from(enlacesDom).filter((id) => porId.has(id)).length;
      di('enlaces en pantalla: ' + enlacesDom.size + ', de esos estan en los datos: ' + tambien);
    }

    const lista = Array.from(porId.values()).map(resumir);
    const sinTitulo = lista.filter((x) => !x.titulo).length;
    di('en los datos, sin titulo: ' + sinTitulo + '   con fecha: ' + lista.filter((x) => x.fecha).length +
       '   con zona: ' + lista.filter((x) => x.zona).length + '   con precio tachado: ' + lista.filter((x) => x.tachado).length);

    const enPantalla = titulosEnPantalla();
    const titulosDatos = new Set(lista.map((x) => String(x.titulo || '').trim()));
    const crudo = fuentes.map((f) => f.texto).join('\n');
    const coinciden = enPantalla.filter((t) => titulosDatos.has(t)).length;
    const aparecenCrudo = enPantalla.filter((t) => crudo.includes(t) || crudo.includes(JSON.stringify(t).slice(1, -1))).length;
    di('titulos de auto en pantalla: ' + enPantalla.length + ', estan en los datos: ' + coinciden +
       ', aparecen en crudo: ' + aparecenCrudo);

    if (lista.length) {
      const primera = porId.values().next().value;
      di('campos de una publicacion: ' + Object.keys(primera).join(', '));
      di('--- primeras 15 ---');
      for (const x of lista.slice(0, 15)) {
        di(x.id + ' | ' + x.titulo + ' | ' + x.precio + (x.tachado ? ' (antes ' + x.tachado + ')' : '') +
           ' | ' + x.zona + (x.fecha ? ' | fecha ' + x.fecha : '') + (x.vendido ? ' | VENDIDO' : ''));
      }
    } else if (enPantalla.length) {
      /* Formato desconocido: se busca un titulo de la pantalla en crudo y se
         muestra que hay alrededor, para ver si el numero esta cerca. */
      const t = enPantalla.find((x) => crudo.includes(x));
      if (t) {
        const i = crudo.indexOf(t);
        di('--- alrededor de "' + t + '" en los datos ---');
        di(crudo.slice(Math.max(0, i - 600), i + 600).replace(/\s+/g, ' '));
        const nums = (crudo.slice(Math.max(0, i - 3000), i + 3000).match(/\b\d{15,17}\b/g) || []);
        di('numeros largos cerca: ' + Array.from(new Set(nums)).slice(0, 10).join(' '));
      } else {
        di('Ningun titulo de la pantalla aparece en los datos escuchados.');
        di('primeros titulos en pantalla: ' + enPantalla.slice(0, 5).join(' / '));
      }
    }

    const texto = out.join('\n');
    console.log(texto);
    try { if (typeof copy === 'function') { copy(texto); console.log('(copiado: pegalo directo)'); } } catch (e) { /* sin copiar */ }
    return '';
  };

  console.log('Listo. Ahora baja a mano 4 o 5 pantallas y despues escribi:  mpfDatos()');
})();
