# Puntos pasa a tener su propio lugar en el menú

- **Menú**: "Puntos" es un destino propio (ícono de estrella), ya no está escondido dentro de Clientes. Ruta nueva: `/panel/puntos`. Los links viejos (`/panel/clientes/puntos`, avisos ya enviados) siguen funcionando. En el celular aparece en "Más".
- **Modo simple**: Puntos ya no se oculta como "avanzado".
- **Pantalla reordenada en 5 pestañas** (antes 6, con una pestaña "Club" que juntaba 10 tarjetas):
  - **Hoy**: tarjetas completas para avisar por WhatsApp y los sellos de las últimas 24 h (rechazar / confirmar).
  - **Mi programa**: pasos numerados que se abren con un toque: 1 Tu premio · 2 Cómo se suman · 3 Más premios (opcional) · 4 QR y cartel. Más abajo y cerrados: Límites, Control de efectivo (papelitos), Avisos en este celular. Si el programa está vacío, abre directo con el asistente de 3 pasos.
  - **Clientes**, **Promociones** (rentabilidad, horas flojas, liquidación, etapas, sorteos; todo opcional) y **Cómo va** (con "Sellos por empleado" plegado).
- Código: `components/sellos/Club.tsx` se dividió en `SellosHoy`, `PremioPrincipal`, `QrMostrador` y `LimitesClub`; nuevos `components/ui/Plegable.tsx` y `components/sellos/Promociones.tsx`. Textos que decían "pestaña Cómo se suman / Premios" ahora apuntan a "Mi programa".
- Pruebas actualizadas (navegación, roles, club, promos, auditoría y e2e de promos). Verificado: `typecheck` y `npm test` en verde. El e2e no se corrió (necesita sesión y base).
