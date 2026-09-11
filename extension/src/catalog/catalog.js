/* Explorador del catalogo historico.

   Aca esta el valor real de la herramienta: Facebook ordena por lo que a el le
   conviene mostrar, pero tu base local recuerda TODO lo que viste alguna vez.
   Por eso se puede ordenar por "mas viejas primero", que es exactamente donde
   estan las publicaciones enterradas que nadie mira. */
(() => {
  const MPF = window.MPF;
  const $ = (id) => document.getElementById(id);

  let todos = [];
  const DIA = 86400000;

  function pedir(msg) {
    return new Promise((resolver) => {
      chrome.runtime.sendMessage(msg, (r) => resolver(chrome.runtime.lastError ? null : r));
    });
  }

  function fecha(ms) {
    if (!ms) return '?';
    return new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' });
  }

  function diasDesde(ms) {
    return ms ? Math.floor((Date.now() - ms) / DIA) : 0;
  }

  /* Un item "bajo de precio" si el ultimo valor del historial es menor que el
     maximo que llego a tener. */
  function bajaDePrecio(item) {
    const h = Array.isArray(item.historial) ? item.historial : [];
    if (h.length < 2) return null;
    const maximo = Math.max(...h.map((x) => x.precioUSD || 0));
    const ultimo = h[h.length - 1].precioUSD || 0;
    if (!maximo || ultimo >= maximo) return null;
    return { desde: maximo, hasta: ultimo, pct: Math.round((1 - ultimo / maximo) * 100) };
  }

  function filtrarYOrdenar() {
    const filtro = MPF.matcher.compilar($('consulta').value);
    const pmin = $('pmin').value === '' ? null : Number($('pmin').value);
    const pmax = $('pmax').value === '' ? null : Number($('pmax').value);
    const soloBajadas = $('soloBajadas').checked;
    const zona = $('zona').value;

    let lista = todos.filter((it) => {
      if (!filtro.vacia && !filtro.evaluar(it.titulo).coincide) return false;
      const p = it.precioUSD;
      if (pmin != null && (p == null || p < pmin)) return false;
      if (pmax != null && (p == null || p > pmax)) return false;
      if (soloBajadas && !bajaDePrecio(it)) return false;
      if (zona) {
        const prov = it.provincia || MPF.zonas.detectarProvincia(it.ubicacion);
        if (prov !== zona) return false;
      }
      return true;
    });

    const orden = $('orden').value;
    const cmp = {
      viejas: (a, b) => (a.vistoPrimera || 0) - (b.vistoPrimera || 0),
      nuevas: (a, b) => (b.vistoUltima || 0) - (a.vistoUltima || 0),
      descubiertas: (a, b) => (b.vistoPrimera || 0) - (a.vistoPrimera || 0),
      baratas: (a, b) => (a.precioUSD ?? Infinity) - (b.precioUSD ?? Infinity),
      caras: (a, b) => (b.precioUSD ?? -Infinity) - (a.precioUSD ?? -Infinity),
      bajadas: (a, b) => ((bajaDePrecio(b) || {}).pct || 0) - ((bajaDePrecio(a) || {}).pct || 0)
    }[orden];
    if (cmp) lista.sort(cmp);
    return lista;
  }

  function tarjeta(it) {
    const el = document.createElement('article');
    el.className = 'tarjeta';

    const baja = bajaDePrecio(it);
    const dias = diasDesde(it.vistoPrimera);
    const etiquetas = [];
    if (baja) etiquetas.push('<span class="etiqueta baja">bajo ' + baja.pct + '%</span>');
    if (dias >= 30) etiquetas.push('<span class="etiqueta vieja">' + dias + ' dias en tu base</span>');
    if (it.anio) etiquetas.push('<span class="etiqueta">' + it.anio + '</span>');
    if (it.km) etiquetas.push('<span class="etiqueta">' + Math.round(it.km).toLocaleString('es-AR') + ' km</span>');
    const prov = it.provincia || MPF.zonas.detectarProvincia(it.ubicacion);
    if (prov) etiquetas.push('<span class="etiqueta">' + MPF.zonas.cortoDe(prov) + '</span>');

    /* Se avisa cuando el precio no vino limpio del campo de Facebook, para que
       sepas cual conviene verificar antes de escribirle al vendedor. */
    const avisos = [];
    if (it.confianzaMoneda === 'inferida') avisos.push('moneda deducida');
    if (it.precioAbreviado) avisos.push('estaba abreviado');
    const inferido = avisos.length
      ? ' <span class="inferido">(' + avisos.join(', ') + ')</span>' : '';
    const precio = it.precio != null
      ? MPF.precio.formatear(it.precio, it.moneda) + inferido
      : '<span style="color:#8a94a3;font-size:14px">sin precio</span>';

    const foto = it.imagen
      ? '<img class="foto" src="' + it.imagen + '" loading="lazy" alt="">'
      : '<div class="foto"></div>';

    el.innerHTML =
      foto +
      '<div class="info">' +
        '<div class="precio">' + precio + '</div>' +
        '<div class="tit"></div>' +
        '<div class="etiquetas">' + etiquetas.join('') + '</div>' +
        '<div class="meta">' + (it.ubicacion || 'sin zona') +
          ' &middot; visto por primera vez el ' + fecha(it.vistoPrimera) + '</div>' +
      '</div>' +
      '<a class="abrir" target="_blank" rel="noreferrer">Abrir en Facebook</a>';

    // El titulo se asigna como texto, nunca como HTML: viene de una pagina externa.
    el.querySelector('.tit').textContent = it.titulo || '';
    el.querySelector('a.abrir').href = it.url;
    return el;
  }

  function pintar() {
    const lista = filtrarYOrdenar();
    const grilla = $('grilla');
    grilla.textContent = '';

    const trozo = document.createDocumentFragment();
    for (const it of lista.slice(0, 600)) trozo.appendChild(tarjeta(it));
    grilla.appendChild(trozo);

    const conBaja = lista.filter(bajaDePrecio).length;
    $('resumen').textContent =
      lista.length.toLocaleString('es-AR') + ' de ' + todos.length.toLocaleString('es-AR') +
      ' publicaciones guardadas' +
      (conBaja ? ' · ' + conBaja + ' bajaron de precio' : '') +
      (lista.length > 600 ? ' · mostrando las primeras 600' : '');

    $('vacio').classList.toggle('oculto', todos.length > 0);
  }

  function aCSV(lista) {
    const cols = ['id', 'titulo', 'precio', 'moneda', 'precioUSD', 'anio', 'km',
                  'ubicacion', 'vistoPrimera', 'vistoUltima', 'veces', 'url'];
    const escapar = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const filas = [cols.join(',')];
    for (const it of lista) {
      filas.push(cols.map((c) => {
        if (c === 'vistoPrimera' || c === 'vistoUltima') {
          return escapar(it[c] ? new Date(it[c]).toISOString() : '');
        }
        return escapar(it[c]);
      }).join(','));
    }
    return '﻿' + filas.join('\r\n');   // BOM para que Excel respete los acentos
  }

  /* El selector se arma con las provincias que aparecen en el catalogo, no con
     las 24: no tiene sentido ofrecer una zona donde nunca miraste nada. */
  function poblarZonas() {
    const presentes = new Set();
    for (const it of todos) {
      const prov = it.provincia || MPF.zonas.detectarProvincia(it.ubicacion);
      if (prov) presentes.add(prov);
    }
    const sel = $('zona');
    const elegida = sel.value;
    sel.textContent = '';
    const todasOpt = document.createElement('option');
    todasOpt.value = '';
    todasOpt.textContent = 'Todas';
    sel.appendChild(todasOpt);
    for (const p of MPF.zonas.PROVINCIAS) {
      if (!presentes.has(p.id)) continue;
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.corto;
      sel.appendChild(o);
    }
    sel.value = elegida;
  }

  async function cargar() {
    const r = await pedir({ tipo: 'listar' });
    todos = (r && r.items) || [];
    poblarZonas();
    pintar();
  }

  for (const id of ['consulta', 'pmin', 'pmax', 'orden', 'soloBajadas', 'zona']) {
    const el = $(id);
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', pintar);
  }

  $('exportar').addEventListener('click', () => {
    const csv = aCSV(filtrarYOrdenar());
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'marketplace-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  $('vaciar').addEventListener('click', async () => {
    if (!confirm('Esto borra todo el catalogo guardado. No se puede deshacer.')) return;
    await pedir({ tipo: 'vaciar' });
    await cargar();
  });

  cargar();
})();
