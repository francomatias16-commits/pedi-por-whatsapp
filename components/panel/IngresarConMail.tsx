"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

// Segunda forma de entrar, para quien no tiene cuenta de Google: mail (que es el usuario) y contraseña.
// Al entrar, Supabase avisa por onAuthStateChange y el panel cambia solo; este componente no navega.

const MIN_CLAVE = 8;

function mensajeAuth(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "Mail o contraseña incorrectos.";
  if (m.includes("email not confirmed")) return "Todavía no confirmaste tu mail. Abrí el mensaje que te mandamos y tocá el enlace.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Ya existe una cuenta con ese mail. Entrá con tu contraseña.";
  if (m.includes("password") && m.includes("least")) return `La contraseña tiene que tener al menos ${MIN_CLAVE} caracteres.`;
  if (m.includes("rate limit") || m.includes("too many")) return "Hicimos muchos intentos seguidos. Esperá unos minutos y probá de nuevo.";
  if (m.includes("valid email")) return "Escribí un mail válido.";
  return "No pudimos completar la acción. Revisá los datos y probá de nuevo.";
}

export default function IngresarConMail() {
  const [mail, setMail] = useState("");
  const [clave, setClave] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const datosOk = () => {
    if (!/^\S+@\S+\.\S+$/.test(mail.trim())) { setError("Escribí un mail válido."); return false; }
    return true;
  };

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setAviso("");
    if (!datosOk()) return;
    if (!clave) { setError("Escribí tu contraseña."); return; }
    setTrabajando(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: mail.trim(), password: clave });
    setTrabajando(false);
    if (err) setError(mensajeAuth(err.message));
  }

  async function crearCuenta() {
    setError(""); setAviso("");
    if (!datosOk()) return;
    if (clave.length < MIN_CLAVE) { setError(`La contraseña tiene que tener al menos ${MIN_CLAVE} caracteres.`); return; }
    setTrabajando(true);
    const { data, error: err } = await supabase.auth.signUp({ email: mail.trim(), password: clave, options: { emailRedirectTo: `${location.origin}/panel` } });
    setTrabajando(false);
    if (err) { setError(mensajeAuth(err.message)); return; }
    // Si el proyecto pide confirmar el mail, no hay sesión todavía.
    if (!data.session) setAviso("Te mandamos un mail para confirmar la cuenta. Tocá el enlace y después volvé acá para entrar.");
  }

  async function recuperar() {
    setError(""); setAviso("");
    if (!datosOk()) return;
    setTrabajando(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(mail.trim(), { redirectTo: `${location.origin}/panel` });
    setTrabajando(false);
    if (err) { setError(mensajeAuth(err.message)); return; }
    setAviso("Si ese mail tiene una cuenta, te mandamos un enlace para cambiar la contraseña.");
  }

  return (
    <form onSubmit={entrar} className="ingreso-mail" aria-label="Entrar con mail y contraseña">
      <label>Usuario (tu mail)
        <input type="email" autoComplete="username" inputMode="email" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="tu@mail.com" />
      </label>
      <label>Contraseña
        <input type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      {aviso && <p role="status" className="mut">{aviso}</p>}
      <button type="submit" disabled={trabajando}>{trabajando ? "Entrando…" : "Entrar"}</button>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        <button type="button" className="sec" onClick={crearCuenta} disabled={trabajando}>Crear cuenta nueva</button>
        <button type="button" className="sec" onClick={recuperar} disabled={trabajando}>Olvidé mi contraseña</button>
      </div>
    </form>
  );
}
