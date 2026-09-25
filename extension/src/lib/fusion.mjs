/* Como se junta lo que ya estaba guardado con una lectura nueva.

   Una lectura posterior puede venir MAS incompleta que la anterior, y eso no
   puede borrar lo que ya se sabia. El caso que lo hizo necesario: la busqueda
   de enlaces entra a la publicacion, encuentra el enlace y lo guarda. Al volver
   atras Facebook redibuja la lista, la tarjeta se lee de nuevo -en la lista no
   hay enlace- y se guarda con el enlace vacio. Juntando "lo nuevo pisa lo
   viejo", ese vacio borraba el enlace que se acababa de encontrar, en todas y
   cada una de las publicaciones.

   La regla: un dato vacio nunca reemplaza a uno que ya tenia valor. Lo que si
   cambia -el precio, las fechas- sigue actualizandose como siempre. */

const QUE_NO_SE_PIERDE = ['url', 'titulo', 'imagen', 'ubicacion', 'provincia', 'km', 'anio'];

function vacio(v) {
  return v == null || v === '';
}

export function fusionar(previo, nuevo) {
  const r = Object.assign({}, previo || {}, nuevo || {});
  if (!previo) return r;
  for (const campo of QUE_NO_SE_PIERDE) {
    if (vacio(nuevo && nuevo[campo]) && !vacio(previo[campo])) r[campo] = previo[campo];
  }
  /* Si quedo con titulo, ya no es una tarjeta sin titulo, venga como venga la
     lectura nueva. */
  if (!vacio(r.titulo)) r.tituloDudoso = false;
  return r;
}
