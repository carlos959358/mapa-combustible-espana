# Contribuir a mapa-combustible-espana

Gracias por el interés en mejorar el proyecto. Guía rápida:

## Antes de empezar

- Revisa los [issues abiertos](https://github.com/carlos959358/mapa-combustible-espana/issues) para evitar duplicar trabajo.
- Para cambios grandes (nueva funcionalidad, cambio de stack), abre primero un issue para discutir el enfoque.
- Este proyecto sigue el [Código de conducta](CODE_OF_CONDUCT.md).

## Entorno local

Sin build, sin npm. Solo un servidor estático:

```
python3 -m http.server 8000
```

Abre `http://localhost:8000`.

## Estructura del código

Ver la sección "Stack" del [README](README.md#stack) para qué hace cada archivo en `js/`.

## Estilo

- JS/CSS/HTML plano, sin frameworks ni dependencias nuevas salvo que estén justificadas en el issue.
- Módulos ES nativos (`import`/`export`), sin bundler.
- Mantén los comentarios al mínimo: solo cuando el motivo del código no sea obvio.
- Sigue el patrón de nombres y estructura ya presente en `js/*.js`.

## Enviar un cambio

1. Haz fork del repo y crea una rama descriptiva (`fix/...`, `feat/...`).
2. Prueba el cambio localmente en el navegador antes de abrir el PR (mapa, filtros, ficha de estación).
3. Abre el Pull Request describiendo el problema y la solución; enlaza el issue si existe.
4. Un mantenedor revisará y podrá pedir cambios antes de mergear.

## Reportar un bug o proponer una mejora

Usa las [plantillas de issue](.github/ISSUE_TEMPLATE) correspondientes.
