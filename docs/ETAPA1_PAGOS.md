# Etapa 1: Mercado Pago en la tienda

El cliente paga al pedir, el pedido se confirma solo y la plata va a la cuenta de Mercado Pago del kiosco.

## Cómo funciona
1. El dueño conecta su cuenta en Mi negocio > Cobrar con Mercado Pago (Access Token + clave secreta de webhooks). Las credenciales se guardan cifradas (AES-256-GCM con `PAGOS_CIFRADO_KEY`); el navegador nunca las lee.
2. Con el cobro online encendido, el cliente ve "Pagar ahora con Mercado Pago". `crear_pedido` deja el pedido en `pago_estado = pendiente` y **reserva el stock**.
3. `/api/pagos/mp/preferencia` arma el link (monto tomado de la base) y lleva al cliente a Mercado Pago; vuelve a `/[slug]/pago`.
4. El webhook (firma HMAC verificada, evento registrado, idempotente) consulta el pago a Mercado Pago y llama a `pago_confirmar`, que verifica monto y moneda y confirma el pedido una sola vez. El aviso push de pedido nuevo sale recién ahí.
5. Respaldo: la pantalla de retorno y el cron `/api/cron/pagos` consultan a Mercado Pago si el aviso no llegó. Un pedido sin pagar vence a las 3 horas y libera su stock.

## Resultados de `pago_confirmar`
confirmado, duplicado, pendiente, rechazado, reembolsado, monto_invalido, cancelado_con_pago, pago_duplicado, pagado_sin_stock, ya_confirmado, ignorado, no_aplica. Los que requieren acción del dueño (reembolsar) disparan un aviso push.

## Desvíos respecto del plan
- Vencimiento a **3 horas** (el plan decía 24). Cambiarlo exige editar `pago_horas_vencimiento()` y `HORAS_VENCIMIENTO` (`lib/pagos/mp.ts`); `tests/pagos.test.mjs` verifica que coincidan.
- La clave secreta de webhooks se carga por kiosco (`MP_WEBHOOK_SECRET` es solo un respaldo).
- Sin recargo por comisión (etapa 1b): pendiente. La conexión con un clic (OAuth) está en `docs/MP_OAUTH.md`.

## Checklist de aceptación
- [ ] Backup, aplicar 0029 en el SQL Editor, cargar `PAGOS_CIFRADO_KEY` en Vercel, desplegar.
- [ ] Cuenta de prueba de Mercado Pago: conectar, "Probar la conexión".
- [ ] Pago aprobado en sandbox: el pedido se confirma una sola vez y llega el push.
- [ ] Pago rechazado: el pedido se cancela y el stock vuelve.
- [ ] Aviso repetido: no duplica nada. Aviso con firma inválida: 401 y queda registrado.
- [ ] Vencimiento y cron de reconciliación.
- [ ] Revisar con Mercado Pago real el formato de `x-signature` cuando la `notification_url` va por preferencia.
