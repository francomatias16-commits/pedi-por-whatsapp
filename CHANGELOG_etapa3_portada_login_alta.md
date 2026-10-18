# Etapa 3 — Portada, login y alta del kiosco

Solo presentación; no cambia tablas ni consultas. `tsc` y `npm test` en verde.
(`next build` no se pudo correr en el entorno de prueba por falta de acceso a Google Fonts; probalo en Vercel.)

- **Portada (`app/page.tsx`)**: titular y promesa, botón grande "Entrar a mi kiosco", "Cómo funciona" en 3 pasos, "Todo lo que necesitás" en lenguaje simple y cierre con ayuda.
- **Login (`components/panel/Login.tsx`)**: tarjeta con botón grande "Continuar con Google" (logo oficial), explicación de qué pasa, aviso de privacidad, ayuda "¿No tenés cuenta de Google?", estado "Abriendo Google…" y mensaje de error con qué hacer.
- **Alta del kiosco (`components/panel/CrearKiosco.tsx`)**: asistente de 3 pasos con barra de progreso, ejemplos en cada campo, errores junto al campo, link de la tienda armado solo con vista previa y botón "Cambiar". Enter avanza. Si la dirección está usada, vuelve a mostrar el campo para cambiarla.
- **Carga**: esqueleto en lugar del texto "Cargando…".
- **Ayuda por WhatsApp**: `lib/ayuda.ts` + `components/AyudaWhatsApp.tsx`. Se activa con `NEXT_PUBLIC_WHATSAPP_AYUDA` (ver `.env.example`); sin número no se muestra.
- `app/panel/page.tsx`: ahora usa los componentes nuevos (se quitó el login y el alta que estaban dentro).
- Validación del WhatsApp: mínimo 10 dígitos (antes 8), igual que "Mi local".
