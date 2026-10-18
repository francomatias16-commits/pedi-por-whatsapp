# Etapa 2 — Sistema de diseño accesible

Solo presentación; no cambia datos ni consultas. `tsc` y `npm test` en verde.

## Estilo (`app/globals.css`, bloque final "Etapa 2")
- Texto base 18 px; piso de lectura 16 px (`.mut` pasó de 14,7 a 16 px).
- Rótulos y etiquetas de campo: sin mayúsculas ni tipografía mono; mínimo 14,4 px (antes 10–11 px).
- Botones y campos de 48 px de alto; botones de cantidad de 44 px.
- Foco visible de 3 px (claro sobre el menú oscuro).
- Placeholder con contraste suficiente.
- Menú lateral: títulos de grupo y subtítulos más grandes y con más contraste.
- Colores sueltos (`#c0392b`, `#1e8449`) reemplazados por variables (`--danger`, `--ok`) en 20 lugares.

## Componentes base (`components/ui/`)
`Pantalla`, `Boton` (principal / secundario / peligro), `Campo` (etiqueta, ayuda y error conectados), `Aviso` (ícono + texto + color), `Insignia` (estado), `EstadoVacio`, `Esqueleto`, `Ayuda` ("¿Qué es esto?") y `Confirmar` (`useConfirmar`, reemplaza a `window.confirm`).

## Pantalla piloto: Pedidos
- Título y ayuda "¿Qué es esto?".
- Estados con ícono + palabra + color (Nuevo / Confirmado / Entregado / Cancelado).
- Cada pedido se abre con un botón real ("Ver detalle" / "Ocultar"), usable con teclado (antes era un div clickeable).
- Filtros con `aria-pressed`; "Abiertos" pasa a "Por atender".
- Mensajes con `Aviso`, esqueleto de carga y estado vacío con explicación.
- Confirmaciones de "Cancelar pedido" y "Quitar fiado" con ventana propia.

## Pendiente (etapa 6)
Quedan 6 usos de `window.confirm` en otras pantallas; se migran a `useConfirmar` al optimizar cada una.
