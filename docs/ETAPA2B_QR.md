# Etapa 2B: cobro con QR de Mercado Pago en la caja

Segunda mitad de la Etapa 2 del plan. Reusa la conexión de Mercado Pago de la Etapa 1 y los roles de la 2A (cajero, encargado y dueño pueden cobrar; solo el dueño hace el alta).

## Cómo funciona

1. **Alta única (dueño).** Mi negocio > Cobrar con Mercado Pago > "QR en el mostrador". El dueño carga la dirección y la ubicación del local; la app crea la sucursal y la caja en Mercado Pago y guarda el QR fijo para imprimir. Se puede repetir sin duplicar (los ids externos salen del id del local).
2. **Interruptor (dueño).** "Cobrar con QR en la caja" arranca apagado. Con él apagado, la caja funciona exactamente como antes.
3. **Cobro (cajero).** En Cobrar, la línea "QR / Mercado Pago" muestra "Cobrar con QR". La app crea un cobro (monto de esa línea, mínimo $15) y una orden en Mercado Pago (API de Orders, `type: qr`, `mode: static`) sobre el QR fijo. El cliente escanea el QR del mostrador y paga. La pantalla espera: el aviso de Mercado Pago llega por el webhook de la Etapa 1 y, de respaldo, se consulta la orden cada 3 segundos.
4. **Venta.** Con el cobro aprobado, "Confirmar venta" registra la venta como siempre. La base ata la venta al cobro aprobado del mismo monto; sin cobro aprobado, la venta se rechaza (`qr_sin_cobro`). Si vence, se cancela sin cobrar nada.

## Decisiones que tomé por vos

- **Un cobro a la vez por local.** Un QR fijo admite una sola orden vigente. Con varios cajeros, el segundo espera o cancela (`qr_ocupado`). Si algún local necesita cobros en paralelo, hay que crear más de una caja (queda para cuando un piloto lo pida).
- **El QR vence a los 5 minutos** (`qr_minutos_vencimiento()` en la base y `QR_MINUTOS` en la app, con un test que verifica que coinciden).
- **Emparejamiento por monto.** La venta consume el cobro aprobado más viejo del mismo monto, de las últimas 12 horas. Evita perder plata si el cajero cierra la pantalla después de que el cliente pagó: el cobro queda en un aviso ("Hay un cobro con QR sin venta") y se usa en la próxima venta por ese monto. El aviso también aparece al cerrar la caja.
- **Un intento rechazado no cierra el cobro:** el cliente puede reintentar con otra tarjeta sobre la misma orden.
- **Pago tardío:** si el cliente paga después de que el cobro venció o se canceló, la plata entra igual. Queda como `aprobado_tarde`, aparece en la lista de cobros sin venta y el dueño recibe un aviso push.
- **El medio sigue llamándose "QR / Mercado Pago"** (el mismo medio de las ventas anteriores). Con el interruptor encendido, ese medio exige cobro aprobado. Para transferencias comunes, el cajero usa "Transferencia".
- **Reembolsos manuales,** igual que en la Etapa 1: se hacen desde Mercado Pago. Anular una venta en la caja no devuelve el pago. Si Mercado Pago avisa un reembolso de un cobro ya usado en una venta, el dueño recibe un aviso.
- **Sin internet:** el QR se deshabilita con un mensaje claro; efectivo y demás medios siguen funcionando, incluida la cola sin conexión.
- **Desconectar Mercado Pago** (o un token revocado) apaga también el QR. La sucursal y la caja quedan creadas en Mercado Pago; si el dueño conecta otra cuenta, hay que repetir el alta.
- **Terminal Point** queda afuera, como dice el plan.

## Qué se agregó

- `supabase/migrations/0031_qr_caja.sql`: `pos_qr_config` y `cobros_qr_pos` (solo se escriben desde el servidor; los miembros leen los cobros), `kioscos.cobro_qr_activo`, funciones `qr_crear_cobro`, `qr_confirmar` (idempotente), `qr_estado_cobro`, `qr_cancelar_cobro`, `qr_puede_consultar`, `qr_vencer_pendientes`, `qr_estado_config`, `qr_cobros_sin_venta`, `qr_configurar_activo`, el trigger `ventas_pagos_exigir_qr` y `mp_desconectar` actualizada.
- Rutas: `POST /api/pagos/mp/qr/{alta,cobrar,cancelar}` y `GET /api/pagos/mp/qr/estado`. El webhook de la Etapa 1 reparte por referencia externa entre pedidos de la tienda y cobros QR. El cron diario también reconcilia y vence cobros QR.
- Caja: `CobroModal` (línea QR con espera, cancelar y cobro ya aprobado), `useQrCaja`, `QrSinVenta` (en caja y en el cierre).
- Panel: `CobroQR` dentro de Cobrar con Mercado Pago.
- Mensajes nuevos en `lib/errores.ts` y `lib/caja.ts`.
- Tests: `supabase/tests/etapa26_test.py` (SQL) y `tests/qr.test.mjs` (`npm run test:qr`, dentro de `npm test`).

No hay variables de entorno nuevas (usa `PAGOS_CIFRADO_KEY`, `CRON_SECRET` y `APP_URL` de las etapas anteriores).

## API de Mercado Pago que usa (verificada contra su documentación, 2026-10-18)

- Sucursal: `POST /users/{user_id}/stores`. Caja: `POST /v2/pos` con `X-Idempotency-Key`, `config.qr.operating_mode: "pdv"`; la respuesta trae el QR en `qr_response` (`image`, `template_document`).
- Cobro: `POST /v1/orders` (`type: "qr"`, `config.qr.mode: "static"`, `external_reference` = id del cobro, montos como texto, `expiration_time: "PT5M"`), con `X-Idempotency-Key` = id del cobro. Se guarda el id de la orden (`ORD…`) en `cobros_qr_pos.mp_order_id`.
- Estado: `GET /v1/orders/{id}` (`processed` = aprobado, `expired`, `refunded`, `created` = pendiente). Cancelar: `POST /v1/orders/{id}/cancel` (solo con la orden en `created`).
- **Los avisos ya no viajan en la orden** (no existe `notification_url` en Orders). El dueño tiene que elegir el evento **Order (Mercado Pago)** en los Webhooks de su aplicación, con la misma dirección y clave de la Etapa 1. Si no lo hace, la caja detecta el pago igual por la consulta cada 3 segundos y el cron diario.
- Se reemplazó el diseño anterior, que usaba la API vieja `instore/orders/qr` (de memoria, y el endpoint de esa API era el de QR dinámico, no el del QR fijo).

## Orden de despliegue

1. Backup.
2. Aplicar `0031_qr_caja.sql` en el SQL Editor, después de la 0030.
3. Desplegar el código y probar en preview.
4. Dejar el interruptor apagado en todos los locales hasta probar con el piloto.

## Checklist de aceptación

- [ ] La 0031 se aplica sin errores sobre producción (con backup).
- [ ] `python3 supabase/tests/etapa26_test.py` y todos los tests SQL anteriores pasan.
- [ ] `npm test`, `npm run typecheck` y `npm run build` pasan.
- [ ] Alta del QR con una cuenta de prueba de Mercado Pago: se crean la sucursal y la caja, se ve el QR.
- [ ] Repetir el alta no duplica la sucursal ni la caja.
- [ ] En Mercado Pago, la aplicación tiene los Webhooks con el evento "Order (Mercado Pago)" y la misma dirección y clave que los pagos.
- [ ] Cobro de prueba: el cajero genera un cobro, paga con la cuenta compradora de prueba, la pantalla pasa a "Cobrado" y la venta queda registrada.
- [ ] Un cobro que no se paga vence a los 5 minutos y no deja venta.
- [ ] Cancelar el cobro libera el QR para el siguiente.
- [ ] Cerrar la pantalla después de pagar deja el aviso "cobro con QR sin venta"; la siguiente venta por el mismo monto lo usa.
- [ ] Con el interruptor encendido, no se puede registrar una venta "QR / Mercado Pago" sin cobro aprobado.
- [ ] Sin internet, el QR se deshabilita y el efectivo sigue vendiendo.
- [ ] Un cajero cobra con QR pero no ve el alta ni el interruptor (están en Mi negocio).
- [ ] Desconectar Mercado Pago apaga el QR.

## Lo que no se pudo verificar (leer antes de desplegar)

- **No se probó contra la API real (sandbox).** Los endpoints y los cuerpos se contrastaron con la documentación oficial, pero hay tres puntos que solo se confirman en el sandbox: (1) el formato exacto del aviso del tema "Order" (la documentación no describe el cuerpo; el código acepta `type` que empiece con "order" o un id `ORD…`, y la firma se valida igual que en pagos); (2) la búsqueda de una caja existente por `external_id` (`GET /pos?external_id=`), que la documentación consultada no detalla: si no la encuentra, el alta repetida podría intentar crearla de nuevo; (3) el nombre de provincia que acepta Mercado Pago. Todo está concentrado en `lib/pagos/mp.ts` y `lib/pagos/qr.ts`.
- Verificado en este entorno con Postgres 16 real: la migración 0031 sobre las 30 anteriores y los 27 tests SQL (incluido `etapa26_test.py`, 103 chequeos); `npm test`, `npm run typecheck` y `npm run build` (este último con Google Fonts simulado). Sin Supabase real: el auth es simulado.
- La pantalla de caja con el QR no se probó en un navegador ni en celular. Las clases `qr-panel` no tienen estilo propio: usa el del sistema.
