"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { mensajeError, normalizarZ, num, type ReporteZ } from "@/lib/caja";
import { peso } from "@/lib/whatsapp";
import ReporteZView from "./ReporteZ";

// Cierre de caja (arqueo) + reporte Z del turno actual.
export default function CierreCaja({ kiosco, turnoId, refresco, onCerrada }: { kiosco: Kiosco; turnoId: string; refresco: number; onCerrada: () => void }) {
  const [z, setZ] = useState<ReporteZ | null>(null);
  const [declarado, setDeclarado] = useState("");
  const [err, setErr] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("caja_reporte_z", { p_turno: turnoId });
    if (!error && data) setZ(normalizarZ(data as ReporteZ));
  }, [turnoId]);
  useEffect(() => { void cargar(); }, [cargar, refresco]);

  const decl = num(declarado);
  const dif = z && declarado !== "" ? decl - z.efectivo_esperado : null;

  async function cerrar() {
    setErr("");
    if (declarado === "" || decl < 0) return setErr("Contá el efectivo e indicá el monto declarado.");
    setOcupado(true);
    const { error } = await supabase.rpc("caja_cerrar_turno", { p_turno: turnoId, p_monto_declarado: decl });
    setOcupado(false);
    if (error) return setErr(mensajeError(error.message));
    setConfirmando(false); onCerrada();
  }

  return (
    <div>
      <div className="card">
        <p className="pos-kicker">Cerrar caja</p>
        <p className="mut">Contá el efectivo físico en la caja e indicá el monto declarado.</p>
        {z && (
          <div className="recibo">
            <div className="row"><span>Plata con la que arranqué</span><b className="mono">{peso(z.monto_inicial)}</b></div>
            <div className="row"><span>Efectivo de ventas</span><b className="mono">{peso(z.cobros_por_medio.efectivo ?? 0)}</b></div>
            <div className="row"><span>Plata que agregué − plata que saqué</span><b className="mono">{peso(z.refuerzos - z.sangrias_y_retiros)}</b></div>
            <div className="row total-fila"><span>Plata que debería haber</span><b className="mono">{peso(z.efectivo_esperado)}</b></div>
          </div>
        )}
        <label>Monto final declarado (efectivo)
          <input type="number" inputMode="decimal" min={0} step={1} value={declarado} onChange={(e) => setDeclarado(e.target.value)} placeholder="0" />
        </label>
        {dif != null && (
          <p className={dif === 0 ? "ok" : "neg"}>{dif === 0 ? "La caja cuadra." : dif > 0 ? `Sobran ${peso(dif)}.` : `Faltan ${peso(Math.abs(dif))}.`}</p>
        )}
        {err && <p className="pos-error" role="alert">{err}</p>}
        {!confirmando
          ? <button className="peligro-solido" onClick={() => { if (declarado === "") return setErr("Indicá el monto declarado."); setErr(""); setConfirmando(true); }}>Cerrar caja</button>
          : (
            <div className="pos-confirma">
              <p><b>¿Cerrar la caja con {peso(decl)} declarados?</b> Después no se pueden anular ventas de este turno.</p>
              <button className="sec" onClick={() => setConfirmando(false)}>Volver</button>
              <button className="peligro-solido" onClick={cerrar} disabled={ocupado}>{ocupado ? "Cerrando…" : "Sí, cerrar caja"}</button>
            </div>
          )}
      </div>
      <div className="card">
        <p className="pos-kicker">Resumen de la caja (parcial)</p>
        {z ? <ReporteZView z={z} kioscoNombre={kiosco.nombre} /> : <p className="mut">Cargando…</p>}
      </div>
    </div>
  );
}
