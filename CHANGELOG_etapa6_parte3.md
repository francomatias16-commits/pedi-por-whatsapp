# Etapa 6 — parte 3: Clientes (Quién me debe y Radar)

Solo presentación y textos; no cambia saldos, movimientos ni reglas. `tsc` y `npm test` en verde.

## Quién me debe (Fiado)
- Pantalla con título y "¿Qué es esto?".
- Cada cliente se abre con un botón accesible (con `aria-expanded`), no con una fila clickeable.
- "Cobrar" (acción principal, registra un pago) y "Anotar fiado" (antes "Se llevó fiado" y "Pagó").
- "Recordarle por WhatsApp" (antes "Recordar").
- Campos con etiqueta visible y ejemplo ("Ej: 1500", "Ej: 11 5555-5555").
- Esqueleto mientras carga; estados vacíos con qué hacer.
- Borrar cliente usa la ventana propia en vez del `confirm` del navegador.

## Radar
- Dar de baja por vencimiento usa la ventana propia en vez del `confirm` del navegador.

## Pendiente
- Puntos (ex Sellos): flujo "Armá tu programa en 3 pasos" del plan.
- Confirmaciones del navegador que quedan en Conteo, Precios, Proveedores, Sellos (Campañas, Premios, Canjes), Tienda y Pedidos a proveedor.
