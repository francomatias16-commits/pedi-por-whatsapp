"use client";
import { useEffect, useMemo, useState } from "react";
import { useConfirmar } from "@/components/ui/Confirmar";
import { supabase, type Kiosco } from "@/lib/supabase";
import {
  DIAS_CORTO, HORAS_FLOJAS_VACIA, PRESETS_HORAS_FLOJAS, campanaDesdeForm, describirCampana, esHorasFlojas, formCampanaHorasFlojas,
  hayBaseDeSellos, horasFlojasDesdeCampana, mensajeFidelidad, validarHorasFlojas, type Campana, type FormHorasFlojas,
} from "@/lib/fidelidad";

const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]; // lunes a domingo (0 = domingo en la base)

/** Promo de horas flojas: sellos dobles (o triples) en los días y horarios con menos ventas. Es una campaña de la 0017 con un formulario mínimo. */
export default function HorasFlojas({ kiosco, campanas, onCambio }: { kiosco: Kiosco; campanas: Campana[]; onCambio: () => void }) {
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const promo = useMemo(() => campanas.find(esHorasFlojas) ?? null, [campanas]);
  const [h, setH] = useState<FormHorasFlojas>(HORAS_FLOJAS_VACIA);
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (promo) setH(horasFlojasDesdeCampana(promo)); }, [promo]);

  const alternarDia = (d: number) => setH((x) => ({ ...x, dias: x.dias.includes(d) ? x.dias.filter((n) => n !== d) : [...x.dias, d] }));

  async function guardar() {
    const err = validarHorasFlojas(h);
    if (err) return setMsg(err);
    setOcupado(true); setMsg("");
    const fila = campanaDesdeForm(formCampanaHorasFlojas(h));
    const { error } = promo
      ? await supabase.from("fidelidad_campanas").update({ ...fila, activa: true }).eq("id", promo.id).eq("kiosco_id", kiosco.id)
      : await supabase.from("fidelidad_campanas").insert({ ...fila, kiosco_id: kiosco.id });
    setOcupado(false);
    if (error) return setMsg(mensajeFidelidad(error.message));
    setMsg(promo ? "Promo actualizada" : "Promo activada"); onCambio();
  }
  async function pausar() {
    if (!promo) return;
    setMsg("");
    const { error } = await supabase.from("fidelidad_campanas").update({ activa: !promo.activa }).eq("id", promo.id).eq("kiosco_id", kiosco.id);
    if (error) return setMsg("No se pudo cambiar el estado.");
    setMsg(promo.activa ? "Promo pausada" : "Promo activada"); onCambio();
  }
  async function quitar() {
    if (!promo) return;
    if (!await confirmar({ titulo: "¿Quitar la promo de horas flojas? Los sellos que ya dio se conservan.", confirmar: "Sí, quitarla", peligro: true })) return;
    const { error } = await supabase.from("fidelidad_campanas").delete().eq("id", promo.id).eq("kiosco_id", kiosco.id);
    if (error) return setMsg("No se pudo quitar.");
    setH(HORAS_FLOJAS_VACIA); setMsg("Promo quitada"); onCambio();
  }

  return (
    <div className="card">
      {ventanaConfirmar}
      <h3>Promo de horas flojas</h3>
      <p className="mut" style={{ marginTop: 0 }}>Sellos dobles en los días y horarios en que vendés menos: llena los huecos sin tocar nada en la caja.</p>
      {promo && <p><b>{promo.activa ? "Activa" : "Pausada"}:</b> {describirCampana(promo)}</p>}
      {!hayBaseDeSellos(campanas) && <p className="mut" role="alert">Para que funcione necesitás tener activa una forma de sumar por compra (pestaña “Cómo se suman”): los sellos dobles multiplican lo que ya se da.</p>}
      <div className="row" style={{ justifyContent: "flex-start", gap: 6, flexWrap: "wrap" }}>
        {PRESETS_HORAS_FLOJAS.map((p) => <button key={p.titulo} type="button" className="sec" onClick={() => setH(p.form)}>{p.titulo}</button>)}
      </div>
      <p className="mut" style={{ marginBottom: 4 }}>Días</p>
      <div className="row" style={{ justifyContent: "flex-start", gap: 6, flexWrap: "wrap" }}>
        {ORDEN_DIAS.map((d) => (
          <button key={d} type="button" className={h.dias.includes(d) ? "" : "sec"} aria-pressed={h.dias.includes(d)} onClick={() => alternarDia(d)}>{DIAS_CORTO[d]}</button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: "flex-start", gap: 8 }}>
        <label>Desde<input type="time" value={h.desde} onChange={(e) => setH({ ...h, desde: e.target.value })} /></label>
        <label>Hasta<input type="time" value={h.hasta} onChange={(e) => setH({ ...h, hasta: e.target.value })} /></label>
        <label>Sellos
          <select value={h.mult} onChange={(e) => setH({ ...h, mult: e.target.value })}>
            <option value="2">Dobles (x2)</option><option value="3">Triples (x3)</option>
          </select>
        </label>
      </div>
      <div className="row" style={{ justifyContent: "flex-start", gap: 8 }}>
        <button type="button" onClick={guardar} disabled={ocupado}>{promo ? "Guardar cambios" : "Activar promo"}</button>
        {promo && <button type="button" className="sec" onClick={pausar}>{promo.activa ? "Pausar" : "Reanudar"}</button>}
        {promo && <button type="button" className="sec peligro" onClick={quitar}>Quitar</button>}
      </div>
      {msg && <p role="status" className="mut">{msg}</p>}
    </div>
  );
}
