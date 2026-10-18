"use client";
import { useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { fecha, mensajeError, normalizarZ, type ReporteZ, type Turno } from "@/lib/caja";
import { peso } from "@/lib/whatsapp";
import ReporteZView from "./ReporteZ";

// Historial de turnos con su reporte Z.
export default function Historial({ kiosco, turnos }: { kiosco: Kiosco; turnos: Turno[] }) {
  const [z, setZ] = useState<ReporteZ | null>(null);
  const [err, setErr] = useState("");
  const ver = async (id: string) => {
    setErr("");
    const { data, error } = await supabase.rpc("caja_reporte_z", { p_turno: id });
    if (error) return setErr(mensajeError(error.message));
    setZ(normalizarZ(data as ReporteZ));
  };
  const cerrados = turnos.filter((t) => t.estado === "cerrado");
  return (
    <div>
      {cerrados.length === 0 && <p className="mut">Todavía no cerraste ninguna caja.</p>}
      {cerrados.map((t) => (
        <div className="card row" key={t.id}>
          <span>
            <b>{fecha(t.abierto_at)}</b> <span className="mut">→ {t.cerrado_at ? fecha(t.cerrado_at) : ""}</span><br />
            <span className="mut">Arranqué con {peso(t.monto_inicial)} · conté {peso(t.monto_final_declarado ?? 0)}</span>
          </span>
          <span className="pos-hist-der">
            <b className={`mono ${(t.diferencia ?? 0) === 0 ? "ok" : "neg"}`}>{(t.diferencia ?? 0) === 0 ? "Cuadra" : `${(t.diferencia ?? 0) > 0 ? "+" : ""}${peso(t.diferencia ?? 0)}`}</b>
            <button className="sec" onClick={() => ver(t.id)}>Ver resumen</button>
          </span>
        </div>
      ))}
      {err && <p className="pos-error" role="alert">{err}</p>}
      {z && (
        <div className="pos-overlay" role="dialog" aria-modal="true" aria-label="Resumen de la caja" onKeyDown={(e) => e.key === "Escape" && setZ(null)}>
          <div className="pos-modal pos-modal--ticket">
            <ReporteZView z={z} kioscoNombre={kiosco.nombre} />
            <div className="pos-modal-acciones no-print"><button className="sec" onClick={() => setZ(null)}>Cerrar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
