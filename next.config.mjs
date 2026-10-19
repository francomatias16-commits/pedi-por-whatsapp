import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const config = { reactStrictMode: true };

// Los mapas de código solo se suben si hay SENTRY_AUTH_TOKEN (variable de Vercel); sin él, el build no cambia.
export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  disableLogger: true,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
