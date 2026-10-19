"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

// Se muestra cuando la persona llega desde el enlace del mail para recuperar la contraseña.
export default function NuevaContrasena({ onListo }: { onListo: () => void }) {
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (clave.length < 8) { setError("La contraseña tiene que tener al menos 8 caracteres."); return; }
    if (clave !== repetir) { setError("Las dos contraseñas no son iguales."); return; }
    setTrabajando(true);
    const { error: err } = await supabase.auth.updateUser({ password: clave });
    setTrabajando(false);
    if (err) { setError("No pudimos guardar la contraseña. Pedí un enlace nuevo e intentá de nuevo."); return; }
    onListo();
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Elegí tu contraseña nueva</h1>
        <form onSubmit={guardar}>
          <label>Contraseña nueva
            <input type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} />
          </label>
          <label>Repetila
            <input type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} />
          </label>
          {error && <p role="alert" className="error">{error}</p>}
          <button type="submit" disabled={trabajando}>{trabajando ? "Guardando…" : "Guardar y entrar"}</button>
        </form>
      </div>
    </div>
  );
}
