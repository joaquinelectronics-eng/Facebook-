/* Pegar en la consola con Marketplace abierto, DESPUES de barrer un rato.

   Contesta una sola pregunta, y la contesta con una prueba, no con una
   suposicion: cuando se llega al fondo, ¿Facebook manda mas o no manda mas?

   Baja hasta abajo de todo, espera, y mira si aparecieron publicaciones
   nuevas. De paso dice que hay al final de la lista, que es donde estaria un
   boton de "ver mas" si existiera. Tarda unos 12 segundos. */
(async () => {
  const PIX = /(?:u\$s|us\$|usd|ars|\$)/i;
  const out = [];
  const di = (s) => { out.push(s); };

  const contar = () => document.querySelectorAll('[data-mpf-tar], [data-mpf-id]').length;

  const puedeScrollear = (el) => {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.scrollHeight - el.clientHeight < 40) return false;
    const y = getComputedStyle(el).overflowY;
    return y === 'auto' || y === 'scroll';
  };

  // De donde cuelga la lista: se arranca de una publicacion y se sube.
  const unaTarjeta = document.querySelector('[data-mpf-tar], [data-mpf-id]');
  let cajon = null;
  for (let n = unaTarjeta, i = 0; n && i < 14; i++, n = n.parentElement) {
    if (puedeScrollear(n)) { cajon = n; break; }
  }

  di('publicaciones reconocidas ahora: ' + contar());
  if (!unaTarjeta) {
    di('No hay ninguna marcada. Abri Marketplace y dejá que lea antes de correr esto.');
    console.log(out.join('\n'));
    return out.join('\n');
  }

  if (cajon) {
    di('scrollea un cajon interno: ' + cajon.tagName.toLowerCase() +
       (cajon.id ? '#' + cajon.id : ''));
    di('  alto del contenido: ' + cajon.scrollHeight +
       '   ventana: ' + cajon.clientHeight +
       '   posicion: ' + Math.round(cajon.scrollTop));
    di('  falta hasta el fondo: ' +
       Math.round(cajon.scrollHeight - cajon.scrollTop - cajon.clientHeight));
  } else {
    di('scrollea la ventana (no hay cajon interno)');
    di('  alto: ' + document.documentElement.scrollHeight +
       '   ventana: ' + window.innerHeight +
       '   posicion: ' + Math.round(window.scrollY));
    di('  falta hasta el fondo: ' + Math.round(
      document.documentElement.scrollHeight - window.scrollY - window.innerHeight));
  }

  const alFondo = () => {
    if (cajon) cajon.scrollTop = cajon.scrollHeight;
    else window.scrollTo(0, document.documentElement.scrollHeight);
  };

  // LA PRUEBA: al fondo, esperar, y ver si crecio.
  const antes = contar();
  di('');
  di('bajando hasta el fondo y esperando...');
  for (let i = 0; i < 3; i++) {
    alFondo();
    await new Promise((r) => setTimeout(r, 3500));
  }
  const despues = contar();
  di('publicaciones antes: ' + antes + '   despues de ir al fondo: ' + despues);
  di(despues > antes
    ? '>>> Facebook SI manda mas al llegar al fondo (+' + (despues - antes) + ').'
    : '>>> Facebook NO mando ni una mas. O se acabaron, o hace falta apretar algo.');

  /* Que hay al final de todo: si existe un "ver mas", aparece aca. */
  const raiz = cajon || document.body;
  const textos = [];
  const paso = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim().length > 1
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
  });
  for (let n = paso.nextNode(); n; n = paso.nextNode()) textos.push(n.nodeValue.trim());
  di('');
  di('ultimas lineas de la lista (aca estaria un boton de "ver mas"):');
  for (const t of textos.slice(-12)) di('   ' + JSON.stringify(t.slice(0, 70)));

  const clickeables = Array.from(raiz.querySelectorAll('[role="button"], button, a'))
    .filter((e) => /ver m|mostrar m|see more|load more|mas resultados/i.test(e.textContent || ''));
  di('');
  di('botones de "ver mas" encontrados: ' + clickeables.length);
  for (const b of clickeables.slice(0, 3)) {
    di('   ' + b.tagName.toLowerCase() + ' ' + JSON.stringify((b.textContent || '').trim().slice(0, 60)));
  }

  const texto = out.join('\n');
  console.log(texto);
  return texto;
})();
