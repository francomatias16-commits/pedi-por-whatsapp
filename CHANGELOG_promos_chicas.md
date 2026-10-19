# Promociones: "No por ahora" en sugeridas y sorteo mensual por defecto (0055)

## Base de datos
- `promo_sugerencias_descartadas`: registro de los "No por ahora", con fecha de vencimiento.
- `promo_sugerencia_descartar(kiosco, clave, producto, días)`: encargado o dueño. Por defecto 14 días.
- `promo_sugerencias` respeta los descartes vigentes.

## Pantallas
- Sugeridas: botón "No por ahora" en cada propuesta.
- Sorteos: el período arranca con el mes anterior completo (sorteo mensual, plan sección 12).

## Pruebas
- `supabase/tests/promos_test.py`: 137 verificaciones.
- `tests/promos.test.mjs`: período mensual (incluye enero y febrero bisiesto) y botón de descarte.
