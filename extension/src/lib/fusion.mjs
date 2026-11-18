/* Como se junta lo que ya estaba guardado con una lectura nueva.

   Una lectura posterior puede venir MAS incompleta que la anterior, y eso no
   puede borrar lo que ya se sabia. El caso que lo hizo necesario: una
   publicacion se guarda con su enlace y su titulo, y despues la misma tarjeta
   se relee de la pantalla sin titulo -todavia no se dibujo- o sin enlace.
   Juntando "lo nuevo pisa lo viejo", ese vacio borraba lo que ya se sabia, en
   todas y cada una de las publicaciones. Hoy el enlace y el titulo vienen de
   los datos que manda Facebook (lib/datos.js), y esta regla es la que hace
   que una relectura pobre no los borre.

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
