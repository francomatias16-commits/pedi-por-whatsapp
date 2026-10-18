"use client";
import { useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { agruparMovimientos, desdePeriodo, formatearNeto, type Fila, type Mov, type Periodo } from "@/lib/modificados";

const PERIODOS: [Periodo, string][] = [["hoy", "Hoy"], ["7", "7 días"], ["30", "30 días"]];
type RawMov = { producto_id: string; tipo: string; cantidad: number; created_at: string; productos: { nombre: string; vendido_por_peso: boolean } | { nombre: string; vendido_por_peso: boolean }[] | null };

// Plan 2.6: productos con cambios de stock en el período, con diferencia neta y último movimiento.
export default function ProductosModificados({ kiosco }: { kiosco: Kiosco }) {
  const [periodo, setPeriodo] = useState<Periodo>("7");
  const [incluir, setIncluir] = useState(false);
  const [movs, setMovs] = useState<Mov[] | null>(null);
  const [err, setErr] = useState(false);
  const [truncado, setTruncado] = useState(false);

  useEffect(() => {
    let vivo = true;
    setMovs(null); setErr(false);
    supabase
      .from("stock_movimientos")
      .select("producto_id,tipo,cantidad,created_at,productos(nombre,vendido_por_peso)")
      .eq("kiosco_id", kiosco.id)
      .gte("created_at", desdePeriodo(periodo))
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { setErr(true); return; }
        const raw = (data ?? []) as unknown as RawMov[];
        setTruncado(raw.length >= 1000);
        setMovs(raw.map((m) => {
          const p = Array.isArray(m.productos) ? m.productos[0] : m.productos;
          return { producto_id: m.producto_id, tipo: m.tipo, cantidad: m.cantidad, created_at: m.created_at, nombre: p?.nombre ?? "Producto borrado", por_peso: !!p?.vendido_por_peso };
        }));
      });
    return () => { vivo = false; };
  }, [kiosco.id, periodo]);

  const filas: Fila[] = movs ? agruparMovimientos(movs, incluir) : [];
  const cuando = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="card">
      <b>Productos modificados</b>
      <div role="group" aria-label="Período" style={{ display: "flex", gap: 8, margin: "8px 0" }}>
        {PERIODOS.map(([p, t]) => (
          <button key={p} className={periodo === p ? undefined : "sec"} aria-pressed={periodo === p} onClick={() => setPeriodo(p)}>{t}</button>
        ))}
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={incluir} onChange={(e) => setIncluir(e.target.checked)} />
        <span className="mut">Incluir ventas, pedidos y devoluciones</span>
      </label>
      {err && <p role="alert" style={{ color: "var(--danger)" }}>No pudimos cargar los cambios de stock.</p>}
      {!err && !movs && <p className="mut">Cargando…</p>}
      {movs && filas.length === 0 && <p className="mut">Sin cambios de stock en este período.</p>}
      {filas.map((f) => (
        <div key={f.producto_id} className="row" style={{ padding: "6px 0" }}>
          <span>
            {f.nombre}
            <span className="mut" style={{ display: "block", fontSize: 12 }}>{f.movimientos} movimiento{f.movimientos === 1 ? "" : "s"} · último {cuando(f.ultimo)}</span>
          </span>
          <b>{formatearNeto(f.neto, f.por_peso)}</b>
        </div>
      ))}
      {truncado && <p className="mut">Se muestran los últimos 1000 movimientos del período.</p>}
    </div>
  );
}
