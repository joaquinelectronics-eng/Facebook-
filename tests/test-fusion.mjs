/* Como se junta lo guardado con una lectura nueva. */
import assert from 'node:assert';
import { fusionar } from '../extension/src/lib/fusion.mjs';

let ok = 0, fallas = 0;
const prueba = (nombre, fn) => {
  try { fn(); ok++; console.log('  ok   ' + nombre); }
  catch (e) { fallas++; console.error('  FALLA ' + nombre + '\n         ' + e.message); }
};

console.log('\nJuntar lo guardado con una lectura nueva');

/* El caso que lo hizo necesario: la busqueda de enlaces encuentra el enlace,
   y al volver a la lista la tarjeta se relee sin enlace. */
prueba('un enlace vacio no borra el que ya se habia encontrado', () => {
  const r = fusionar({ id: 'a', url: 'https://www.facebook.com/marketplace/item/1/' },
                     { id: 'a', url: '' });
  assert.strictEqual(r.url, 'https://www.facebook.com/marketplace/item/1/');
});

prueba('un titulo vacio no borra el que ya estaba', () => {
  const r = fusionar({ titulo: 'Audi A4 1.8 TFSI 2009' }, { titulo: '', tituloDudoso: true });
  assert.strictEqual(r.titulo, 'Audi A4 1.8 TFSI 2009');
  assert.strictEqual(r.tituloDudoso, false);
});

prueba('lo que cambia de verdad si se actualiza', () => {
  const r = fusionar({ precioUSD: 12000, url: 'x' }, { precioUSD: 11000, url: '' });
  assert.strictEqual(r.precioUSD, 11000);
});

prueba('un enlace nuevo si reemplaza a uno vacio', () => {
  const r = fusionar({ url: '' }, { url: 'https://www.facebook.com/marketplace/item/2/' });
  assert.strictEqual(r.url, 'https://www.facebook.com/marketplace/item/2/');
});

prueba('sin nada guardado, queda lo nuevo', () => {
  const r = fusionar(null, { id: 'b', url: '' });
  assert.strictEqual(r.id, 'b');
});

if (fallas) { console.error('\n' + fallas + ' pruebas de fusion fallaron\n'); process.exit(1); }
console.log('\n' + ok + ' pruebas de fusion pasaron\n');
