/* Parseo de precios de Marketplace Argentina.
   El problema real: los vendedores mezclan dolares y pesos, y Facebook muestra
   "$ 23.500" sin aclarar cual es. Aca se resuelve con dos pasos:
     1) buscar una marca explicita de moneda (US$, u$s, USD, ARS, pesos...)
     2) si no hay marca, inferir por magnitud: un auto no vale 23.500 pesos,
        asi que un monto chico con "$" pelado casi siempre es dolares. */
(() => {
  const MPF = (window.MPF = window.MPF || {});

  // Por encima de este monto, un "$" sin aclarar se considera pesos.
  const UMBRAL_AMBIGUO_POR_DEFECTO = 500000;

  const RE_USD = /(u\$s|us\$|usd|d[oó]lar|dolar)/i;
  const RE_ARS = /(ars|\bpesos?\b|\$ar|m\$n)/i;
  const RE_GRATIS = /\b(gratis|free|a convenir|consultar)\b/i;

  /* Convierte "23.500", "23,500", "1.234.567", "23.500,50" a numero.
     Argentina usa el punto como separador de miles, pero Facebook a veces
     devuelve formato ingles, asi que se decide por la forma del ultimo grupo. */
  function aNumero(textoNumerico) {
    let s = String(textoNumerico).replace(/[^\d.,]/g, '');
    if (!s) return null;

    const tienePunto = s.includes('.');
    const tieneComa = s.includes(',');

    if (tienePunto && tieneComa) {
      // El separador decimal es el que aparece mas a la derecha.
      const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      const miles = decimal === '.' ? ',' : '.';
      s = s.split(miles).join('');
      s = s.replace(decimal, '.');
    } else if (tienePunto || tieneComa) {
      const sep = tienePunto ? '.' : ',';
      const partes = s.split(sep);
      const ultima = partes[partes.length - 1];
      if (partes.length > 2 || ultima.length === 3) {
        // 1.234.567 o 23.500 -> separador de miles
        s = partes.join('');
      } else {
        // 23.5 o 1234,50 -> separador decimal
        s = partes.slice(0, -1).join('') + '.' + ultima;
      }
    }

    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  /* Devuelve { valor, moneda, confianza } a partir del texto de una publicacion.
     confianza: 'explicita' (la moneda estaba escrita), 'inferida' (se dedujo por
     magnitud) o 'sin_precio'. */
  function parsearPrecio(texto, opciones) {
    const opts = opciones || {};
    const umbral = Number(opts.umbralAmbiguo) || UMBRAL_AMBIGUO_POR_DEFECTO;
    const t = String(texto || '');

    if (!t.trim() || RE_GRATIS.test(t)) {
      return { valor: null, moneda: null, confianza: 'sin_precio' };
    }

    // Primer numero que parezca un monto (al menos 3 digitos con separadores).
    const m = t.match(/\d[\d.,]{1,}/);
    if (!m) return { valor: null, moneda: null, confianza: 'sin_precio' };

    const valor = aNumero(m[0]);
    if (valor == null || valor <= 0) {
      return { valor: null, moneda: null, confianza: 'sin_precio' };
    }

    if (RE_USD.test(t)) return { valor, moneda: 'USD', confianza: 'explicita' };
    if (RE_ARS.test(t)) return { valor, moneda: 'ARS', confianza: 'explicita' };

    // "$" pelado: se decide por magnitud.
    const moneda = valor >= umbral ? 'ARS' : 'USD';
    return { valor, moneda, confianza: 'inferida' };
  }

  /* Lleva cualquier precio a dolares para poder comparar todo contra un rango. */
  function aDolares(valor, moneda, cotizacion) {
    if (valor == null) return null;
    if (moneda === 'USD') return valor;
    const c = Number(cotizacion);
    if (!Number.isFinite(c) || c <= 0) return null;
    return valor / c;
  }

  function formatear(valor, moneda) {
    if (valor == null) return 'sin precio';
    const n = Math.round(valor).toLocaleString('es-AR');
    return moneda === 'USD' ? 'US$ ' + n : '$ ' + n;
  }

  MPF.precio = { parsearPrecio, aDolares, aNumero, formatear, UMBRAL_AMBIGUO_POR_DEFECTO };
})();
