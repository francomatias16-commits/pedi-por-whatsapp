# Promociones: tope en pesos y "Deshacer" (0053)

## Base de datos
- `fidelidad_premios.tope_pesos`: solo para premios de descuento en %. El descuento no pasa de ese monto.
- `club_evaluar`: el costo del descuento en % se topa en `tope_pesos` (rentabilidad y semáforo).
- `promo_etapas_guardar`: el nivel de % acepta `tope` (opcional, mayor que cero).
- `promo_etapas_quitar`: quita todos los niveles activos (lo usa "Deshacer" cuando no había niveles antes).

## Pantallas
- Premios: campo "Tope en pesos (opcional)" cuando el premio es de % de descuento.
- Caja: el descuento en % con tope se calcula con el tope (se redondea hacia abajo para no pasarse).
- Premios por etapas: campo de tope para los niveles de %, "Así lo verá el cliente" (vista previa) y "Deshacer el último cambio".

## Pruebas
- `supabase/tests/promos_test.py`: 121 verificaciones (incluye 0053).
- `tests/promos.test.mjs` y `tests/fidelidad.test.mjs`: validaciones, tope, vista previa.

## Notas
- "Deshacer" vuelve a los niveles anteriores con sus topes. No restaura los regalos de liquidación que el guardado pausó.
