# Club + horas flojas + clientes en fuga + premios listos + sellos por empleado (migraciones 0040 y 0041)

Todo en un solo zip, armado sobre KKKIOSCO.zip (que ya trae la 0039). Descomprimir sobre el repo, revisar `git status` y correr `npm test`.

## Qué trae
- **Horas flojas** (`components/sellos/HorasFlojas.tsx`, `lib/fidelidad.ts`): preset de "sello doble" en las horas de poco movimiento.
- **Clientes que dejaron de venir** (`0040_fuga_club.sql`, `components/Radar.tsx`): la lista también cuenta toques del club y pedidos de la tienda. Misma firma que la 0025.
- **Tarjetas completas** (`components/sellos/PremiosListos.tsx`, `lib/club.ts`): en Puntos → Club, clientes que ya juntaron el premio, con botón "Avisarle por WhatsApp" (toque manual, sin API paga).
- **Sellos por empleado** (`0041_auditoria_sellos.sql`, `lib/auditoria.ts`, `components/sellos/ReporteEmpleados.tsx`): Puntos → pestaña **Por empleado**. Solo el dueño. Cuántos sellos dio y cuántos canjes hizo cada persona, por día, con detalle de manuales y anulados.
  - `sellos.usuario_id` y `canjes.usuario_id` se completan solos (default `auth.uid()`); no cambia ninguna llamada de la app.
  - Lo anterior a la 0041 y lo que suma el cliente (club, tienda) aparece como "Sin registrar" o no figura.
  - Señales para mirar (no son acusaciones): 10 o más sellos manuales y la mitad o más de lo que dio, o 3 o más anulados.
  - Se agregó `tests/auditoria.test.mjs` (`npm run test:auditoria`), ya incluido en `npm test`.

## Orden de aplicación
1. Migraciones en el SQL Editor, en orden: `0039_club.sql` (si no está), `0040_fuga_club.sql`, `0041_auditoria_sellos.sql`. Probar primero en pedi-restore-test.
2. Subir el código y probar en preview.

## Verificado
- `npm test` completo (31 suites, incluida la nueva) y `tsc --noEmit` sin errores.
- 0039 probada en pedi-restore-test. 0041 probada en la base de prueba: usuario automático, reporte por persona, rechazo para quien no es dueño.
- No corrí `next build`: hay que correrlo en tu máquina.
