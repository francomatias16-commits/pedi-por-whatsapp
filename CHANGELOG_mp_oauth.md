# Mercado Pago: conectar con un clic (OAuth)

- `supabase/migrations/0057_mp_oauth.sql` (aditiva): `refresh_token_cifrado`, `token_expira_at`, `renovando_hasta`; `mp_renovacion_tomar` (solo servidor); `mp_estado_conexion` ya no pide clave secreta a quien usa OAuth.
- `lib/pagos/oauth.ts` (+ `tests/oauth.test.mjs`): state firmado, dirección de autorización, lectura del token, vencimiento.
- `/api/pagos/mp/oauth/iniciar` y `/callback`; `lib/pagos/servidor.ts`: canje, guardado, `renovarToken` (con turno y compare-and-swap) y `credenciales` que renueva sola.
- Webhook: el local se resuelve por `?kiosco=` o por la cuenta vendedora (`user_id`); 503 (reintento) si falla algo pasajero al leer credenciales.
- Cron `/api/cron/pagos`: renueva tokens OAuth que vencen en el mes.
- Panel: botón "Conectar con Mercado Pago"; el método manual queda plegado.
- Variables nuevas: `MP_OAUTH_CLIENT_ID`, `MP_OAUTH_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`, `APP_URL`. Pasos en `docs/MP_OAUTH.md`.
