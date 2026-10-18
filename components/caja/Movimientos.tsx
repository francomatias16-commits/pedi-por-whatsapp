"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { ETIQUETA_MOV, fecha, mensajeError, num, type Resumen, type TipoMov } from "@/lib/caja";
import { peso } from "@/lib/whatsapp";

// Estado de caja + movimientos (sangría, refuerzo, retiro final).
export default function Movimientos({ resumen, turnoId, abierto, onCambio }: { resumen: Resumen; turnoId: string; abierto: boolean; onCambio: () => void }) {
  const [tipo, setTipo] = useState<TipoMov>("sangria");
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [err, setErr] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const disponible = resumen.monto_calculado;

  async function registrar() {
    setErr("");
    const m = num(monto);
    if (!(m > 0)) return setErr("Ingresá un monto mayor a 0.");
    if (tipo !== "refuerzo" && m > disponible) return setErr("No hay tanto efectivo en la caja para retirar.");
    setOcupado(true);
    const { error } = await supabase.rpc("caja_registrar_movimiento", { p_turno: turnoId, p_tipo: tipo, p_monto: m, p_concepto: concepto || null });
    setOcupado(false);
    if (error) return setErr(mensajeError(error.message));
    setMonto(""); setConcepto(""); onCambio();
  }

  return (
    <div>
      <div className="kpis">
        <div className="kpi"><span>Apertura</span><b className="mono">{peso(resumen.monto_inicial)}</b></div>
        <div className="kpi"><span>Efectivo de ventas</span><b className="mono">{peso(resumen.ventas_efectivo)}</b></div>
        <div className="kpi"><span>Movimientos (neto)</span><b className="mono">{peso(resumen.neto_movimientos)}</b></div>
        <div className="kpi kpi--fuerte"><span>Efectivo en caja</span><b className="mono">{peso(disponible)}</b></div>
      </div>
      <div className="card">
        <p className="pos-kicker">Plata del turno</p>
        {resumen.movimientos.length === 0 && <p className="mut">Todavía no sacaste ni agregaste plata.</p>}
        <div className="recibo">
          {resumen.movimientos.map((m, i) => (
            <div className="row" key={i}>
              <span>{ETIQUETA_MOV[m.tipo]}{m.concepto ? <span className="mut"> · {m.concepto}</span> : null}<small className="mut"> · {fecha(m.created_at)}</small></span>
              <b className={`mono ${m.tipo === "refuerzo" ? "ok" : "neg"}`}>{m.tipo === "refuerzo" ? "+" : "−"}{peso(m.monto)}</b>
            </div>
          ))}
        </div>
      </div>
      {abierto && (
        <div className="card">
          <p className="pos-kicker">Registrar movimiento</p>
          <label>Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoMov)}>
              <option value="sangria">Sacar plata — retiro parcial</option>
              <option value="refuerzo">Agregar plata — poner efectivo</option>
              <option value="retiro_final">Retiro final — vaciado</option>
            </select>
          </label>
          <label>Monto<input type="number" inputMode="decimal" min={1} step={1} value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0" /></label>
          <label>Concepto <span className="mut">(opcional)</span><input value={concepto} maxLength={200} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej: envío a banco, cambio de turno…"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void registrar(); } }} /></label>
          {err && <p className="pos-error" role="alert">{err}</p>}
          <button onClick={registrar} disabled={ocupado}>{ocupado ? "Registrando…" : "Registrar movimiento"}</button>
        </div>
      )}
    </div>
  );
}
