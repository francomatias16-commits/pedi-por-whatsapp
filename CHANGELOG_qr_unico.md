# QR único y productos visibles en la tienda (0060)

**Aplicar `0060_qr_unico_tienda_visible.sql` en el SQL Editor ANTES de subir el código** (después de la 0059).

## Qué cambia para el cliente
- Un solo QR (`/{slug}/club`). Si ya tiene tarjeta, entra directo a ella y ve el botón **Ver catálogo y hacer un pedido** (solo si el local tiene tienda con productos).
- Cliente nuevo: formulario de la tarjeta + enlace **Solo quiero ver el catálogo** (no hay que registrarse para pedir).
- Club en pausa y tienda disponible: el QR lleva directo a la tienda. Tienda apagada: `/{slug}` muestra "Este local no recibe pedidos online".
- Los QR ya impresos (`/{slug}` y `/{slug}/club`) y los links de "Traé un amigo" siguen funcionando.

## Qué cambia para el kiosquero
- **Productos**: botón **En tienda / Oculto** por producto, filtro "solo ocultos" y "Ocultar/Mostrar categoría en la tienda". Es independiente de **Hay / Sin stock**: un producto oculto se sigue vendiendo en la Caja, y reponer stock no lo vuelve a mostrar.
- **Mi negocio → Compartir mi QR**: interruptor "Tengo tienda online" (se guarda con Guardar cambios) y un único QR. El cartel del club suma la línea del catálogo.

## Base de datos
- `kioscos.tienda_activa` y `productos.visible_tienda` (ambos `true` por defecto: nada cambia hasta que el dueño lo decida).
- La lectura pública de productos exige `disponible and visible_tienda`; `crear_pedido` rechaza productos ocultos y locales con tienda apagada (`tienda_no_disponible`).
- `club_datos` y `club_armar_tarjeta` devuelven `tienda`; `tienda_disponible_slug(slug)` es pública.
- Tests: `npm run test:tienda` y `python3 supabase/tests/tienda_visible_test.py`.

## Límites conocidos
- La tienda se cachea 30 s (`revalidate = 30`): ocultar un producto tarda hasta ese tiempo en dejar de verse. Un pedido a un producto oculto se rechaza igual en el servidor.
- Un carrito guardado en el celular del cliente con un producto que luego se ocultó recibe "Algún producto ya no está disponible" al confirmar.
