# Etapa 1 — Menos ruido en el panel

Solo presentación; no cambia datos ni consultas. `tsc` y `npm test` en verde.

- Se sacó de todas las pestañas: tarjeta de estado de tienda, avisos de pedidos, banner de reposición y QR grande.
- Estado de la tienda: ahora se ve en el menú lateral (nombre + "Tienda abierta/cerrada" + detalle de horario).
- Reposición: número en el ítem "Para reponer" del menú (agotados + por acabarse). La tarjeta detallada sigue en Inicio.
- Nuevo **Inicio** (antes "Resumen"): es la pantalla por defecto. Muestra avisos al celular (solo hasta activarlos), tarjeta "Tu tienda" con Copiar link y Ver QR, y lo que ya tenía el resumen.
- **Mi local**: ahora tiene el QR compacto (96 px) con Descargar y Copiar link, y el estado de avisos al celular.
- Se eliminó `components/BannerReponer.tsx` (sin uso).
