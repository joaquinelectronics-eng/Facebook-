/* Panel de control flotante.

   Va dentro de un Shadow DOM: asi los estilos de Facebook no lo deforman y los
   nuestros no tocan nada de la pagina. Es arrastrable y se puede plegar. */
(() => {
  const MPF = (window.MPF = window.MPF || {});

  const CSS = `
  :host { all: initial; }
  .caja {
    position: fixed; top: 90px; right: 18px; z-index: 2147483000;
    width: 380px; font: 13px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
    /* En la version movil la pantalla es angosta: el panel se achica solo en
       vez de irse de la pantalla y dejar los botones fuera de alcance. */
    max-width: calc(100vw - 36px);
    /* Y se puede agrandar tirando de la esquina: los textos largos -el estado
       del barrido, los motivos- no entraban y habia que leerlos de a pedazos
       moviendo el panel para los costados. */
    resize: horizontal; min-width: 300px;
    color: #e9edf2; background: #171a20; border: 1px solid #2c323c;
    border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.45); overflow: hidden;
  }
  .barra {
    display: flex; align-items: center; gap: 8px; padding: 9px 11px;
    background: #1f242c; cursor: move; user-select: none; border-bottom: 1px solid #2c323c;
  }
  .punto { width: 8px; height: 8px; border-radius: 50%; background: #3d4450; flex: none; }
  .punto.activo { background: #35d07f; box-shadow: 0 0 8px #35d07f; }
  .titulo { font-weight: 650; font-size: 12.5px; letter-spacing: .2px; flex: 1; }
  .plegar { cursor: pointer; opacity: .6; padding: 0 4px; font-size: 15px; }
  .plegar:hover { opacity: 1; }
  /* Freno en la barra de titulo: se ve siempre, aunque el panel este plegado
     o scrolleado hasta arriba. */
  .frenar {
    display: none; width: auto; padding: 3px 10px; font-size: 11px;
    background: #b3392f; color: #fff; border-radius: 5px; border: none;
    cursor: pointer; font-weight: 700; letter-spacing: .3px; flex: none;
  }
  .frenar:hover { background: #cc4438; }
  .frenar.visible { display: block; }
  .cuerpo { padding: 11px; display: grid; gap: 9px; max-height: 72vh; overflow-y: auto; }
  /* Los avisos largos se parten en varias lineas en vez de cortarse. */
  .estado, .pendientes { white-space: normal; overflow-wrap: anywhere; }
  .cuerpo.oculto { display: none; }
  label { display: block; font-size: 10.5px; text-transform: uppercase;
          letter-spacing: .6px; color: #8b94a3; margin-bottom: 3px; }
  input[type=text], input[type=number], select {
    width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 7px;
    border: 1px solid #333a45; background: #0f1216; color: #e9edf2;
    font: inherit; font-size: 13px; outline: none;
  }
  input:focus, select:focus { border-color: #4a8cff; }
  .fila { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .fila3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 7px; }
  .ayuda { font-size: 11px; color: #6f7887; line-height: 1.4; }
  .ayuda code { background: #0f1216; padding: 1px 4px; border-radius: 3px; color: #9ec1ff; }
  button {
    font: inherit; font-weight: 600; font-size: 12.5px; padding: 8px 10px;
    border-radius: 7px; border: 1px solid transparent; cursor: pointer; width: 100%;
  }
  .primario { background: #2d6cf6; color: #fff; }
  .primario:hover { background: #4380ff; }
  .primario.parar { background: #b3392f; }
  .primario.parar:hover { background: #cc4438; }
  .secundario { background: #232932; color: #cdd5e0; border-color: #333a45; }
  .secundario:hover { background: #2b323d; }
  .check { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #b9c2cf;
           text-transform: none; letter-spacing: 0; margin-bottom: 0; }
  .check input { width: auto; }
  .marcador { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center; }
  .marcador div { background: #0f1216; border: 1px solid #262c35; border-radius: 7px; padding: 6px 3px; }
  .marcador b { display: block; font-size: 16px; color: #fff; font-variant-numeric: tabular-nums; }
  .marcador span { font-size: 9.5px; color: #79828f; text-transform: uppercase; letter-spacing: .5px; }
  .estado { font-size: 11px; color: #8b94a3; min-height: 15px; text-align: center; }
  .pendientes { font-size: 11px; text-align: center; min-height: 14px; color: #79828f; }
  .pendientes b { color: #ffb74d; font-variant-numeric: tabular-nums; }
  /* El boton de barrer/detener queda pegado abajo del panel: antes habia que
     scrollear el panel para llegar a el, justo cuando uno quiere frenar ya. */
  .pie {
    position: sticky; bottom: 0; background: #171a20; z-index: 2;
    padding: 9px 0 2px; margin-top: 2px; display: grid; gap: 6px;
    box-shadow: 0 -10px 14px -10px rgba(0,0,0,.75);
  }
  .sep { height: 1px; background: #262c35; margin: 1px 0; }
  details { border: 1px solid #2c323c; border-radius: 8px; background: #14171c; }
  summary {
    cursor: pointer; padding: 7px 10px; font-size: 12px; color: #cdd5e0;
    list-style: none; user-select: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '\\25b8'; display: inline-block; margin-right: 6px;
                    transition: transform .12s; color: #7b8494; }
  details[open] summary::before { transform: rotate(90deg); }
  .provincias {
    display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px;
    padding: 4px 10px 8px; max-height: 190px; overflow-y: auto;
  }
  .provincias label { display: flex; align-items: center; gap: 5px; font-size: 11.5px;
                      text-transform: none; letter-spacing: 0; color: #b9c2cf;
                      margin: 0; padding: 2px 0; cursor: pointer; }
  .provincias input { width: auto; }
  .provincias .destacada { color: #e9edf2; font-weight: 600; }
  .zonaPie { padding: 0 10px 8px; }
  .motivos { padding: 2px 10px 9px; display: grid; gap: 7px; max-height: 210px; overflow-y: auto; }
  .motivo { font-size: 11.5px; }
  .motivo .cab { display: flex; justify-content: space-between; gap: 8px; color: #e9edf2; }
  .motivo .cab b { color: #ffb74d; font-variant-numeric: tabular-nums; }
  .motivo ul { margin: 3px 0 0; padding-left: 14px; color: #79828f; font-size: 10.5px; }
  .motivo li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  textarea {
    width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 7px;
    border: 1px solid #333a45; background: #0f1216; color: #e9edf2;
    font: inherit; font-size: 12.5px; outline: none; resize: vertical;
  }
  textarea:focus { border-color: #4a8cff; }
  .buscador { padding: 6px 10px 2px; }
  .hallazgos { padding: 0 10px 8px; display: grid; gap: 5px; max-height: 180px; overflow-y: auto; }
  .hallazgo { font-size: 11px; border-left: 2px solid #3d4450; padding-left: 7px; }
  .hallazgo.si { border-color: #35d07f; }
  .hallazgo.no { border-color: #e5564a; }
  .hallazgo .t { color: #dbe3ec; }
  .hallazgo .m { color: #79828f; font-size: 10.5px; }
  .nada { color: #ffb74d; font-size: 11px; padding: 4px 10px 8px; line-height: 1.45; }
  .botoncito { background: none; border: none; color: #7fa8ff; font-size: 11px;
               padding: 0; width: auto; cursor: pointer; text-decoration: underline; }
  `;

  const HTML = `
  <div class="caja">
    <div class="barra" id="barra">
      <div class="punto" id="punto"></div>
      <div class="titulo">Filtro Estricto</div>
      <button class="frenar" id="frenar" type="button">Detener</button>
      <div class="plegar" id="plegar">−</div>
    </div>
    <div class="cuerpo" id="cuerpo">
      <div>
        <label>Busqueda estricta</label>
        <input type="text" id="consulta" placeholder="audi a5 -permuto" spellcheck="false">
        <div class="ayuda" style="margin-top:5px">
          <code>a4|a5</code> cualquiera &middot; <code>"linea nueva"</code> frase exacta &middot;
          <code>-chocado</code> descarta
        </div>
      </div>

      <div class="sep"></div>

      <div class="fila3">
        <div>
          <label>Desde</label>
          <input type="number" id="pmin" placeholder="0" min="0">
        </div>
        <div>
          <label>Hasta</label>
          <input type="number" id="pmax" placeholder="sin tope" min="0">
        </div>
        <div>
          <label>Moneda</label>
          <select id="moneda"><option value="USD">USD</option><option value="ARS">ARS</option></select>
        </div>
      </div>

      <div class="fila">
        <div>
          <label>Dolar (ARS)</label>
          <input type="number" id="cotizacion" min="1" step="1">
        </div>
        <div>
          <label>$ solo = USD hasta</label>
          <input type="number" id="umbral" min="1000" step="1000">
        </div>
      </div>
      <div class="ayuda">Un <code>$</code> sin aclarar por debajo de ese monto se toma como dolares.</div>

      <div class="sep"></div>

      <details id="detZona">
        <summary id="resZona">Zona: todas</summary>
        <div class="provincias" id="provincias"></div>
        <div class="zonaPie">
          <label class="check"><input type="checkbox" id="zonaDesc" checked> Mostrar zona no reconocida</label>
          <button class="botoncito" id="zonaLimpiar" type="button">buscar en todo el pais</button>
        </div>
      </details>

      <div class="sep"></div>

      <div>
        <label>Velocidad del barrido</label>
        <select id="velocidad">
          <option value="tranquilo">Tranquilo &middot; invisible</option>
          <option value="normal">Normal &middot; 5 veces mas rapido</option>
          <option value="rapido">Rapido &middot; se nota mas</option>
          <option value="turbo">Turbo &middot; lo maximo util</option>
        </select>
      </div>

      <label class="check"><input type="checkbox" id="soloBajadas"> Solo los que bajaron de precio</label>
      <label class="check"><input type="checkbox" id="tocarLaPagina"> Filtrar tambien en la pantalla de Facebook</label>
      <div class="ayuda">El barrido guarda TODO lo que encuentra, coincida o no, y
        el filtro se aplica en tu catalogo. Tocar la pantalla de Facebook dejaba
        huecos en blanco y hacia que el barrido cortara antes de tiempo.</div>
      <label class="check"><input type="checkbox" id="ocultar" checked> Ocultar los que no coinciden</label>
      <label class="check"><input type="checkbox" id="sinPrecio"> Mostrar tambien los sin precio</label>
      <label class="check"><input type="checkbox" id="rescatarCortados"> Mostrar los de titulo cortado (no perder ninguno)</label>
      <label class="check"><input type="checkbox" id="versionCelular"> Abrir Marketplace en la version de celular</label>
      <label class="check"><input type="checkbox" id="indexar" checked> Guardar todo en mi catalogo</label>

      <details id="detMotivos">
        <summary id="resMotivos">Por que se ocultaron</summary>
        <div class="buscador">
          <input type="text" id="buscarLeidas" spellcheck="false"
                 placeholder="¿esta esta publicacion? ej: coupe, udaondo">
        </div>
        <div class="hallazgos" id="hallazgos"></div>
        <div class="motivos" id="motivos"></div>
        <div class="zonaPie">
          <button class="botoncito" id="copiarIlegible" type="button">
            copiar una tarjeta que no se pudo leer
          </button>
          <div class="estado" id="avisoCopia"></div>
        </div>
      </details>

      <div class="sep"></div>

      <div class="marcador">
        <div><b id="mVistos">0</b><span>en pantalla</span></div>
        <div><b id="mOk">0</b><span>coinciden</span></div>
        <div><b id="mGuardados">0</b><span>catalogo</span></div>
      </div>
      <div class="pendientes" id="pendientes"></div>

      <details id="detRecorrida">
        <summary>Recorrer varias busquedas</summary>
        <div class="zonaPie">
          <div class="ayuda" style="margin-bottom:6px">
            Facebook corta cada busqueda -medido: 261 y ni una mas-. Preguntando
            distinto trae otra rebanada, y el catalogo se queda con todas juntas.
            Una busqueda por linea.
          </div>
          <textarea id="listaBusquedas" rows="5" spellcheck="false"
            placeholder="audi a5&#10;a5 sportback&#10;a5 quattro&#10;audi cabrio"></textarea>
          <label class="check" style="margin-top:6px"><input type="checkbox" id="recorrerEscritorio" checked>
            Recorrer en escritorio (para traer los enlaces)</label>
          <button id="recorrer" class="secundario" style="margin-top:6px">Recorrer todas</button>
        </div>
      </details>

      <div class="pie">
        <button class="primario" id="barrer">Barrer hasta el fondo</button>
        <div class="estado" id="estado">listo</div>
        <div class="estado" id="costo"></div>
        <!-- Este boton es un paso del trabajo, no una opcion escondida: el
             celular trae los titulos y el escritorio los enlaces, asi que se
             pasa de uno al otro todo el tiempo. Va en el pie, que queda fijo
             aunque el panel este scrolleado. -->
        <button class="secundario" id="releer">Releer las que faltan</button>
        <button class="secundario" id="escritorio">Ir a escritorio (los enlaces)</button>
      </div>

      <button class="secundario" id="guardarBusq">Guardar esta busqueda</button>
      <div class="estado" id="avisoBusq"></div>
      <button class="secundario" id="catalogo">Abrir mi catalogo</button>
    </div>
  </div>`;

  function crear(callbacks) {
    const host = document.createElement('div');
    host.id = 'mpf-host';
    host.style.cssText = 'all:initial;position:static';
    const shadow = host.attachShadow({ mode: 'open' });
    const estilo = document.createElement('style');
    estilo.textContent = CSS;
    shadow.appendChild(estilo);
    const cont = document.createElement('div');
    cont.innerHTML = HTML;
    shadow.appendChild(cont);
    document.documentElement.appendChild(host);

    const $ = (id) => shadow.getElementById(id);

    const el = {
      consulta: $('consulta'), pmin: $('pmin'), pmax: $('pmax'), moneda: $('moneda'),
      cotizacion: $('cotizacion'), umbral: $('umbral'), ocultar: $('ocultar'),
      velocidad: $('velocidad'), soloBajadas: $('soloBajadas'),
      pendientes: $('pendientes'), tocarLaPagina: $('tocarLaPagina'),
      releer: $('releer'),
      listaBusquedas: $('listaBusquedas'), recorrer: $('recorrer'),
      recorrerEscritorio: $('recorrerEscritorio'),
      escritorio: $('escritorio'),
      sinPrecio: $('sinPrecio'), rescatarCortados: $('rescatarCortados'),
      versionCelular: $('versionCelular'),
      indexar: $('indexar'), barrer: $('barrer'),
      estado: $('estado'), catalogo: $('catalogo'), punto: $('punto'),
      mVistos: $('mVistos'), mOk: $('mOk'), mGuardados: $('mGuardados'),
      cuerpo: $('cuerpo'), plegar: $('plegar'), barra: $('barra'), caja: shadow.querySelector('.caja'),
      provincias: $('provincias'), resZona: $('resZona'), zonaDesc: $('zonaDesc'),
      zonaLimpiar: $('zonaLimpiar'), guardarBusq: $('guardarBusq'), avisoBusq: $('avisoBusq'),
      costo: $('costo'), frenar: $('frenar'),
      motivos: $('motivos'), resMotivos: $('resMotivos'), detMotivos: $('detMotivos'),
      buscarLeidas: $('buscarLeidas'), hallazgos: $('hallazgos'),
      copiarIlegible: $('copiarIlegible'), avisoCopia: $('avisoCopia')
    };

    /* Lista de provincias. Las cuatro de la zona habitual van primero para no
       tener que buscarlas entre veinticuatro. */
    const DESTACADAS = ['BA', 'CABA', 'SF', 'ER', 'LP'];
    const listaProvincias = (MPF.zonas ? MPF.zonas.PROVINCIAS : []).slice().sort((a, b) => {
      const ia = DESTACADAS.indexOf(a.id), ib = DESTACADAS.indexOf(b.id);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.nombre.localeCompare(b.nombre, 'es');
    });
    for (const prov of listaProvincias) {
      const lab = document.createElement('label');
      if (DESTACADAS.indexOf(prov.id) >= 0) lab.className = 'destacada';
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.value = prov.id;
      inp.className = 'provCheck';
      lab.appendChild(inp);
      lab.appendChild(document.createTextNode(prov.corto));
      el.provincias.appendChild(lab);
    }
    const checksProv = () => Array.from(el.provincias.querySelectorAll('.provCheck'));

    function resumirZona(ids) {
      if (!ids.length) return 'Zona: todo el pais';
      const nombres = ids.map((id) => MPF.zonas.cortoDe(id) || id);
      if (nombres.length <= 3) return 'Zona: ' + nombres.join(', ');
      return 'Zona: ' + nombres.slice(0, 2).join(', ') + ' +' + (nombres.length - 2);
    }

    // --- arrastrar el panel ---
    let arrastrando = false, dx = 0, dy = 0;
    el.barra.addEventListener('mousedown', (e) => {
      if (e.target === el.plegar || e.target === el.frenar) return;
      arrastrando = true;
      const r = el.caja.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!arrastrando) return;
      el.caja.style.left = Math.max(0, e.clientX - dx) + 'px';
      el.caja.style.top = Math.max(0, e.clientY - dy) + 'px';
      el.caja.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => { arrastrando = false; });

    el.plegar.addEventListener('click', () => {
      const plegado = el.cuerpo.classList.toggle('oculto');
      el.plegar.textContent = plegado ? '+' : '−';
    });

    // --- eventos hacia el orquestador ---
    const campos = [el.consulta, el.pmin, el.pmax, el.moneda, el.cotizacion,
                    el.umbral, el.tocarLaPagina, el.ocultar, el.sinPrecio, el.rescatarCortados,
                    el.versionCelular, el.indexar, el.zonaDesc,
                    el.velocidad, el.soloBajadas]
                    .concat(checksProv());
    for (const c of campos) {
      const evento = c.type === 'checkbox' || c.tagName === 'SELECT' ? 'change' : 'input';
      c.addEventListener(evento, () => {
        const cfg = leerConfig();
        el.resZona.textContent = resumirZona(cfg.provincias);
        callbacks.alCambiar(cfg);
      });
    }
    el.zonaLimpiar.addEventListener('click', () => {
      for (const c of checksProv()) c.checked = false;
      el.resZona.textContent = resumirZona([]);
      callbacks.alCambiar(leerConfig());
    });
    el.barrer.addEventListener('click', () => callbacks.alBarrer());
    el.recorrer.addEventListener('click', () =>
      callbacks.alRecorrer(el.listaBusquedas.value, el.recorrerEscritorio.checked));
    el.escritorio.addEventListener('click', () => callbacks.alIrAEscritorio());
    el.releer.addEventListener('click', () => callbacks.alReleer());
    el.catalogo.addEventListener('click', () => callbacks.alAbrirCatalogo());
    el.guardarBusq.addEventListener('click', () => callbacks.alGuardarBusqueda());
    el.frenar.addEventListener('click', (e) => { e.stopPropagation(); callbacks.alBarrer(); });

    function leerConfig() {
      return {
        consulta: el.consulta.value,
        pmin: el.pmin.value === '' ? null : Number(el.pmin.value),
        pmax: el.pmax.value === '' ? null : Number(el.pmax.value),
        moneda: el.moneda.value,
        cotizacion: Number(el.cotizacion.value) || 1000,
        umbralAmbiguo: Number(el.umbral.value) || 500000,
        provincias: checksProv().filter((c) => c.checked).map((c) => c.value),
        zonaDesconocida: el.zonaDesc.checked,
        velocidad: el.velocidad.value,
        soloBajadas: el.soloBajadas.checked,
        ocultar: el.ocultar.checked,
        sinPrecio: el.sinPrecio.checked,
        rescatarCortados: el.rescatarCortados.checked,
        tocarLaPagina: el.tocarLaPagina.checked,
        versionCelular: el.versionCelular.checked,
        indexar: el.indexar.checked
      };
    }

    function escribirConfig(c) {
      if (!c) return;
      el.consulta.value = c.consulta || '';
      el.pmin.value = c.pmin == null ? '' : c.pmin;
      el.pmax.value = c.pmax == null ? '' : c.pmax;
      el.moneda.value = c.moneda || 'USD';
      el.cotizacion.value = c.cotizacion || 1000;
      el.umbral.value = c.umbralAmbiguo || 500000;
      el.velocidad.value = c.velocidad || 'tranquilo';
      el.soloBajadas.checked = !!c.soloBajadas;
      el.ocultar.checked = c.ocultar !== false;
      el.sinPrecio.checked = !!c.sinPrecio;
      el.rescatarCortados.checked = c.rescatarCortados !== false;
      el.tocarLaPagina.checked = !!c.tocarLaPagina;
      el.versionCelular.checked = c.versionCelular !== false;
      el.indexar.checked = c.indexar !== false;
      const elegidas = Array.isArray(c.provincias) ? c.provincias : [];
      for (const chk of checksProv()) chk.checked = elegidas.indexOf(chk.value) >= 0;
      el.zonaDesc.checked = c.zonaDesconocida !== false;
      el.resZona.textContent = resumirZona(elegidas);
    }

    // Cada contador se actualiza solo si se le pasa un valor; null lo deja como esta.
    function marcador(vistos, ok, guardados) {
      if (vistos != null) el.mVistos.textContent = vistos;
      if (ok != null) el.mOk.textContent = ok;
      if (guardados != null) el.mGuardados.textContent = guardados;
    }

    /* Dos numeros que hasta ahora no se veian y son los que contestan "por que
       faltan resultados": cuantas hay en pantalla sin poder leer, y cuantas se
       muestran solo porque el titulo venia cortado y no se pudo confirmar. */
    function pendientes(sinLeer, enDuda, conEnlace) {
      const partes = [];
      if (sinLeer > 0) partes.push('sin poder leer: <b>' + sinLeer + '</b>');
      if (enDuda > 0) partes.push('titulo cortado: <b>' + enDuda + '</b>');
      /* En el celular Facebook no manda ningun enlace; en escritorio si. Este
         numero deja ver de una si la pasada por escritorio los esta juntando.

         Dice "juntados" y no "con enlace" porque cuenta TODO lo leido en esta
         pagina, no lo que hay ahora en pantalla: Facebook va sacando tarjetas
         de arriba mientras uno baja. Puesto al lado de "en pantalla" parecia un
         numero imposible, y un numero que no cierra no se puede usar. */
      if (conEnlace > 0) partes.push('enlaces juntados: <b>' + conEnlace + '</b>');
      el.pendientes.innerHTML = partes.join(' &middot; ');
    }

    /* El mismo boton hace las dos cosas, segun donde estemos. */
    function modoEscritorio(activo) {
      el.escritorio.textContent = activo
        ? 'Volver a la version de celular'
        : 'Ir a escritorio (los enlaces)';
    }

    function estado(texto, barriendo) {
      el.estado.textContent = texto;
      el.punto.classList.toggle('activo', !!barriendo);
      el.barrer.textContent = barriendo ? 'Detener barrido' : 'Barrer hasta el fondo';
      el.barrer.classList.toggle('parar', !!barriendo);
      // El freno de la barra de titulo se ve aunque el panel este plegado.
      el.frenar.classList.toggle('visible', !!barriendo);
    }

    let borrarAviso = null;
    function avisoBusqueda(texto) {
      el.avisoBusq.textContent = texto;
      clearTimeout(borrarAviso);
      borrarAviso = setTimeout(() => { el.avisoBusq.textContent = ''; }, 4000);
    }

    function mostrar(visible) { host.style.display = visible ? '' : 'none'; }

    /* Cuanto tarda cada pasada de filtrado. Si ese numero se dispara, el
       barrido se va a sentir lento por mas que se suba la velocidad. */
    function costo(ms, tarjetas, ilegibles) {
      const n = ms < 10 ? ms.toFixed(1) : String(Math.round(ms));

      /* Muchas tarjetas sin titulo casi siempre significan lo mismo: el barrido
         va tan rapido que Facebook no alcanza a dibujarlas. Conviene decirlo
         donde se ve, no esconderlo en el desglose. */
      if (ilegibles) {
        el.costo.textContent = ilegibles + ' esperando que Facebook las dibuje';
        el.costo.style.color = '#ffb74d';
        return;
      }
      el.costo.textContent = 'filtrado: ' + n + ' ms \u00b7 ' + tarjetas + ' tarjetas';
      el.costo.style.color = ms > 120 ? '#ffb74d' : '';
    }

    /* El desglose de descartes. Si faltan resultados, aca se ve de una si los
       tiro el filtro de titulo, el de precio, el de zona, o si directamente
       Facebook no los mando. */
    function pintarMotivos(mapa, totalOcultos) {
      /* "Se ocultaron" solo cuando de verdad se oculta algo. Por defecto la
         extension no toca la pantalla de Facebook, asi que decir que se
         ocultaron 199 era mentira y hacia pensar que faltaban resultados. */
      const seOcultan = el.tocarLaPagina.checked && el.ocultar.checked;
      const texto = seOcultan ? 'Por que se ocultaron' : 'Por que no coinciden';
      el.resMotivos.textContent = totalOcultos ? texto + ' ' + totalOcultos : texto;
      if (!el.detMotivos.open) return;   // no se dibuja si esta plegado

      el.motivos.textContent = '';
      const orden = Array.from(mapa.entries()).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
      for (const [motivo, datos] of orden) {
        const caja = document.createElement('div');
        caja.className = 'motivo';
        const cab = document.createElement('div');
        cab.className = 'cab';
        const nom = document.createElement('span');
        nom.textContent = motivo;
        const num = document.createElement('b');
        num.textContent = datos.n;
        cab.appendChild(nom);
        cab.appendChild(num);
        caja.appendChild(cab);

        const lista = document.createElement('ul');
        for (const ej of datos.ejemplos) {
          const li = document.createElement('li');
          li.textContent = ej;          // titulo ajeno: siempre como texto
          li.title = ej;
          lista.appendChild(li);
        }
        caja.appendChild(lista);
        el.motivos.appendChild(caja);
      }
    }

    /* Buscador de diagnostico: escribis parte de un titulo o de una zona y te
       dice si esa publicacion llego a la pagina y que se hizo con ella. */
    el.buscarLeidas.addEventListener('input', () => {
      const texto = el.buscarLeidas.value.trim();
      el.hallazgos.textContent = '';
      if (texto.length < 3) return;

      const encontradas = callbacks.alBuscarEnLeidas(texto);
      if (!encontradas.length) {
        const aviso = document.createElement('div');
        aviso.className = 'nada';
        aviso.textContent = 'No esta en la pagina. Facebook no la mando: ' +
          'ningun filtro puede mostrar algo que nunca llego.';
        el.hallazgos.appendChild(aviso);
        return;
      }
      for (const h of encontradas.slice(0, 25)) {
        const caja = document.createElement('div');
        caja.className = 'hallazgo ' + (h.pasa ? 'si' : 'no');
        const t = document.createElement('div');
        t.className = 't';
        t.textContent = h.titulo;                 // titulo ajeno: como texto
        const m = document.createElement('div');
        m.className = 'm';
        m.textContent = (h.precio || 'sin precio') + ' \u00b7 ' + (h.ubicacion || 'sin zona') +
                        ' \u00b7 ' + (h.pasa ? 'se muestra' : 'oculta: ' + h.motivo);
        caja.appendChild(t);
        caja.appendChild(m);
        el.hallazgos.appendChild(caja);
      }
    });

    el.copiarIlegible.addEventListener('click', async () => {
      const texto = callbacks.alCopiarIlegible();
      try {
        await navigator.clipboard.writeText(texto);
        el.avisoCopia.textContent = 'copiado: pegalo en el chat';
      } catch (e) {
        // Si el navegador no deja copiar, al menos se puede leer en la consola.
        console.log(texto);
        el.avisoCopia.textContent = 'no se pudo copiar, mira la consola (F12)';
      }
      setTimeout(() => { el.avisoCopia.textContent = ''; }, 6000);
    });

    let ultimoMapa = new Map(), ultimoTotal = 0;
    function motivos(mapa, totalOcultos) {
      ultimoMapa = mapa;
      ultimoTotal = totalOcultos;
      pintarMotivos(mapa, totalOcultos);
    }
    el.detMotivos.addEventListener('toggle', () => pintarMotivos(ultimoMapa, ultimoTotal));

    return { leerConfig, escribirConfig, marcador, pendientes, estado, avisoBusqueda,
             mostrar, costo, motivos, modoEscritorio };
  }

  MPF.panel = { crear };
})();
