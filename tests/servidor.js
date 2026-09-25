/* Servidor estatico minimo para las pruebas.
   Hace falta porque catalog.js usa modulos ES y Chrome los bloquea sobre
   file:// por CORS. Sirviendolo por http se prueba igual que en la extension. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json'
};

/* alias permite servir un archivo bajo una ruta inventada. Se usa para montar
   el fixture en /marketplace/search, que es donde la extension espera estar:
   el content script se activa segun la URL. */
function servir(raiz, alias) {
  return new Promise((resolver) => {
    const srv = http.createServer((req, resp) => {
      const rel = decodeURIComponent(String(req.url).split('?')[0]);
      /* Un alias que termina en '*' vale para todo lo que empieza asi:
         /marketplace/item/* sirve cualquier publicacion. */
      const mapeado = alias && Object.keys(alias).find((k) => rel === k || rel === k + '/' ||
        (k.endsWith('*') && rel.startsWith(k.slice(0, -1))));
      const destino = mapeado ? path.resolve(raiz, alias[mapeado]) : path.join(raiz, rel);
      if (!destino.startsWith(raiz)) { resp.writeHead(403); return resp.end(); }
      fs.readFile(destino, (err, datos) => {
        if (err) { resp.writeHead(404); return resp.end('no encontrado'); }
        resp.writeHead(200, { 'Content-Type': TIPOS[path.extname(destino)] || 'text/plain' });
        resp.end(datos);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolver({ srv, base: 'http://127.0.0.1:' + srv.address().port }));
  });
}

module.exports = { servir };
