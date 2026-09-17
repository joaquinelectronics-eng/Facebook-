/* Recorrida de varias busquedas, una atras de otra.

   POR QUE EXISTE: Facebook corta cada busqueda. Medido en la pagina real,
   "audi a5" devolvio 261 publicaciones y ni una mas: al llegar al fondo no
   mandaba nada, y no habia ningun boton de "ver mas". Scrollear mejor no
   cambia eso.

   Lo que si cambia es preguntar distinto. Cada busqueda devuelve una rebanada
   distinta de los mismos miles de avisos, y como el catalogo guarda todo y no
   se borra, se queda con la UNION de todas. Ahi aparecen las viejas
   enterradas, que son las que interesan.

   Este archivo es solo la cuenta -que sigue, cuando se termino-, sin tocar el
   navegador, para poder probarlo sin abrir Facebook. */
(() => {
  const MPF = (typeof window !== 'undefined')
    ? (window.MPF = window.MPF || {})
    : {};

  const BASE = 'https://m.facebook.com/marketplace/category/search/';

  /* Una busqueda por linea. Se limpian vacias y repetidas: repetir la misma
     consulta no trae nada nuevo, solo tarda. */
  function limpiarLista(texto) {
    const vistas = new Set();
    const salida = [];
    for (const linea of String(texto || '').split('\n')) {
      const t = linea.trim();
      if (!t) continue;
      const clave = t.toLowerCase();
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      salida.push(t);
    }
    return salida;
  }

  /* Una linea puede ser dos cosas:
       - un texto suelto: "audi a5" -> se arma la busqueda
       - una direccion entera pegada del navegador -> se usa tal cual

     Lo segundo importa mas de lo que parece. Los resultados no los corta solo
     la consulta: tambien el radio y el rango de precio. Subiendo el radio de
     lo que viene puesto a 150 km aparecen muchas mas publicaciones. Esos
     filtros se arman en la pantalla de Facebook y quedan en la direccion, asi
     que la manera honesta de aprovecharlos es dejar pegar la direccion, y no
     que yo adivine como se llama cada parametro. */
  function esDireccion(linea) {
    return /^https?:\/\//i.test(String(linea || '').trim());
  }

  function armarUrl(consulta) {
    const t = String(consulta || '').trim();
    if (esDireccion(t)) return t;
    return BASE + '?query=' + encodeURIComponent(t);
  }

  /* Que consulta esta corriendo ahora, segun la direccion. Sirve para saber si
     la pagina que se cargo es la que pedimos o el usuario se fue a otro lado. */
  function consultaDeUrl(url) {
    try {
      return new URL(url).searchParams.get('query') || '';
    } catch (e) { return ''; }
  }

  /* El paso siguiente. estado = { lista, indice }.
     Devuelve { terminada, indice, consulta, url, cuantas }. */
  function siguiente(estado) {
    const lista = (estado && estado.lista) || [];
    const indice = Math.max(0, Number((estado && estado.indice) || 0));
    if (!lista.length || indice >= lista.length) {
      return { terminada: true, indice: lista.length, consulta: '', url: '',
               cuantas: lista.length };
    }
    return {
      terminada: false,
      indice,
      consulta: lista[indice],
      url: armarUrl(lista[indice]),
      cuantas: lista.length
    };
  }

  function avanzar(estado) {
    const lista = (estado && estado.lista) || [];
    const indice = Math.max(0, Number((estado && estado.indice) || 0)) + 1;
    return { lista, indice, terminada: indice >= lista.length };
  }

  const api = { limpiarLista, armarUrl, consultaDeUrl, siguiente, avanzar,
                esDireccion, BASE };
  MPF.recorrida = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
