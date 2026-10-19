# Promociones: sugeridas (0054)

Plan, sección 7: el sistema propone y el kiosquero confirma con un clic.

## Base de datos
- `promo_sugerencias(p_kiosco)`: hasta 3 propuestas con datos reales:
  - Reactivación: 5 o más clientes del club sin comprar hace 30 días (y la opción apagada).
  - Regalo de cumpleaños: hay clientes que cumplen años este mes (y la opción apagada).
  - Producto parado sin liquidación: propone un 20% de descuento.
- Solo propone si la factibilidad del premio principal está "lista" (stock, margen y tope).

## Pantalla
- "Sugeridas para vos", arriba de Rentabilidad. Cada propuesta tiene un botón que usa `promo_activar` o `promo_liquidar_activar`, con la confirmación de margen bajo.

## Pruebas
- `supabase/tests/promos_test.py`: 128 verificaciones (incluye 0054).
- `tests/promos.test.mjs`: la pantalla llama a las funciones correctas y está montada.

## Notas
- Los umbrales (5 clientes, 30 días, 20%) son los valores iniciales. Hay que validarlos con kiosqueros reales.
