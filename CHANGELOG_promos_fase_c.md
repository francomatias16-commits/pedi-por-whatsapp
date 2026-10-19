# Promociones: paneles completos y fases A, B y C (0050–0052)

## Base de datos
- 0050 · Panel y factibilidad: `promo_panel` (una sola llamada), factibilidad (falta de stock, tope mensual, margen mínimo con confirmación), aviso previo para las automáticas (`club_aviso_previo_dias`), historial de cambios (`promo_historial`), `promo_activar` con `p_confirmar_margen` y `sale_el`.
- 0051 · Liquidación de stock: productos sin rotación (`promo_sin_rotacion`), liquidaciones por descuento, regalo o "llevá dos", con apagado automático por stock, fecha de fin y tope.
- 0052 · Etapas, sorteos y retención: premios por etapas (2 a 6 niveles), sorteos con papelitos del período (semilla guardada, verificable, permiso legal confirmado por el dueño), racha, cumpleaños, "Traé un amigo" (código de invitación en `club_unirse` con `p_ref`) y tarjeta del cliente ampliada.

## Pruebas
- `supabase/tests/promos_test.py`: 108 verificaciones SQL contra Postgres (0050–0052).
- `tests/promos.test.mjs` (`npm run test:promos`): lib/promos y el panel del club.

## Notas
- Los sorteos no se realizan sin la confirmación del permiso legal del dueño. No es asesoramiento legal.
