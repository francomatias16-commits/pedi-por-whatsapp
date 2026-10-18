"use client";
import { useMemo, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { norm, type ProductoPos } from "@/lib/caja";
import { peso } from "@/lib/whatsapp";

// Favoritos del POS: accesos rápidos para los productos más vendidos.
export default function Favoritos({ kiosco, productos, favoritos, onCambio }: { kiosco: Kiosco; productos: ProductoPos[]; favoritos: string[]; onCambio: () => void }) {
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const lista = favoritos.map((id) => porId.get(id)).filter((p): p is ProductoPos => !!p);
  const res = useMemo(() => {
    const s = norm(q.trim());
    return s ? productos.filter((p) => !favoritos.includes(p.id) && norm(p.nombre).includes(s)).slice(0, 6) : [];
  }, [q, productos, favoritos]);

  async function agregar(p: ProductoPos) {
    setErr("");
    const { error } = await supabase.from("pos_favoritos").insert({ kiosco_id: kiosco.id, producto_id: p.id, orden: favoritos.length + 1 });
    if (error) return setErr("No se pudo agregar el favorito.");
    setQ(""); onCambio();
  }
  async function quitar(p: ProductoPos) {
    const { error } = await supabase.from("pos_favoritos").delete().eq("kiosco_id", kiosco.id).eq("producto_id", p.id);
    if (error) return setErr("No se pudo quitar el favorito.");
    onCambio();
  }
  async function mover(i: number, d: -1 | 1) {
    const j = i + d; if (j < 0 || j >= lista.length) return;
    const a = lista[i], b = lista[j];
    const r = await Promise.all([
      supabase.from("pos_favoritos").update({ orden: j + 1 }).eq("kiosco_id", kiosco.id).eq("producto_id", a.id),
      supabase.from("pos_favoritos").update({ orden: i + 1 }).eq("kiosco_id", kiosco.id).eq("producto_id", b.id),
    ]);
    if (r.some((x) => x.error)) return setErr("No se pudo reordenar.");
    onCambio();
  }

  return (
    <div>
      <div className="card">
        <p className="pos-kicker">Favoritos del punto de venta</p>
        <p className="mut">Aparecen como botones arriba del ticket para agregarlos con un toque.</p>
        {lista.length === 0 && <p className="mut">Todavía no marcaste favoritos.</p>}
        <div className="recibo">
          {lista.map((p, i) => (
            <div className="row" key={p.id}>
              <span>{p.nombre} <span className="mut mono">{peso(p.precio)}</span></span>
              <span className="pos-fav-acc">
                <button className="sec" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir">↑</button>
                <button className="sec" onClick={() => mover(i, 1)} disabled={i === lista.length - 1} aria-label="Bajar">↓</button>
                <button className="sec" onClick={() => quitar(p)}>Quitar</button>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <p className="pos-kicker">Agregar favorito</p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto por nombre…" aria-label="Buscar producto favorito" autoComplete="off" />
        {res.map((p) => (<button type="button" className="pos-resultado" key={p.id} onClick={() => agregar(p)}><span>{p.nombre}</span><span className="mono">{peso(p.precio)}</span></button>))}
        {err && <p className="pos-error" role="alert">{err}</p>}
      </div>
    </div>
  );
}
