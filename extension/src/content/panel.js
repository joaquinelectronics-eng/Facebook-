/* Panel de control flotante.

   Va dentro de un Shadow DOM: asi los estilos de Facebook no lo deforman y los
   nuestros no tocan nada de la pagina. Es arrastrable y se puede plegar. */
(() => {
  const MPF = (window.MPF = window.MPF || {});

  const CSS = `
  :host { all: initial; }
  .caja {
    position: fixed; top: 90px; right: 18px; z-index: 2147483000;
    width: 310px; font: 13px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
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
  .cuerpo { padding: 11px; display: grid; gap: 9px; max-height: 72vh; overflow-y: auto; }
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
  .botoncito { background: none; border: none; color: #7fa8ff; font-size: 11px;
               padding: 0; width: auto; cursor: pointer; text-decoration: underline; }
  `;

  const HTML = `
  <div class="caja">
    <div class="barra" id="barra">
      <div class="punto" id="punto"></div>
      <div class="titulo">Filtro Estricto</div>
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

      <label class="check"><input type="checkbox" id="ocultar" checked> Ocultar los que no coinciden</label>
      <label class="check"><input type="checkbox" id="sinPrecio"> Mostrar tambien los sin precio</label>
      <label class="check"><input type="checkbox" id="indexar" checked> Guardar todo en mi catalogo</label>

      <div class="sep"></div>

      <div class="marcador">
        <div><b id="mVistos">0</b><span>en pantalla</span></div>
        <div><b id="mOk">0</b><span>coinciden</span></div>
        <div><b id="mGuardados">0</b><span>catalogo</span></div>
      </div>

      <button class="primario" id="barrer">Barrer hasta el fondo</button>
      <div class="estado" id="estado">listo</div>
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
      sinPrecio: $('sinPrecio'), indexar: $('indexar'), barrer: $('barrer'),
      estado: $('estado'), catalogo: $('catalogo'), punto: $('punto'),
      mVistos: $('mVistos'), mOk: $('mOk'), mGuardados: $('mGuardados'),
      cuerpo: $('cuerpo'), plegar: $('plegar'), barra: $('barra'), caja: shadow.querySelector('.caja'),
      provincias: $('provincias'), resZona: $('resZona'), zonaDesc: $('zonaDesc'),
      zonaLimpiar: $('zonaLimpiar')
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
      if (e.target === el.plegar) return;
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
                    el.umbral, el.ocultar, el.sinPrecio, el.indexar, el.zonaDesc]
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
    el.catalogo.addEventListener('click', () => callbacks.alAbrirCatalogo());

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
        ocultar: el.ocultar.checked,
        sinPrecio: el.sinPrecio.checked,
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
      el.ocultar.checked = c.ocultar !== false;
      el.sinPrecio.checked = !!c.sinPrecio;
      el.indexar.checked = c.indexar !== false;
      const elegidas = Array.isArray(c.provincias) ? c.provincias : [];
      for (const chk of checksProv()) chk.checked = elegidas.indexOf(chk.value) >= 0;
      el.zonaDesc.checked = c.zonaDesconocida !== false;
      el.resZona.textContent = resumirZona(elegidas);
    }

    function marcador(vistos, ok, guardados) {
      el.mVistos.textContent = vistos;
      el.mOk.textContent = ok;
      if (guardados != null) el.mGuardados.textContent = guardados;
    }

    function estado(texto, barriendo) {
      el.estado.textContent = texto;
      el.punto.classList.toggle('activo', !!barriendo);
      el.barrer.textContent = barriendo ? 'Detener barrido' : 'Barrer hasta el fondo';
      el.barrer.classList.toggle('parar', !!barriendo);
    }

    return { leerConfig, escribirConfig, marcador, estado };
  }

  MPF.panel = { crear };
})();
