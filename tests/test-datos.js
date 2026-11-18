/* Leer las publicaciones de los datos que Facebook le manda a la pagina.

   Las respuestas de tests/datos/ son REALES, sacadas de la pagina de verdad
   (busqueda "audi a4" en escritorio) y anonimizadas: los numeros de
   publicacion, de foto y de vendedor estan cambiados, las fotos apuntan a
   example.invalid, el nombre del vendedor y el seguimiento estan borrados, y
   la zona del usuario esta reemplazada. Titulos, precios y zonas de las
   publicaciones son los de verdad. No necesitan navegador. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.window = {};
require(path.join(__dirname, '../extension/src/lib/datos.js'));
const { datos } = global.window.MPF;

const leer = (n) => fs.readFileSync(path.join(__dirname, 'datos', n), 'utf8');
const GRAPHQL = leer('escritorio-graphql.json');
const PAGINA = leer('escritorio-pagina.json');
const CELULAR = leer('celular-websocket.txt');

let ok = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ok   ' + nombre); }
  catch (e) { console.error('  FALLA ' + nombre + '\n         ' + e.message); process.exitCode = 1; }
}
const porId = (lista) => Object.fromEntries(lista.map((p) => [p.id, p]));

console.log('\nRespuesta real de /api/graphql/ (escritorio)');
const deGraphql = datos.publicacionesDe(GRAPHQL);
const g = porId(deGraphql);

prueba('trae las cinco publicaciones, y la tarjeta vacia de Facebook no cuenta', () =>
  assert.deepStrictEqual(deGraphql.map((p) => p.id), [
    '9100000000015838', '9100000000055432', '9100000000095028',
    '9100000000134624', '9100000000174218']));

prueba('cada una con su enlace, armado con SU numero', () => {
  for (const p of deGraphql) {
    assert.strictEqual(p.url, 'https://www.facebook.com/marketplace/item/' + p.id + '/');
  }
});

prueba('titulo, precio y zona de cada una', () => {
  assert.strictEqual(g['9100000000095028'].titulo, 'Audi A4 Quattro 1.8 Turbo Integral enfierrado');
  assert.strictEqual(g['9100000000095028'].precioTexto, '$14.000');
  assert.strictEqual(g['9100000000095028'].ubicacion, 'Moreno, BA');
  assert.strictEqual(g['9100000000134624'].ubicacion, 'Ciudad de Buenos Aires, CF');
});

prueba('el kilometraje que viene aparte', () =>
  assert.deepStrictEqual(g['9100000000015838'].subtitulos, ['125 mil km']));

prueba('sin precio tachado queda vacio, no "null"', () =>
  assert.strictEqual(g['9100000000015838'].precioAnteriorTexto, ''));

prueba('la foto y la fecha de publicacion', () => {
  assert.strictEqual(g['9100000000015838'].imagen, 'https://example.invalid/foto-1.jpg');
  assert.strictEqual(g['9100000000015838'].creado, 1793822940 * 1000);
});

prueba('no se confunde el numero de la foto ni el del vendedor con el de la publicacion', () => {
  const ids = deGraphql.map((p) => p.id);
  assert.ok(!ids.includes('9100000000023756'), 'tomo el de la foto');
  assert.ok(!ids.includes('9100000000039596'), 'tomo el del vendedor');
});

console.log('\nScript real metido en la pagina (las primeras publicaciones)');
const dePagina = datos.publicacionesDe(PAGINA);
const p = porId(dePagina);

/* El camino ahi es otro y mucho mas hondo:
   require > ... > __bbox > require > ... > __bbox > result > data > ...
   Se encuentra igual porque se busca por la forma, no por el camino. */
prueba('las cuatro, enterradas en la estructura de modulos', () =>
  assert.deepStrictEqual(dePagina.map((x) => x.id), [
    '9100000000205894', '9100000000245488', '9100000000285084', '9100000000324680']));

prueba('el precio tachado, para marcar la bajada desde el primer dia', () => {
  assert.strictEqual(p['9100000000245488'].precioTexto, '$7.500');
  assert.strictEqual(p['9100000000245488'].precioAnteriorTexto, '$9.000');
});

prueba('la zona es la de la publicacion, no el nombre largo de la ciudad', () =>
  assert.strictEqual(p['9100000000245488'].ubicacion, 'Ricardo Rojas, BA'));

prueba('la ubicacion del usuario no es una publicacion', () =>
  assert.ok(!dePagina.some((x) => /prueba/i.test(x.ubicacion))));

prueba('un titulo largo llega entero', () =>
  assert.strictEqual(p['9100000000324680'].titulo,
    'Vendo o permuto Audi a4 1.8tfsi 2009, titular, vtv, automático, 138.000km'));

console.log('\nPor la forma, no por el camino');

prueba('si Facebook la mueve de lugar, se encuentra igual', () => {
  const listing = JSON.parse(GRAPHQL).data.marketplace_search.feed_units.edges[1].node.listing;
  const otro = JSON.stringify({ respuesta: { otra_cosa: [{ envoltorio: { pub: listing } }] } });
  assert.deepStrictEqual(datos.publicacionesDe(otro).map((x) => x.id), ['9100000000015838']);
});

prueba('con "for (;;);" adelante y varios JSON pegados, uno por renglon', () => {
  const linea2 = JSON.stringify({ x: { id: '9100000000999991', marketplace_listing_title: 'Audi A4 Avant 2008' } });
  const crudo = 'for (;;);' + JSON.stringify({ nada: 1 }) + '\n' + GRAPHQL.trim() + '\n' + linea2;
  const ids = datos.publicacionesDe(crudo).map((x) => x.id);
  assert.strictEqual(ids.length, 6);
  assert.ok(ids.includes('9100000000999991'));
});

prueba('sin numero de verdad no es una publicacion: no se inventa un enlace', () => {
  const crudo = JSON.stringify([
    { id: 'abc', marketplace_listing_title: 'Audi A4' },
    { id: '9100000000999992', marketplace_listing_title: '' },
    { id: '9100000000999993', otro_titulo: 'Audi A4' }
  ]);
  assert.deepStrictEqual(datos.publicacionesDe(crudo), []);
});

prueba('un JSON roto no rompe nada', () =>
  assert.deepStrictEqual(datos.publicacionesDe('{"data": {"marketplace_listing_title": '), []));

console.log('\nLa misma publicacion dos veces');

prueba('un dato vacio nunca pisa uno lleno', () => {
  const lleno = { id: '9100000000999994', marketplace_listing_title: 'Audi A4 2012',
                  listing_price: { formatted_amount: '$10.900' },
                  strikethrough_price: { formatted_amount: '$12.500' },
                  location: { reverse_geocode: { city: 'San Isidro', state: 'BA' } } };
  const flaco = { id: '9100000000999994', marketplace_listing_title: 'Audi A4 2012',
                  listing_price: { formatted_amount: '' } };
  const r = datos.publicacionesDe(JSON.stringify([flaco, lleno]));
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].precioTexto, '$10.900');
  assert.strictEqual(r[0].precioAnteriorTexto, '$12.500');
  assert.strictEqual(r[0].ubicacion, 'San Isidro, BA');
});

prueba('completar: lo que manda queda, lo vacio se llena', () => {
  const r = datos.completar({ titulo: 'Audi A4 2012', precioTexto: '' },
                            { titulo: 'otro', precioTexto: '$10.900' });
  assert.deepStrictEqual(r, { titulo: 'Audi A4 2012', precioTexto: '$10.900' });
});

console.log('\nVersion de celular');

/* Medido en la pagina real: el celular recibe las tarjetas por un WebSocket,
   ya armadas como HTML. La tarjeta tiene titulo, precio y zona, y un numero
   de accion (data-action-id) que solo entiende el servidor. El numero de la
   publicacion no esta. */
prueba('lo que llega al celular no trae publicaciones: no hay de donde sacar el numero', () => {
  assert.ok(/for sale/.test(CELULAR));
  assert.deepStrictEqual(datos.publicacionesDe(CELULAR), []);
});

console.log('\n' + ok + ' pruebas de datos pasaron\n');
