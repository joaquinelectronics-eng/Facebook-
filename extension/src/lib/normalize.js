/* Normalizacion de texto. Todo el matching trabaja sobre texto normalizado:
   sin tildes, en minusculas y con los espacios colapsados. */
(() => {
  const MPF = (window.MPF = window.MPF || {});

  function normalizar(texto) {
    return (texto == null ? '' : String(texto))
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')   // saca tildes y dieresis
      .toLowerCase()
      .replace(/[‘’'`´]/g, '')  // apostrofes de todo tipo
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Escapa un texto para poder meterlo dentro de una expresion regular.
  function escaparRegex(texto) {
    return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  MPF.normalizar = normalizar;
  MPF.escaparRegex = escaparRegex;
})();
