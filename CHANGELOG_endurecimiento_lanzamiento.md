# Endurecimiento previo al lanzamiento

Descomprimir sobre el repo (mismas rutas), revisar `git status` y correr `npm test` y `npm run typecheck`. No hay migraciones nuevas.

## Cambios
- **Catálogo completo (más de 1000 productos).** Supabase corta cada respuesta en 1000 filas sin avisar; la tienda y el panel pedían `.limit(2000)` y un almacén grande veía el catálogo incompleto. Nuevo `lib/paginar.ts` (`traerTodo`, pide de a páginas con `.range()` y desempata por `id`). Aplicado en: tienda pública (`app/[slug]/page.tsx`), Productos, Caja (POS), Etiquetas, Precios (2 consultas) y Radar. Test: `tests/paginar.test.mjs` (0, 1, 999, 1000, 1001, 2500 y 3000 filas, error a mitad de camino y tope de seguridad).
- **Cabeceras de seguridad** (`next.config.mjs`): `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` (los links `/seguimiento/<token>` y `/tarjeta/<token>` llevan el token en la URL), `Permissions-Policy` (cámara, WebUSB, puerto serie y ubicación solo del propio sitio; resto apagado) y HSTS.
- **CSP en modo solo reporte** (`Content-Security-Policy-Report-Only`): no bloquea nada. Pasados unos días sin avisos en la consola del navegador (panel, caja, tienda, pago con Mercado Pago), cambiar el nombre de la cabecera a `Content-Security-Policy`.
- **Tests SQL sin falla por zona horaria.** `promos_test.py` y `club_test.py` usaban `current_date` (UTC) y el SQL usa la fecha de Argentina, así que entre las 21:00 y las 24:00 hora argentina fallaban 3 chequeos. Ahora usan la fecha de Argentina. Verificado a las 22:19 hora argentina (01:19 UTC): ambos pasan.
- **Node:** `engines >= 22` en `package.json` y CI en Node 22 (antes 20; `@zxing/library@0.23` declara Node >= 24 pero la suite corre en 22). En Vercel, fijar Node 22.x o 24.x en Settings.

## Verificado
`npm run typecheck` limpio, `npm test` (34 conjuntos) OK, `check:migraciones` OK, `promos_test.py` y `club_test.py` OK.

## No cubierto acá
Actualizar Next (hoy 14.2.35, `npm audit` crítico de denegación de servicio), probar Mercado Pago en sandbox, pendientes de producción (rotar `PUSH_WEBHOOK_SECRET`, aplicar 0027/0028 y el delta 0044), Supabase Pro, restore probado y revisión legal.
