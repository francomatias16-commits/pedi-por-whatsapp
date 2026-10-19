"use client";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Último recurso: falla el layout mismo. Tiene que traer su propio <html>.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html lang="es-AR">
      <body style={{ fontFamily: "system-ui, sans-serif", fontSize: 18, padding: 24 }}>
        <h1>Algo salió mal</h1>
        <p>La aplicación tuvo un problema. Ya nos llegó el aviso. Recargá la página en un momento.</p>
        <a href="/" style={{ display: "inline-block", minHeight: 48, lineHeight: "48px", padding: "0 20px", background: "#14181d", color: "#fff", borderRadius: 6, textDecoration: "none" }}>Ir al inicio</a>
      </body>
    </html>
  );
}
