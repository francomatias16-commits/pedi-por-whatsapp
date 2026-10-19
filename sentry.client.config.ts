import * as Sentry from "@sentry/nextjs";
import { limpiarEvento } from "@/lib/sentry";

// Sin DSN no hace nada (desarrollo y previews sin configurar).
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "production",
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
    beforeSend: limpiarEvento,
  });
}
