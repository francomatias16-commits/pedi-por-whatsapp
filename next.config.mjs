import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs/config";

/** @type {import('next').NextConfig} */
// Cabeceras de seguridad para todas las rutas. La CSP va en modo "solo reporte": no bloquea nada, solo avisa en la consola del
// navegador qué rompería. Cuando pasen unos días sin avisos en el panel, la tienda y el cobro, cambiar a "Content-Security-Policy".
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.sentry.io",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const cabeceras = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // /seguimiento/<token> y /tarjeta/<token> llevan el token en la URL: que no viaje como referrer a otros sitios.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // La app usa cámara (escáner), WebUSB y puerto serie (impresora térmica) y ubicación (QR). Todo lo demás, apagado.
  { key: "Permissions-Policy", value: "camera=(self), usb=(self), serial=(self), geolocation=(self), microphone=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy-Report-Only", value: CSP },
];

const config = {
  reactStrictMode: true,
  // Raíz del proyecto fija: evita el aviso de "multiple lockfiles" si hay un package-lock.json en una carpeta superior.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  // pdfkit lee sus tipografías del disco: no se empaqueta (comprobante PDF de ARCA).
  serverExternalPackages: ["pdfkit"],
  // La app no usa next/image: se apaga el optimizador (/_next/image) para no exponer una superficie que no se necesita.
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: cabeceras }];
  },
};

// Los mapas de código solo se suben si hay SENTRY_AUTH_TOKEN (variable de Vercel); sin él, el build no cambia.
export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  webpack: { treeshake: { removeDebugLogging: true } },
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
