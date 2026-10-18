"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import type { Campana, Premio } from "@/lib/fidelidad";
import ClientesSellos from "./sellos/ClientesSellos";
import Campanas from "./sellos/Campanas";
import Premios from "./sellos/Premios";
import ResumenSellos from "./sellos/ResumenSellos";
import Asistente from "./sellos/Asistente";

export type ProductoSello = { id: string; nombre: string; categoria: string; vendido_por_peso: boolean };
type Vista = "clientes" | "campanas" | "premios" | "resumen";
const VISTAS: [Vista, string][] = [["clientes", "Clientes"], ["campanas", "Cómo se suman"], ["premios", "Premios"], ["resumen", "Cómo va"]];
const num = (v: unknown) => (v == null ? null : Number(v));

export default function Sellos({ kiosco }: { kiosco: Kiosco }) {
  const [vista, setVista] = useState<Vista>("clientes");
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [premios, setPremios] = useState<Premio[]>([]);
  const [productos, setProductos] = useState<ProductoSello[]>([]);
  const [msg, setMsg] = useState("");
  const [asistente, setAsistente] = useState(false);
  const [primeraCarga, setPrimeraCarga] = useState(true);

  const cargar = useCallback(async () => {
    const [c, p, pr] = await Promise.all([
      supabase.from("fidelidad_campanas").select("*").eq("kiosco_id", kiosco.id).order("created_at"),
      supabase.from("fidelidad_premios").select("*").eq("kiosco_id", kiosco.id).order("costo_sellos"),
      supabase.from("productos").select("id,nombre,categoria,vendido_por_peso").eq("kiosco_id", kiosco.id).order("nombre"),
    ]);
    if (c.error || p.error) setMsg("No pudimos cargar el programa de sellos.");
    setCampanas(((c.data ?? []) as Campana[]).map((x) => ({ ...x, multiplicador: num(x.multiplicador), por_monto: num(x.por_monto), monto_minimo: num(x.monto_minimo) })));
    setPremios(((p.data ?? []) as Premio[]).map((x) => ({ ...x, valor: num(x.valor) })));
    setProductos(((pr.data ?? []) as ProductoSello[]).map((x) => ({ ...x, vendido_por_peso: !!x.vendido_por_peso })));
    // Programa vacío la primera vez: se abre el asistente solo.
    if (primeraCarga && !c.error && !p.error) { setAsistente((c.data ?? []).length === 0 && (p.data ?? []).length === 0); setPrimeraCarga(false); }
  }, [kiosco.id, primeraCarga]);
  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <>
      <h2>Puntos y premios</h2>
      <p className="mut">Para que los clientes vuelvan: suman puntos con cada compra y se llevan premios cuando juntan suficientes.</p>
      {asistente
        ? <Asistente kiosco={kiosco} onListo={() => { setAsistente(false); setMsg("Programa guardado"); void cargar(); }} onCancelar={() => setAsistente(false)} />
        : <button type="button" className="sec" onClick={() => setAsistente(true)}>Armar programa en 3 pasos</button>}
      <div className="tabs" role="tablist">
        {VISTAS.map(([k, t]) => <button key={k} role="tab" aria-selected={vista === k} className={vista === k ? "" : "sec"} onClick={() => setVista(k)}>{t}</button>)}
      </div>
      {msg && <p role="status" className="mut">{msg}</p>}
      {vista === "clientes" && <ClientesSellos kiosco={kiosco} campanas={campanas} premios={premios} />}
      {vista === "campanas" && <Campanas kiosco={kiosco} campanas={campanas} productos={productos} onCambio={cargar} />}
      {vista === "premios" && <Premios kiosco={kiosco} premios={premios} productos={productos} onCambio={cargar} />}
      {vista === "resumen" && <ResumenSellos kiosco={kiosco} />}
    </>
  );
}
