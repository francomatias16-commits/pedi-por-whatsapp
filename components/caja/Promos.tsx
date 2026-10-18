"use client";
import { useConfirmar } from "@/components/ui/Confirmar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import type { ProductoPos } from "@/lib/caja";
import { PROMO_VACIA, describirPromo, filaPromo, formDePromo, validarPromo, vigenciaPromo, type FormPromo, type Promo } from "@/lib/pos/promos";

type Fila = Promo & { creada?: string };

// Alta y edición de promociones automáticas (NxM por producto, % por producto o categoría).
// En una misma venta gana la más conveniente para el cliente en cada renglón; no se suman.
export default function Promos({ kiosco, productos, promos, onCambio }: { kiosco: Kiosco; productos: ProductoPos[]; promos: Promo[]; onCambio: () => void }) {
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const [todas, setTodas] = useState<Fila[] | null>(null);
  const [form, setForm] = useState<FormPromo | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const nombreProd = (id: string) => productos.find((p) => p.id === id)?.nombre;
  const categorias = useMemo(() => [...new Set(productos.map((p) => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [productos]);
  const porPeso = (id: string) => !!productos.find((p) => p.id === id)?.vendido_por_peso;

  // Caja solo trae las activas; acá se necesitan también las pausadas para poder reactivarlas.
  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from("pos_promos").select("id,nombre,tipo,producto_id,categoria,lleva,paga,pct,desde,hasta,activa").eq("kiosco_id", kiosco.id).order("created_at", { ascending: false });
    if (error) { setErr("No pudimos cargar las promociones."); return; }
    setTodas((data ?? []).map((x) => ({ ...x, pct: x.pct == null ? null : Number(x.pct) })) as Fila[]);
  }, [kiosco.id]);
  useEffect(() => { void cargar(); }, [cargar]);
  const lista = todas ?? promos;

  const refrescar = async () => { await cargar(); onCambio(); };

  async function guardar() {
    if (!form) return;
    const e = validarPromo(form);
    if (e) return setErr(e);
    setOcupado(true); setErr("");
    const fila = filaPromo(form);
    const { error } = editId
      ? await supabase.from("pos_promos").update(fila).eq("id", editId).eq("kiosco_id", kiosco.id)
      : await supabase.from("pos_promos").insert({ ...fila, kiosco_id: kiosco.id });
    setOcupado(false);
    if (error) return setErr("No se pudo guardar la promoción. Revisá los datos e intentá de nuevo.");
    setForm(null); setEditId(null); await refrescar();
  }
  async function alternar(p: Fila) {
    const { error } = await supabase.from("pos_promos").update({ activa: !p.activa }).eq("id", p.id).eq("kiosco_id", kiosco.id);
    if (error) return setErr("No se pudo cambiar el estado de la promoción.");
    await refrescar();
  }
  async function borrar(p: Fila) {
    if (!(await confirmar({ titulo: `¿Eliminar la promoción “${p.nombre}”?`, detalle: "Las ventas ya hechas no se modifican.", confirmar: "Sí, eliminar", peligro: true }))) return;
    const { error } = await supabase.from("pos_promos").delete().eq("id", p.id).eq("kiosco_id", kiosco.id);
    if (error) return setErr("No se pudo eliminar la promoción.");
    await refrescar();
  }
  const set = (k: Partial<FormPromo>) => setForm((f) => (f ? { ...f, ...k } : f));

  return (
    <div>
      {ventanaConfirmar}
      <p className="mut">Se aplican solas al cobrar. Si un producto entra en más de una, gana la que más le conviene al cliente (no se suman). El NxM no aplica a productos por peso.</p>
      {err && <p className="pos-error" role="alert">{err}</p>}
      {!form && <button onClick={() => { setForm({ ...PROMO_VACIA }); setEditId(null); setErr(""); }}>Nueva promoción</button>}
      {form && (
        <div className="card" style={{ margin: ".6rem 0" }}>
          <h3 className="pos-sub" style={{ marginTop: 0 }}>{editId ? "Editar promoción" : "Nueva promoción"}</h3>
          <label>Nombre<input value={form.nombre} maxLength={80} onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej: 3x2 en Coca 500" autoFocus /></label>
          <label>Tipo
            <select value={form.tipo} onChange={(e) => set({ tipo: e.target.value as FormPromo["tipo"], alcance: e.target.value === "nxm" ? "producto" : form.alcance })}>
              <option value="nxm">NxM (lleva 3, paga 2)</option><option value="pct">Porcentaje de descuento</option>
            </select>
          </label>
          {form.tipo === "pct" && (
            <label>Aplica a
              <select value={form.alcance} onChange={(e) => set({ alcance: e.target.value as FormPromo["alcance"] })}>
                <option value="producto">Un producto</option><option value="categoria">Una categoría</option>
              </select>
            </label>
          )}
          {form.alcance === "producto" ? (
            <label>Producto
              <select value={form.producto_id} onChange={(e) => set({ producto_id: e.target.value })}>
                <option value="">Elegí un producto…</option>
                {productos.filter((p) => form.tipo !== "nxm" || !p.vendido_por_peso).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
          ) : (
            <label>Categoría
              <select value={form.categoria} onChange={(e) => set({ categoria: e.target.value })}>
                <option value="">Elegí una categoría…</option>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          {form.tipo === "nxm" ? (
            <div className="pos-filtros" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label>Lleva<input inputMode="numeric" value={form.lleva} onChange={(e) => set({ lleva: e.target.value })} /></label>
              <label>Paga<input inputMode="numeric" value={form.paga} onChange={(e) => set({ paga: e.target.value })} /></label>
            </div>
          ) : (
            <label>Descuento (%)<input inputMode="decimal" value={form.pct} onChange={(e) => set({ pct: e.target.value })} placeholder="Ej: 15" /></label>
          )}
          <div className="pos-filtros" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label>Desde (opcional)<input type="date" value={form.desde} onChange={(e) => set({ desde: e.target.value })} /></label>
            <label>Hasta (opcional)<input type="date" value={form.hasta} onChange={(e) => set({ hasta: e.target.value })} /></label>
          </div>
          <div className="pos-modal-acciones">
            <button className="sec" onClick={() => { setForm(null); setEditId(null); setErr(""); }}>Cancelar</button>
            <button disabled={ocupado} onClick={guardar}>{ocupado ? "Guardando…" : "Guardar promoción"}</button>
          </div>
        </div>
      )}
      {lista.length === 0 && !form && <p className="mut">Todavía no cargaste promociones.</p>}
      {lista.map((p) => {
        const vig = vigenciaPromo(p);
        const estado = !p.activa ? "Pausada" : vig === "vigente" ? "Vigente" : vig === "programada" ? "Programada" : "Vencida";
        return (
          <div className="card" key={p.id} style={{ margin: ".4rem 0", opacity: p.activa && vig !== "vencida" ? 1 : 0.7 }}>
            <div className="row"><b>{p.nombre}</b><span className="chip-estado">{estado}</span></div>
            <p className="mut" style={{ margin: ".2rem 0" }}>
              {describirPromo(p, nombreProd)}{p.desde || p.hasta ? ` · ${p.desde ? `desde ${p.desde}` : ""}${p.desde && p.hasta ? " " : ""}${p.hasta ? `hasta ${p.hasta}` : ""}` : ""}
              {p.tipo === "nxm" && p.producto_id && porPeso(p.producto_id) ? " ·  el producto se vende por peso: el NxM no aplica" : ""}
            </p>
            <div className="pos-venta-acc">
              <button className="sec" onClick={() => alternar(p)}>{p.activa ? "Pausar" : "Activar"}</button>
              <button className="sec" onClick={() => { setForm(formDePromo(p)); setEditId(p.id); setErr(""); }}>Editar</button>
              <button className="sec peligro" onClick={() => borrar(p)}>Eliminar</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
