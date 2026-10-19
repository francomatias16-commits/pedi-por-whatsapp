# Club · paso 2: talonario de papelitos (0044)

## Lógica
- **Opcional por local** (`kioscos.club_exigir_codigo`, apagado por defecto). Si está activo, "Pagué en efectivo" pide el código de un papelito.
- **Solo efectivo.** Transferencia y Mercado Pago no piden código.
- **Cada papelito** tiene 6 caracteres (sin I, L, O, 0 ni 1), es único por local y se usa una sola vez.
- **Intentos fallidos**: 5 errores en una hora por cliente frenan el código un rato. Un código mal escrito no hace error de SQL: vuelve como `_error`, así el intento queda registrado.
- **Si el local no exige código** pero el cliente manda uno válido, se acepta y se gasta igual.

## Base de datos
- `supabase/migrations/0044_club_talonario.sql` (sin DROP). `club_sumar(text, text)` delega en la nueva `club_sumar(text, text, text)`; `club_sumar(text)` sigue funcionando.
- Tablas `club_codigos` y `club_intentos`: RLS activo y sin acceso para anon ni authenticated. Solo se usan desde las funciones.
- Funciones del panel (solo encargado y dueño): `club_generar_codigos` (hasta 200 por lote), `club_codigos_resumen`, `club_codigos_sin_usar`.
- `club_tarjeta` informa `exige_codigo`.

## App
- `app/api/club/sumar/route.ts`: recibe `codigo`, lo normaliza y responde 409 con el código de error cuando la función devuelve `_error`.
- `components/ClubTarjeta.tsx`: si el local exige código, "Pagué en efectivo" abre un campo para el papelito. Los errores quedan en pantalla con su mensaje.
- `lib/club.ts`: `CODIGO_CLUB_RE` y `normalizarCodigoClub`.
- `lib/errores.ts`: mensajes para `club_codigo_requerido`, `club_codigo_invalido`, `club_codigo_usado`, `club_codigo_bloqueado`, `club_cantidad_invalida`, `club_codigos_no_generados`.

## Tope por local
- Por cliente: 5 errores en una hora.
- Por local: 50 errores en una hora frenan el papelito para todos los clientes del local durante ese rato. Mientras dura, ni un papelito válido sirve (queda como `club_codigo_bloqueado` y el papelito no se gasta). Se libera solo cuando pasa la hora.

## Panel (Puntos → Club → Papelitos para el efectivo)
- Interruptor para pedir papelito en efectivo. Solo el dueño lo cambia (`club_configurar_codigos`).
- Generar un lote de 1 a 200 papelitos y ver cuántos quedan sin usar.
- Imprimir: imprime los recién generados; si no hay, los que quedan sin usar.
- Componente nuevo: `components/sellos/PapelitosClub.tsx`.

## Pruebas
- `supabase/tests/club_test.py`: 0043 y 0044 de punta a punta (generación, permisos, código requerido, válido, usado, inválido, bloqueo por cliente y por local, prender/apagar, versiones viejas de la función).
- `tests/club.test.mjs`: normalización, formato y cableado de ruta, tarjeta y mensajes.
- `npm test`: todo pasa hasta `test:marca`, que ya fallaba antes de este cambio (íconos viejos).

## Estado en Supabase (aplicado)
- `pedi-por-whatsapp` (producción): la 0044 original quedó aplicada como `0044_club_talonario`. Después se aplicó el ajuste `0044_delta_talonario` (`supabase/ajustes/0044_delta_talonario.sql`), que lleva la base a la versión de este repo: tope por local, `club_configurar_codigos`, y cierre de `club_codigos` y `club_intentos` para anon y authenticated.
- `pedi-restore-test` (prueba): mismo ajuste aplicado y verificado.
- Verificado en ambos: tope por local presente, función de configuración presente, anon no lee papelitos ni intentos y no puede configurar el papelito.

## Probado en navegador
- Panel de papelitos (Chromium, con Supabase simulado): prender y apagar, generar 12, rechazar 0 y más de 200, lista de sin usar, imprimir 12 papelitos. La vista de impresión muestra solo los papelitos, en 4 columnas.
- Corregido: la lista de sin usar y la impresión no cortaban la cuarta columna.
- Pendiente de probar en navegador: la tarjeta del cliente (campo de papelito).

## Para la app
- Los cambios de app (ruta, tarjeta y panel de papelitos) se despliegan con el repo. La base ya está lista.
- `supabase/migrations/0044_club_talonario.sql` es la versión final del repo. No volver a correrla en producción: el ajuste delta es lo que corresponde allí.

## Diseño y revisión visual
- El panel de papelitos usa los tokens del proyecto (`--f-mono`, `--ink`) y las clases existentes (`card`, `mut`, `sec`, `btn-grande`).
- Corregido: `globals.css` oculta todo en impresión con `!important`; el listado de papelitos ahora también usa `!important` para mostrarse. Sin esto, la impresión salía en blanco.
- Probado con la hoja de estilos real del proyecto (`app/globals.css`), en Chromium.
- Nota: `docs/DISENO.md` describe otra paleta ("Mercado Vivo": Fraunces, arcilla) que no es la del CSS actual. Se siguió el CSS actual, que es el que se ve en la app.
