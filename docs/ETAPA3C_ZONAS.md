# Etapa 3C: envío por zonas

Segunda parte de la Etapa 3 del plan (la 3B, WhatsApp oficial, queda para después por depender de Meta). El local define zonas con su costo y su pedido mínimo, y el cliente elige la suya al pedir.

## Cómo funciona

1. **Zonas.** En Mi negocio, "Envío por zonas": nombre, barrios o calles (opcional), costo, pedido mínimo y si está disponible. Hasta 30 por local, sin nombres repetidos. Las cargan encargado y dueño.
2. **Interruptor (dueño).** "Cobrar el envío por zonas". Arranca apagado: apagado, rige el costo único de Datos del local como hasta ahora. No se puede encender sin una zona activa, y si se quita o apaga la última zona activa, se apaga solo.
3. **Tienda.** Con las zonas encendidas, al elegir envío aparece "¿A qué zona?" con el costo de cada una. El total y el mínimo se actualizan al elegir.
4. **La base manda.** `crear_pedido` recibe la zona (no el costo): toma de la base el costo y el mínimo. Si la zona no existe, está apagada o es de otro local, responde `zona_invalida`; si falta, `zona_requerida`.
5. **Mínimo.** Para un envío rige el mayor entre el mínimo del local y el de la zona. El retiro solo usa el del local.
6. **Pedido.** Guarda `zona_id` y `zona_nombre` (copia del nombre: renombrar o quitar la zona no cambia los pedidos viejos). En Pedidos se ve "Envío (Centro): dirección".

## Decisiones que tomé por vos

- **Mayor de los dos mínimos** (local y zona) en vez de reemplazar uno por otro: el local no pierde su mínimo general sin querer.
- **Compatibilidad.** `crear_pedido` ahora tiene la zona como argumento; la versión anterior (8 argumentos) sigue existiendo y delega. Una pestaña abierta con la app vieja sigue andando mientras el local no use zonas; si las usa, avisa `zona_requerida`.
- **Quitar una zona** la borra de verdad (los pedidos conservan el nombre).
- **Ventana de entrega** (opcional en el plan): incluida después, ver la sección siguiente.

## Ventana de entrega (migración 0036)

El local define franjas horarias de entrega y el cliente que pide envío elige una.

1. **Franjas.** En Mi negocio, "Ventana de entrega": nombre, hora desde y hora hasta, y si está disponible. Hasta 10 por local, sin nombres repetidos, con la hora de inicio antes de la de fin. Las cargan encargado y dueño.
2. **Interruptor (dueño).** "Pedir al cliente que elija una franja de entrega". Arranca apagado: apagado, el envío funciona como hasta ahora. No se puede encender sin una franja activa, y si se quita o apaga la última, se apaga solo. Es independiente del interruptor de zonas: se pueden usar juntos o por separado.
3. **Tienda.** Con las franjas encendidas, al elegir envío aparece "¿Cuándo querés recibirlo?" y no se puede pedir sin elegir. El retiro no la pide.
4. **La base manda.** `crear_pedido` recibe la franja y la lee de la base: si falta responde `franja_requerida`; si no existe, está apagada o es de otro local, `franja_invalida`.
5. **Pedido.** Guarda `franja_id` y `franja_nombre` (texto copiado, por ejemplo "Mañana (09:00 a 13:00)"): editar o quitar la franja no cambia los pedidos viejos. Se ve en Pedidos ("Entrega: …") y en el mensaje de WhatsApp al local.
6. **Compatibilidad.** `crear_pedido` ahora tiene 10 argumentos; la versión de 9 (0033) sigue existiendo y delega sin franja. Una pestaña abierta con la app vieja sigue andando mientras el local no use franjas; si las usa, un envío avisa `franja_requerida`.

Decisiones que tomé por vos:
- **Por pedido, no por zona.** Las franjas son del local y valen para todas las zonas. Si una zona necesita horarios propios, se agrega después.
- **Es la preferencia del cliente.** No se compara con la hora actual ni con el horario de atención: un pedido de la noche puede elegir la franja de mañana. El local lo ve en el pedido y lo coordina.
- **Sin cupos.** No hay tope de pedidos por franja.

## Despliegue

1. Backup.
2. Aplicar `0033_zonas_envio.sql` en el SQL Editor (después de la 0032). Para la ventana de entrega, aplicar también `0036_franjas_entrega.sql`, siempre después de la 0035 (limpieza de fotos).
3. Subir el código y probar en preview.
4. Dejar el interruptor apagado en todos los locales hasta cargar zonas en un piloto.

## Checklist de aceptación

- [ ] Con el interruptor apagado, la tienda cobra el envío como antes.
- [ ] Cargar dos zonas y encender: la tienda pide elegir zona y muestra el costo de cada una.
- [ ] El total del pedido creado coincide con costo de zona más productos.
- [ ] Una zona con mínimo mayor al carrito bloquea el pedido con un mensaje claro.
- [ ] Un cajero no ve ni edita zonas; un encargado edita pero no enciende el interruptor.
- [ ] Quitar la última zona apaga el interruptor.
- [ ] En un celular real: elegir zona y pedir.
- [ ] Ventana de entrega apagada: la tienda no muestra nada nuevo y el pedido sale como antes.
- [ ] Cargar dos franjas y encender: pedir envío sin elegir franja no deja continuar; con franja, el pedido muestra "Entrega: Mañana (09:00 a 13:00)" en Pedidos y en el WhatsApp.
- [ ] Retiro no pide franja.
- [ ] Quitar la última franja activa apaga el interruptor.
- [ ] Un cajero no ve ni edita franjas; un encargado edita pero no enciende el interruptor.

## Sin verificar

- Uso en celular y con Supabase real (los tests usan un auth simulado).
- Pedidos con pago online y zona (la lógica de pago no cambió, pero conviene probar uno en el sandbox de Mercado Pago).
