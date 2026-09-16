/* Pegar en la consola estando en la pantalla de BUSQUEDA de Marketplace movil
   (la que deja la direccion en facebook.com y donde el panel desaparece).

   No usa nada de la extension a proposito: el content script vive en otro
   mundo de javascript y desde la consola no se lo ve. Aca se repite, tal cual,
   la logica con la que la extension decide si esta mirando publicaciones, y se
   informa en que paso exacto dice que no. */
(() => {
  const SELECTOR_MOVIL =
    'div[data-mcomponent="MContainer"][data-type="container"][tabindex="0"][data-action-id]';
  const SELECTOR_TEXTO_MOVIL = '[data-mcomponent="ServerTextArea"]';
  const RE_PRECIO = /(?:u\$s|us\$|usd|ars|\$)\s?\d[\d.,]*/gi;

  const lineas = (caja) => Array.from(caja.querySelectorAll(SELECTOR_TEXTO_MOVIL))
    .map((e) => (e.textContent || '').trim()).filter(Boolean);

  /* Una linea es "de precio" si casi toda ella es el precio, como en la
     extension: asi "Gratis $15.000" cuenta y "financio en $ cuotas" no. */
  const esLineaDePrecio = (t) => {
    const hallados = String(t).match(RE_PRECIO);
    if (!hallados) return false;
    return hallados.join('').length >= String(t).replace(/\s/g, '').length * 0.6;
  };
  const esTarjeta = (el) => {
    const l = lineas(el);
    return l.length >= 2 && l.some(esLineaDePrecio);
  };

  const out = [];
  const di = (s) => out.push(s);

  di('direccion: ' + location.pathname + '   (la extension se activa sola si dice /marketplace)');
  const pantallas = document.querySelectorAll('[data-mcomponent="MScreen"]');
  di('es version movil (hay MScreen): ' + (pantallas.length > 0) + '   cantidad: ' + pantallas.length);

  const cand = Array.from(document.querySelectorAll(SELECTOR_MOVIL));
  di('contenedores que matchean el selector: ' + cand.length);

  const buenos = cand.filter(esTarjeta);
  di('de esos, parecen tarjetas de verdad: ' + buenos.length);
  if (buenos.length) {
    di('la primera tarjeta esta en la posicion ' + cand.indexOf(buenos[0]) +
       '  (la extension solo miraba las primeras 60)');
    di('ejemplo: ' + JSON.stringify(lineas(buenos[0]).slice(0, 4)));
    di('>>> el selector ANDA aca. El problema es otro.');
  }

  /* Si el selector no encuentra nada, hay que ver como es la tarjeta de verdad:
     se arranca desde un precio y se sube, marcando cual seria el contenedor. */
  if (!buenos.length) {
    const esPrecioSuelto = (e) => !e.children.length &&
      /^\s*(?:u\$s|us\$|usd|\$)\s?\d[\d.,]*\s*$/i.test(e.textContent || '');
    const precios = Array.from(document.querySelectorAll('span,div')).filter(esPrecioSuelto);
    di('');
    di('precios sueltos en pantalla: ' + precios.length);
    if (!precios.length) di('No hay precios: scrollea hasta ver tarjetas y corre esto de nuevo.');

    const interesante = /^(role|tabindex|href|aria-label|id|data-)/;
    precios.slice(0, 2).forEach((p) => {
      di('');
      di('--- subiendo desde el precio ' + JSON.stringify(p.textContent.trim()) + ' ---');
      let n = p;
      for (let nivel = 0; n && nivel < 12; nivel++) {
        const attrs = Array.from(n.attributes || [])
          .filter((a) => interesante.test(a.name))
          .map((a) => a.name + '=' + JSON.stringify(String(a.value).slice(0, 60)))
          .join(' ');
        const cuantos = n.querySelectorAll ? n.querySelectorAll(SELECTOR_TEXTO_MOVIL).length : 0;
        di('  '.repeat(nivel) + (nivel ? '^ ' : '') + n.tagName.toLowerCase() +
           (attrs ? ' ' + attrs : '') +
           (cuantos ? '   [' + cuantos + ' textos adentro]' : ''));
        n = n.parentElement;
      }
    });
  }

  const texto = out.join('\n');
  console.log(texto);
  return texto;
})();
