# mapa-combustible-espana

Mapa interactivo con el precio de la gasolina, el diésel y el resto de combustibles en más de 11.000 gasolineras de España, con datos oficiales y en tiempo real del Gobierno de España.

🔗 **Demo:** https://carlos959358.github.io/mapa-combustible-espana/

## Qué hace

- **Mapa con clustering** (Leaflet + Leaflet.markercluster): agrupa estaciones a nivel nacional/regional y muestra cada gasolinera individualmente a partir de zoom de ciudad, con el precio como etiqueta permanente sobre cada punto.
- **Color por precio**: cada estación se pinta en una escala verde → rojo según su precio para el combustible seleccionado, relativa a lo que hay visible en ese momento.
- **Filtros**: combustible, comunidad autónoma, provincia, municipio (con autocompletado), rango de precio y búsqueda por marca (con agrupación automática de cadenas con muchas estaciones, p. ej. "BP" en vez de cada sucursal suelta).
- **"Más barata en el mapa"**: aviso siempre visible con la estación más económica dentro de lo que se ve en pantalla; al pulsarlo, centra el mapa y abre su ficha.
- **Ficha de estación**: marca, dirección, horario, tipo de venta y precio de todos los combustibles que vende, con el filtrado resaltado.
- **Histórico de precio medio**: gráfico de los últimos 7 o 30 días del precio medio nacional del combustible seleccionado.
- **Geolocalización**: centra el mapa en la ubicación del usuario al entrar (si da permiso) o bajo demanda con el botón "Usar mi ubicación".
- **Enlaces directos por ciudad** (`?municipio=Madrid`, etc.) para aterrizar ya filtrado, pensados para SEO.

## Fuente de datos

[API pública "Precios de Carburantes"](https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/help) del Ministerio para la Transición Ecológica. No hay backend propio: el navegador llama directamente a la API (tiene CORS abierto). Los precios se cargan de forma incremental por combustible (`FiltroProducto`) en vez de descargar el volcado completo de todas las estaciones (~12 MB) de golpe; al abrir la ficha de una estación se completa con el resto de sus combustibles vía el endpoint por provincia.

## Stack

HTML/CSS/JS puro con módulos ES nativos — sin build, sin npm. Leaflet y Leaflet.markercluster se cargan por CDN con Subresource Integrity.

```
index.html        Layout, metadatos SEO/Open Graph/JSON-LD y contenido de apoyo
css/style.css      Tema "Alexandria" (serif editorial + superficies en capas)
js/api.js          Llamadas a la API oficial y normalización de estaciones
js/filters.js      Poblado de selects/datalists y pipeline de filtrado
js/map.js          Inicialización de Leaflet, clustering, colores y popups
js/chart.js        Gráfico SVG del histórico de precio medio
js/utils.js        Parsers (números/fechas en formato español), helpers varios
js/main.js         Orquestación: carga de datos, estado y eventos
```

## Desarrollo local

```
python3 -m http.server 8000
```

y abrir `http://localhost:8000`.

## Despliegue

Sitio estático publicado en GitHub Pages (`.nojekyll`, `robots.txt` y `sitemap.xml` incluidos).
