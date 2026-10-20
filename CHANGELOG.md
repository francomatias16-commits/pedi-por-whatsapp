# Changelog

## demo-en-vivo — 2026-10-20

Demo en vivo como la del proyecto de distribuidoras (`/demo`), readecuada a kioscos. Detalle y puesta en marcha: `docs/DEMO.md`.

### Agregado
- `supabase/migrations/0059_demo_en_vivo.sql` (**aplicar en el SQL Editor ANTES de subir el código**, después de la 0058): `kioscos.es_demo`, `es_usuario_demo()`, trigger `demo_solo_lectura` en todas las tablas (rechaza cualquier cambio de la cuenta de la demo, directo o por funciones), políticas restrictivas de Storage, `demo_sembrar()` y `demo_reiniciar()` (solo `service_role`), slug `demo` reservado.
- `/demo` + `POST /api/demo`: entra con la cuenta de la demo desde el servidor (la clave no viaja al navegador). Si ya hay una sesión abierta, pregunta antes de cerrarla.
- `GET /api/cron/demo` + entrada en `vercel.json` (03:00 AR): reinicia los datos y restablece la cuenta.
- `scripts/crear-demo.mjs`: crea la cuenta y el kiosco demo (una vez por ambiente).
- Cartel "Estás en la demo" en el panel (`components/panel/AvisoDemo.tsx`) con salida a crear el kiosco propio.
- Portada: botón "Ver demo en vivo" arriba y abajo.
- Datos ficticios con puntos y pagos con Mercado Pago en mostrador y tienda (4 pedidos de la tienda).
- `supabase/tests/demo_test.py` (53 chequeos), `tests/demo.test.mjs` (15, dentro de `npm test`), mensajes en `lib/errores.ts`, variables `DEMO_EMAIL` y `DEMO_PASSWORD`.

### Cambiado
- `lib/pagos/servidor.ts` (`esDueno`, `rolDe`) y el callback OAuth de Mercado Pago: nunca autorizan nada sobre el kiosco demo (sin cobros, facturas, fotos ni conexión de cuentas reales).

### Sin cambios / no incluido
- Prueba real en navegador, con Supabase Auth y con el cron de Vercel: requiere el proyecto desplegado.
- `etapa2` a `etapa9` y `rls_test.py` (piden `pgserver`) no se pudieron correr acá; el resto de `supabase/tests` y `npm test` pasan.

## etapa3d-fotos-automaticas — 2026-10-18

Tercera parte de la Etapa 3 (ver `docs/ETAPA3D_FOTOS.md`): fotos automáticas de productos, sugeridas y nunca aplicadas solas.

### Agregado
- `supabase/migrations/0034_fotos_auto.sql`: interruptor `kioscos.fotos_auto_activo`, tablas `fotos_uso` (cupo diario, solo servidor) y `fotos_historial` (origen, quién, derechos, foto anterior), funciones `foto_aplicar`, `foto_deshacer`, `fotos_configurar_activo` y `fotos_usar_cupo`.
- `app/api/fotos/sugerir` y `app/api/fotos/descargar` (solo encargado y dueño, con el interruptor encendido). La descarga rechaza redes internas, redirecciones inseguras, tipos que no sean JPEG/PNG/WebP y más de 5 MB.
- Mi negocio: "Fotos automáticas". Productos: "Buscar foto automática", elegir, confirmar derechos y deshacer.
- `lib/fotos-sugerencias.ts`, `lib/fotos-cliente.ts`, `tests/fotos-sugerencias.test.mjs`, `supabase/tests/etapa29_test.py` (45 chequeos), mensajes en `lib/errores.ts`.
- Variables opcionales: `SERPER_API_KEY`, `FOTOS_LIMITE_DIARIO`.
- `lib/fotos-descarga.ts`: la IP se valida al conectar (cierra el DNS rebinding); `tests/fotos-descarga.test.mjs` prueba con sockets reales que un nombre que resuelve a red interna se corta antes de conectar.

## etapa3c-zonas-envio — 2026-10-18

Segunda parte de la Etapa 3 del plan (ver `docs/ETAPA3C_ZONAS.md`): envío por zonas.

### Agregado
- `supabase/migrations/0033_zonas_envio.sql`: tabla `zonas_envio` (RLS, lectura pública solo de las activas, escritura solo por RPC), interruptor `kioscos.zonas_envio_activo` (arranca apagado), `pedidos.zona_id` y `zona_nombre`, funciones `zona_guardar`, `zona_quitar` y `zonas_configurar_activo`, y `crear_pedido` con zona (la versión de 8 argumentos delega).
- Mi negocio: "Envío por zonas". Tienda: selector de zona con costo y mínimo. Pedidos: muestra la zona.
- `lib/zonas.ts`, `tests/zonas.test.mjs`, `supabase/tests/etapa28_test.py` (43 chequeos), mensajes en `lib/errores.ts`.

### Notas
- Aplicar la 0033 en el SQL Editor ANTES de subir el código (la tienda y el panel ya piden `zonas_envio_activo` y mandan `p_zona`).

## etapa3a-seguimiento — 2026-10-18

Quinta etapa del plan, primera parte de la Etapa 3 (ver `docs/ETAPA3A_SEGUIMIENTO.md`): seguimiento público del pedido.

### Agregado
- `supabase/migrations/0032_seguimiento.sql`: `pedidos.token_seguimiento` (64 hex, único, también para pedidos anteriores), `pedidos.entrega_estado` (`listo` o `en_camino`), interruptor `kioscos.seguimiento_activo` (arranca apagado), funciones `seguimiento_pedido(token)` (pública, sin datos personales) y `seguimiento_configurar_activo` (solo dueño), y trigger que fija las reglas de la etapa de entrega y hace inmutable el token.
- Página pública `/seguimiento/[token]` (sin indexar, sin referrer, se actualiza cada 20 s).
- Pedidos: botones "Marcar listo para retirar" / "Marcar en camino", insignia de entrega, interruptor (solo dueño) y link en el aviso por WhatsApp.
- `lib/seguimiento.ts`, `tests/seguimiento.test.mjs`, `supabase/tests/etapa27_test.py` (33 chequeos), mensajes en `lib/errores.ts`.

### Notas
- El slug `seguimiento` queda reservado (constraint `NOT VALID`: no toca locales existentes).
- Aplicar la 0032 en el SQL Editor ANTES de subir el código (el panel ya pide la columna `seguimiento_activo`).

## etapa2b-qr-caja — 2026-10-18

Cuarta etapa del plan, segunda mitad de la Etapa 2 (ver `docs/ETAPA2B_QR.md`): cobro con QR de Mercado Pago en la caja.

### Agregado
- `supabase/migrations/0031_qr_caja.sql`: `pos_qr_config` y `cobros_qr_pos`, interruptor `kioscos.cobro_qr_activo` (arranca apagado), funciones `qr_crear_cobro`, `qr_confirmar` (idempotente, verifica monto y moneda), `qr_estado_cobro`, `qr_cancelar_cobro`, `qr_puede_consultar`, `qr_vencer_pendientes`, `qr_estado_config`, `qr_cobros_sin_venta` y `qr_configurar_activo`. Trigger `ventas_pagos_exigir_qr`: con el interruptor encendido, un pago "mercadopago" solo se registra si hay un cobro aprobado del mismo monto sin usar.
- Rutas `POST /api/pagos/mp/qr/{alta,cobrar,cancelar}` y `GET /api/pagos/mp/qr/estado`. El dueño debe elegir el evento "Order (Mercado Pago)" en los Webhooks de su aplicación (la caja igual detecta el pago por consulta, con demora). Cajero, encargado y dueño cobran; el alta es solo del dueño.
- Caja: línea "Cobrar con QR" en el cobro (espera con consulta cada 3 segundos, cancelar, cobro ya aprobado), aviso de cobros con QR sin venta (en la caja y en el cierre).
- Panel: "QR en el mostrador" dentro de Cobrar con Mercado Pago (alta con ubicación, QR para imprimir, interruptor).
- Cobros con la API de Orders de Mercado Pago (`POST /v1/orders`, modo static sobre el QR fijo; caja con `POST /v2/pos`). `cobros_qr_pos.mp_order_id` guarda la orden.
- `lib/pagos/qr.ts`, `lib/pagos/qr-cliente.ts`, `components/CobroQR.tsx`, `components/caja/{useQrCaja.ts,QrSinVenta.tsx}`.
- Tests: `supabase/tests/etapa26_test.py` y `tests/qr.test.mjs` (`npm run test:qr`, dentro de `npm test`).

### Cambiado
- El webhook y la reconciliación de la Etapa 1 reparten por referencia externa entre pedidos de la tienda y cobros QR. El cron diario también reconcilia y vence cobros QR.
- `mp_desconectar` y un token revocado apagan también el QR.
- `lib/pagos/mp.ts`: las respuestas vacías (borrar una orden) ya no rompen.

### Importante
- Aplicar **0031** en el SQL Editor (con backup) **antes** de subir el código. El interruptor queda apagado: nada cambia hasta que el dueño lo encienda.
- Un QR fijo atiende un cobro a la vez por local. Los reembolsos son manuales desde Mercado Pago.
- No verificado acá: Mercado Pago real (sandbox: formato del aviso del tema Order, búsqueda de caja por id externo, nombre de provincia), Supabase real y el uso en celular. Sí corridos con Postgres 16: la 0031 y los 27 tests SQL; también `npm test`, `typecheck` y `build` (con Google Fonts simulado).

## etapa2a-equipo — 2026-10-18

Tercera etapa del plan, primera mitad (ver `docs/ETAPA2A_EQUIPO.md`): cajeros y roles. La 2B (QR de Mercado Pago en la caja) queda para después.

### Agregado
- `supabase/migrations/0030_equipo.sql`: `kiosco_miembros` y `kiosco_invitaciones` (solo por RPC), `rol_en` y `es_miembro`, `equipo_invitar/listar/cambiar_rol/quitar/revocar_invitacion/ver_invitacion/aceptar`, `pos_config_publica` (configuración del mostrador sin el hash del PIN) y `pos_exigir_supervisor`. Un trigger crea al dueño como miembro de cada local nuevo.
- Matriz de permisos aplicada por catálogo sobre 37 políticas y 54 funciones; el despliegue falla si algo de la matriz no existe.
- Invitación por enlace de un solo uso (`/unirse/[token]`), vence a los 7 días, el token no se guarda en claro.
- Panel: Mi negocio > Mi equipo (invitar, cambiar rol, quitar, cancelar invitaciones). Menú filtrado por rol; el cajero entra directo a la caja.
- `lib/equipo.ts`, roles en `lib/navegacion.ts`, mensajes nuevos en `lib/errores.ts`.
- Tests: `supabase/tests/etapa25_test.py` (190 chequeos: invitaciones, rol por tabla y operación, caja, PIN de supervisor, aislamiento entre locales) y `tests/roles.test.mjs` (`npm run test:roles`, dentro de `npm test`).

### Cambiado
- Las políticas y funciones que decían "dueño" ahora dicen "miembro con estos roles"; el dueño de la cuenta sigue teniendo todo. `es_dueno()` no cambió.
- Caja lee la configuración por `pos_config_publica()`. El cajero siempre pide PIN de supervisor para anular o devolver.
- `borrar_cliente` se abre al encargado (coherente con la política de la tabla). `caja_reporte_z` se abre al cajero (lo necesita para cerrar su caja).

### Importante
- Aplicar **0030** en el SQL Editor (con backup) **antes** de subir el código.
- Decisión que tomé por vos: el cajero anula solo con PIN de supervisor.
- No verificado acá: Supabase real, el flujo de Google con la invitación y el celular. El build se probó con Google Fonts simulado.
- Limitación: un cajero hoy no puede activar los avisos push (el botón está en Mi negocio).

## etapa1-mercado-pago — 2026-10-18

Segunda etapa del plan (ver `docs/ETAPA1_PAGOS.md`): el cliente paga al pedir y el pedido se confirma solo.

### Agregado
- `supabase/migrations/0029_pagos.sql`: tablas `integraciones_pago` (credencial cifrada, sin acceso desde el navegador), `transacciones_pago` y `webhooks_recibidos`; columnas `pedidos.pago_estado`, `pedidos.stock_reservado`, `kioscos.cobro_online_activo`; funciones `pago_confirmar` (idempotente, verifica monto y moneda), `pago_vencer_pendientes`, `pago_estado_pedido`, `pago_puede_consultar`, `webhook_registrar`, `webhook_marcar`, `mp_estado_conexion` y `mp_desconectar`.
- Rutas: `POST /api/pagos/mp/{conectar,probar,preferencia,webhook}`, `GET /api/pagos/mp/estado` y el cron `/api/cron/pagos`.
- Tienda: "Pagar ahora con Mercado Pago" y la pantalla de retorno `/[slug]/pago`.
- Panel: Mi negocio > "Cobrar con Mercado Pago" (guía en 4 pasos, probar la conexión, interruptor, desconectar). Pedidos: insignias "Esperando pago", "Pagado online" y "Reembolsado".
- `lib/pagos/` (cifrado AES-256-GCM, firma y estados de Mercado Pago, pantalla de retorno), `lib/push-envio.ts`, avisos de pago en `lib/push.ts`.
- Tests: `supabase/tests/etapa24_test.py` (101 chequeos) y `tests/pagos.test.mjs` (`npm run test:pagos`, dentro de `npm test`).

### Cambiado
- `crear_pedido` (misma firma): si el local cobra online y el cliente elige Mercado Pago, el pedido nace esperando pago y **reserva el stock**. El trigger de stock cuenta como retenido un pedido pendiente con reserva, y al devolver stock un producto que había quedado en 0 vuelve a estar disponible.
- El aviso push de "pedido nuevo" de un pedido online sale cuando se aprueba el pago, no al crearlo.
- Un pedido online espera su pago **3 horas** (el plan decía 24): una reserva sin pagar no puede retener stock de un día para otro. Se libera al crear otro pedido en el local y en el cron diario.

### Importante
- Aplicar **0029** en el SQL Editor (con backup) **antes** de subir el código.
- Cargar `PAGOS_CIFRADO_KEY` en Vercel antes de que un dueño conecte Mercado Pago, y no cambiarla después.
- No verificado acá: Mercado Pago real (sandbox), el formato exacto de la firma de avisos con `notification_url` por preferencia, el E2E y el flujo en celular. El build se probó con Google Fonts simulado.

## etapa0-cierre-base — 2026-10-18

Primera etapa del plan de incorporación de herramientas operativas (ver `docs/ETAPA0_CIERRE.md`).

### Agregado
- `supabase/migrations/0028_cierre_base.sql`: `kiosco_exportar_seccion` (el dueño baja sus datos, sin hash de PIN ni claves push), `kiosco_pedir_baja` / `kiosco_cancelar_baja` (baja suave: cierra la tienda y conserva los datos 30 días), `kioscos_purgar_bajas` (borrado definitivo, solo administración) y la columna `kioscos.baja_solicitada_at`.
- Mi negocio > "Mis datos y baja de la cuenta" (`components/MisDatos.tsx`, `lib/exportar.ts`). Un local en baja deja de mostrarse en la tienda pública.
- `/api/salud`, `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`.
- Sentry (`@sentry/nextjs`) en servidor, navegador y edge; apagado sin DSN; limpia cuerpos, cookies, usuario y teléfonos antes de enviar.
- E2E con Playwright (`e2e/`, `npm run test:e2e`) y job `e2e` en CI (se omite sin secretos).
- Tests: `supabase/tests/etapa23_test.py` (35 chequeos), `tests/cierre-base.test.mjs` (`npm run test:cierre`, dentro de `npm test`).

### Cambiado
- `/privacidad` sección 6: describe la baja con borrado a los 30 días (texto en borrador, pendiente de revisión legal).
- `next.config.mjs` ahora pasa por `withSentryConfig` (Next agrega `instrumentationHook`).

### Importante
- Aplicar **0027 y 0028** en el SQL Editor **antes** de subir el código. Sin 0028, la sección de baja y exportación muestra el error genérico, y la tienda pública falla porque pide `baja_solicitada_at`.
- La numeración de la etapa 1 (pagos) pasa a **0029**: la 0028 quedó para el cierre de base.
- No verificado acá: el E2E contra un Supabase real, ni push, escáner y crons en celular. El build se probó con Google Fonts simulado (sin internet en el entorno).

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
