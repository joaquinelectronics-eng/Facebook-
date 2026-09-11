/* Parseo de precios de Marketplace Argentina.

   Tres problemas reales que hay que resolver juntos:

   1) MONEDA MEZCLADA. Los vendedores publican en dolares y en pesos sin
      aclarar cual. "$ 23.500" no dice nada por si solo.

   2) PRECIO ABREVIADO. Es muy comun que pongan "13" en vez de 13.000, o
      "13 palos" por 13.000.000. Si se leen literal, esos avisos se pierden.

   3) PRECIO TRUCHO. Ponen "$1" o "$111" para figurar arriba en el orden por
      precio. Esos valores de relleno se descartan: el aviso queda "sin precio"
      y se muestra solo si pediste ver los sin precio.

   El orden de resolucion es: multiplicador explicito -> abreviatura ->
   moneda explicita -> inferencia por magnitud. */
(() => {
  const MPF = (window.MPF = window.MPF || {});

  // Por encima de este monto, un "$" sin aclarar se considera pesos.
  const UMBRAL_AMBIGUO_POR_DEFECTO = 500000;

  // Por debajo de esto, un precio de auto esta abreviado: "13" son 13.000.
  const UMBRAL_ABREVIADO = 1000;

  // Precios de relleno para figurar primero en el orden por precio.
  const VALORES_TRUCHOS = new Set([1, 111, 1111, 11111, 111111, 123, 1234, 12345, 123456]);

  const RE_USD = /(u\$s|us\$|usd|d[oó]lar)/i;
  const RE_ARS = /(ars|\bpesos?\b|\$ar|m\$n)/i;
  const RE_GRATIS = /\b(gratis|free|a convenir|consultar|preguntar)\b/i;

  /* Sufijos de magnitud. "palos", "lucas" y "millones" ademas implican pesos:
     nadie dice "13 palos verdes" para hablar de dolares. */
  const MULTIPLICADORES = [
    { re: /\b(palos?|millones?|melones?)\b/i,      factor: 1e6,  moneda: 'ARS' },
    { re: /\b(lucas?)\b/i,                          factor: 1e3,  moneda: 'ARS' },
    { re: /\b(mil)\b/i,                             factor: 1e3,  moneda: null },
    { re: /\d\s*(k)\b/i,                            factor: 1e3,  moneda: null },
    { re: /\d\s*(m)\b(?!il)/i,                      factor: 1e6,  moneda: null }
  ];

  /* Convierte "23.500", "23,500", "1.234.567", "13,5" a numero.
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
        s = partes.join('');            // 1.234.567 o 23.500 -> miles
      } else {
        s = partes.slice(0, -1).join('') + '.' + ultima;  // 13,5 -> decimal
      }
    }

    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  /* Devuelve { valor, moneda, confianza, abreviado } o valor null.
     confianza: 'explicita' | 'inferida' | 'sin_precio'
     abreviado: true si hubo que expandir "13" a 13.000 */
  function parsearPrecio(texto, opciones) {
    const opts = opciones || {};
    const umbral = Number(opts.umbralAmbiguo) || UMBRAL_AMBIGUO_POR_DEFECTO;
    const t = String(texto || '');
    const vacio = { valor: null, moneda: null, confianza: 'sin_precio', abreviado: false };

    if (!t.trim() || RE_GRATIS.test(t)) return vacio;

    const m = t.match(/\d[\d.,]*/);
    if (!m) return vacio;

    let valor = aNumero(m[0]);
    if (valor == null || valor <= 0) return vacio;

    // Lo que viene despues del numero puede traer el multiplicador.
    const cola = t.slice(m.index + m[0].length, m.index + m[0].length + 14);
    let monedaPorSufijo = null;
    let huboMultiplicador = false;

    for (const mul of MULTIPLICADORES) {
      // Para "k" y "m" el patron incluye el digito previo, asi que se prueba
      // contra el numero pegado a la cola.
      const objetivo = mul.re.source.startsWith('\\d') ? m[0].slice(-1) + cola : cola;
      if (mul.re.test(objetivo)) {
        valor *= mul.factor;
        if (mul.moneda) monedaPorSufijo = mul.moneda;
        huboMultiplicador = true;
        break;
      }
    }

    // Numeros de relleno para figurar arriba: no son precios.
    if (!huboMultiplicador && VALORES_TRUCHOS.has(valor)) return vacio;

    /* Abreviatura: "13" o "13,5" en el campo de precio de un auto siempre
       significa miles. Se aplica solo si no hubo un multiplicador explicito. */
    let abreviado = false;
    if (!huboMultiplicador && valor < UMBRAL_ABREVIADO) {
      valor *= 1000;
      abreviado = true;
    }

    if (RE_USD.test(t)) return { valor, moneda: 'USD', confianza: 'explicita', abreviado };
    if (RE_ARS.test(t)) return { valor, moneda: 'ARS', confianza: 'explicita', abreviado };
    if (monedaPorSufijo) return { valor, moneda: monedaPorSufijo, confianza: 'explicita', abreviado };

    // "$" pelado: se decide por magnitud.
    return { valor, moneda: valor >= umbral ? 'ARS' : 'USD', confianza: 'inferida', abreviado };
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

  MPF.precio = {
    parsearPrecio, aDolares, aNumero, formatear,
    UMBRAL_AMBIGUO_POR_DEFECTO, UMBRAL_ABREVIADO
  };
})();
