/* Explorador del catalogo historico.

   Aca esta el valor real de la herramienta: Facebook ordena por lo que a el le
   conviene mostrar, pero tu base local recuerda TODO lo que viste alguna vez.
   Por eso se puede ordenar por "mas viejas primero", que es exactamente donde
   estan las publicaciones enterradas que nadie mira. */
import { corridasPorDia } from '../lib/agenda.mjs';

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
    // Marca si la bajada la informo Facebook (precio tachado) o la vimos nosotros.
    const propia = h.some((x) => !x.segunFacebook && (x.precioUSD || 0) < maximo);
    return { desde: maximo, hasta: ultimo, propia,
             pct: Math.round((1 - ultimo / maximo) * 100) };
  }

  /* EMPAREJAR PARA CONSEGUIR EL ENLACE.

     Medido en la pagina de verdad: en la version de celular NO hay ni una sola
     direccion de publicacion. Ni en las tarjetas ni en el resto de la pagina:
     "direcciones de publicacion en toda la pagina: 0". Facebook resuelve el
     toque con su propio sistema y nunca escribe el enlace.

     Pero en la version de escritorio las tarjetas SI son enlaces con el numero
     de la publicacion; lo que les falta ahi es el titulo. O sea que cada lado
     tiene la mitad: el celular trae titulo, precio y zona; el escritorio trae
     enlace, precio y zona.

     Entonces se juntan por lo que los dos tienen: precio y zona. Solo se
     acepta cuando hay UNA sola candidata. Si dos publicaciones comparten
     precio y zona no se elige ninguna: mandarte al auto equivocado es peor que
     no mandarte a ninguno. */
  /* LA FOTO ES LA MEJOR LLAVE.

     Las fotos de Facebook tienen un nombre propio con el id adentro
     -"492118012_1234567890_..._n.jpg"- y ese nombre es el mismo se lea desde
     el celular o desde escritorio. Si dos publicaciones muestran la misma
     foto, son la misma publicacion. Es mucho mas firme que el precio, que se
     repite todo el tiempo.

     Se usa solo el nombre del archivo y no la direccion entera: el resto lleva
     fichas que cambian en cada carga y en cada version, asi que comparando la
     direccion completa no coincidiria nunca. */
  function claveDeFoto(it) {
    const src = String(it.imagen || '');
    if (!src || src.indexOf('data:') === 0) return '';
    let ruta = src;
    try { ruta = new URL(src, location.href).pathname; } catch (e) {}
    const nombre = ruta.split('/').filter(Boolean).pop() || '';
    // Tiene que parecer un nombre de foto de verdad, no un icono de la interfaz.
    if (nombre.length < 12 || !/\d{6,}/.test(nombre)) return '';
    return nombre;
  }

  function claveDePrecio(it) {
    return it.precioUSD != null ? String(Math.round(it.precioUSD)) : '';
  }

  /* El titulo cortado es un dato, no un estorbo. Facebook manda "VENDO Audi A4
     1.8T..." y lo que se ve es el PRINCIPIO del titulo de verdad, asi que si el
     candidato empieza igual, es el mismo auto. Cruzando solo por precio y zona
     no alcanzaba: seis A4 a US$ 9.000 en Buenos Aires empatan entre ellos y no
     se emparejaba ninguno. */
  function tituloParaCruce(it) {
    return MPF.normalizar(String(it.titulo || '').replace(/(?:\u2026|\.\.\.)\s*$/, '').trim());
  }

  function titulosCompatibles(a, b) {
    if (!a || !b) return true;    // si a uno le falta el titulo, no contradice
    return a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }

  /* precio -> las publicaciones con direccion que valen ese precio.
     foto   -> lo mismo, pero por nombre de foto. */
  let porPrecio = new Map();
  let porFoto = new Map();

  function armarCruce() {
    porPrecio = new Map();
    porFoto = new Map();
    for (const it of todos) {
      if (!it.url) continue;
      const p = claveDePrecio(it);
      if (p) {
        if (!porPrecio.has(p)) porPrecio.set(p, []);
        porPrecio.get(p).push(it);
      }
      const f = claveDeFoto(it);
      if (f) {
        if (!porFoto.has(f)) porFoto.set(f, []);
        porFoto.get(f).push(it);
      }
    }
  }

  /* Se busca de lo mas especifico a lo mas general, y solo se acepta cuando
     queda UNA sola candidata. Con dos, mandar al auto equivocado es peor que no
     mandar a ninguno. */
  /* CUAL LLAVE PUEDE VINCULAR.

     Para pegarle el enlace a una publicacion que no lo tiene hace falta una
     llave que exista de los DOS lados: en la que trae enlace y en la que no.
     Si las fotos que mandan las dos versiones son distintas, la foto no puede
     servir por mas vueltas que le demos, y hay que saberlo con un numero y no
     probando. Esto cuenta cuantas llaves de cada tipo aparecen en los dos
     lados a la vez. */
  /* Los numeros que trae el nombre de la foto. Las dos versiones pueden pedir
     la MISMA foto en otro tamanio, y ahi el archivo se llama distinto aunque
     los ids de adentro sean los mismos. Comparando el nombre entero eso no
     coincide nunca; comparando los numeros, si. */
  function idsDeFoto(it) {
    const n = claveDeFoto(it);
    if (!n) return '';
    const numeros = n.match(/\d{8,}/g);
    return numeros ? numeros.join('_') : '';
  }

  function claveZonaKm(it) {
    const precio = claveDePrecio(it);
    const zona = MPF.normalizar(it.ubicacion || '');
    if (!precio || !zona) return '';
    return precio + '|' + zona + '|' + (it.km != null ? it.km : '');
  }

  function claveZona(it) {
    const precio = claveDePrecio(it);
    const zona = MPF.normalizar(it.ubicacion || '');
    return precio && zona ? precio + '|' + zona : '';
  }

  /* CUAL LLAVE PUEDE VINCULAR.

     Para pegarle el enlace a una publicacion que no lo tiene hace falta un
     dato que aparezca de los DOS lados. Cual sirve no se puede razonar: hay
     que medirlo. Esto prueba varias a la vez y dice, de las que no tienen
     enlace, cuantas podrian conseguirlo con cada una. */
  function puentes() {
    const llaves = {
      foto: claveDeFoto,
      'foto-id': idsDeFoto,
      'precio+zona': claveZona,
      'precio+zona+km': claveZonaKm
    };
    const conEnlace = {};
    for (const nombre in llaves) conEnlace[nombre] = new Set();
    for (const it of todos) {
      if (!it.url) continue;
      for (const nombre in llaves) {
        const k = llaves[nombre](it);
        if (k) conEnlace[nombre].add(k);
      }
    }
    const alcance = {};
    for (const nombre in llaves) alcance[nombre] = 0;
    let sinEnlace = 0;
    for (const it of todos) {
      if (it.url) continue;
      sinEnlace++;
      for (const nombre in llaves) {
        const k = llaves[nombre](it);
        if (k && conEnlace[nombre].has(k)) alcance[nombre]++;
      }
    }
    return { alcance, sinEnlace };
  }

  function urlDe(it) {
    if (it.url) return { url: it.url, emparejada: false };

    /* Primero la foto, que es la llave mas firme. Igual se exige que quede una
       sola: un concesionario puede usar la misma foto -su cartel- en varias
       publicaciones, y ahi la foto no dice nada. */
    const foto = claveDeFoto(it);
    if (foto) {
      const mismas = porFoto.get(foto) || [];
      const direcciones = new Set(mismas.map((c) => c.url));
      if (direcciones.size === 1) {
        return { url: mismas[0].url, emparejada: true, porFoto: true };
      }
    }

    const k = claveDePrecio(it);
    if (!k) return { url: '', emparejada: false };

    const mismoPrecio = porPrecio.get(k) || [];
    if (!mismoPrecio.length) return { url: '', emparejada: false };

    const miTitulo = tituloParaCruce(it);
    let candidatas = mismoPrecio.filter(
      (c) => titulosCompatibles(miTitulo, tituloParaCruce(c)));

    // Si el titulo no alcanzo para decidir, la zona desempata.
    if (candidatas.length > 1) {
      const miZona = MPF.normalizar(it.ubicacion || '');
      const conZona = candidatas.filter(
        (c) => MPF.normalizar(c.ubicacion || '') === miZona);
      if (conZona.length) candidatas = conZona;
    }

    const direcciones = new Set(candidatas.map((c) => c.url));
    if (direcciones.size !== 1) return { url: '', emparejada: false };
    return { url: candidatas[0].url, emparejada: true };
  }

  function filtrarYOrdenar() {
    const filtro = MPF.matcher.compilar($('consulta').value);
    const pmin = $('pmin').value === '' ? null : Number($('pmin').value);
    const pmax = $('pmax').value === '' ? null : Number($('pmax').value);
    const soloBajadas = $('soloBajadas').checked;
    const zona = $('zona').value;

    const dudosas = $('dudosas') ? $('dudosas').checked : true;
    /* Para trabajar con lo que sirve hoy, sin esperar a que todo empareje. */
    const soloAbribles = $('soloAbribles') ? $('soloAbribles').checked : false;

    let lista = todos.filter((it) => {
      /* MISMA REGLA QUE EN LA PANTALLA: un titulo que no se pudo leer entero no
         alcanza para decir que no. Facebook manda muchos titulos recortados y
         algunos vacios; si se descartan por no coincidir, las guardamos para no
         perderlas y despues el catalogo las esconde igual. */
      if (!filtro.vacia) {
        const r = filtro.evaluar(it.titulo);
        if (!r.coincide) {
          const enDuda = !it.titulo || it.tituloCortado || it.tituloDudoso;
          /* Si lo que fallo fue una palabra excluida, es un no de verdad: esa
             palabra esta escrita, no es cuestion de lo que no se llego a leer. */
          const soloLeFalta = !it.titulo || /^falta:/.test(r.motivo || '');
          if (!(dudosas && enDuda && soloLeFalta)) return false;
        }
      }
      const p = it.precioUSD;
      if (pmin != null && (p == null || p < pmin)) return false;
      if (pmax != null && (p == null || p > pmax)) return false;
      if (soloBajadas && !bajaDePrecio(it)) return false;
      if (soloAbribles && !urlDe(it).url) return false;
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
    if (baja) {
      etiquetas.push('<span class="etiqueta baja" title="' +
        (baja.propia ? 'La baja la detectamos nosotros comparando con lo guardado'
                     : 'Facebook muestra el precio anterior tachado') +
        '">bajo ' + baja.pct + '%</span>');
    }
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
    ponerEnlace(el.querySelector('a.abrir'), it);
    return el;
  }

  /* A donde lleva el boton.

     Una direccion vacia apunta a la pagina donde uno esta, asi que "Abrir en
     Facebook" reabria el catalogo. Se probo mandar a buscar el titulo en
     Marketplace y no sirve: Facebook no encuentra la publicacion por su
     titulo. Asi que o hay direccion de verdad, o el boton queda apagado: un
     boton que no lleva a ningun lado hace perder mas tiempo del que ahorra.

     La direccion sale del scraper, que la busca en la tarjeta aunque no sea un
     enlace. Lo unico que se acepta es un texto que diga /marketplace/item/ con
     su numero: los otros numeros largos de una tarjeta son de las fotos y
     llevarian a otro auto. */
  function ponerEnlace(a, it) {
    const r = urlDe(it);
    if (r.url) {
      a.href = r.url;
      a.textContent = 'Abrir en Facebook';
      /* Se avisa cuando la direccion no vino con la publicacion sino de cruzar
         precio y zona con lo leido en la version de escritorio. */
      if (r.emparejada) {
        a.title = r.porFoto
          ? 'enlace emparejado por la foto'
          : 'enlace emparejado por precio y titulo';
      }
      else a.removeAttribute('title');
      a.removeAttribute('aria-disabled');
      return;
    }
    a.removeAttribute('href');
    a.textContent = 'sin enlace';
    a.setAttribute('aria-disabled', 'true');
  }

  function pintar() {
    const lista = filtrarYOrdenar();
    const grilla = $('grilla');
    grilla.textContent = '';

    const trozo = document.createDocumentFragment();
    for (const it of lista.slice(0, 600)) trozo.appendChild(tarjeta(it));
    grilla.appendChild(trozo);

    const conBaja = lista.filter(bajaDePrecio).length;
    const puente = puentes();

    /* Cuantas se pueden abrir y cuantas no. Sin este numero, "no extrajo
       ningun enlace" y "extrajo pero no emparejo" se ven exactamente igual, y
       son problemas distintos: uno es leer, el otro es cruzar. */
    let propio = 0, emparejado = 0, sinNada = 0, sinFoto = 0;
    /* La pregunta que decide si alcanza con barrer escritorio: de las que
       traen enlace -que solo salen de ahi-, cuantas traen tambien el titulo.
       Si son pocas, escritorio no alcanza solo y el paso por el celular hace
       falta. Es un dato, no una impresion. */
    let conEnlaceYTitulo = 0, conEnlaceSinTitulo = 0;
    for (const it of lista) {
      if (it.url) {
        if (it.titulo && !it.tituloDudoso) conEnlaceYTitulo++;
        else conEnlaceSinTitulo++;
      }
      if (it.url) propio++;
      else if (urlDe(it).url) emparejado++;
      else {
        sinNada++;
        /* Sin foto guardada no se puede emparejar por foto, que es la llave
           buena. Saber cuantas son distingue "no encuentra el par" de "nunca
           guardamos con que buscarlo". */
        if (!claveDeFoto(it)) sinFoto++;
      }
    }

    $('resumen').textContent =
      lista.length.toLocaleString('es-AR') + ' de ' + todos.length.toLocaleString('es-AR') +
      ' publicaciones guardadas' +
      (conBaja ? ' · ' + conBaja + ' bajaron de precio' : '') +
      ' · enlace: ' + propio + ' propio, ' + emparejado + ' emparejado, ' +
      sinNada + ' sin enlace' +
      (sinFoto ? ' (' + sinFoto + ' de esas, sin foto guardada)' : '') +
      ' · de ' + puente.sinEnlace + ' sin enlace, podrian vincularse por: ' +
      Object.keys(puente.alcance)
        .map((k) => puente.alcance[k] + ' ' + k).join(', ') +
      ' · de las que traen enlace: ' + conEnlaceYTitulo + ' con titulo, ' +
      conEnlaceSinTitulo + ' sin titulo' +
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
    armarCruce();
    poblarZonas();
    pintar();
  }

  for (const id of ['consulta', 'pmin', 'pmax', 'orden', 'soloBajadas', 'dudosas',
                    'soloAbribles', 'zona']) {
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


  // ------------------------------------------------------ corridas automaticas

  function cuando(ms) {
    if (!ms) return 'nunca';
    const d = new Date(ms);
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    return mismoDia ? hora : d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) + ' ' + hora;
  }

  function leerAuto() {
    return {
      activo: $('autoActivo').checked,
      cadaMinutos: Number($('autoCada').value) || 60,
      desdeHora: Math.min(23, Math.max(0, Number($('autoDesde').value))),
      hastaHora: Math.min(24, Math.max(1, Number($('autoHasta').value))),
      notificar: $('autoNotif').value
    };
  }

  /* El aviso le dice al usuario cuanto se esta exponiendo, en corridas por dia.
     La frecuencia alta no se bloquea: es su decision, pero tiene que verla. */
  function pintarAviso(auto) {
    const porDia = corridasPorDia(auto);
    const el = $('autoAviso');
    if (!auto.activo) {
      el.textContent = 'Desactivadas. El catálogo solo crece cuando navegás vos.';
      el.className = 'aviso tranquilo';
      return;
    }
    if (porDia >= 10) {
      el.textContent = porDia + ' corridas por día. Es mucho: ninguna persona entra a ' +
        'Marketplace tantas veces. Funciona, pero es el patrón más expuesto. ' +
        'Con 3 o 4 por día juntás casi lo mismo y sos invisible.';
      el.className = 'aviso';
    } else {
      el.textContent = porDia + ' corridas por día, de ' + auto.desdeHora + ' a ' +
        auto.hastaHora + ' hs. Ritmo indistinguible de una persona.';
      el.className = 'aviso tranquilo';
    }
  }

  function pintarBusquedas(busquedas) {
    const cont = $('busquedas');
    cont.textContent = '';
    $('sinBusquedas').classList.toggle('oculto', busquedas.length > 0);
    for (const b of busquedas) {
      const fila = document.createElement('div');
      fila.className = 'busq';
      const nom = document.createElement('div');
      nom.className = 'nom';
      nom.textContent = b.nombre || b.url;
      const det = document.createElement('div');
      det.className = 'det';
      const c = b.config || {};
      const rango = c.pmin != null || c.pmax != null
        ? (c.pmin ?? 0) + ' a ' + (c.pmax ?? 'sin tope') + ' ' + (c.moneda || 'USD') : 'sin rango';
      det.textContent = rango;
      const borrar = document.createElement('button');
      borrar.textContent = '\u00d7';
      borrar.title = 'Borrar esta búsqueda';
      borrar.addEventListener('click', async () => {
        await pedir({ tipo: 'borrarBusqueda', id: b.id });
        cargarAjustes();
      });
      fila.appendChild(nom);
      fila.appendChild(det);
      fila.appendChild(borrar);
      cont.appendChild(fila);
    }
  }

  async function cargarAjustes() {
    const r = await pedir({ tipo: 'leerAjustes' });
    if (!r || !r.ok) return;
    const a = r.auto;
    $('autoActivo').checked = !!a.activo;
    $('autoCada').value = String(a.cadaMinutos);
    $('autoDesde').value = a.desdeHora;
    $('autoHasta').value = a.hastaHora;
    $('autoNotif').value = a.notificar;
    pintarAviso(a);
    const busquedas = r.busquedas || [];
    pintarBusquedas(busquedas);
    /* Si todavia no guardo ninguna busqueda, se abre solo: es la unica forma de
       que se entere de que las corridas automaticas existen. */
    if (!busquedas.length && !$('detAuto').dataset.tocado) $('detAuto').open = true;

    const est = r.estado || {};
    const res = est.ultimoResumen;
    const partes = [];
    if (a.activo && est.proximaCorrida) partes.push('próxima ' + cuando(est.proximaCorrida));
    if (est.ultimaCorrida) {
      let t = 'última ' + cuando(est.ultimaCorrida);
      if (res) t += ' (' + res.nuevos + ' nuevos, ' + res.bajadas + ' bajaron)';
      partes.push(t);
    }
    $('autoResumen').textContent = partes.length ? '\u00b7 ' + partes.join(' \u00b7 ') : '';
  }

  $('detAuto').addEventListener('toggle', () => { $('detAuto').dataset.tocado = '1'; });

  for (const id of ['autoActivo', 'autoCada', 'autoDesde', 'autoHasta', 'autoNotif']) {
    $(id).addEventListener('change', async () => {
      const auto = leerAuto();
      pintarAviso(auto);
      await pedir({ tipo: 'guardarAuto', auto });
      cargarAjustes();
    });
  }

  $('correrAhora').addEventListener('click', async () => {
    $('correrAhora').textContent = 'corriendo...';
    $('correrAhora').disabled = true;
    await pedir({ tipo: 'correrAhora' });
    setTimeout(() => {
      $('correrAhora').textContent = 'Correr ahora';
      $('correrAhora').disabled = false;
      cargar();
      cargarAjustes();
    }, 4000);
  });

  cargarAjustes();

  cargar();
})();
