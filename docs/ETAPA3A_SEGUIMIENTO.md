# Etapa 3A: seguimiento del pedido

Primera parte de la Etapa 3 del plan. El cliente ve en qué etapa está su pedido con un link, sin ver ningún dato personal.

## Cómo funciona

1. **Token.** Cada pedido tiene un `token_seguimiento` de 64 caracteres hexadecimales (dos UUID v4), imposible de adivinar. Los pedidos anteriores también lo reciben al aplicar la migración. Solo lo leen los miembros del local (por RLS); el cliente lo recibe en el link que le manda el local. Desde el navegador no se puede cambiar.
2. **Página pública** `/seguimiento/<token>`: muestra el local, el número de pedido, si es retiro o envío, y la etapa: recibido, confirmado, listo para retirar o en camino, y entregado. También "esperando el pago" (pago online pendiente) y "cancelado". Se actualiza sola cada 20 segundos mientras el pedido no esté entregado ni cancelado. No se indexa y no manda referencia a otros sitios.
3. **Qué NO muestra:** nombre, teléfono, dirección, notas ni productos. La función `seguimiento_pedido(token)` devuelve solo `numero`, `etapa`, `modalidad`, `creado` y nombre, tienda y WhatsApp del local (un test verifica el conjunto exacto de campos).
4. **Interruptor (dueño).** En Pedidos: "Mandar a los clientes un link para seguir su pedido". Arranca apagado. Apagado: el link responde "no encontramos este pedido" y los avisos por WhatsApp van sin link. Solo el dueño lo cambia.
5. **Etapa de entrega.** Con el pedido confirmado, el local toca "Marcar listo para retirar" (retiro) o "Marcar en camino" (envío). La base lo exige: un retiro no puede ir "en camino", un envío no puede estar "listo", y solo se marca con el pedido confirmado. Pueden hacerlo cajero, encargado y dueño (como confirmar pedidos).
6. **Aviso por WhatsApp.** "Avisar por WhatsApp" agrega el link cuando el seguimiento está encendido (no en pedidos cancelados). "Listo" y "en camino" tienen su propio texto.

## Decisiones que tomé por vos

- **Sin estados nuevos en el pedido.** El plan habla de "en camino o listo"; en vez de ampliar el enum `estado_pedido` (que toca triggers de stock y pagos), agregué `entrega_estado` aparte.
- **Una sola respuesta** para token inexistente, mal formado o seguimiento apagado: no se puede averiguar qué tokens existen.
- **Slug reservado.** `seguimiento` no puede ser el nombre de un local (constraint `NOT VALID`, no toca los existentes).
- **Sin push al cliente.** El cliente ve el estado al abrir el link; los avisos automáticos son la 3B.

## Despliegue

1. Backup.
2. Aplicar `0032_seguimiento.sql` en el SQL Editor (después de la 0031).
3. Subir el código y probar en preview.
4. Dejar el interruptor apagado en todos los locales hasta probar con un piloto.

## Checklist de aceptación

- [ ] Con el interruptor apagado, el link de un pedido responde "no encontramos este pedido".
- [ ] Encendido, el link muestra la etapa y ningún dato personal.
- [ ] Confirmar, marcar listo/en camino y entregar cambia la página (en hasta 20 s).
- [ ] Un retiro no ofrece "en camino" y un envío no ofrece "listo".
- [ ] Un cajero marca la etapa pero no ve el interruptor.
- [ ] El aviso por WhatsApp trae el link solo con el interruptor encendido.
- [ ] En un celular real: abrir el link desde WhatsApp y volver a abrirlo.

## Sin verificar

- Uso en celular y con Supabase real (los tests usan un auth simulado).
- El preview del link en WhatsApp (la página no tiene imagen ni descripción a propósito).
