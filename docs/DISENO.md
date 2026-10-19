# Sistema visual — Go Fluxo ("Góndola")

Reemplaza a "Mercado Vivo" (ver `CHANGELOG_rediseno_gondola.md`). La fuente de verdad es `app/globals.css`.

## Principios
- Rotulado de local de venta: tinta casi negra, amarillo de etiqueta, gris hormigón.
- Un solo acento (amarillo), siempre con tinta encima: nunca texto amarillo.
- Bordes firmes, esquinas casi rectas, sombras duras de un solo sentido.
- Sin emojis, sin degradados, sin fondos decorativos, sin serif.
- Accesibilidad: texto base 18 px, objetivos de 48 px, foco con doble anillo, estados con palabra + color.

## Tokens (`:root`)
- Neutros: `--ink`, `--ink-2`, `--ink-3`, `--muted`, `--bg`, `--bg-2`, `--line`, `--line-soft`, `--surface`.
- Acento: `--signal`, `--signal-dark`, `--signal-soft`.
- Estados: `--ok`, `--warn`, `--danger`, `--info` (cada uno con `-bg`).
- Tipografía: `--f-display` (Barlow Condensed), `--f-ui` (IBM Plex Sans), `--f-mono` (IBM Plex Mono).
- Otros: `--r`, `--sh-card`, `--sh-lift`, `--fs-base`, `--fs-sm`, `--target`, `--cinta`.

## Reglas para los componentes
- Colores solo con `var(--token)`; nada de hex en `.tsx` (el cartel del Club lee los tokens en tiempo de ejecución).
- Botón principal = `button` sin clase (amarillo). Secundario = `.sec`. Destructivo = `.peligro`.
- Tarjeta = `.card`. Fila = `.row`; fila con separador = `.row.fila-sep`. Texto auxiliar = `.mut`.
- Evitar `style={{}}` para color, borde o tipografía; usar clases.
