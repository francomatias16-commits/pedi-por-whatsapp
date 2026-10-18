"use client";
import { useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { cantidadTexto, fecha, mensajeError, type PosConfig } from "@/lib/caja";
import { cargarVentaCompleta } from "@/lib/pos/venta-remota";
import { peso } from "@/lib/whatsapp";
import Ticket, { type TicketData } from "./Ticket";
import DevolverModal from "./DevolverModal";

type Item = { id: string; nombre: string; cantidad: number; por_peso: boolean; neto: number; devuelto: number };
type Res = { id: string; numero: number; total: number; anulada: boolean; created_at: string; cliente_nombre: string | null; items: Item[] };
const DIAS: [number, string][] = [[1, "Hoy y ayer"], [7, "Última semana"], [30, "Último mes"], [90, "3 meses"], [365, "Último año"]];

// Búsqueda de ventas de días anteriores (también de cajas ya cerradas) para devolver o reimprimir el ticket.
export default function BuscarVentas({ kiosco, config, turnoAbierto, onCambio }: { kiosco: Kiosco; config: PosConfig; turnoAbierto: boolean; onCambio: () => void }) {
  const [q, setQ] = useState("");
  const [dias, setDias] = useState(7);
  const [res, setRes] = useState<Res[]>([]);
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState("");
  const [devolviendo, setDevolviendo] = useState<Res | null>(null);
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setErr("");
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("pos_buscar_ventas", { p_kiosco: kiosco.id, p_q: q.trim().replace(/^#/, "") || null, p_dias: dias });
      if (!vivo) return;
      setCargando(false);
      if (error) { setErr(mensajeError(error.message)); return; }
      setRes(((data ?? []) as Res[]).map((v) => ({ ...v, total: Number(v.total), items: v.items.map((i) => ({ ...i, cantidad: Number(i.cantidad), neto: Number(i.neto), devuelto: Number(i.devuelto) })) })));
    }, q ? 300 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [kiosco.id, q, dias, recarga]);

  async function reimprimir(r: Res) {
    setErr("");
    try {
      const v = await cargarVentaCompleta(r.id);
      setTicket({
        numero: v.numero, fecha: fecha(v.created_at), kioscoNombre: kiosco.nombre, cliente: r.cliente_nombre, items: v.itemsTicket,
        subtotal: v.subtotal, descuento: v.descuento, total: v.total, pagos: v.pagos, vuelto: v.vuelto, anulada: v.anulada,
        encabezado: config.ticket_encabezado, pie: config.ticket_pie,
      });
    } catch (e) { setErr((e as Error).message); }
  }

  const devolvible = (r: Res) => !r.anulada && r.items.some((i) => i.cantidad - i.devuelto > 0);
  return (
    <div>
      <div className="pos-filtros">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° de venta, cliente o producto…" aria-label="Buscar venta" autoFocus />
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período">
          {DIAS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
        </select>
      </div>
      {!turnoAbierto && <p className="mut">Para devolver necesitás una caja abierta.</p>}
      {err && <p className="pos-error" role="alert">{err}</p>}
      {cargando && <p className="mut">Buscando…</p>}
      {!cargando && res.length === 0 && !err && <p className="mut">No encontramos ventas con ese criterio en el período elegido.</p>}
      {res.map((r) => {
        const dev = r.items.some((i) => i.devuelto > 0);
        return (
          <details className={`card venta${r.anulada ? " anulada" : ""}`} key={r.id}>
            <summary className="row">
              <span><b className="mono">#{r.numero}</b> <span className="mut">{fecha(r.created_at)}{r.cliente_nombre ? ` · ${r.cliente_nombre}` : ""}</span>
                {r.anulada && <span className="chip-estado">Anulada</span>}{dev && !r.anulada && <span className="chip-estado">Con devoluciones</span>}</span>
              <b className="mono">{peso(r.total)}</b>
            </summary>
            <div className="recibo">
              {r.items.map((i) => (
                <div className="row" key={i.id}>
                  <span>{cantidadTexto(i.cantidad, i.por_peso)} × {i.nombre}{i.devuelto > 0 && <span className="mut"> (devuelto {cantidadTexto(i.devuelto, i.por_peso)})</span>}</span>
                  <span className="mono">{peso(i.neto)}</span>
                </div>
              ))}
            </div>
            <div className="pos-venta-acc">
              <button className="sec" onClick={() => reimprimir(r)}>Ver / reimprimir ticket</button>
              {devolvible(r) && turnoAbierto && <button className="sec" onClick={() => setDevolviendo(r)}>Devolver</button>}
            </div>
          </details>
        );
      })}
      {ticket && <Ticket t={ticket} ancho={config.ticket_ancho} onCerrar={() => setTicket(null)} />}
      {devolviendo && <DevolverModal kiosco={kiosco} ventaId={devolviendo.id} numero={devolviendo.numero} config={config} onCerrar={() => setDevolviendo(null)} onHecho={() => { setRecarga((n) => n + 1); onCambio(); }} />}
    </div>
  );
}
