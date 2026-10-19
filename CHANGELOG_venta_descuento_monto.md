# Caja · descuento en pesos exacto (0049)

## Qué cambia
- Un premio de **monto** (por ejemplo, $1.000 de descuento) o de **producto** descuenta el monto exacto. Antes se convertía en porcentaje con 2 decimales y el cobro podía diferir unos centavos (peor caso medido: $9,89 sobre un premio de $2.500).
- La venta recibe `p_descuento_monto`. El descuento se topa en el subtotal (nunca da total negativo).
- El monto y el porcentaje no se combinan: si llegan juntos, la base responde `descuento_doble`.
- Un monto negativo responde `descuento_invalido`.
- Las ventas encoladas sin conexión guardan el monto y lo envían al sincronizar.

## Compatibilidad
- Clientes viejos (sin el parámetro nuevo) siguen andando: el parámetro tiene default null.
- Orden de despliegue: **primero la migración, después la app**. La app manda `p_descuento_monto` siempre; si llega antes que la migración, PostgREST no encuentra esa firma.

## Archivos
- `supabase/migrations/0049_venta_descuento_monto.sql` (drop-ok: cambia la firma).
- `lib/fidelidad.ts`: `montoDePremio`.
- `lib/pos/promos.ts`: `calcularVenta` acepta el descuento en pesos (mismo cálculo que la base, en centavos).
- `lib/pos/offline.ts`: la venta encolada guarda `descuento_monto`.
- `components/caja/PosVenta.tsx`: premio de monto o producto → monto exacto; el porcentaje sigue igual para los demás.
- `lib/errores.ts`: `descuento_doble`.

## Pruebas
- `supabase/tests/venta_monto_test.py`: $1.000 sobre $12.345; prorrateo exacto de $333,33 sobre $3.500; topes; negativo; monto + porcentaje; cliente viejo; cajero; ajeno; anon.
- Las nueve suites que usan la venta de mostrador (etapa10, 11, 14, 15, 17, 20, 21, 25, 26) pasan con la 0049.
- `tests/pos.test.mjs`: mismos casos que la base, en el navegador.

## Estado en Supabase
- `pedi-restore-test` y `pedi-por-whatsapp` (producción): aplicada. Verificado: firma nueva, `anon` sin permiso, `authenticated` con permiso.

## Migraciones 0045 a 0048 en el repo
- Se agregaron `0046_endurecer_anon.sql`, `0047_corregir_authenticated.sql` y `0048_promos_captar_retener.sql`. Están verificadas por hash (MD5) contra lo que Supabase tiene aplicado en producción: son idénticas.
- `0045_promos_fase_a.sql`: el repo tiene comentarios agregados; el código y el catálogo son idénticos a lo aplicado (verificado por hash del cuerpo sin comentarios y de las 11 filas del catálogo).
- `check:migraciones` pasa: 49 migraciones en orden.

## Pruebas del repo
- Todas las suites SQL (`supabase/tests/*_test.py`) pasan. Las suites ahora crean el rol `service_role` como en Supabase.
- `npm test`: todo pasa salvo `test:marca` (íconos viejos), que ya fallaba antes.
