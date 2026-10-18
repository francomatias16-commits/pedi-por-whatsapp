# Changelog

## fase3-completo v4 — 2026-10-17

### Agregado
- Pedidos a proveedor como documento con estados (plan 1.4 / 9.5, opcional): `supabase/migrations/0027_pedidos_proveedor.sql` (tablas `pedidos_proveedor` y `pedido_proveedor_items`, RLS solo lectura para el dueño, funciones `pedido_proveedor_crear / enviar / cancelar / recibir / cerrar`). Estados `borrador → enviada → recibida_parcial → recibida` o `cancelada`. Recepción estricta y atómica: no se recibe más de lo pendiente. El pedido no mueve stock ni deuda; la compra se sigue cargando con `registrar_compra`.
- `components/PedidosProveedor.tsx`: lista de pedidos abiertos y anteriores, "Registrar lo que llegó" (con "Llegó todo"), cerrar sin lo que falta, cancelar, y botón para precargar la compra con lo recibido.
- `components/Reponer.tsx`: "Guardar borrador" y "Pedir por WhatsApp" ahora dejan el pedido registrado.
- `lib/pedidos-proveedor.ts`, `tests/pedidos-proveedor.test.mjs` (`npm run test:pedidos`) y `supabase/tests/etapa22_test.py` (35 chequeos: estados, aislamiento entre kioscos, atomicidad, anon).

### Importante
- La migración 0027 **no está aplicada en producción**: hay que aplicarla antes de usar la pantalla. Sin ella, "Guardar borrador" y "Pedir por WhatsApp" muestran el error genérico (el WhatsApp igual se abre).

## fase3-completo v3 — 2026-10-17

### Agregado
- Conteo con escáner (plan 2.4): en `Conteo.tsx`, botón "📷 Escanear con la cámara" y "📱 Usar el celular como lector" (reusa `Escaner.tsx` y `useVinculoCelular`). Cada lectura suma 1 al producto y lo deja a la vista; las etiquetas de balanza suman sus kilos; un producto por peso con código común pide escribir los kilos. Se puede corregir a mano. Códigos desconocidos o de productos fuera de la planilla avisan sin tocar nada.
- `lib/conteo.ts` y `tests/conteo.test.mjs` (`npm run test:conteo`, ya dentro de `npm test`).

### Cambiado
- `docs/PLAN_STOCK_Y_AUTOMATIZACION.md`: checklist final tildado según lo verificado. Quedan sin tildar el backup con restauración probada (falta correr el workflow en GitHub). El pedido a proveedor como documento con estados sigue sin hacerse (opcional).

### Sin cambios / no incluido
- Prueba en el celular del escáner en el conteo: requiere cámara y sesión.
- Lector USB en el conteo: no incluido (los campos de texto lo recibirían como tipeo).
- Pendientes de operación de la v2 (rotar `PUSH_WEBHOOK_SECRET`, PR #9, workflow de restauración, protección de contraseñas filtradas).

## fase3-completo v2 — 2026-10-17

Reconstruida sobre el ZIP de `main` (que no tenía la última tanda) y la base de producción. Verificada: `check:migraciones` (26), `typecheck`, `npm test` y todos los tests SQL de `supabase/tests`.

### Agregado
- `supabase/migrations/0026_fuga_semanal.sql`: tabla `avisos_fuga`, `fuga_conteo_semanal()` y `fuga_avisos_semanales()` (solo service role). Deja el repo igual que producción, donde ya estaba aplicada. Segura de volver a correr.
- `app/api/cron/fuga/route.ts` + entrada en `vercel.json` (lunes 09:05 AR): aviso "Clientes que dejaron de venir" con link a Radar. Idempotente por kiosco y semana.
- `lib/fuga.ts` y `tests/fuga.test.mjs`.
- `components/ProductosModificados.tsx`, `lib/modificados.ts` y `tests/modificados.test.mjs` (plan 2.6): cambios de stock por producto en hoy / 7 / 30 días, con diferencia neta y último movimiento. Oculta ventas, pedidos y devoluciones salvo que se tilde.
- Resumen: tarjeta "Dinero parado en mercadería" (usa `plata_en_stock`, que ya calculaba `reposicion_resumen`).
- `supabase/tests/etapa21_test.py`: 4 chequeos nuevos de la 0026 (33 en total).
- `CHANGELOG.md`.

### Cambiado
- `.github/workflows/restore-to-test.yml`: borra el esquema `public` del destino antes de restaurar y omite triggers y claves foráneas. Corrige los tres errores de las corridas anteriores (esquema duplicado, `supabase_functions` inexistente, clave foránea contra `auth.users`).
- `app/panel/page.tsx`: los avisos push abren `fiado`, `radar` o `reponer` (antes solo `reponer`; el de fiado ya apuntaba a una pestaña que no se abría).
- `package.json`: scripts `test:fuga` y `test:modificados` dentro de `npm test`.
- `README.md`: documenta todo lo anterior y los pendientes.

### Sin cambios / no incluido
- Prueba en navegador de Radar, Resumen y el cron: requiere sesión iniciada.
- Rotar `PUSH_WEBHOOK_SECRET` (quedó expuesto en un log).
- Revisión del PR #9: lo que hay en la rama `fase3-operacion` de GitHub no se pudo comparar; esta versión se rehízo desde `main`.
