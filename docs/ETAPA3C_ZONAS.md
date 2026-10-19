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
- **Ventana de entrega** (opcional en el plan): no incluida. Se agrega si algún piloto la pide.

## Despliegue

1. Backup.
2. Aplicar `0033_zonas_envio.sql` en el SQL Editor (después de la 0032).
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

## Sin verificar

- Uso en celular y con Supabase real (los tests usan un auth simulado).
- Pedidos con pago online y zona (la lógica de pago no cambió, pero conviene probar uno en el sandbox de Mercado Pago).
