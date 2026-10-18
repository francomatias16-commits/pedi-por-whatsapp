"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AyudaWhatsApp from "@/components/AyudaWhatsApp";

const GoogleLogo = () => (
  <svg width="22" height="22" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.17.29-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03l3.05-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97l3.05 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
  </svg>
);

// Pantalla de ingreso: una sola acción clara, con explicación de qué pasa al tocar el botón.
export default function Login() {
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState("");

  async function entrar() {
    setError(""); setAbriendo(true);
    try {
      const { error: e } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/panel` } });
      if (e) throw e;
    } catch {
      setAbriendo(false);
      setError("No pudimos abrir Google. Revisá tu conexión a internet y tocá el botón de nuevo.");
    }
  }

  return (
    <div className="login-wrap">
      <Link href="/" className="volver">← Volver al inicio</Link>
      <div className="card login-card">
        <h1>Entrá a tu kiosco</h1>
        <p className="mut login-sub">Usá tu cuenta de Google (la misma de tu mail de Gmail). Si es la primera vez, te ayudamos a crear tu kiosco.</p>
        <button type="button" className="btn-google" onClick={entrar} disabled={abriendo}>
          <GoogleLogo /> {abriendo ? "Abriendo Google…" : "Continuar con Google"}
        </button>
        {error && <p role="alert" className="error">{error}</p>}
        <p className="mut login-nota">Usamos tu cuenta solo para reconocerte. No publicamos nada ni compartimos tus datos.</p>
        <details className="login-ayuda">
          <summary>¿No tenés cuenta de Google?</summary>
          <p className="mut">Podés crear una gratis con tu mail actual en <b>accounts.google.com/signup</b>. Después volvé acá y tocá “Continuar con Google”.</p>
        </details>
        <AyudaWhatsApp texto="Necesito ayuda para entrar" mensaje="Hola, necesito ayuda para entrar a mi kiosco" />
      </div>
    </div>
  );
}
