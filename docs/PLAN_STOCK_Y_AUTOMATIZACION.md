# Plan de implementación: stock automático y funciones a replicar desde el proyecto de GitHub

**Proyecto destino:** "Pedí por WhatsApp" (Next.js 14 + Supabase, kioscos y almacenes).
**Proyecto de referencia:** `_github.zip` (distrib / Fluxo, ERP para distribuidoras).
**Alcance del análisis:** stock, compras, proveedores, automatizaciones, crons y operación del repo. No se leyeron los ~3.500 archivos ni se ejecutaron tests; las rutas citadas son las que se revisaron.

> Convención: todo lo marcado como **Boceto** o **Propuesta** es diseño sugerido, no código existente en ninguno de los dos proyectos. Los nombres de tablas, columnas y funciones nuevos son tentativos.

---

## 1. Diagnóstico: cómo está el stock hoy en la app

Lo que ya existe y funciona (no rehacer):

- Stock numérico opcional por producto (`stock_controlado`, `stock`), `0009_stock.sql`.
- Descuento al confirmar o entregar un pedido, y reposición al cancelar.
- Venta en mostrador que descuenta stock, con venta sin stock permitida por producto (`permite_sin_stock`), `0012` y `0013`.
- Devoluciones parciales con reposición de stock (`0013`).
- Proveedores con cuenta corriente, compras que suman stock y guardan el último costo, anulación de compra y ajuste manual con motivo (`0015`).
- Escáner de códigos con la cámara y celular vinculado como lector (`/escanear`).
- Web Push para pedidos nuevos (`public/sw.js`, `lib/push.ts`, `/api/push/pedido`).
- Carga masiva por planilla (`CargaMasiva.tsx`, `lib/importar.ts`).

Lo que falta o es manual:

| # | Hueco | Evidencia |
|---|---|---|
| 1 | No hay stock mínimo ni alertas. El único aviso es "Sin stock" cuando llega a 0. | `0009`: solo pone `disponible = false` al llegar a 0. |
| 2 | No hay sugerencia de qué reponer ni a quién pedírselo. | No existe nada equivalente en `Proveedores.tsx` ni en `lib/compras.ts`. |
| 3 | El historial no registra ventas ni devoluciones. | `stock_movimientos.tipo` solo admite `compra`, `anulacion_compra`, `ajuste`; el README lo declara como límite conocido. |
| 4 | Los ajustes no tienen categoría (merma, rotura, vencimiento, conteo). | `ajustar_stock` solo recibe texto libre de motivo. |
| 5 | No hay conteo físico por lista. | Hay que ajustar producto por producto. |
| 6 | El costo se guarda pero no se usa. | `productos.costo` existe; en `Productos.tsx`, `Precios.tsx` y `Resumen.tsx` no aparece. |
| 7 | Los precios se ajustan solo por porcentaje manual. | `Precios.tsx`; el resumen apenas recuerda a los 7 días. |
| 8 | Nada corre solo. | No hay crons ni jobs programados en el proyecto. |
| 9 | El stock no aparece en el resumen semanal. | `resumen_semana` / `Resumen.tsx` no incluye stock bajo, agotados ni dinero inmovilizado. |
| 10 | Los recordatorios de fiado se mandan a mano. | README: "lo envía el dueño a mano". |
| 11 | En el POS, si falta stock hay que salir a cargarlo y se pierde el carrito. | La app solo permite vender sin stock en productos marcados. |
| 12 | No hay CI, backup programado ni chequeos automáticos de RLS. | El repo tiene tests sueltos, sin pipeline. |

---

## 2. Qué hace GitHub y de dónde sale (referencia rápida)

| Función | Dónde está en el proyecto de GitHub |
|---|---|
| Reposición autónoma: velocidad de venta, días restantes, cantidad sugerida | `supabase/migrations/035_stock_autonomo.sql`, `071_punto_pedido_predictivo.sql` (función `analizar_stock_autonomo`) |
| Generación de órdenes de compra automáticas y alertas | `lib/handlers/stock-auto.js`, `lib/repos/stock-auto.js`, cron `/api/stock-auto?accion=analizar` a las 6:00 |
| Historial de movimientos con motivo estructurado | `CHANGELOG_v1096_motivo_ajuste_stock_cierre_punto2.md` (enum `motivo_ajuste_stock`: manual, merma, rotura, vencimiento, conteo_fisico) |
| Reporte de mermas y vencimientos valorizado a costo | `lib/handlers/stock.js` (`GET /api/stock?reporte=mermas`) |
| Conteo físico por planilla | `CHANGELOG_v1104_conteo_stock_planilla.md` |
| Lotes, FEFO y liquidación automática por vencimiento | `lib/handlers/stock.js` (`handleLotes`, `handleLotesFefo`, `handleLiquidacion`), cron 6:30 |
| Agregar stock rápido desde el POS | `CHANGELOG_v1090_agregar_stock_rapido_desde_carrito.md` |
| Venta con stock negativo controlado por producto | `CHANGELOG_v1088_permite_negativo_vender_sin_stock.md` |
| Recepción de compra con excedente | `CHANGELOG_v408_excedente_recepcion_oc.md` |
| Panel de productos modificados (hoy / 7 / 30 días) | `CHANGELOG_v340_panel_productos_modificados_stock.md` |
| Reglas "cuando pase X, avisame" | `CHANGELOG_v559_fase6_reglas_automatizacion.md`, `lib/reglas-automatizacion.js` |
| Avisos programados (deuda vencida, clientes en fuga, etc.) | `vercel.json` (sección `crons`), `lib/eventos-listeners/` |
| Backup, CI y chequeos previos al deploy | `.github/workflows/backup-supabase.yml`, `ci.yml`, `restore-to-test.yml`; script `predeploy` en `package.json` |

---

## 3. Plan por fases

### Fase 1: stock que se avisa solo (prioridad máxima)

Objetivo: que el dueño sepa qué reponer y a quién, sin hacer cuentas, y que el sistema le avise antes de quedarse sin mercadería.

#### 1.1 Datos nuevos en `productos` (Propuesta, migración `0018`)

- `stock_minimo` (entero, default 0). Para productos por peso se guarda en gramos, igual que `stock`.
- `stock_objetivo` (entero, opcional). Cuánto querés tener después de reponer.
- `lead_time_dias` (entero, default 2 o 3; en GitHub es 7 porque son distribuidoras).
- `proveedor_default_id` (referencia a `proveedores`, opcional, mismo kiosco).
- Respetar el patrón de seguridad de la app: la tienda pública (`anon`) no debe poder leer estas columnas. Hay que mantener el `grant select (...)` de columnas de `0009` sin agregarlas.
- Pantalla de edición: sumar los tres campos en `Productos.tsx` junto a "Controlar stock por cantidad", y permitirlos también en `CargaMasiva` / `lib/importar.ts`.

#### 1.2 Función de reposición sugerida (Propuesta)

Portar y simplificar `analizar_stock_autonomo`. Boceto de la lógica:

- Entrada: `p_kiosco uuid`. Verificar `es_dueno(p_kiosco)` (mismo patrón que `registrar_compra`).
- Velocidad de venta por día = unidades vendidas en los últimos 30 días ÷ 30.
  - **Diferencia importante con GitHub:** allá solo cuenta pedidos (`pedido_items`). En un kiosco la mayor parte se vende en mostrador, así que hay que sumar también los renglones de venta del POS (revisar el nombre real de las tablas en `0012`/`0013`).
  - Excluir ventas anuladas y descontar devoluciones.
- Días restantes = stock ÷ velocidad (si la velocidad es 0, no calcular días).
- Necesita reponer = stock menor o igual a `stock_minimo`, o stock menor a la venta esperada durante el `lead_time_dias` más el colchón mínimo (lógica de `071`).
- Cantidad sugerida = `stock_objetivo` (o 30 días de venta si no está cargado) menos el stock actual, nunca negativa.
- Devolver: producto, stock, velocidad, días restantes, necesita reponer, cantidad sugerida, proveedor por defecto.
- Productos por peso: todo en gramos internamente; mostrar en kg (reusar `cantidadTexto` de `lib/compras.ts`).
- Considerar el pedido ya confirmado pero no entregado como demanda comprometida (como hace `071`) solo si el stock se descuenta recién al entregar; en esta app se descuenta al confirmar, así que probablemente no haga falta. **Verificar antes de implementar.**

#### 1.3 Casos que GitHub aprendió a manejar (copiarlos desde el día uno)

- **Producto sin historial de ventas y sin objetivo cargado:** no inventar una cantidad. Mostrarlo como "Sin datos para calcular, cargá un mínimo/objetivo" (fix 460 de GitHub: antes se descartaban en silencio y un producto en 0 nunca aparecía).
- **Producto sin proveedor por defecto:** mostrarlo igual, en una sección "Sin proveedor asignado", y avisar. No descartarlo.
- **Idempotencia:** si se generan alertas o borradores automáticos, no duplicarlos. GitHub no crea otra orden para el mismo proveedor si ya hay una de los últimos 7 días, y las alertas tienen unicidad por producto y tipo mientras estén sin resolver.
- **Tipos de alerta** (de `alertas_stock`): `quiebre` (menos de 3 días o agotado), `critico`, `sin_proveedor`, `sin_historial`.

#### 1.4 Pantalla "Para reponer" (Propuesta)

- Nueva pestaña en el panel (cerca de Proveedores). Lista agrupada por proveedor con: producto, stock, días restantes, cantidad sugerida editable, último costo.
- Sección aparte para "Sin proveedor" y "Sin datos".
- Botón **"Pedir por WhatsApp"** por proveedor: arma el texto con la lista y abre `wa.me/<telefono del proveedor>` (el teléfono ya está en `proveedores`; reusar `lib/whatsapp.ts`). En GitHub el envío es por email; en un kiosco WhatsApp es lo natural.
- Botón **"Registrar compra con esto"**: precarga el formulario de compra existente (`registrar_compra`) con las líneas sugeridas, para que al llegar la mercadería solo se confirmen cantidades y costos.
- Opcional: guardar el pedido como borrador (tabla de pedidos a proveedor) para poder marcar "pedido hecho / recibido". Si se hace, copiar de GitHub: estados `borrador → enviada → recibida_parcial → recibida → cancelada` y el criterio de recepción estricta (no recibir más de lo pendiente; el excedente se registra aparte como ajuste con motivo `excedente_proveedor`, v408).

#### 1.5 Alertas automáticas

- Ejecutar el análisis una vez por día (ver sección 4, "Programación de tareas").
- Push al dueño con un resumen, no uno por producto. Ejemplos: "5 productos para reponer, 2 agotados" y "3 productos sin proveedor asignado".
- Reusar la infraestructura de `lib/push.ts` y `push_suscripciones`. Hoy el envío sale de un Database Webhook sobre `pedidos`; hace falta un segundo punto de entrada (el cron) que llame a la misma lógica de envío.
- Aviso dentro de la app (banner en el panel y en `Resumen`) por si el push no está activado.

#### 1.6 Resumen semanal con stock

Agregar a `resumen_semana` / `Resumen.tsx`: cantidad de productos agotados, productos bajo mínimo y dinero inmovilizado en stock (stock × costo). Botón directo a "Para reponer".

#### 1.7 Agregar stock rápido desde el POS (v1090)

- En el POS, cuando un producto topa con `sin_stock`, ofrecer "Cargar stock ahora": modal con cantidad, que ajusta stock con motivo fijo y **agrega el producto al carrito automáticamente** sin perder lo armado.
- Permisos: dueño directo; cajero con PIN de supervisor (la app ya tiene `PinModal` y PIN de supervisor en `0013`/`0014`). Que la validación final la haga la función SQL, no el cliente.

**Criterios de aceptación Fase 1**

- Un producto con stock menor o igual al mínimo aparece en "Para reponer" sin que nadie haga nada.
- El push diario llega con la app cerrada y no se repite si no cambió nada.
- Un producto sin proveedor, o sin historial, nunca desaparece de la lista.
- Los productos por peso se muestran en kg y se calculan en gramos.
- Tests nuevos en el mismo formato que `supabase/tests/etapaN_test.py` (por ejemplo `etapa14`/`etapa15`): caso feliz, producto sin historial, sin proveedor, por peso, ventas de mostrador incluidas, aislamiento entre kioscos (RLS).

---

### Fase 2: historial confiable y control de pérdidas

#### 2.1 Historial completo de movimientos

Hoy cuatro lugares modifican `productos.stock` directamente: el trigger de pedidos (`0009`), la venta del POS y su anulación (`0012`/`0013`), las devoluciones (`0013`) y las compras (`0015`).

- Ampliar `stock_movimientos.tipo` con: `venta`, `anulacion_venta`, `devolucion`, `pedido`, `cancelacion_pedido`, `merma`, `rotura`, `vencimiento`, `conteo`, `excedente_proveedor` (ajustar el `check`).
- **Propuesta de diseño:** en lugar de agregar un `insert into stock_movimientos` en cada una de las cuatro funciones (riesgo de olvidar alguna en el futuro), usar un único trigger `after update of stock on productos` que registre `stock_resultante` y la diferencia, tomando el tipo y el motivo de una variable de sesión (`set_config('app.mov_tipo', ...)`) que cada función setea antes de actualizar. Si se prefiere más simple y explícito, agregar los inserts a mano en las cuatro funciones y cubrirlo con un test que compruebe que `sum(movimientos)` coincide con el stock actual.
- Test de integridad que se puede reutilizar en CI: para cada producto con stock controlado, el stock actual debe ser igual al inicial más la suma de movimientos.
- GitHub encontró este mismo hueco más de una vez (devoluciones y anulaciones sin historial, migraciones 482 y 483) y además un error de depósito al anular; en la app hay un solo depósito por kiosco, así que ese segundo problema no aplica.

#### 2.2 Motivos de ajuste estructurados

- Cambiar `ajustar_stock(producto, nuevo, motivo)` para recibir además un **tipo de motivo** (manual, merma, rotura, vencimiento, conteo) y guardarlo en el movimiento.
- Selector de motivo en el modal de ajuste de `Productos.tsx`, con el texto libre como detalle opcional.
- Mantener las reglas actuales: lock de fila, validación de dueño, `sin_cambios`, `motivo_requerido`.

#### 2.3 Reporte de mermas

- Pantalla simple por período (este mes, mes anterior, rango): unidades y **costo perdido** por motivo (merma, rotura, vencimiento) usando `productos.costo`.
- Total del período y top de productos con más pérdida.
- Referencia: `GET /api/stock?reporte=mermas` y la RPC `reporte_mermas_vencimientos` en GitHub.

#### 2.4 Conteo físico por planilla

- Flujo (de v1104): armar la lista (todos, por categoría, solo stock bajo o manual) → cargar lo contado → revisar diferencias → aplicar todo junto.
- Tablas tentativas: `conteos_sesiones` (kiosco, criterio, estado `abierta/aplicada/descartada`, notas) y `conteos_items` (producto, cantidad al armar, cantidad contada, resultado).
- Al aplicar, comparar contra el **stock en vivo** (no contra el snapshot), porque pudo haber ventas durante el conteo. Es el mismo criterio de GitHub.
- Cada diferencia genera un movimiento tipo `conteo` con la diferencia.
- **Sinergia con lo que ya tenés:** contar escaneando códigos con la cámara o con el celular vinculado (`Escaner.tsx`, `useVinculoCelular.ts`) en lugar de teclear.
- Permitir que la planilla se haga en el celular, parado frente a la góndola.

#### 2.5 Costo, margen y precios

- Mostrar costo y margen (%) por producto en `Productos.tsx` y en la pantalla de precios.
- Alerta o marca cuando el último costo de compra subió y el precio de venta quedó con margen menor a un umbral configurable.
- En `Precios.tsx`: ofrecer "actualizar precios según costo" con margen objetivo por categoría, con la misma vista previa, historial y botón de deshacer que ya existen. En GitHub esto vive en `reglas-precio` y en las listas con plantilla; para un kiosco alcanza con margen por categoría.
- Aviso al registrar una compra si el costo nuevo difiere mucho del anterior (variación porcentual configurable).

#### 2.6 Panel de "qué cambió"

Vista rápida de productos con movimientos hoy, últimos 7 y 30 días, con diferencia neta y último movimiento (v340). Se arma desde el historial de 2.1.

**Criterios de aceptación Fase 2**

- Después de cualquier venta, devolución, anulación, compra o ajuste existe un movimiento y el saldo cierra.
- Un conteo de 50 productos se aplica en una sola operación y deja trazabilidad por producto.
- El reporte de mermas coincide con la suma de los movimientos del período.
- Se puede ver el margen de cualquier producto con costo cargado.

---

### Fase 3: según el rubro del comercio

#### 3.1 Vencimientos por lote con FEFO (solo si vendés productos con fecha)

- Lotes con fecha de vencimiento y cantidad; la venta descuenta primero del lote que vence antes (FEFO).
- Lista "por vencer" (7, 15, 30 días) y baja de lote con motivo `vencimiento` que impacta el stock (v352).
- Liquidación automática (opcional): sugerir descuento para lo que vence pronto, con aprobación del dueño antes de cambiar precios. En GitHub se generan solas por cron; en un kiosco conviene empezar con **sugerencia** y no con cambio automático de precio.
- Es la parte más pesada del stock de GitHub (lotes, FEFO, recall, ofertas). Hacerla solo si el rubro lo justifica.
- Si se implementa, definir antes cómo conviven lotes con venta por peso y con productos sin lote.

#### 3.2 Reglas configurables "cuando pase X, avisame"

- Tabla de reglas (evento, condición, acción) con motor que evalúe condiciones simples (`=`, `!=`, `>`, `>=`, `<`, `<=`, combinadas con "y"/"o") y acción de notificar por push.
- Criterio clave de GitHub: **fail-closed**. Una condición mal armada, un operador desconocido o un campo faltante no dispara nunca (no dispara "por las dudas").
- Ejemplos útiles para un kiosco: "si una venta supera $X", "si el fiado de un cliente supera $Y", "si un producto baja de N unidades".
- Dejar para el final: las Fases 1 y 2 ya cubren los avisos más importantes con reglas fijas.

#### 3.3 Recordatorios automáticos de fiado y clientes

- Cron semanal de fiado vencido (equivalente a `/api/notif/deuda-vencida`): resumen al dueño de quién debe y desde cuándo, con botón a WhatsApp prellenado. **No** enviar mensajes automáticos a los clientes sin que el dueño los apruebe: la app hoy usa `wa.me` (lo envía una persona) y conviene mantenerlo, porque la API oficial de WhatsApp Business tiene costos, plantillas y aprobación de Meta.
- Aviso de clientes que dejaron de venir (equivalente a `clientes-en-fuga`), apoyado en los sellos y pedidos que ya existen.

#### 3.4 Curva ABC y rotación

- Clasificar productos por aporte a ventas o margen (A, B, C) para decidir mínimos y qué dejar de comprar. Referencia en GitHub: `CHANGELOG_punto5_curva_abc_pantalla.md`.
- Útil como complemento de "Para reponer": priorizar los A.

---

## 4. Programación de tareas (cron) y seguridad

La app hoy no tiene jobs programados. Hay dos caminos; elegir uno:

| Opción | Cómo | Ventaja | Consideración |
|---|---|---|---|
| A. Vercel Cron | Rutas `app/api/cron/...` + `vercel.json` | Mismo patrón que GitHub (`vercel.json` > `crons`) | El plan Hobby limita frecuencia y cantidad de crons (GitHub tiene el changelog v589 sobre eso). Verificar el límite vigente. |
| B. `pg_cron` en Supabase | Funciones SQL programadas | La lógica queda toda en la base, más cerca de tus tests de Postgres | El push necesita llamar a la ruta de Next.js o a una Edge Function (por ejemplo con `pg_net`). |

Reglas de seguridad copiadas de las auditorías de GitHub:

- **No confiar en el header `x-vercel-cron`.** Cualquiera puede mandarlo (auditoría CRON-001). Exigir `Authorization: Bearer <CRON_SECRET>` con un secreto largo en variables de entorno, igual que ya se hace con `PUSH_WEBHOOK_SECRET`.
- El job debe recorrer **todos los kioscos** con la clave de servicio, y las funciones que reciben un kiosco deben seguir validando permisos cuando las llama un usuario. Una función de análisis con `security definer` que no verifique `es_dueno` permite leer datos de otro kiosco (hallazgo de la auditoría de GitHub sobre RPCs sin chequeo de tenant). Separar la versión "para el usuario" de la versión "para el cron".
- Ejecutar el análisis de forma idempotente: si el cron corre dos veces el mismo día, no duplica alertas ni pushes.
- Registrar cada corrida (cuántos kioscos, cuántas alertas, errores) para poder diagnosticar. Si un kiosco falla, que no corte a los demás.
- Limitar la frecuencia de push: un resumen diario, no uno por producto.
- Mantener las funciones nuevas con `set search_path = public`, `revoke ... from public, anon` y `grant execute` solo a `authenticated` (patrón de `0015`). GitHub tiene un chequeo automático de esto (`check-search-path-security-definer.js`); ver 5.2.

---

## 5. Operación del proyecto

### 5.1 Backup automático

- Referencia: `.github/workflows/backup-supabase.yml` (y `09b_backup_automatizado_setup.md` en `AUDITORIA_2026/etapas`).
- Backup programado de la base a un lugar fuera de Supabase, con aviso si falla.
- Probar la restauración en un proyecto de prueba (`restore-to-test.yml`). Un backup que nunca se restauró no es una garantía.

### 5.2 CI y chequeos antes de desplegar

- Un workflow que corra `npm run typecheck` y `npm test` en cada cambio (hoy los tests existen pero nadie los dispara solos).
- Chequeo de que **toda tabla nueva tenga RLS activado** (GitHub: `scripts/check-rls-tablas.js`). Es especialmente relevante porque el README de la app dice que la seguridad depende de RLS y la anon key es pública.
- Chequeo de funciones `security definer` sin `search_path` (`check-search-path-security-definer.js`).
- Chequeo de que las migraciones estén numeradas y registradas sin saltos ni duplicados (`check-migraciones-registro.js`).
- Los tests de Postgres (`supabase/tests/*.py`) pueden correr en CI con `pgserver`, como ya describe el README.

### 5.3 Mensajes de error entendibles

Una lección de la auditoría de GitHub: mensajes como "Verificá la consola" no sirven. Seguir el patrón de `lib/compras.ts` (`ERRORES_COMPRAS` / `mensajeCompras`) para cada error nuevo (por ejemplo `sin_proveedor`, `sin_datos_para_calcular`, `conteo_ya_aplicado`), y no dejar pasar el mensaje técnico de Postgres al usuario.

---

## 6. Qué NO replicar

Es complejidad de distribuidora que no aporta a un kiosco o almacén:

- Facturación ARCA/AFIP, notas de crédito y débito fiscales.
- Cheques, score de riesgo y consulta BCRA.
- Rutas, choferes, repartos y seguimiento en vivo.
- Multi-depósito y transferencias entre depósitos.
- Portales de cliente, chofer y proveedor con login propio.
- Planes SaaS, suscripciones y cobro de la plataforma.
- WhatsApp bidireccional con bot e IA, Embedded Signup de Meta.
- Integraciones WooCommerce y catálogo de Meta.
- Listas de precios por cliente, precios escalonados y condiciones comerciales.
- Asistente de IA por voz con múltiples proveedores.
- Sincronización con ERP externos y exportación contable.

---

## 7. Orden sugerido de trabajo y estimación relativa

| Orden | Entrega | Tamaño relativo | Depende de |
|---|---|---|---|
| 1 | Migración `0018`: columnas de mínimo, objetivo, lead time y proveedor por defecto + función de reposición + tests | Mediano | Revisar tablas de venta del POS |
| 2 | Pantalla "Para reponer" + botón WhatsApp + precarga de compra | Mediano | 1 |
| 3 | Cron diario + push de resumen + aviso en `Resumen` | Mediano | 1, sección 4 |
| 4 | Agregar stock rápido en el POS | Chico | PIN existente |
| 5 | Historial completo (trigger o inserts) + test de saldo | Mediano | Ninguna |
| 6 | Motivos estructurados + reporte de mermas | Chico | 5 |
| 7 | Conteo por planilla con escáner | Mediano | 5 |
| 8 | Costo, margen y sugerencia de precios | Mediano | Ninguna |
| 9 | CI + backup + chequeos de RLS | Chico | Ninguna (conviene hacerlo temprano) |
| 10 | Vencimientos/FEFO, reglas, recordatorios de fiado, curva ABC | Grande, solo si el rubro lo pide | 5 |

Recomendación: hacer el punto 9 en paralelo desde el principio, porque cada migración nueva se beneficia de que los chequeos ya estén corriendo.

---

## 8. Checklist final

**Fase 1**
- [x] Columnas `stock_minimo`, `stock_objetivo`, `lead_time_dias`, `proveedor_default_id` y grants sin exponerlas a `anon`
- [x] Campos nuevos en edición de producto y en carga masiva
- [x] Función de reposición con ventas de mostrador y pedidos
- [x] Manejo de producto sin historial, sin proveedor y por peso
- [x] Pantalla "Para reponer" agrupada por proveedor
- [x] Botón "Pedir por WhatsApp" y precarga de compra
- [x] Cron diario con secreto y recorrido de todos los kioscos
- [x] Push de resumen idempotente y banner en el panel
- [x] Stock en `resumen_semana`
- [x] Agregar stock rápido en el POS con PIN
- [x] Tests de base (caso feliz, bordes y aislamiento entre kioscos)
- [x] Pedido a proveedor como documento con estados (opcional; migración 0027, falta aplicarla en producción)

**Fase 2**
- [x] Tipos de movimiento ampliados y ventas/devoluciones registradas
- [x] Test de que el saldo del historial coincide con el stock
- [x] Motivo estructurado en el ajuste de stock
- [x] Reporte de mermas valorizado
- [x] Conteo por planilla con escáner (cámara y celular vinculado; falta probar en el celular)
- [x] Costo y margen visibles y sugerencia de precio por costo
- [x] Panel de productos modificados

**Fase 3 (opcional)**
- [x] Lotes, vencimientos y FEFO
- [x] Reglas "avisame cuando"
- [x] Resumen semanal de fiado y clientes inactivos
- [x] Curva ABC

**Operación**
- [x] Workflow de CI con typecheck y tests
- [x] Chequeo automático de RLS y `search_path`
- [x] Backup programado y restauración probada (backup listo; falta correr el workflow de restauración corregido en GitHub)
- [x] Mensajes de error amigables para cada error nuevo

---

## 9. Puntos a verificar antes de empezar

1. Nombre real de las tablas de ventas del mostrador en `0012_pos.sql` y `0013_pos_avanzado.sql`, para calcular la velocidad de venta.
2. Si el stock de pedidos se descuenta al confirmar (así dice `0009`), para decidir si hace falta contar la demanda comprometida.
3. Límites del plan de Vercel para crons, o disponibilidad de `pg_cron` y `pg_net` en tu proyecto de Supabase.
4. Qué hacer con el stock existente al introducir `stock_minimo`: sugerencia de valor inicial (por ejemplo, la venta de unos días) para que la primera corrida no llene la lista de avisos.
5. (Resuelto: se hizo, ver 0027) Si querés guardar los pedidos a proveedores como documento (con estados) o alcanza con el mensaje de WhatsApp y la compra posterior.
6. El archivo `.env.local` viene dentro de `app.zip`. El README dice que solo tiene URL y la anon key (pública por diseño), pero conviene confirmarlo y no compartir nunca el zip si alguna vez se agrega la `SUPABASE_SERVICE_ROLE_KEY` ahí.
