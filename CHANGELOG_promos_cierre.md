# Promos: cierre del plan (deshacer, vista previa, textos, guardarraíles de caja, E2E)

Se descartaron "combo real de varios productos" y "frecuencia en kioscos similares".

## Qué cambia
- **Deshacer en Premios y Campañas**: después de crear, editar, pausar/activar o borrar aparece el aviso del último cambio con un botón **Deshacer**
  (`components/sellos/useDeshacer.ts`, helpers en `lib/fidelidad.ts`). Solo vuelve atrás el último cambio. Al deshacer un borrado se recrea la
  fila con el mismo id; los sellos o canjes viejos que apuntaban a la campaña o al premio borrado no se vuelven a enlazar.
- **Vista previa del cliente** ("Así lo verá el cliente") al armar un premio, una campaña y la regla simple del club (con los casilleros de la tarjeta).
  Si falta un dato, dice cuál (`vistaPreviaPremio`, `vistaPreviaCampana`, `vistaPreviaMeta`).
- **Textos**: seis párrafos de las pantallas de promos pasaron a una o dos oraciones (Club, Liquidación, Rentabilidad, Por empleado, Cómo va, Etapas).
  Se midió con un chequeo de largo (más de 170 letras o más de 2 oraciones); no queda ninguno. No reemplaza mostrarle la pantalla a un kiosquero.
- **Guardarraíles de la caja — migración 0056** (`pos_promos`):
  - Un producto no puede tener dos promos activas que se pisen en fechas, ni una promo de caja junto a una liquidación activa del mismo producto
    (`promo_producto_duplicada`).
  - Si la promo deja algún producto alcanzado por debajo del margen mínimo del local, pide confirmación (`promo_reduce_margen`, detalle "margen|mínimo");
    confirmada, queda en el historial. Se mira el peor producto de la categoría y se ignoran los productos sin costo.
  - Solo controla altas y cambios: las promos que ya existían (aunque estén duplicadas) siguen funcionando y se pueden renombrar o pausar.
  - La pantalla Ofertas de la Caja muestra el aviso "Baja el margen" con `Sí, guardar igual` / `No, volver`, y el mensaje claro del duplicado.
  - Límite conocido: la marca `margen_confirmado` la envía la propia app; es un freno contra descuidos, no una barrera contra alguien que escriba directo a la tabla.
- **E2E** (`e2e/promos.spec.ts`): premios, campañas, club, sorteos (sin realizar) y ofertas de la caja con sesión por mail y contraseña, más la tarjeta del cliente.
  `e2e/seed.sql` ahora deja el club activo y una gaseosa con 30% de margen.

## Pruebas
- `supabase/tests/promos_caja_test.py`: 31 verificaciones (nuevo). Toda la suite SQL (`supabase/tests/*.py`) pasa.
- `tests/fidelidad.test.mjs` y `tests/pos.test.mjs` suman casos; `npm test`, `npm run typecheck` y `npm run check:migraciones` (56 migraciones) pasan.
- `e2e/promos.spec.ts` compila y Playwright lo lista, pero **no se corrió** contra un proyecto de Supabase de pruebas (hace falta el usuario de prueba, ver `e2e/README.md`).

## Para aplicar
Producción está en la 0049. Hay que aplicar 0050 a 0056 en orden (con respaldo antes). La 0056 no modifica datos existentes.
