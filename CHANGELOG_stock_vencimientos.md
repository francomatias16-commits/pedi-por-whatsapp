# Stock y vencimientos sincronizados con la Caja

- 0061: la venta consume lotes por vencimiento (FEFO real); anular/devolver devuelve al mismo lote.
- 0062: endurecimiento de permisos de lo nuevo (solo lectura, triggers no ejecutables desde la app).
- 0063: `pos_vencimientos` para que cajero/encargado vean el vencimiento sin acceder a `lotes_stock`.
- Caja: aviso (no bloquea) si el producto agregado está vencido o vence en ≤ 7 días.
- Historial de ventas: muestra de qué lote salió cada ítem.
- Productos: corregir el stock de un producto que ya controla stock ahora pasa por `ajustar_stock` (queda en el historial de movimientos).
- Orden de aplicación en la base: 0061, 0062, 0063.

- lib/pagos/mp.ts: se agrega `mpReembolsarOrden` (POST /v1/orders/{id}/refund; firma: token, id, cuerpo, idempotencia) y `refunds` en `OrdenMP`. Corrige el build de `qr/reembolsar/route.ts`.
