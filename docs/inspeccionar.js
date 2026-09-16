/* Pegar en la consola de Chrome (F12) estando en Facebook Marketplace, con
   resultados a la vista. No usa la extension: mira el DOM crudo y vuelca donde
   esta cada texto de las tarjetas que se ven en pantalla. */
(() => {
  const SEL = 'a[href*="/item/"]';
  const aLaVista = (el) => {
    const r = el.getBoundingClientRect();
    return r.top < innerHeight && r.bottom > 0 && r.width > 20;
  };

  /* Sube desde el enlace mientras el ancestro siga conteniendo SOLO esta
     publicacion. Asi se abarca la tarjeta entera -por si el titulo esta fuera
     del <a>- sin invadir las de al lado. */
  const subirHastaLaTarjeta = (a) => {
    let e = a;
    while (e.parentElement && e.parentElement.querySelectorAll(SEL).length === 1) e = e.parentElement;
    return e;
  };

  const rutaDe = (nodo, tope) => {
    const partes = [];
    let e = nodo.parentElement;
    while (e && e !== tope && partes.length < 8) {
      let t = e.tagName.toLowerCase();
      if (e === nodo.parentElement && e.getAttribute('aria-hidden')) t += '[aria-hidden]';
      partes.unshift(t);
      e = e.parentElement;
    }
    return partes.join(' > ');
  };

  const links = Array.from(document.querySelectorAll(SEL)).filter(aLaVista);
  if (!links.length) return console.log('No hay tarjetas a la vista. Scrolleá hasta ver resultados y volvé a pegar esto.');

  const bloques = links.slice(0, 3).map((a) => {
    const id = (a.getAttribute('href').match(/item\/(\d+)/) || [])[1];
    const caja = subirHastaLaTarjeta(a);
    const lineas = [];
    const paso = document.createTreeWalker(caja, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = paso.nextNode())) {
      const t = (n.nodeValue || '').trim();
      if (!t) continue;
      const dentroDelLink = a.contains(n);
      lineas.push('  ' + (dentroDelLink ? '[dentro] ' : '[FUERA]  ') +
                  rutaDe(n, caja) + '  =  ' + JSON.stringify(t.slice(0, 90)));
    }
    const imgs = Array.from(caja.querySelectorAll('img')).map(
      (im) => '  img alt=' + JSON.stringify((im.getAttribute('alt') || '').slice(0, 90)));
    return [
      '=== ITEM ' + id + ' ===',
      'aria-label del enlace: ' + JSON.stringify(a.getAttribute('aria-label')),
      'title del enlace:      ' + JSON.stringify(a.getAttribute('title')),
      'TEXTOS (dentro o fuera del enlace):',
      lineas.length ? lineas.join('\n') : '  (ninguno)',
      imgs.length ? 'IMAGENES:\n' + imgs.join('\n') : 'IMAGENES: (ninguna)'
    ].join('\n');
  });

  const salida = 'tarjetas a la vista: ' + links.length + '\n\n' + bloques.join('\n\n');
  console.log(salida);
  try { copy(salida); console.log('\n^ copiado al portapapeles'); } catch (e) {}
})();
