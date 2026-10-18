# Etapa 4 — Navegación del panel

Solo estructura y navegación; no cambia datos, consultas ni reglas. `tsc` y `npm test` en verde.

- `panel/page.tsx` se partió: `components/panel/PanelApp.tsx` (sesión + kiosco), `Login`, `CrearKiosco` y `Dueno.tsx` (panel).
- Rutas propias por destino: `/panel` (Inicio), `/panel/vender`, `/panel/pedidos`, `/panel/productos/precios`, `/panel/clientes/alertas`, `/panel/compras/proveedores`, `/panel/negocio`… (`app/panel/layout.tsx` + `app/panel/[[...seccion]]/page.tsx`).
- Mapa de 7 destinos en `lib/navegacion.ts` (lógica pura, con prueba en `tests/navegacion.test.mjs`, script `test:navegacion`).
- Links viejos `/panel?tab=…` (avisos push, favoritos) redirigen solos a la ruta nueva.
- Menú nuevo:
  - Computadora: menú lateral de 7 ítems, cada uno con su descripción corta.
  - Celular: barra inferior con Inicio, Vender, Pedidos, Productos y "Más" (hoja con Clientes, Compras y Mi negocio).
- Barra superior fija: nombre del kiosco, interruptor "Tienda abierta / cerrada", Ayuda y Salir.
- Pestañas de cada destino (`SubNav`) cuando hay más de una pantalla.
- Insignias con número solo en "Pedidos" (por confirmar) y "Compras" (por reponer). No aparecen con 0.
- Se mantienen los nombres internos de tabs (`radar`, `sellos`, `reponer`…) para no tocar lógica.
- CSS: se quitó el bloque `.side*` viejo y se agregó el de la etapa 4 al final de `globals.css`.
