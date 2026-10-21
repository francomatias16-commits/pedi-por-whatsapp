"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import type { Campana, Premio } from "@/lib/fidelidad";
import Plegable from "@/components/ui/Plegable";
import Avisos from "@/components/Avisos";
import ClientesSellos from "./sellos/ClientesSellos";
import Campanas from "./sellos/Campanas";
import Premios from "./sellos/Premios";
import ResumenSellos from "./sellos/ResumenSellos";
import { LimitesClub, PremioPrincipal, QrMostrador, SellosHoy, premioPrincipal } from "./sellos/Club";
import Promociones from "./sellos/Promociones";
import PapelitosClub from "./sellos/PapelitosClub";
import ReporteEmpleados from "./sellos/ReporteEmpleados";
import Asistente from "./sellos/Asistente";

export type ProductoSello = { id: string; nombre: string; categoria: string; vendido_por_peso: boolean };
// Orden pensado para el día a día: primero lo que pasa hoy, después cómo se configura, y al final lo opcional.
type Vista = "hoy" | "programa" | "clientes" | "promos" | "resultados";
const VISTAS: [Vista, string][] = [["hoy", "Hoy"], ["programa", "Mi programa"], ["clientes", "Clientes"], ["promos", "Promociones"], ["resultados", "Cómo va"]];
const num = (v: unknown) => (v == null ? null : Number(v));

export default function Sellos({ kiosco }: { kiosco: Kiosco }) {
  const [vista, setVista] = useState<Vista>("hoy");
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
    // Programa vacío la primera vez: te lleva directo a "Mi programa" con el asistente abierto.
    if (primeraCarga && !c.error && !p.error) {
      const vacio = (c.data ?? []).length === 0 && (p.data ?? []).length === 0;
      if (vacio) { setAsistente(true); setVista("programa"); }
      setPrimeraCarga(false);
    }
  }, [kiosco.id, primeraCarga]);
  useEffect(() => { void cargar(); }, [cargar]);

  const principal = premioPrincipal(premios);
  const formasActivas = campanas.filter((c) => c.activa).length;

  return (
    <>
      <h2>Puntos y premios</h2>
      <p className="mut">Tus clientes suman un sello con cada compra y, cuando juntan los que pedís, se llevan un premio.</p>
      <div className="tabs" role="tablist">
        {VISTAS.map(([k, t]) => <button key={k} role="tab" aria-selected={vista === k} className={vista === k ? "" : "sec"} onClick={() => setVista(k)}>{t}</button>)}
      </div>
      {msg && <p role="status" className="mut">{msg}</p>}

      {vista === "hoy" && <SellosHoy kiosco={kiosco} premios={premios} />}

      {vista === "programa" && (
        <>
          {asistente
            ? <Asistente kiosco={kiosco} onListo={() => { setAsistente(false); setMsg("Programa guardado"); void cargar(); }} onCancelar={() => setAsistente(false)} />
            : (
              <div className="ejemplo">
                <p style={{ margin: 0 }}>
                  {principal
                    ? <>Hoy: <b>{principal.nombre}</b> a los <b>{principal.costo_sellos}</b> sellos · {formasActivas} {formasActivas === 1 ? "forma" : "formas"} de sumar activa{formasActivas === 1 ? "" : "s"}.</>
                    : <>Todavía no tenés premio. Empezá por el paso 1 o dejá que te guiemos.</>}
                </p>
                <button type="button" className="sec" onClick={() => setAsistente(true)}>Armar programa en 3 pasos</button>
              </div>
            )}
          <Plegable titulo="1. Tu premio" ayuda="Lo que se lleva el cliente y cuántos sellos tiene que juntar." abierto>
            <PremioPrincipal kiosco={kiosco} premios={premios} onCambio={cargar} />
          </Plegable>
          <Plegable titulo="2. Cómo se suman los sellos" ayuda="Por defecto, 1 sello por compra. Acá podés sumar reglas: sellos dobles en un horario, por monto, por producto…" abierto>
            <Campanas kiosco={kiosco} campanas={campanas} productos={productos} onCambio={cargar} />
          </Plegable>
          <Plegable titulo="3. Más premios (opcional)" ayuda="Si querés ofrecer premios distintos: uno chico a pocos sellos y uno grande a muchos.">
            <Premios kiosco={kiosco} premios={premios} productos={productos} onCambio={cargar} />
          </Plegable>
          <Plegable titulo="4. QR y cartel del mostrador" abierto>
            <QrMostrador kiosco={kiosco} premios={premios} />
          </Plegable>
          <Plegable titulo="Límites contra abusos (opcional)">
            <LimitesClub kiosco={kiosco} />
          </Plegable>
          <Plegable titulo="Control de sellos en efectivo (opcional)">
            <PapelitosClub kiosco={kiosco} />
          </Plegable>
          <Plegable titulo="Avisos en este celular (opcional)">
            <Avisos kiosco={kiosco} />
          </Plegable>
        </>
      )}

      {vista === "clientes" && <ClientesSellos kiosco={kiosco} campanas={campanas} premios={premios} />}
      {vista === "promos" && <Promociones kiosco={kiosco} campanas={campanas} onCambio={cargar} />}

      {vista === "resultados" && (
        <>
          <ResumenSellos kiosco={kiosco} />
          <Plegable titulo="Sellos por empleado">
            <ReporteEmpleados kiosco={kiosco} />
          </Plegable>
        </>
      )}
    </>
  );
}
