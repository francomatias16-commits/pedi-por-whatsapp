# Sistema visual — Pedí por WhatsApp ("Mercado Vivo")

Origen: lenguaje del portal cliente de distrib (`frontend/cliente/`, concepto "Mercado Vivo").
Dirección: puesto de feria / almacén de barrio, no plantilla SaaS.

## Piezas
| Pieza | Clase | Dónde |
|---|---|---|
| Franja de marca (verde profundo + filo arcilla) | `.franja` | `app/layout.tsx` |
| Titular tipo afiche (Fraunces itálica + punto arcilla) | `.afiche`, `.punto` | portada, tienda |
| Etiqueta de dato (sello de mostrador) | `.tag` | horario |
| Pestañas con subrayado (inactiva = `.sec`) | `.tabs`, `.chips` | panel, filtros, categorías |
| Barra pegajosa de búsqueda | `.sticky` | tienda |
| Tarjeta ticket (esquina cortada + sombra dura) | `.producto` > `.card-producto` | grilla de productos |
| Recibo con línea punteada | `.recibo`, `.total` | pedido |
| Aviso de estado | `.aviso-tienda`, `.alerta` | cerrado / error |
| Barra inferior de pedido | `.bar` | tienda |
| Botón de cantidad circular | `.qty` | tienda |

Los componentes no cambian de lógica: el estado activo de las pestañas se marca con
`button:not(.sec)`, así que basta con mantener esa convención.

## Tokens (`app/globals.css`, `:root`)
- Papel `#F6F3EC`, tinta `#16211C`, verde profundo `#16302A`, acento salvia `#86B792`, arcilla `#C1552C`.
- Tipografía: Fraunces (titulares), IBM Plex Sans (interfaz), IBM Plex Mono (precios y etiquetas).
- Fuentes cargadas con `next/font/google` en `app/layout.tsx`.

## Para diferenciar el producto
Cambiar solo los valores de `--deep`, `--clay` y `--accent` en `:root`. Todo lo demás los toma de ahí.
