/* Pegar en la consola con Marketplace abierto y publicaciones a la vista.

   Contesta: ¿la direccion de cada publicacion esta en algun lado de la pagina?
   Si esta, la extension la puede sacar y el catalogo te lleva a la publicacion.
   Si no esta, hay que buscarla por otro lado y conviene saberlo ya. */
(() => {
  const out = [];
  const di = (s) => out.push(s);
  const RE = /\/marketplace\/item\/(\d+)/;

  const tarjetas = document.querySelectorAll('[data-mpf-tar], [data-mpf-id]');
  di('publicaciones reconocidas: ' + tarjetas.length);
  if (!tarjetas.length) {
    di('Ninguna. Abri Marketplace y dejá que lea antes de correr esto.');
    console.log(out.join('\n'));
    return out.join('\n');
  }

  di('enlaces <a> a una publicacion: ' +
     document.querySelectorAll('a[href*="/marketplace/item/"]').length);

  /* Donde aparece la direccion dentro de una tarjeta: en que atributo. Saberlo
     es lo que permite sacarla sin adivinar. */
  const donde = new Map();
  let conDireccion = 0;
  for (const caja of tarjetas) {
    let encontrada = '';
    const nodos = [caja].concat(Array.from(caja.querySelectorAll('*')).slice(0, 80));
    for (const n of nodos) {
      for (const a of Array.from(n.attributes || [])) {
        if (RE.test(a.value)) {
          encontrada = n.tagName.toLowerCase() + '[' + a.name + ']';
          break;
        }
      }
      if (encontrada) break;
    }
    if (encontrada) {
      conDireccion++;
      donde.set(encontrada, (donde.get(encontrada) || 0) + 1);
    }
  }
  di('tarjetas con la direccion adentro: ' + conDireccion + ' de ' + tarjetas.length);
  for (const [k, v] of donde) di('   en ' + k + ': ' + v);

  /* Si no esta en las tarjetas, puede estar en la pagina igual -en los datos
     que Facebook manda-, y entonces habria que emparejarlas de otra forma. */
  const enTodaLaPagina = (document.documentElement.innerHTML.match(
    /\/marketplace\/item\/(\d+)/g) || []);
  const distintas = new Set(enTodaLaPagina);
  di('');
  di('direcciones de publicacion en toda la pagina: ' + enTodaLaPagina.length +
     '   distintas: ' + distintas.size);
  di(conDireccion > 0
    ? '>>> SE PUEDE: la direccion esta en la tarjeta.'
    : (distintas.size > 0
      ? '>>> Estan en la pagina pero NO dentro de la tarjeta. Hay que emparejarlas.'
      : '>>> No hay ninguna direccion de publicacion en la pagina.'));

  const texto = out.join('\n');
  console.log(texto);
  return texto;
})();
