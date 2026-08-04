# Política de seguridad

## Alcance

`mapa-combustible-espana` es un sitio estático (HTML/CSS/JS sin build) desplegado en GitHub Pages. No hay backend propio, base de datos ni autenticación de usuarios; el navegador llama directamente a la API pública del Ministerio para la Transición Ecológica. El riesgo principal en este proyecto es de tipo frontend: XSS, dependencias de terceros (Leaflet vía CDN) o fugas de datos en el propio repositorio.

## Versiones soportadas

Solo se mantiene la rama `main` / lo publicado en producción. No hay versiones antiguas con soporte.

## Reportar una vulnerabilidad

Si encuentras un problema de seguridad (por ejemplo, una vía de XSS, un CDN sin Subresource Integrity, o una dependencia con CVE conocido):

1. **No abras un issue público** si el problema es explotable de inmediato.
2. Escribe a **carlosbeltran228@gmail.com** con una descripción del problema, pasos para reproducirlo y el impacto potencial.
3. Recibirás confirmación en un plazo razonable y se trabajará en una corrección antes de hacer pública la información, cuando el caso lo requiera.

Para sugerencias de bajo riesgo (mejoras de hardening, cabeceras, etc.) puedes abrir un issue normal.
