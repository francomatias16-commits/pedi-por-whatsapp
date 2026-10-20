# Demo en vivo

Un kiosco de ejemplo al que se entra con un clic desde la portada ("Ver demo en vivo" → `/demo`). Se puede mirar todo el panel (Inicio, Pedidos, Caja, Productos, Club de puntos, Promos, Radar, Resumen…), pero **no se guarda nada**. Cada noche se reinicia sola.

## Cómo funciona

1. `/demo` llama a `POST /api/demo`, que inicia sesión en el **servidor** con la cuenta de la demo (`DEMO_EMAIL` / `DEMO_PASSWORD`) y le pasa la sesión al navegador. La contraseña nunca viaja en el código que baja el navegador.
2. La cuenta es dueña del kiosco `kiosco-demo` (`kioscos.es_demo = true`). Ahí no manda la pantalla sino la **base de datos**: un trigger por sentencia (`demo_solo_lectura`) en todas las tablas rechaza con `demo_solo_lectura` cualquier INSERT, UPDATE, DELETE o TRUNCATE de esa cuenta, sea directo o desde una función SQL. En Storage, tres políticas restrictivas impiden subir, cambiar o borrar archivos.
3. En el servidor, `esDueno` y `rolDe` no autorizan nada sobre el kiosco demo: no hay cobros, facturas ARCA, fotos automáticas ni conexión de Mercado Pago reales. El panel muestra un cartel "Estás en la demo" con el botón **Salir y crear mi kiosco**.
4. La tienda pública de la demo es `/kiosco-demo`. Cualquier visita puede hacer un pedido de prueba; se borra con el reinicio.
5. Cada noche (03:00 hora Argentina, `vercel.json`) `GET /api/cron/demo` borra el kiosco demo y lo arma de nuevo (`demo_reiniciar()`), y restablece la contraseña por si alguien la cambió.

Los datos ficticios: 12 productos, 3 proveedores, 6 clientes con puntos, 60 días de ventas del mostrador (efectivo, transferencia y Mercado Pago), fiado, un turno de caja abierto, lotes con vencimiento, reglas de aviso y 4 pedidos de la tienda (dos entregados —uno pagado con Mercado Pago—, uno confirmado y uno nuevo).

## Puesta en marcha (una sola vez por ambiente)

1. Aplicar `supabase/migrations/0059_demo_en_vivo.sql` en el SQL Editor (después de la 0058).
2. Desde tu computadora:
   ```
   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_EMAIL=demo@tu-dominio.com DEMO_PASSWORD='una-clave-larga' node scripts/crear-demo.mjs
   ```
   Crea la cuenta (con ese mail, que no tiene que existir como persona real) y arma el kiosco.
3. En Vercel (Production y Preview) cargar `DEMO_EMAIL` y `DEMO_PASSWORD` con los mismos valores. `CRON_SECRET` y `SUPABASE_SERVICE_ROLE_KEY` ya están.
4. Redeploy. Entrar a `/demo` y comprobar que abre el panel y que al guardar algo aparece "Esto es la demo…".

## Reglas para el que siga

- **Tabla nueva = protegerla.** Toda migración que cree una tabla en `public` tiene que terminar con `select public.demo_proteger_tablas();`. `supabase/tests/demo_test.py` falla si alguna tabla queda sin el trigger.
- **Dato nuevo = sembrarlo.** Si agregás una pantalla que se ve vacía en la demo, sumá los datos en `demo_sembrar()` (con una migración que la reemplace) y en `demo_test.py`.
- **Servidor nuevo = revisar.** Toda ruta de `/api` que llame a un tercero con credenciales de un local (cobros, facturas, mensajes) tiene que pasar por `rolDe`/`esDueno`, que ya excluyen la demo, o chequear `es_demo` por su cuenta.
- La cuenta de la demo no puede ser la de una persona con un kiosco real (la base lo rechaza: `demo_usuario_con_kiosco`).

## Límites conocidos

- `POST /api/demo` no tiene límite de pedidos propio: lo cubre el que ya aplica Supabase Auth al inicio de sesión. Si hay abuso, agregar un tope por IP.
- Si la cuenta de la demo cambia su contraseña desde el navegador, `/demo` deja de entrar hasta el próximo reinicio (como máximo 24 horas) o hasta volver a correr `scripts/crear-demo.mjs`.
- Probado: `supabase/tests/demo_test.py` (base: armado, solo lectura directo y por funciones, no afecta a kioscos reales, reseteo) y `tests/demo.test.mjs` (cableado). **No probado**: la entrada real con Supabase Auth, el cron en Vercel ni la pantalla en un navegador; requieren el proyecto desplegado.
