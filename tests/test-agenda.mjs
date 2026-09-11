/* Pruebas de la programacion de corridas automaticas.
   El azar se inyecta para que los resultados sean reproducibles. */
import assert from 'node:assert';
import { calcularProxima, corridasPorDia, AUTO_POR_DEFECTO } from '../extension/src/lib/agenda.mjs';

let ok = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ok   ' + nombre); }
  catch (e) { console.error('  FALLA ' + nombre + '\n         ' + e.message); process.exitCode = 1; }
}

const sinAzar = () => 0.5;          // jitter cero, minuto 10
const auto = Object.assign({}, AUTO_POR_DEFECTO, { activo: true, cadaMinutos: 60 });
const en = (h, m) => new Date(2026, 2, 10, h, m, 0, 0).getTime();
const hora = (ms) => new Date(ms).getHours();
const dia = (ms) => new Date(ms).getDate();

console.log('\nFranja horaria (8 a 23)');
prueba('a las 14:00 la proxima es a las 15', () =>
  assert.strictEqual(hora(calcularProxima(auto, en(14, 0), sinAzar)), 15));
prueba('a las 22:40 no corre a las 23:40: pasa a maniana', () => {
  const t = calcularProxima(auto, en(22, 40), sinAzar);
  assert.strictEqual(hora(t), 8);
  assert.strictEqual(dia(t), 11);
});
prueba('a las 3 de la maniana corre recien a las 8', () => {
  const t = calcularProxima(auto, en(3, 0), sinAzar);
  assert.strictEqual(hora(t), 8);
  assert.strictEqual(dia(t), 10);
});
prueba('a las 23:10 pasa a maniana', () =>
  assert.strictEqual(dia(calcularProxima(auto, en(23, 10), sinAzar)), 11));
prueba('nunca programa dentro de la madrugada', () => {
  for (let h = 0; h < 24; h++) {
    for (const r of [0.0, 0.25, 0.5, 0.75, 0.999]) {
      const t = calcularProxima(auto, en(h, 30), () => r);
      const hp = hora(t);
      assert.ok(hp >= auto.desdeHora && hp < auto.hastaHora,
        'programo a las ' + hp + ' saliendo de las ' + h + ':30 con azar ' + r);
    }
  }
});

console.log('\nJitter');
prueba('el horario se mueve con el azar', () => {
  const a = calcularProxima(auto, en(14, 0), () => 0.0);
  const b = calcularProxima(auto, en(14, 0), () => 1.0);
  assert.notStrictEqual(a, b);
  // 8 minutos para cada lado: 16 minutos de diferencia entre los extremos.
  assert.strictEqual(Math.round((b - a) / 60000), 2 * auto.jitterMinutos);
});
prueba('el jitter no se pasa de lo configurado', () => {
  for (let i = 0; i < 200; i++) {
    const t = calcularProxima(auto, en(14, 0));
    const diff = Math.abs(t - en(15, 0)) / 60000;
    assert.ok(diff <= auto.jitterMinutos + 0.01, 'se desvio ' + diff + ' minutos');
  }
});

console.log('\nCorridas por dia');
prueba('cada hora de 8 a 23 son 15 corridas', () =>
  assert.strictEqual(corridasPorDia({ cadaMinutos: 60 }), 15));
prueba('cada 3 horas son 5 corridas', () =>
  assert.strictEqual(corridasPorDia({ cadaMinutos: 180 }), 5));
prueba('una vez por dia es 1 corrida', () =>
  assert.strictEqual(corridasPorDia({ cadaMinutos: 1440 }), 1));

console.log('\n' + ok + ' pruebas de agenda pasaron\n');
