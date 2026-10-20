import * as Sentry from "@sentry/nextjs";
import { limpiarEvento } from "@/lib/sentry";

// Sin DSN no hace nada (desarrollo y previews sin configurar).
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "production",
    tracesSampleRate: 0.05,
    dataCollection: { userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false, stackFrameVariables: false },
    beforeSend: limpiarEvento,
  });
}

// Registra las navegaciones del App Router en Sentry (recomendado desde Next 15.3).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
