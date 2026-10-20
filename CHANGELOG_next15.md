# Actualización a Next 15

- next ^15.5.28, @sentry/nextjs ^11.8.0, override postcss ^8.5.31: `npm audit` queda en 0 vulnerabilidades (antes: 1 crítica y 8 altas).
- `params` y `searchParams` asíncronos en 7 archivos de app/ (club, tienda, pago, unirse, seguimiento, tarjeta y su manifest).
- Sentry 11: `sentry.client.config.ts` pasa a `instrumentation-client.ts` (+ `onRouterTransitionStart`); `withSentryConfig` se importa de `@sentry/nextjs/config`.
  `sendDefaultPii: false` ya no existe en Sentry 11: se reemplaza por `dataCollection` restrictivo (sin usuario, cookies, cuerpos, query params ni variables de stack). `limpiarEvento` sigue activo.
- `images.unoptimized: true`: la app no usa next/image, se apaga /_next/image.
- **Borrar `sentry.client.config.ts`** del repo (el zip trae su reemplazo `instrumentation-client.ts`).
- Verificado: typecheck, `npm test` (34 conjuntos), `check:migraciones`, `next build` (con Google Fonts simulado) y cabeceras/crons con `next start`.
- No verificado: preview real en Vercel, ni que Sentry reciba eventos con el nuevo `dataCollection`.
