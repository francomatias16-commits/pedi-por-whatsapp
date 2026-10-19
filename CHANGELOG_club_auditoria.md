# Club · auditoría del flujo cliente → kiosquero (0042)

## Qué se auditó
Toque del cliente → API → función SQL (`club_sumar` / `club_unirse`) → aviso push → panel del kiosquero → rechazo → canje → tarjeta del cliente.
El registro y la entrega de premios ya estaban sincronizados por la base (fila del cliente bloqueada, sellos y canjes en la misma fuente). Lo que faltaba:

## Hallazgos y cambios
1. **El mensaje del QR no seguía las campañas.** Mostraba premio y meta, pero no cuántos sellos suma cada compra. Ahora `club_datos` y la tarjeta devuelven `por_compra` (según las campañas activas, sellos dobles incluidos) y el QR/tarjeta lo muestran. El regalo de bienvenida se anuncia aparte (`bienvenida`) para no prometer de más en cada compra.
2. **El encargado veía la pantalla del club pero la base lo rechazaba** (`club_actividad`, `club_rechazar`, `club_reenviar` eran solo del dueño). Ahora pueden dueño y encargado; el cajero sigue sin acceso. El reporte por empleado sigue siendo solo del dueño.
3. **Rechazar un sello ya canjeado no avisaba.** `club_rechazar` ahora devuelve `descubierto` y el panel lo muestra; el saldo del cliente nunca queda negativo.
4. **No quedaba rastro de quién rechazó.** `sellos.anulado_por` / `anulado_at`; deshacer el rechazo los limpia.
5. **El club no tenía tests SQL en el CI.** Nuevo `supabase/tests/club_test.py` (56 checks contra Postgres real): QR vs configuración, registro, tope diario, canje, roles, rechazo, permisos de funciones internas, reporte y "clientes que dejaron de venir".
6. Se borraron `public/icon-192.png` y `icon-512.png` (nadie los usaba y `npm test` fallaba por eso desde antes).

## Archivos
`supabase/migrations/0042_club_roles_aviso.sql`, `supabase/tests/club_test.py`, `lib/club.ts`, `components/ClubUnirse.tsx`, `components/ClubTarjeta.tsx`, `components/sellos/Club.tsx`, `tests/club.test.mjs`.

## Para aplicar
Aplicar la 0042 DESPUÉS de la 0041. No tiene DROP; no cambia permisos existentes.
