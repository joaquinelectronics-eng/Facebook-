/* Pruebas de la logica pura: matcher estricto y parseo de precios.
   No necesitan navegador. */
const assert = require('assert');
const path = require('path');

global.window = {};
require(path.join(__dirname, '../extension/src/lib/normalize.js'));
require(path.join(__dirname, '../extension/src/lib/price.js'));
require(path.join(__dirname, '../extension/src/lib/matcher.js'));
const { matcher, precio } = global.window.MPF;

let ok = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ok   ' + nombre); }
  catch (e) { console.error('  FALLA ' + nombre + '\n         ' + e.message); process.exitCode = 1; }
}

console.log('\nMatcher estricto');
const m = matcher.compilar('audi a5 -permuto -chocado');
const casos = [
  ['Audi A5 2.0 TFSI Quattro 2018', true,  'el modelo justo'],
  ['Audi A4 2.0 TFSI 2017',         false, 'A4 no debe pasar por A5'],
  ['Audi A3 Sportback',             false, 'A3 afuera'],
  ['Audi A1 1.4',                   false, 'A1 afuera'],
  ['AUDI A 5 Coupe impecable',      true,  'con espacio en el medio'],
  ['Audi-A5 2019',                  true,  'con guion en el medio'],
  ['Audi A50 raro',                 false, 'A50 no es A5'],
  ['Audi A5 permuto por menor',     false, 'exclusion por permuto'],
  ['audi a5 sportback chocado',     false, 'exclusion por chocado'],
  ['Volkswagen Vento 2.0',          false, 'otra marca'],
  ['A5 sin marca en el titulo',     false, 'falta la marca requerida']
];
for (const [titulo, esperado, desc] of casos) {
  prueba(desc, () => assert.strictEqual(m.evaluar(titulo).coincide, esperado, titulo));
}

console.log('\nAlternativas y frases');
const m2 = matcher.compilar('audi a4|a5');
prueba('a4|a5 acepta A4', () => assert.ok(m2.evaluar('Audi A4 2017').coincide));
prueba('a4|a5 acepta A5', () => assert.ok(m2.evaluar('Audi A5 2018').coincide));
prueba('a4|a5 rechaza A3', () => assert.ok(!m2.evaluar('Audi A3 2016').coincide));
const m3 = matcher.compilar('"linea nueva"');
prueba('frase en orden',       () => assert.ok(m3.evaluar('Audi A5 linea nueva').coincide));
prueba('frase desordenada no', () => assert.ok(!m3.evaluar('Audi A5 nueva linea').coincide));
const m4 = matcher.compilar('corolla');
prueba('tolera plural', () => assert.ok(m4.evaluar('Toyota Corollas usados').coincide));
prueba('consulta vacia no filtra', () => assert.ok(matcher.compilar('').vacia));

console.log('\nPrecios (Argentina: dolares y pesos mezclados)');
const p = [
  ['US$ 23.500',    23500,    'USD', 'explicita'],
  ['u$s 18500',     18500,    'USD', 'explicita'],
  ['USD 12,500',    12500,    'USD', 'explicita'],
  ['ARS 30.000.000',30000000, 'ARS', 'explicita'],
  ['$ 23.500',      23500,    'USD', 'inferida'],
  ['$ 45.900.000',  45900000, 'ARS', 'inferida'],
  ['23.500 dolares',23500,    'USD', 'explicita']
];
for (const [texto, valor, moneda, confianza] of p) {
  prueba(texto, () => {
    const r = precio.parsearPrecio(texto);
    assert.strictEqual(r.valor, valor);
    assert.strictEqual(r.moneda, moneda);
    assert.strictEqual(r.confianza, confianza);
  });
}
prueba('descarta el truco del $1', () => {
  assert.strictEqual(precio.parsearPrecio('$1').confianza, 'sin_precio');
});
prueba('descarta "a convenir"', () => {
  assert.strictEqual(precio.parsearPrecio('Precio a convenir').confianza, 'sin_precio');
});
prueba('convierte pesos a dolares', () => {
  assert.strictEqual(precio.aDolares(28000000, 'ARS', 1000), 28000);
});

console.log('\n' + ok + ' pruebas de logica pasaron\n');
