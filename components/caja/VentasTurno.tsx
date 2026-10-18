"use client";
import { useMemo, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { ETIQUETA_MEDIO, cantidadTexto, fecha, hora, mensajeError, MEDIOS, necesitaPin, type PosConfig, type Resumen, type Venta } from "@/lib/caja";
import { peso } from "@/lib/whatsapp";
import Ticket, { type TicketData } from "./Ticket";
import DevolverModal from "./DevolverModal";
import { usePin } from "./PinModal";

// Ventas del turno: buscar, ver ticket, reimprimir y anular con motivo.
export default function VentasTurno({ kiosco, resumen, abierto, config, onCambio }: { kiosco: Kiosco; resumen: Resumen; abierto: boolean; config: PosConfig; onCambio: () => void }) {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<"" | "completada" | "anulada">("");
  const [anulando, setAnulando] = useState<Venta | null>(null);
  const [motivo, setMotivo] = useState("");
  const [err, setErr] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [devolviendo, setDevolviendo] = useState<Venta | null>(null);
  const { pedir, modal: modalPin } = usePin(kiosco.id);

  const lista = useMemo(() => resumen.ventas.filter((v) => {
    if (estado === "anulada" && !v.anulada) return false;
    if (estado === "completada" && v.anulada) return false;
    const s = q.trim().replace(/^#?v?-?0*/i, "");
    return !s || String(v.numero).includes(s);
  }), [resumen.ventas, q, estado]);
  const vigentes = resumen.ventas.filter((v) => !v.anulada);
  const total = vigentes.reduce((s, v) => s + v.total, 0);

  const verTicket = (v: Venta) => setTicket({
    numero: v.numero, fecha: fecha(v.created_at), kioscoNombre: kiosco.nombre, cliente: v.cliente_nombre, items: v.items,
    subtotal: v.subtotal, descuento: v.descuento, total: v.total, pagos: v.pagos, vuelto: v.vuelto, anulada: v.anulada,
  });

  async function anular() {
    if (!anulando) return;
    setErr("");
    const llamar = async (token: string | null) => {
      setOcupado(true);
      const r = await supabase.rpc("anular_venta_mostrador", { p_venta: anulando.id, p_motivo: motivo, p_token: token });
      setOcupado(false);
      return r;
    };
    let token: string | null = null;
    if (necesitaPin(config, "anular")) {
      const t = await pedir(`Anular la venta #${anulando.numero}`);
      if (t === undefined) return;
      token = t;
    }
    let r = await llamar(token);
    if (r.error?.message.includes("pin_requerido") && token === null) {
      const t = await pedir(`Anular la venta #${anulando.numero}`);
      if (t === undefined) return;
      r = await llamar(t);
    }
    if (r.error) return setErr(r.error.message.includes("pin_requerido") ? "El PIN venció (dura 2 minutos). Probá de nuevo." : mensajeError(r.error.message));
    setAnulando(null); setMotivo(""); onCambio();
  }

  return (
    <div>
      <div className="kpis">
        <div className="kpi"><span>Ventas</span><b>{vigentes.length}</b></div>
        <div className="kpi"><span>Vendido</span><b className="mono">{peso(total)}</b></div>
        {MEDIOS.map((m) => (resumen.ventas_por_medio[m] ?? 0) > 0 ? <div className="kpi" key={m}><span>{ETIQUETA_MEDIO[m]}</span><b className="mono">{peso(resumen.ventas_por_medio[m])}</b></div> : null)}
      </div>
      <div className="pos-filtros">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número de venta…" aria-label="Buscar venta" />
        <select value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)} aria-label="Estado">
          <option value="">Todos los estados</option><option value="completada">Completadas</option><option value="anulada">Anuladas</option>
        </select>
      </div>
      {lista.length === 0 && <p className="mut">No hay ventas de mostrador en este turno.</p>}
      {lista.map((v) => (
        <details className={`card venta${v.anulada ? " anulada" : ""}`} key={v.id}>
          <summary className="row">
            <span><b className="mono">#{v.numero}</b> <span className="mut">{hora(v.created_at)}{v.cliente_nombre ? ` · ${v.cliente_nombre}` : ""}</span>{v.anulada && <span className="chip-estado">Anulada</span>}</span>
            <b className="mono">{peso(v.total)}</b>
          </summary>
          <div className="recibo">
            {v.items.map((i, k) => (<div className="row" key={k}><span>{cantidadTexto(i.cantidad, i.por_peso)} × {i.nombre}</span><span className="mono">{peso(i.por_peso ? (i.cantidad * i.precio_unit) / 1000 : i.cantidad * i.precio_unit)}</span></div>))}
            {v.descuento > 0 && <div className="row"><span>Descuento</span><span className="mono">−{peso(v.descuento)}</span></div>}
            {v.pagos.map((p, k) => (<div className="row mut" key={k}><span>{ETIQUETA_MEDIO[p.medio]}</span><span className="mono">{peso(p.monto)}</span></div>))}
            {v.vuelto > 0 && <div className="row mut"><span>Vuelto</span><span className="mono">{peso(v.vuelto)}</span></div>}
          </div>
          {v.anulada && v.anulada_motivo && <p className="mut">Motivo: {v.anulada_motivo}</p>}
          <div className="pos-venta-acc">
            <button className="sec" onClick={() => verTicket(v)}>Ver ticket</button>
            {!v.anulada && abierto && <button className="sec" onClick={() => setDevolviendo(v)}>Devolver</button>}
            {!v.anulada && abierto && <button className="sec peligro" onClick={() => { setAnulando(v); setMotivo(""); setErr(""); }}>Anular venta</button>}
          </div>
        </details>
      ))}
      {resumen.devoluciones.length > 0 && (
        <div className="card" style={{ marginTop: ".8rem" }}>
          <h3 className="pos-sub" style={{ marginTop: 0 }}>Devoluciones del turno</h3>
          {resumen.devoluciones.map((d) => (
            <div className="row" key={d.id}>
              <span><b className="mono">D-{d.numero}</b> <span className="mut">venta #{d.venta_numero} · {hora(d.created_at)} · {ETIQUETA_MEDIO[d.medio]} · {d.motivo}</span></span>
              <b className="mono">−{peso(d.total)}</b>
            </div>
          ))}
        </div>
      )}
      {!abierto && <p className="mut">La caja está cerrada: las ventas ya no se pueden anular ni devolver.</p>}
      {anulando && (
        <div className="pos-overlay" role="dialog" aria-modal="true" aria-label="Anular venta">
          <div className="pos-modal">
            <div className="pos-modal-head"><h2>Anular venta #{anulando.numero}</h2></div>
            <p className="mut">Se repone el stock y la venta sale de la caja. Si fue a cuenta corriente, se revierte el saldo del cliente.</p>
            <label>Motivo<input autoFocus value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: error de carga, el cliente se arrepintió…"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void anular(); } if (e.key === "Escape") setAnulando(null); }} /></label>
            {err && <p className="pos-error" role="alert">{err}</p>}
            <div className="pos-modal-acciones">
              <button className="sec" onClick={() => setAnulando(null)}>Cancelar</button>
              <button className="peligro-solido" disabled={ocupado || motivo.trim().length < 3} onClick={anular}>{ocupado ? "Anulando…" : "Anular venta"}</button>
            </div>
          </div>
        </div>
      )}
      {ticket && <Ticket t={ticket} onCerrar={() => setTicket(null)} />}
      {devolviendo && <DevolverModal kiosco={kiosco} ventaId={devolviendo.id} numero={devolviendo.numero} config={config} onCerrar={() => setDevolviendo(null)} onHecho={onCambio} />}
      {modalPin}
    </div>
  );
}
