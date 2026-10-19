# Etapa 0: cierre de base (checklist)

Requisito previo a sumar dinero real (etapa 1). Lo que hace el código ya está hecho y probado; lo de abajo marcado **[vos]** depende de cuentas y accesos tuyos.

## Entregado en el código
- [x] Migración `0028_cierre_base.sql`: exportación de datos por sección, baja suave de la cuenta (cierra la tienda, datos 30 días) y borrado definitivo solo para administración (`kioscos_purgar_bajas`).
- [x] Pantalla Mi negocio > "Mis datos y baja de la cuenta" (`components/MisDatos.tsx`).
- [x] `/api/salud` (público: solo `ok`/`degradado`; con `Bearer CRON_SECRET` agrega variables que faltan). Responde 503 si la base no contesta en 4 s.
- [x] `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`.
- [x] Sentry en servidor, navegador y edge, apagado si no hay DSN. Antes de enviar se borran cuerpos de pedidos, cookies, usuario y teléfonos (`lib/sentry.ts`).
- [x] E2E con Playwright (`e2e/`) y job en CI (se omite sin secretos).
- [x] Tests: `supabase/tests/etapa23_test.py` (35 chequeos), `tests/cierre-base.test.mjs`.

## Orden de despliegue
1. Backup (workflow `backup-supabase`).
2. SQL Editor: aplicar **0027** (si falta) y luego **0028**.
3. Desplegar el código. Si no cargás `NEXT_PUBLIC_SENTRY_DSN`, Sentry queda apagado.
4. Probar en preview: Mi negocio > Mis datos, `/api/salud`, una página inexistente.

## Pendiente [vos]
- [ ] Aplicar 0027 y 0028 en producción.
- [ ] Rotar `PUSH_WEBHOOK_SECRET` en Vercel **y** en el Database Webhook de pedidos (los dos a la vez).
- [ ] Correr el workflow `Restore a proyecto de prueba` y anotar el tiempo: ______ min (backup de ____ MB). Necesita `SUPABASE_TEST_DB_URL`.
- [ ] Decidir el plan de Supabase. Free se pausa por inactividad y no tiene recuperación a un punto en el tiempo; Pro antes del primer cobro real.
- [ ] Crear cuenta y proyecto en Sentry; cargar `NEXT_PUBLIC_SENTRY_DSN` y `SENTRY_DSN` en Vercel. Crear alertas: error nuevo y pico de errores. (Opcional: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` para mapas de código.)
- [ ] Monitor externo (UptimeRobot o similar) sobre `https://<dominio>/api/salud`, cada 5 min.
- [ ] Legal: abogado revisa `/terminos` y `/privacidad`; después `NEXT_PUBLIC_LEGAL_REVISADO=1` y `NEXT_PUBLIC_CONTACTO_EMAIL`. El texto de la sección 6 de privacidad se actualizó para la baja de 30 días: que lo vea.
- [ ] Probar en celular real: push, escáner con celular, avisos de Radar y los 3 crons.
- [ ] Proyecto de Supabase de pruebas + secretos de CI (`E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_SERVICE_ROLE`) y `e2e/seed.sql`.
- [ ] Borrado definitivo de bajas: cada tanto, en el SQL Editor, `select public.kioscos_purgar_bajas(30);` (devuelve cuántos borró). No hay cron a propósito: conviene mirar antes.

## Aceptación
CI verde (incluido E2E), 0027 y 0028 aplicadas, restauración probada con su tiempo anotado, secreto rotado, Sentry recibiendo un error de prueba, monitor sobre `/api/salud`, términos revisados.
