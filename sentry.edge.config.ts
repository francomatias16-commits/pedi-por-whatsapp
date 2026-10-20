import * as Sentry from "@sentry/nextjs";
import { limpiarEvento } from "@/lib/sentry";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn, environment: process.env.VERCEL_ENV ?? "production", tracesSampleRate: 0.05, dataCollection: { userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false, stackFrameVariables: false }, beforeSend: limpiarEvento });
}
