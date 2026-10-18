"use client";
import { useConfirmar } from "@/components/ui/Confirmar";
import { useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import type { ProductoSello } from "../Sellos";
import { PREMIO_VACIO, TIPOS_PREMIO, describirPremio, formDesdePremio, mensajeFidelidad, premioDesdeForm, validarPremio, type FormPremio, type Premio } from "@/lib/fidelidad";

export default function Premios({ kiosco, premios, productos, onCambio }: { kiosco: Kiosco; premios: Premio[]; productos: ProductoSello[]; onCambio: () => void }) {
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const [form, setForm] = useState<(FormPremio & { id?: string }) | null>(null);
  const [msg, setMsg] = useState(""); const [ocupado, setOcupado] = useState(false);
  const set = <K extends keyof FormPremio>(k: K, v: FormPremio[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const nombreProd = (id: string | null) => productos.find((p) => p.id === id)?.nombre;

  async function guardar() {
    if (!form) return;
    const err = validarPremio(form);
    if (err) return setMsg(err);
    setOcupado(true); setMsg("");
    const fila = premioDesdeForm(form);
    const { error } = form.id
      ? await supabase.from("fidelidad_premios").update(fila).eq("id", form.id).eq("kiosco_id", kiosco.id)
      : await supabase.from("fidelidad_premios").insert({ ...fila, kiosco_id: kiosco.id });
    setOcupado(false);
    if (error) return setMsg(mensajeFidelidad(error.message));
    setForm(null); setMsg("Premio guardado"); onCambio();
  }
  async function activar(p: Premio) {
    const { error } = await supabase.from("fidelidad_premios").update({ activo: !p.activo }).eq("id", p.id).eq("kiosco_id", kiosco.id);
    if (error) setMsg("No se pudo cambiar el estado."); else onCambio();
  }
  async function borrar(p: Premio) {
    if (!await confirmar({ titulo: `¿Borrar el premio “${p.nombre}”? Los canjes ya hechos se conservan.`, confirmar: "Sí, seguir", peligro: true })) return;
    const { error } = await supabase.from("fidelidad_premios").delete().eq("id", p.id).eq("kiosco_id", kiosco.id);
    if (error) setMsg("No se pudo borrar."); else { setMsg("Premio borrado."); onCambio(); }
  }

  return (
    <>
      {ventanaConfirmar}
      <p className="mut">Podés tener varios premios con distinto costo: uno chico a los 5 puntos y uno grande a los 20. El cliente elige cuál canjear.</p>
      {msg && <p role="status" className="mut">{msg}</p>}
      {!form && <button onClick={() => { setMsg(""); setForm({ ...PREMIO_VACIO }); }}>Nuevo premio</button>}
      {form && (
        <div className="card">
          <h3>{form.id ? "Editar premio" : "Nuevo premio"}</h3>
          <label>Nombre<input value={form.nombre} maxLength={80} placeholder="Ej: Café con medialuna" onChange={(e) => set("nombre", e.target.value)} /></label>
          <label>Costo en sellos<input inputMode="numeric" value={form.costo_sellos} onChange={(e) => set("costo_sellos", e.target.value)} /></label>
          <label>Tipo
            <select value={form.tipo} onChange={(e) => set("tipo", e.target.value as FormPremio["tipo"])}>
              {TIPOS_PREMIO.map((t) => <option key={t.tipo} value={t.tipo}>{t.titulo}</option>)}
            </select>
          </label>
          <p className="mut">{TIPOS_PREMIO.find((t) => t.tipo === form.tipo)?.ayuda}</p>
          {form.tipo === "producto" && (
            <label>Producto
              <select value={form.producto_id} onChange={(e) => set("producto_id", e.target.value)}>
                <option value="">Elegí un producto</option>
                {productos.filter((p) => !p.vendido_por_peso).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
          )}
          {form.tipo === "pct" && <label>Porcentaje de descuento<input inputMode="decimal" value={form.valor} onChange={(e) => set("valor", e.target.value)} placeholder="10" /></label>}
          {form.tipo === "monto" && <label>Monto de descuento ($)<input inputMode="decimal" value={form.valor} onChange={(e) => set("valor", e.target.value)} placeholder="500" /></label>}
          <label>Descripción (opcional)<input value={form.descripcion} maxLength={200} onChange={(e) => set("descripcion", e.target.value)} /></label>
          <div className="row" style={{ justifyContent: "flex-start", gap: 6, marginTop: 8 }}>
            <button disabled={ocupado} onClick={guardar}>Guardar premio</button>
            <button className="sec" onClick={() => { setForm(null); setMsg(""); }}>Cancelar</button>
          </div>
        </div>
      )}
      <h3>Tus premios ({premios.length})</h3>
      {premios.length === 0 && <p className="mut">Sin premios: los clientes juntan puntos pero no tienen qué canjear. Creá uno arriba.</p>}
      {premios.map((p) => (
        <div className="card" key={p.id} style={{ opacity: p.activo ? 1 : 0.6 }}>
          <div className="row"><b>{p.nombre}</b><span className="mut">{p.activo ? "" : "pausado"}</span></div>
          <p className="mut" style={{ margin: ".3rem 0" }}>{describirPremio(p, nombreProd(p.producto_id))}{p.descripcion ? ` · ${p.descripcion}` : ""}</p>
          <div className="row" style={{ justifyContent: "flex-start", gap: 6, flexWrap: "wrap" }}>
            <button className="sec" onClick={() => activar(p)}>{p.activo ? "Pausar" : "Activar"}</button>
            <button className="sec" onClick={() => { setMsg(""); setForm({ ...formDesdePremio(p), id: p.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Editar</button>
            <button className="sec" onClick={() => borrar(p)}>Borrar</button>
          </div>
        </div>
      ))}
    </>
  );
}
