# Mercado Pago: conectar con un clic (OAuth)

El dueño toca **Conectar con Mercado Pago** en Mi negocio, inicia sesión en Mercado Pago, acepta y vuelve al panel con el cobro online encendido.
Pegar el Access Token queda como alternativa plegada ("Conectar a mano").

## Cómo funciona
1. `POST /api/pagos/mp/oauth/iniciar` (sesión del dueño): devuelve la dirección de autorización de Mercado Pago. El `state` va firmado (HMAC, vence a los 10 minutos) y atado al navegador con una cookie httpOnly.
2. Mercado Pago devuelve al dueño a `GET /api/pagos/mp/oauth/callback?code=…&state=…`. Se exigen el `state` firmado **y** la cookie, y que quien lo pidió siga siendo el dueño del local.
3. Se canjea el código en `POST https://api.mercadopago.com/oauth/token`, se verifica que la cuenta sea argentina (`site_id` MLA), se guardan cifrados el access token y el refresh token (AES-256-GCM, `PAGOS_CIFRADO_KEY`) y se enciende el cobro online. El panel muestra el resultado con `?mp=<motivo>`.
4. **Renovación.** El token dura ~180 días. Cada vez que se usa, si le faltan menos de 3 días se renueva con el refresh token. El refresh token es de un solo uso, así que solo renueva quien toma el turno (`mp_renovacion_tomar`); la consulta que no lo toma espera y relee lo que guardó la otra. Además el cron diario (`/api/cron/pagos`) renueva los que vencen en el próximo mes, para no perder el refresh token por falta de uso.
5. Si Mercado Pago rechaza la renovación (el dueño quitó el permiso), se apaga el cobro online y el panel pide reconectar.

## Avisos de pago
Con una sola aplicación, todos los avisos se firman con la clave de esa aplicación (`MP_WEBHOOK_SECRET`); los locales conectados con un clic no tienen clave propia.
El aviso se asigna al local por `?kiosco=` si la dirección lo trae (los pagos de la tienda sí: la preferencia lo incluye). Si no, por la cuenta vendedora (`user_id` del aviso). Si dos locales usan la misma cuenta de Mercado Pago, se prueba con cada uno: el que corresponde es el dueño del pedido o del cobro.
Si en el sandbox los avisos de Orders (QR) no traen `user_id`, cargar la dirección del webhook con `?kiosco=<id del local>` o pasarme el aviso real.

## Qué tenés que hacer
1. Backup y correr `supabase/migrations/0057_mp_oauth.sql` en el SQL Editor (aditiva). Aplicarla **antes** de subir el código: el panel y el webhook ya usan las columnas nuevas.
2. En tu aplicación de Mercado Pago (la verificada): 
   - Redirect URL: `https://<tu-dominio>/api/pagos/mp/oauth/callback` (exacta, sin barra final).
   - Webhooks (modo producción): `https://<tu-dominio>/api/pagos/mp/webhook`, eventos **Pagos** y **Order (Mercado Pago)**. Copiá la clave secreta.
3. En Vercel: `MP_OAUTH_CLIENT_ID` (App ID), `MP_OAUTH_CLIENT_SECRET`, `MP_WEBHOOK_SECRET` y `APP_URL` (`https://<tu-dominio>`). Redesplegar.
4. Probar con una cuenta de prueba: conectar, "Probar la conexión", un pago de tienda, un cobro QR.

## Checklist de aceptación
- [ ] Conectar: el botón lleva a Mercado Pago y vuelve a Mi negocio con "Mercado Pago quedó conectado".
- [ ] Cancelar en Mercado Pago: vuelve con el aviso de que no se conectó nada y no cambia el estado.
- [ ] Abrir el enlace de retorno desde otro navegador o pasados 10 minutos: "El enlace de conexión venció".
- [ ] Un pago aprobado confirma el pedido una sola vez (aviso con y sin `?kiosco=`).
- [ ] Renovación: poner `token_expira_at` a mañana en esa fila, usar "Probar la conexión" y verificar que cambió (`token_expira_at` ~180 días adelante).
- [ ] Quitar el permiso desde Mercado Pago > Seguridad > Aplicaciones conectadas, "Probar la conexión": queda "Conexión caída" y el cobro apagado.

## No verificado desde acá
El canje del código, la renovación y los avisos contra Mercado Pago real (mi entorno no sale a esa API). Los formatos de `/oauth/token` y de la dirección de autorización están tomados de la documentación de Mercado Pago; todo está en `lib/pagos/oauth.ts` y `lib/pagos/servidor.ts`.
