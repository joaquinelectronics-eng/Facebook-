/* Coincidencia estricta de titulos.
   Este archivo es el que resuelve el dolor principal: buscar "audi a5" y que
   NO aparezcan A1, A3, A4 ni otras marcas.

   Sintaxis de busqueda soportada:
     audi a5              -> el titulo debe contener "audi" Y "a5"
     a4|a5                -> alguna de las dos alternativas
     "linea nueva"        -> la frase exacta, en ese orden
     -permuto -chocado    -> descarta si aparece cualquiera de esos
     -"no anda"           -> descarta la frase

   La clave esta en los limites: el patron de "a5" se construye de forma que
   no pueda matchear "a50", "a4" ni quedar pegado a otro caracter alfanumerico. */
(() => {
  const MPF = (window.MPF = window.MPF || {});
  const escaparRegex = MPF.escaparRegex;
  const normalizar = MPF.normalizar;

  // Separadores que un vendedor puede meter en el medio de un modelo: "a 5", "a-5".
  const SEP = '[\\s._\\-]?';

  /* Parte un termino en tandas de letras y de numeros.
     "a5" -> ["a","5"] | "320i" -> ["320","i"] | "audi" -> ["audi"] */
  function tandas(termino) {
    return termino.match(/[a-z]+|[0-9]+/g) || [];
  }

  /* Construye el patron de UN termino suelto, con limites estrictos a los lados. */
  function patronTermino(termino) {
    const t = normalizar(termino).replace(/[^a-z0-9]/g, '');
    if (!t) return null;

    const partes = tandas(t);
    if (!partes.length) return null;

    const cuerpo = partes.map(escaparRegex).join(SEP);

    // Solo letras y razonablemente largo -> se tolera el plural ("corollas").
    const soloLetras = /^[a-z]+$/.test(t);
    const plural = soloLetras && t.length >= 4 ? '(?:s|es)?' : '';

    // Los lookarounds impiden que "a5" matchee dentro de "a50" o "xa5".
    return '(?<![a-z0-9])' + cuerpo + plural + '(?![a-z0-9])';
  }

  /* Construye el patron de una frase entre comillas: los terminos en ese orden. */
  function patronFrase(frase) {
    const partes = normalizar(frase).split(/\s+/).filter(Boolean);
    const cuerpos = partes.map(patronTermino).filter(Boolean);
    if (!cuerpos.length) return null;
    // Se quitan los limites internos y se unen exigiendo separacion real.
    return cuerpos.join('[\\s._\\-]+');
  }

  /* Un "requisito" puede tener alternativas separadas por |. */
  function compilarRequisito(texto, esFrase) {
    const alternativas = esFrase ? [texto] : String(texto).split('|');
    const patrones = alternativas
      .map((a) => (esFrase ? patronFrase(a) : patronTermino(a)))
      .filter(Boolean);
    if (!patrones.length) return null;
    try {
      return new RegExp('(?:' + patrones.join('|') + ')', 'i');
    } catch (e) {
      return null;
    }
  }

  /* Tokeniza la consulta respetando comillas y el prefijo "-" de exclusion. */
  function tokenizar(consulta) {
    const tokens = [];
    const re = /(-?)"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(consulta)) !== null) {
      if (m[2] !== undefined) {
        tokens.push({ negado: m[1] === '-', frase: true, texto: m[2] });
      } else {
        const crudo = m[3];
        const negado = crudo.startsWith('-') && crudo.length > 1;
        tokens.push({ negado, frase: false, texto: negado ? crudo.slice(1) : crudo });
      }
    }
    return tokens;
  }

  /* Compila una consulta a un objeto reutilizable. Compilar una vez y aplicar a
     cientos de tarjetas es mucho mas barato que rearmar regex por tarjeta. */
  function compilar(consulta) {
    const requeridos = [];
    const excluidos = [];

    for (const tok of tokenizar(normalizar(consulta || ''))) {
      const re = compilarRequisito(tok.texto, tok.frase);
      if (!re) continue;
      (tok.negado ? excluidos : requeridos).push({ re, texto: tok.texto });
    }

    return {
      vacia: requeridos.length === 0 && excluidos.length === 0,
      requeridos,
      excluidos,

      /* Devuelve { coincide, motivo }. El motivo sirve para mostrarle al usuario
         por que se descarto una publicacion. */
      evaluar(titulo) {
        const t = normalizar(titulo);
        if (!t) return { coincide: false, motivo: 'sin titulo' };

        for (const ex of excluidos) {
          if (ex.re.test(t)) return { coincide: false, motivo: 'excluido: ' + ex.texto };
        }
        for (const req of requeridos) {
          if (!req.re.test(t)) return { coincide: false, motivo: 'falta: ' + req.texto };
        }
        return { coincide: true, motivo: '' };
      }
    };
  }

  MPF.matcher = { compilar, patronTermino, tokenizar };
})();
