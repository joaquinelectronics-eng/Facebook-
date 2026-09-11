# Marketplace Filtro Estricto

Extensión de Chrome para buscar autos en Facebook Marketplace sin el ruido que
mete Facebook: si buscás **Audi A5**, ves **solo Audi A5** — no A1, ni A3, ni A4,
ni otras marcas — y solo dentro del rango de precio que pediste.

Además arma un **catálogo local** con todo lo que pasó por tu pantalla, para que
las publicaciones viejas que Facebook entierra no se te pierdan nunca más.

![El panel filtrando en vivo](docs/panel.png)

## Qué resuelve

| El problema de siempre | Lo que hace la extensión |
|---|---|
| Buscás "Audi A5" y te aparecen A1, A3, A4 y otras marcas | Coincidencia estricta en el título: si no dice A5, no aparece |
| Las publicaciones viejas quedan enterradas en el fondo | Todo lo que ves queda guardado en tu PC y se puede ordenar **de la más vieja a la más nueva** |
| Dice "resultados fuera de tu zona" pero son de tu zona | Filtrás vos, por título y precio; la zona la elegís en Marketplace |
| Precios mezclados en dólares y pesos | Detecta la moneda y compara todo contra un mismo rango |
| Vendedores que ponen `$1` para figurar arriba | Se descartan solos |
| No te enterás cuando alguien baja el precio | El catálogo guarda el historial y te marca **cuánto bajó** |

![El catálogo histórico](docs/catalogo.png)

## Instalación en Windows

No está en la Chrome Web Store, así que se carga como extensión de desarrollador.
Es el procedimiento normal de Chrome y lleva un minuto.

1. Descargá este repositorio: botón verde **Code → Download ZIP**.
2. Descomprimilo en una carpeta fija, por ejemplo `C:\Users\TuNombre\marketplace-filtro`.
   **No la borres ni la muevas después**, Chrome la lee de ahí cada vez que arranca.
3. Abrí Chrome y entrá a `chrome://extensions`.
4. Arriba a la derecha, activá **Modo de desarrollador**.
5. Clic en **Cargar descomprimida**.
6. Elegí la carpeta `extension` que está adentro de lo que descomprimiste
   (la que tiene el archivo `manifest.json`).
7. Listo. Entrá a Facebook Marketplace y vas a ver el panel arriba a la derecha.

> Si usás **Edge**, es igual pero en `edge://extensions`.

## Cómo se usa

En el campo **Búsqueda estricta** escribís lo que querés que diga el título:

| Escribís | Qué hace |
|---|---|
| `audi a5` | El título tiene que decir **audi** Y **a5**. A4, A3 y A50 quedan afuera |
| `a4\|a5` | Cualquiera de los dos modelos |
| `"línea nueva"` | Esa frase exacta, en ese orden |
| `audi a5 -permuto -chocado` | Audi A5, pero descarta los que digan permuto o chocado |

Después ponés **Desde** y **Hasta** con el rango de precio y elegís la moneda.
Todo lo que no coincida desaparece de la pantalla al instante.

### El dólar y el peso

En autos los vendedores mezclan monedas todo el tiempo. La extensión funciona así:

- Si el aviso dice `US$`, `u$s` o `USD` → es dólares, sin dudas.
- Si dice `ARS` o `pesos` → es pesos.
- Si dice solamente `$`, decide por el monto: por debajo del umbral que configurás
  (500.000 por defecto) lo toma como dólares, porque ningún auto vale 23.500 pesos.

Cargá el valor del dólar en el campo **Dólar (ARS)** para que los avisos en pesos
se puedan comparar contra un rango en dólares. Actualizalo de vez en cuando.

### El barrido automático

El botón **Barrer hasta el fondo** hace el scroll por vos hasta que se acaban los
resultados, para no bajar media hora a mano.

Está hecho a propósito **sin apuro**: baja de a poco, como una rueda de mouse real,
con pausas de varios segundos entre tandas y pausas más largas cada tantas.
Si tocás el scroll vos, se aparta y espera a que termines.

Podés dejarlo trabajando mientras hacés otra cosa.

## El catálogo: de dónde salen las joyitas

Este es el corazón del asunto.

Cada publicación que pasa por tu pantalla queda guardada en tu computadora. Eso
significa que **una vez que la viste, ya no se pierde nunca**, aunque Facebook la
entierre en el fondo al día siguiente.

Abrilo con **Abrir mi catálogo** (o con el ícono de la extensión). Adentro podés:

- Ordenar **de la más vieja a la más nueva** → ahí están las publicaciones que
  nadie mira hace meses, que es donde suele estar el precio bueno.
- Ver **quién bajó el precio y cuánto** → la extensión guarda el historial de cada
  aviso. Un auto que bajó 17% es un vendedor apurado. Ese es el momento de escribirle.
- Filtrar con la misma búsqueda estricta sobre todo tu historial.
- Exportar a **CSV** para abrirlo en Excel.

A las dos semanas de uso normal tenés tu propio catálogo de autos, buscable de
verdad, mientras Facebook te sigue mostrando su desorden.

## Sobre el riesgo de que te bloqueen

Está pensada para no llamar la atención, y conviene entender por qué:

- **No le pide nada a Facebook.** Los datos los carga la página, con tu sesión y
  tu navegador de siempre. La extensión solo lee lo que ya está en tu pantalla y
  esconde lo que no sirve. Desde el servidor de Facebook, eso es indistinguible
  de vos mirando el monitor.
- **No usa automatización detectable.** No hay Selenium ni Playwright manejando el
  navegador, que es lo que Facebook sí detecta.
- **No manda mensajes ni hace clics automáticos.** Eso es lo que dispara bloqueos
  rápido, y la extensión no lo hace.
- **Nada sale de tu máquina.** El catálogo vive en tu PC. No hay servidor, no hay
  cuenta, no se envía nada a ningún lado.

El único punto de contacto es el ritmo del barrido, y por eso está deliberadamente
lento y con pausas variables.

Aclaración honesta: filtrar y guardar localmente lo que ya ves va contra los
Términos de Servicio de Facebook, igual que cualquier bloqueador de publicidad.
Es tu cuenta, tus ojos y uso personal.

## Si algo deja de andar

Facebook cambia su código seguido. La extensión está hecha para aguantarlo:
**no usa ni una sola clase CSS de Facebook**, porque están ofuscadas y cambian
cada pocas semanas. Se apoya únicamente en el link de cada publicación
(`/marketplace/item/…`), que Facebook no puede cambiar sin romper su propio sitio.

Si algún día no detecta las tarjetas:

1. Recargá la página de Marketplace.
2. Entrá a `chrome://extensions` y tocá el botón de recargar de la extensión.
3. Si sigue sin andar, avisá: el archivo a revisar es
   `extension/src/content/scraper.js`.

## Para desarrollar

```bash
npm install
npm test          # 28 pruebas de lógica + 22 de navegador real
```

Las pruebas levantan Chromium contra una réplica del DOM de Marketplace y
verifican que el filtrado deje exactamente las publicaciones correctas.

### Estructura

```
extension/
  manifest.json
  src/
    lib/
      normalize.js    Texto sin tildes y en minúsculas
      price.js        Parseo de precios argentinos (USD y ARS mezclados)
      matcher.js      Coincidencia estricta de títulos  <- el corazón
    content/
      scraper.js      Lectura del DOM sin usar clases de Facebook
      panel.js        Panel flotante (shadow DOM)
      autoscroll.js   Barrido a ritmo humano
      content.js      Orquestador
    background/
      background.js   Base de datos local (IndexedDB) e historial de precios
    catalog/          La página del catálogo histórico
tests/
  test-logica.js      Matcher y precios
  test-dom.js         Integración en Chromium real
```
