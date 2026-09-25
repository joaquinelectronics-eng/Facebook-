/* Pegar en la consola ADENTRO de una publicacion, abierta tocando un auto de la
   lista en la version de celular (m.facebook.com).

   Contesta: ¿como se ve una publicacion por dentro? Hace falta para que la
   busqueda de enlaces pueda comprobar que entro al auto correcto -mismo titulo,
   mismo precio- antes de guardar el enlace, sin adivinar donde esta cada cosa. */
(() => {
  const out = [];
  const di = (s) => out.push(s);
  di('direccion: ' + location.href);
  di('titulo de la pestania: ' + document.title);
  const og = document.querySelector('meta[property="og:title"]');
  di('og:title: ' + (og ? og.content : '(no hay)'));

  // ¿Sigue la lista abajo de la publicacion, escondida o a la vista?
  const tarjetas = Array.from(document.querySelectorAll('[data-mpf-tar], [data-mpf-id]'));
  const aLaVista = tarjetas.filter((t) => t.getClientRects().length > 0);
  di('tarjetas de la lista que siguen en la pagina: ' + tarjetas.length +
     ' (dibujadas: ' + aLaVista.length + ')');

  // Los textos que se ven, en orden, con su altura en pantalla.
  const RE_PRECIO = /(US\$|U\$S|USD|\$)/;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n, i = 0;
  di('--- textos dibujados (y = altura en pixeles) ---');
  while ((n = w.nextNode()) && i < 45) {
    const t = n.textContent.trim();
    const el = n.parentElement;
    if (!t || !el || !el.getClientRects().length) continue;
    const st = getComputedStyle(el);
    if (st.visibility !== 'visible' || st.display === 'none') continue;
    const r = el.getBoundingClientRect();
    di(String(i++).padStart(2) + ' y=' + String(Math.round(r.top + scrollY)).padStart(5) +
       (RE_PRECIO.test(t) ? ' [$] ' : '     ') + t.slice(0, 80));
  }
  const texto = out.join('\n');
  console.log(texto);
  try { copy(texto); console.log('(copiado: pegalo en el chat)'); } catch (e) {}
  return 'listo';
})();
