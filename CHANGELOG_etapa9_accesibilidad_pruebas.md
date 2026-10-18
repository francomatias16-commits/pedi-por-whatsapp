# Etapa 9 — Accesibilidad, rendimiento y pruebas

## Accesibilidad
- Contraste revisado en los colores principales: texto AA (4,5:1) en todos los pares de texto. Corregido el enlace al pasar el mouse y el texto de marca sobre el menú oscuro (eran 4,1 y 3,6).
- Campos sin etiqueta visible asociada: Productos (código, nombre, precio, categoría), Proveedores, Puntos (WhatsApp, nombre, buscador), Alertas (tipo), Carteles (medidas, código, buscador), Carga masiva.
- Objetivos táctiles de al menos 44 px en el encabezado y el pie.
- Foco visible en teclado y reducción de movimiento respetada (ya estaba, se mantiene).

## Pruebas en navegador (Chromium, ancho 360 px, sin sesión real)
- Sin scroll horizontal en las pantallas revisadas (portada, login, panel).
- Se encontró y corrigió: el contador del menú mostraba "NaN" si la base devolvía un resumen vacío.
- Se encontró y corrigió: la pantalla de Conteo se rompía si la base devolvía algo que no era una sesión.
- Capturas revisadas: login, Inicio, Vender, Mi negocio y bienvenida.

## Pruebas automáticas
- `npm test` en verde, incluida la prueba nueva del modo simple.

## No se hizo en esta etapa (queda para revisar con el kiosquero)
- Lighthouse (rendimiento y accesibilidad con puntaje). No hay build de producción en este entorno: Google Fonts no responde desde acá.
- Prueba con lector de pantalla.
- Prueba manual del cobro completo y del pedido por WhatsApp con datos reales.
- Prueba con usuarios mayores (etapa 0 y etapa 9 del plan).
