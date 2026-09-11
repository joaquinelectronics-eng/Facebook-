/* Deteccion de provincia a partir de la ubicacion del aviso.

   Facebook muestra la zona de tres formas distintas, todas presentes en una
   misma pagina de resultados:
       "Olivos, BA"                  ciudad + abreviatura de provincia
       "Ciudad de Buenos Aires"      nombre completo, sin abreviatura
       "Ciudad de Buenos Aires, CF"  con abreviatura

   Por eso se prueba en tres pasos: abreviatura despues de la ultima coma,
   despues frases completas, y por ultimo ciudades conocidas.

   REGLA IMPORTANTE: si no se puede determinar la provincia, el aviso NO se
   descarta. Es preferible que se cuele uno de mas a perder una publicacion
   buena por una localidad que no esta en la lista. */
(() => {
  const MPF = (window.MPF = window.MPF || {});
  const normalizar = MPF.normalizar;

  /* Solo se usan abreviaturas de dos letras o mas: las de una sola letra
     generan falsos positivos con cualquier cosa. */
  const PROVINCIAS = [
    { id: 'CABA', nombre: 'Ciudad de Buenos Aires', corto: 'CABA',
      abrev: ['cf', 'caba'],
      frases: ['ciudad autonoma de buenos aires', 'ciudad de buenos aires', 'capital federal'],
      ciudades: ['palermo', 'belgrano', 'recoleta', 'caballito', 'villa urquiza', 'flores',
                 'almagro', 'nunez', 'saavedra', 'devoto', 'villa crespo', 'colegiales',
                 'barracas', 'boedo', 'liniers', 'mataderos', 'puerto madero'] },

    { id: 'BA', nombre: 'Buenos Aires', corto: 'Bs As',
      abrev: ['ba', 'bsas'],
      frases: ['provincia de buenos aires', 'buenos aires'],
      ciudades: ['olivos', 'martinez', 'san isidro', 'vicente lopez', 'florida', 'beccar',
                 'boulogne', 'tigre', 'san fernando', 'nordelta', 'del viso', 'garin',
                 'ingeniero maschwitz', 'escobar', 'pilar', 'san miguel', 'jose c paz',
                 'moreno', 'merlo', 'ituzaingo', 'castelar', 'moron', 'hurlingham',
                 'ramos mejia', 'san justo', 'caseros', 'san martin', 'villa ballester',
                 'avellaneda', 'lanus', 'lomas de zamora', 'banfield', 'temperley',
                 'adrogue', 'burzaco', 'monte grande', 'ezeiza', 'quilmes', 'berazategui',
                 'florencio varela', 'canuelas', 'san vicente', 'la plata', 'berisso',
                 'ensenada', 'mar del plata', 'bahia blanca', 'tandil', 'junin',
                 'pergamino', 'olavarria', 'necochea', 'azul', 'chivilcoy', 'lujan',
                 'zarate', 'campana', 'san nicolas', 'chascomus', 'dolores', 'pinamar',
                 'villa gesell', 'miramar', 'balcarce', 'trenque lauquen', 'mercedes'] },

    { id: 'SF', nombre: 'Santa Fe', corto: 'Santa Fe',
      abrev: ['sf'],
      frases: ['santa fe'],
      ciudades: ['rosario', 'funes', 'roldan', 'perez', 'villa gobernador galvez',
                 'san lorenzo', 'granadero baigorria', 'capitan bermudez', 'rafaela',
                 'venado tuerto', 'reconquista', 'esperanza', 'casilda',
                 'canada de gomez', 'sunchales', 'firmat', 'san jorge'] },

    { id: 'ER', nombre: 'Entre Rios', corto: 'Entre Rios',
      abrev: ['er'],
      frases: ['entre rios'],
      ciudades: ['parana', 'concordia', 'gualeguaychu', 'concepcion del uruguay',
                 'gualeguay', 'victoria', 'villaguay', 'nogoya', 'chajari',
                 'colon', 'la paz', 'diamante', 'crespo'] },

    { id: 'LP', nombre: 'La Pampa', corto: 'La Pampa',
      abrev: ['lp'],
      frases: ['la pampa'],
      ciudades: ['santa rosa', 'general pico', 'toay', 'realico', 'general acha',
                 'eduardo castex', 'victorica'] },

    { id: 'CB', nombre: 'Cordoba', corto: 'Cordoba',
      abrev: ['cb', 'cd'], frases: ['cordoba'],
      ciudades: ['villa carlos paz', 'rio cuarto', 'villa maria', 'san francisco',
                 'alta gracia', 'jesus maria', 'rio tercero', 'bell ville'] },
    { id: 'MZ', nombre: 'Mendoza', corto: 'Mendoza',
      abrev: ['mz'], frases: ['mendoza'],
      ciudades: ['godoy cruz', 'san rafael', 'lujan de cuyo', 'maipu', 'guaymallen'] },
    { id: 'TM', nombre: 'Tucuman', corto: 'Tucuman',
      abrev: ['tm'], frases: ['tucuman'], ciudades: ['yerba buena', 'concepcion'] },
    { id: 'SA', nombre: 'Salta', corto: 'Salta', abrev: ['sa'], frases: ['salta'], ciudades: [] },
    { id: 'NQ', nombre: 'Neuquen', corto: 'Neuquen',
      abrev: ['nq'], frases: ['neuquen'], ciudades: ['plottier', 'centenario', 'cutral co'] },
    { id: 'RN', nombre: 'Rio Negro', corto: 'Rio Negro',
      abrev: ['rn'], frases: ['rio negro'],
      ciudades: ['bariloche', 'general roca', 'cipolletti', 'viedma'] },
    { id: 'CR', nombre: 'Corrientes', corto: 'Corrientes',
      abrev: ['cr'], frases: ['corrientes'], ciudades: ['goya', 'paso de los libres'] },
    { id: 'CC', nombre: 'Chaco', corto: 'Chaco',
      abrev: ['cc'], frases: ['chaco'], ciudades: ['resistencia', 'saenz pena'] },
    { id: 'MN', nombre: 'Misiones', corto: 'Misiones',
      abrev: ['mn'], frases: ['misiones'], ciudades: ['posadas', 'obera', 'eldorado'] },
    { id: 'SJ', nombre: 'San Juan', corto: 'San Juan', abrev: ['sj'], frases: ['san juan'], ciudades: [] },
    { id: 'SL', nombre: 'San Luis', corto: 'San Luis',
      abrev: ['sl'], frases: ['san luis'], ciudades: ['villa mercedes', 'merlo'] },
    { id: 'SE', nombre: 'Santiago del Estero', corto: 'Sgo. del Estero',
      abrev: ['se'], frases: ['santiago del estero'], ciudades: ['la banda'] },
    { id: 'JY', nombre: 'Jujuy', corto: 'Jujuy', abrev: ['jy'], frases: ['jujuy'], ciudades: [] },
    { id: 'CT', nombre: 'Catamarca', corto: 'Catamarca', abrev: ['ct'], frases: ['catamarca'], ciudades: [] },
    { id: 'LR', nombre: 'La Rioja', corto: 'La Rioja', abrev: ['lr'], frases: ['la rioja'], ciudades: [] },
    { id: 'FM', nombre: 'Formosa', corto: 'Formosa', abrev: ['fm'], frases: ['formosa'], ciudades: [] },
    { id: 'CH', nombre: 'Chubut', corto: 'Chubut',
      abrev: ['ch'], frases: ['chubut'], ciudades: ['comodoro rivadavia', 'trelew', 'puerto madryn'] },
    { id: 'SC', nombre: 'Santa Cruz', corto: 'Santa Cruz',
      abrev: ['sc'], frases: ['santa cruz'], ciudades: ['rio gallegos', 'caleta olivia'] },
    { id: 'TF', nombre: 'Tierra del Fuego', corto: 'Tierra del Fuego',
      abrev: ['tf'], frases: ['tierra del fuego'], ciudades: ['ushuaia', 'rio grande'] }
  ];

  // Indices para no recorrer todo el arreglo en cada tarjeta.
  const PorAbrev = new Map();
  for (const p of PROVINCIAS) for (const a of p.abrev) PorAbrev.set(a, p.id);

  /* Las frases se prueban de la mas larga a la mas corta para que
     "ciudad de buenos aires" gane antes que "buenos aires". */
  const FRASES = [];
  for (const p of PROVINCIAS) for (const f of p.frases) FRASES.push({ f, id: p.id });
  FRASES.sort((a, b) => b.f.length - a.f.length);

  const CIUDADES = [];
  for (const p of PROVINCIAS) for (const c of p.ciudades) CIUDADES.push({ c, id: p.id });
  CIUDADES.sort((a, b) => b.c.length - a.c.length);

  function contienePalabra(texto, frase) {
    const i = texto.indexOf(frase);
    if (i < 0) return false;
    const antes = i === 0 ? ' ' : texto[i - 1];
    const despues = i + frase.length >= texto.length ? ' ' : texto[i + frase.length];
    return !/[a-z0-9]/.test(antes) && !/[a-z0-9]/.test(despues);
  }

  /* Devuelve el id de provincia, o null si no se pudo determinar. */
  function detectarProvincia(ubicacion) {
    const t = normalizar(ubicacion);
    if (!t) return null;

    // 1) Abreviatura despues de la ultima coma: "Olivos, BA"
    const coma = t.lastIndexOf(',');
    if (coma >= 0) {
      const sufijo = t.slice(coma + 1).trim();
      if (PorAbrev.has(sufijo)) return PorAbrev.get(sufijo);
    }

    // 2) Nombre de provincia escrito completo
    for (const { f, id } of FRASES) if (contienePalabra(t, f)) return id;

    // 3) Ciudad conocida
    for (const { c, id } of CIUDADES) if (contienePalabra(t, c)) return id;

    return null;
  }

  function nombreDe(id) {
    const p = PROVINCIAS.find((x) => x.id === id);
    return p ? p.nombre : null;
  }

  function cortoDe(id) {
    const p = PROVINCIAS.find((x) => x.id === id);
    return p ? p.corto : null;
  }

  MPF.zonas = { PROVINCIAS, detectarProvincia, nombreDe, cortoDe };
})();
