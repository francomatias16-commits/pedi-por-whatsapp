# Responsive de todo el proyecto

Solo CSS (`app/globals.css`); no se tocó ningún componente.

- **POS / Vender**: la grilla usa `minmax(0, 1fr)` y la columna del ticket es `clamp(300px, 30vw, 380px)`. El ticket y el buscador se adaptan al ancho de su propia tarjeta (container query `pos`), no al del viewport: arregla notebook chica y tablet horizontal.
- **Filas angostas** (Puntos, Alertas, Negocio): bajo 560 px, `.row` pasa a varios renglones y sus inputs/selects se reparten el ancho. Los textos largos (mails, links) se cortan en vez de ensanchar la página.
- **Texto largo sin espacios**: `main { overflow-wrap: break-word }`.

Verificado con barrido en 20 pantallas × 8 anchos (320, 360, 390, 430, 768, 1024, 1280, 1920): 0 desbordes horizontales, 0 errores de JS (datos simulados de Supabase).
