/* Pegar en la consola con Marketplace en modo telefono (Ctrl+Shift+M).
   En la version movil las tarjetas NO son enlaces, asi que no sirve buscar
   a[href]. Este script arranca desde un precio y sube mostrando la cadena de
   elementos con sus atributos, para ver que es una tarjeta y de donde se puede
   sacar el id de la publicacion. */
(() => {
  const esPrecio = (e) => !e.children.length &&
    /^\s*(?:u\$s|us\$|usd|\$)\s?[\d][\d.,]*\s*$/i.test(e.textContent || '');

  const precios = Array.from(document.querySelectorAll('span,div')).filter(esPrecio);
  if (!precios.length) return console.log('No encontre precios. Scrollea hasta ver tarjetas.');

  const interesante = /^(role|tabindex|href|aria-label|aria-labelledby|id|data-|target|onclick)/;

  const bloques = precios.slice(0, 2).map((p, i) => {
    const lineas = ['--- desde el precio ' + JSON.stringify(p.textContent.trim()) + ' ---'];
    let n = p, nivel = 0;
    while (n && nivel < 14) {
      const attrs = Array.from(n.attributes || [])
        .filter((a) => interesante.test(a.name))
        .map((a) => a.name + '=' + JSON.stringify(String(a.value).slice(0, 90)))
        .join(' ');
      const propio = Array.from(n.childNodes)
        .filter((x) => x.nodeType === 3 && (x.nodeValue || '').trim())
        .map((x) => x.nodeValue.trim()).join(' ').slice(0, 60);
      lineas.push('  '.repeat(nivel) + (nivel ? '^ ' : '') + n.tagName.toLowerCase() +
                  (attrs ? ' ' + attrs : '') + (propio ? '  "' + propio + '"' : ''));
      n = n.parentElement;
      nivel++;
    }
    // Todo el texto de la tarjeta, mirando unos niveles arriba.
    let caja = p;
    for (let k = 0; k < 8 && caja.parentElement; k++) caja = caja.parentElement;
    lineas.push('TEXTO DE ESA ZONA: ' +
      JSON.stringify((caja.textContent || '').trim().slice(0, 200)));
    return lineas.join('\n');
  });

  const salida = 'precios encontrados: ' + precios.length + '\n\n' + bloques.join('\n\n');
  console.log(salida);
  return salida;
})();
