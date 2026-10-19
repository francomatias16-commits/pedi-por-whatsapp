"use client";
import { useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { mensajeErrorSql } from "@/lib/errores";
import Aviso from "@/components/ui/Aviso";

// Interruptor de fotos automáticas (Mi negocio). Solo lo enciende el dueño; arranca apagado.
export default function FotosAuto({ kiosco, onCambio }: { kiosco: Kiosco; onCambio: () => void }) {
  const [activo, setActivo] = useState(!!kiosco.fotos_auto_activo);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  async function cambiar(v: boolean) {
    setTrabajando(true); setError("");
    const { error: e } = await supabase.rpc("fotos_configurar_activo", { p_kiosco: kiosco.id, p_activo: v });
    setTrabajando(false);
    if (e) { setError(mensajeErrorSql(e.message)); return; }
    setActivo(v); kiosco.fotos_auto_activo = v; onCambio();
  }
  return (
    <div>
      <p className="mut">Con esto encendido, al editar un producto aparece “Buscar foto automática”: te mostramos fotos posibles y vos elegís una. Nunca se cambia una foto sola, y siempre se puede deshacer.</p>
      <p className="mut">Las fotos de Open Food Facts tienen licencia abierta. Las que vienen de una búsqueda en internet pueden tener derechos de autor: antes de usarlas, quien las elige tiene que confirmar que puede hacerlo.</p>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <label style={{ display: "block", margin: "8px 0" }}>
        <input type="checkbox" checked={activo} disabled={trabajando} onChange={(e) => cambiar(e.target.checked)} style={{ width: "auto", marginRight: 8 }} />Buscar fotos automáticas de productos
      </label>
    </div>
  );
}
