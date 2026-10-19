"use client";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Se muestra cuando falla una pantalla. El error real va a Sentry; el usuario ve un texto simple.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <div className="card" role="alert">
      <h2 style={{ marginTop: 0 }}>Algo salió mal</h2>
      <p>No pudimos mostrar esta pantalla. Ya nos llegó el aviso. Probá de nuevo; si sigue igual, volvé al inicio.</p>
      <div className="row" style={{ justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="principal" onClick={() => reset()}>Probar de nuevo</button>
        <a className="btn sec" href="/">Ir al inicio</a>
      </div>
      {error.digest && <p className="mut">Código para soporte: {error.digest}</p>}
    </div>
  );
}
