# Etapa 6 — Optimización por pantalla (parte 1: Pedidos y Productos)

Solo presentación y textos de botones; no cambia consultas ni reglas. `tsc` y `npm test` en verde.

## Pedidos
- Botón principal grande según estado: "Confirmar pedido" (nuevo) y "Marcar como entregado" (confirmado).
- "Avisar" pasa a "Avisar por WhatsApp", con etiqueta accesible con el nombre del cliente.

## Productos
- Los `confirm` y `prompt` del navegador se reemplazaron por la ventana propia (`Confirmar`): eliminar producto y cambio a venta por peso.
- Cambiar precio ahora abre el formulario de edición (antes era un `prompt`).
- Buscador y categorías quedan fijos al bajar la lista (con botones de categoría marcados con `aria-pressed`).

## Pendiente de la etapa 6
- Vender (Caja): dejar 4 pestañas (Vender, Ventas de hoy, Plata, Cerrar caja) y mover lo demás a "Más".
- Clientes (Fiado, Puntos, Radar), Compras, Precios, Mi negocio: optimización de cada pantalla según el plan.
- Quedan 18 `confirm` del navegador en otras pantallas (Promos, Venta, Compras, Tienda, Fiado, Conteo, Proveedores, Radar, Precios, Sellos). Se pasan a `Confirmar` al optimizar cada pantalla.
