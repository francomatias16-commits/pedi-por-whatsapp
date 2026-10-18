# Etapa 6 — parte 2: Vender (Caja) y confirmaciones

Solo presentación y navegación interna de la caja; no cambia cobros, cierres ni reglas. `tsc` y `npm test` en verde.

- Caja: a la vista quedan 4 pestañas: **Vender**, **Ventas de hoy**, **Plata** (movimientos) y **Cerrar caja** (Reporte Z).
- "Más ▾" abre: Buscar una venta, Atajos, Ofertas, Cajas anteriores e Impresora y ajustes.
- El carrito de Vender ya no usa `window.confirm` para vaciar: ventana propia.
- Ofertas (promos) ya no usa `window.confirm` para eliminar: ventana propia.
- Pendiente: los `confirm` del navegador que siguen en Fiado, Radar, Conteo, Precios, Proveedores, Compras pendientes, Sellos (Campañas, Premios, Canjes), Tienda y Pedidos a proveedor.
