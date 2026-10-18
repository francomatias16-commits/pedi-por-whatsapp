"use client";
import { useConfirmar } from "@/components/ui/Confirmar";
import { useMemo, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import type { ProductoSello } from "../Sellos";
import {
  CAMPANA_VACIA, DIAS, DIAS_CORTO, MEDIOS_ETQ, PLANTILLAS, TIPOS, campanaDesdeForm, describirCampana, formDesdeCampana, mensajeFidelidad, validarCampana,
  type Campana, type Canal, type FormCampana, type Medio,
} from "@/lib/fidelidad";

const alternar = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const ahoraLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export default function Campanas({ kiosco, campanas, productos, onCambio }: { kiosco: Kiosco; campanas: Campana[]; productos: ProductoSello[]; onCambio: () => void }) {
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const [form, setForm] = useState<(FormCampana & { id?: string }) | null>(null);
  const [msg, setMsg] = useState(""); const [ocupado, setOcupado] = useState(false);
  const categorias = useMemo(() => [...new Set(productos.map((p) => p.categoria))].sort(), [productos]);
  const nombreProd = (id: string | null) => productos.find((p) => p.id === id)?.nombre;
  const set = <K extends keyof FormCampana>(k: K, v: FormCampana[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const esManual = form?.tipo === "manual";

  async function guardar() {
    if (!form) return;
    const err = validarCampana(form);
    if (err) return setMsg(err);
    setOcupado(true); setMsg("");
    const fila = campanaDesdeForm(form);
    const { error } = form.id
      ? await supabase.from("fidelidad_campanas").update(fila).eq("id", form.id).eq("kiosco_id", kiosco.id)
      : await supabase.from("fidelidad_campanas").insert({ ...fila, kiosco_id: kiosco.id });
    setOcupado(false);
    if (error) return setMsg(mensajeFidelidad(error.message));
    setForm(null); setMsg("Forma de sumar puntos guardada"); onCambio();
  }
  async function activar(c: Campana) {
    const { error } = await supabase.from("fidelidad_campanas").update({ activa: !c.activa }).eq("id", c.id).eq("kiosco_id", kiosco.id);
    if (error) setMsg("No se pudo cambiar el estado."); else onCambio();
  }
  async function borrar(c: Campana) {
    if (!await confirmar({ titulo: `¿Borrar la campaña “${c.nombre}”? Los sellos que ya dio se conservan.`, confirmar: "Sí, seguir", peligro: true })) return;
    const { error } = await supabase.from("fidelidad_campanas").delete().eq("id", c.id).eq("kiosco_id", kiosco.id);
    if (error) setMsg("No se pudo borrar."); else { setMsg("Se borró la forma de sumar puntos."); onCambio(); }
  }

  return (
    <>
      {ventanaConfirmar}
      <p className="mut">Las campañas activas se <b>suman</b>: una compra puede ganar sellos por varias a la vez. Los “sellos dobles” multiplican lo que dan las demás.</p>
      {msg && <p role="status" className="mut">{msg}</p>}
      {!form && (
        <div className="card">
          <h3>Nueva forma de sumar puntos</h3>
          <p className="mut">Empezá con una plantilla o armá la tuya desde cero.</p>
          <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 6 }}>
            {PLANTILLAS.map((p) => <button key={p.titulo} className="sec" onClick={() => { setMsg(""); setForm({ ...CAMPANA_VACIA, ...p.form }); }}>{p.titulo}</button>)}
            <button onClick={() => { setMsg(""); setForm({ ...CAMPANA_VACIA }); }}>Desde cero</button>
          </div>
        </div>
      )}

      {form && (
        <div className="card">
          <h3>{form.id ? "Editar campaña" : "Nueva campaña"}</h3>
          <label>Nombre<input value={form.nombre} maxLength={80} onChange={(e) => set("nombre", e.target.value)} placeholder="Ej: Martes de sellos dobles" /></label>
          <label>Tipo
            <select value={form.tipo} onChange={(e) => set("tipo", e.target.value as FormCampana["tipo"])} disabled={!!form.id}>
              {TIPOS.map((t) => <option key={t.tipo} value={t.tipo}>{t.titulo}</option>)}
            </select>
          </label>
          <p className="mut">{TIPOS.find((t) => t.tipo === form.tipo)?.ayuda}</p>

          {form.tipo === "multiplicador"
            ? <label>Multiplicador (2 = dobles, 3 = triples)<input inputMode="decimal" value={form.multiplicador} onChange={(e) => set("multiplicador", e.target.value)} /></label>
            : <label>{form.tipo === "monto" ? "Sellos por cada bloque de monto" : "Sellos que da"}<input inputMode="numeric" value={form.sellos} onChange={(e) => set("sellos", e.target.value)} /></label>}
          {form.tipo === "monto" && <label>Cada cuántos pesos<input inputMode="decimal" value={form.por_monto} placeholder="1000" onChange={(e) => set("por_monto", e.target.value)} /></label>}
          {form.tipo === "producto" && (
            <label>Producto
              <select value={form.producto_id} onChange={(e) => set("producto_id", e.target.value)}>
                <option value="">Elegí un producto</option>
                {productos.filter((p) => !p.vendido_por_peso).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
          )}
          {form.tipo === "categoria" && (
            <label>Categoría
              <select value={form.categoria} onChange={(e) => set("categoria", e.target.value)}>
                <option value="">Elegí una categoría</option>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          {form.tipo === "reactivacion" && <label>Días sin comprar para considerarlo “perdido”<input inputMode="numeric" value={form.dias_inactivo} onChange={(e) => set("dias_inactivo", e.target.value)} /></label>}

          {!esManual && (<>
            <label>Monto mínimo de la compra (opcional)<input inputMode="decimal" value={form.monto_minimo} placeholder="Sin mínimo" onChange={(e) => set("monto_minimo", e.target.value)} /></label>
            <label>Dónde aplica</label>
            <div className="row" style={{ justifyContent: "flex-start", gap: 6 }}>
              {(["mostrador", "pedido"] as Canal[]).map((c) => <button key={c} type="button" className={form.canales.includes(c) ? "" : "sec"} onClick={() => set("canales", alternar(form.canales, c))}>{c === "mostrador" ? "Mostrador (Caja)" : "Pedidos"}</button>)}
            </div>
            <label>Medios de pago (ninguno = todos)</label>
            <div className="row" style={{ justifyContent: "flex-start", gap: 6, flexWrap: "wrap" }}>
              {(Object.keys(MEDIOS_ETQ) as Medio[]).map((m) => <button key={m} type="button" className={form.medios.includes(m) ? "" : "sec"} onClick={() => set("medios", alternar(form.medios, m))}>{MEDIOS_ETQ[m]}</button>)}
            </div>
            <label>Días de la semana (ninguno = todos)</label>
            <div className="row" style={{ justifyContent: "flex-start", gap: 6, flexWrap: "wrap" }}>
              {DIAS.map((d, i) => <button key={d} type="button" title={d} className={form.dias_semana.includes(i) ? "" : "sec"} onClick={() => set("dias_semana", alternar(form.dias_semana, i))}>{DIAS_CORTO[i]}</button>)}
            </div>
            <label className="etq-check"><input type="checkbox" checked={form.usar_horario} onChange={(e) => set("usar_horario", e.target.checked)} /> Solo en un horario (hora de Argentina)</label>
            {form.usar_horario && (
              <div className="etq-form">
                <div><label>Desde</label><input type="time" value={form.hora_desde} onChange={(e) => set("hora_desde", e.target.value)} /></div>
                <div><label>Hasta</label><input type="time" value={form.hora_hasta} onChange={(e) => set("hora_hasta", e.target.value)} /></div>
              </div>
            )}
          </>)}
          <div className="etq-form">
            <div><label>Empieza (opcional)</label><input type="date" value={form.desde} onChange={(e) => set("desde", e.target.value)} /></div>
            <div><label>Termina (opcional)</label><input type="date" value={form.hasta} onChange={(e) => set("hasta", e.target.value)} /></div>
            <div><label>Tope por cliente y día</label><input inputMode="numeric" value={form.tope_diario} placeholder="Sin tope" onChange={(e) => set("tope_diario", e.target.value)} /></div>
          </div>
          <div className="row" style={{ justifyContent: "flex-start", gap: 6, marginTop: 8 }}>
            <button disabled={ocupado} onClick={guardar}>Guardar campaña</button>
            <button className="sec" onClick={() => { setForm(null); setMsg(""); }}>Cancelar</button>
          </div>
        </div>
      )}

      <h3>Tus formas de sumar puntos ({campanas.length})</h3>
      {campanas.length === 0 && <p className="mut">Todavía no tenés formas de sumar puntos: sin ellas nadie junta puntos. Creá una arriba.</p>}
      {campanas.map((c) => (
        <div className="card" key={c.id} style={{ opacity: c.activa ? 1 : 0.6 }}>
          <div className="row"><b>{c.nombre}</b><span className="mut">{TIPOS.find((t) => t.tipo === c.tipo)?.titulo}{c.activa ? "" : " · pausada"}</span></div>
          <p className="mut" style={{ margin: ".3rem 0" }}>{describirCampana(c, nombreProd(c.producto_id))}</p>
          <div className="row" style={{ justifyContent: "flex-start", gap: 6, flexWrap: "wrap" }}>
            <button className="sec" onClick={() => activar(c)}>{c.activa ? "Pausar" : "Activar"}</button>
            <button className="sec" onClick={() => { setMsg(""); setForm({ ...formDesdeCampana(c), id: c.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Editar</button>
            <button className="sec" onClick={() => borrar(c)}>Borrar</button>
          </div>
        </div>
      ))}
      <Simulador kiosco={kiosco} productos={productos} />
    </>
  );
}

function Simulador({ kiosco, productos }: { kiosco: Kiosco; productos: ProductoSello[] }) {
  const [monto, setMonto] = useState("2500"); const [canal, setCanal] = useState<Canal>("mostrador"); const [medio, setMedio] = useState<Medio>("efectivo");
  const [cuando, setCuando] = useState(ahoraLocal()); const [prod, setProd] = useState(""); const [uni, setUni] = useState("1");
  const [res, setRes] = useState<{ total: number; detalle: { motivo: string; cantidad: number }[] } | null>(null); const [msg, setMsg] = useState("");
  async function simular() {
    setMsg(""); setRes(null);
    const m = Number(monto.replace(",", "."));
    if (!(m >= 0)) return setMsg("Poné un monto válido.");
    const { data, error } = await supabase.rpc("fidelidad_simular", {
      p_kiosco: kiosco.id, p_monto: m, p_canal: canal, p_medio: medio, p_cuando: new Date(cuando).toISOString(), p_cliente: null, p_producto: prod || null, p_unidades: Math.max(1, Math.floor(Number(uni)) || 1),
    });
    if (error) return setMsg(mensajeFidelidad(error.message));
    setRes(data as { total: number; detalle: { motivo: string; cantidad: number }[] });
  }
  return (
    <div className="card">
      <h3>Probar cuántos puntos se lleva un cliente</h3>
      <p className="mut">Simulá una compra para ver cuántos sellos daría (como si fuera un cliente nuevo). Sirve para chequear días, horarios y montos antes de avisarle a tus clientes.</p>
      <div className="etq-form">
        <div><label>Monto</label><input inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
        <div><label>Dónde</label><select value={canal} onChange={(e) => setCanal(e.target.value as Canal)}><option value="mostrador">Mostrador</option><option value="pedido">Pedido</option></select></div>
        <div><label>Medio de pago</label><select value={medio} onChange={(e) => setMedio(e.target.value as Medio)}>{(Object.keys(MEDIOS_ETQ) as Medio[]).map((m) => <option key={m} value={m}>{MEDIOS_ETQ[m]}</option>)}</select></div>
        <div><label>Día y hora</label><input type="datetime-local" value={cuando} onChange={(e) => setCuando(e.target.value)} /></div>
        <div><label>Producto (opcional)</label><select value={prod} onChange={(e) => setProd(e.target.value)}><option value="">—</option>{productos.filter((p) => !p.vendido_por_peso).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></div>
        <div><label>Unidades</label><input inputMode="numeric" value={uni} onChange={(e) => setUni(e.target.value)} /></div>
      </div>
      <button className="sec" onClick={simular}>Simular</button>
      {msg && <p className="mut">{msg}</p>}
      {res && (
        <div style={{ marginTop: 8 }}>
          <b>{res.total} sello{res.total === 1 ? "" : "s"}</b>
          <ul className="mut" style={{ margin: ".3rem 0 0", paddingLeft: 20 }}>{res.detalle.map((d, i) => <li key={i}>{d.motivo}: +{d.cantidad}</li>)}{res.detalle.length === 0 && <li>Ninguna campaña aplica a esa compra.</li>}</ul>
        </div>
      )}
    </div>
  );
}
