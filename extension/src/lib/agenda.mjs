/* Calculo de cuando toca la proxima corrida automatica.

   Dos reglas, las dos pensadas para no parecer un robot:

   1) FRANJA HORARIA. Nunca de madrugada. Una persona no entra a Marketplace
      a las cuatro de la mañana, y un patron que si lo hace canta solo.

   2) JITTER. El horario se mueve unos minutos al azar en cada corrida. Correr
      siempre a las 14:00:00 clavadas es de reloj, no de persona. */

export const AUTO_POR_DEFECTO = {
  activo: false,
  cadaMinutos: 60,
  desdeHora: 8,
  hastaHora: 23,
  jitterMinutos: 8,
  notificar: 'ambos',    // 'ambos' | 'bajadas' | 'nada'
  limiteTandas: 18       // barrido corto: lo nuevo esta arriba, no hace falta el fondo
};

/* desde: momento de referencia (por defecto, ahora).
   azar:  inyectable para poder probarlo sin azar de verdad. */
export function calcularProxima(auto, desde, azar) {
  const cfg = Object.assign({}, AUTO_POR_DEFECTO, auto || {});
  const rnd = azar || Math.random;
  const base = new Date(desde == null ? Date.now() : desde);

  const jitter = (rnd() * 2 - 1) * cfg.jitterMinutos * 60000;
  const t = new Date(base.getTime() + cfg.cadaMinutos * 60000 + jitter);

  if (t.getHours() < cfg.desdeHora) {
    // Cayo antes de la franja: se corre al abrir la franja de hoy.
    t.setHours(cfg.desdeHora, Math.floor(rnd() * 20), 0, 0);
  } else if (t.getHours() >= cfg.hastaHora) {
    // Cayo de noche: se corre al abrir la franja de mañana.
    t.setDate(t.getDate() + 1);
    t.setHours(cfg.desdeHora, Math.floor(rnd() * 20), 0, 0);
  }
  return t.getTime();
}

/* Cuantas corridas por dia implica una configuracion. Sirve para avisarle al
   usuario cuanto se esta exponiendo. */
export function corridasPorDia(auto) {
  const cfg = Object.assign({}, AUTO_POR_DEFECTO, auto || {});
  const horas = Math.max(0, cfg.hastaHora - cfg.desdeHora);
  return Math.max(1, Math.round((horas * 60) / cfg.cadaMinutos));
}
