"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { mensajeFidelidad } from "@/lib/fidelidad";

type R = {
  sellos_dados: number; canjes: number; clientes_con_saldo: number; sellos_en_circulacion: number;
  por_campana: { nombre: string; sellos: number }[]; por_premio: { nombre: string; canjes: number }[]; top_clientes: { nombre: string; sellos: number }[];
};

export default function ResumenSellos({ kiosco }: { kiosco: Kiosco }) {
  const [dias, setDias] = useState(30);
  const [r, setR] = useState<R | null>(null);
  const [vence, setVence] = useState("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const [res, k] = await Promise.all([
      supabase.rpc("fidelidad_resumen", { p_kiosco: kiosco.id, p_dias: dias }),
      supabase.from("kioscos").select("sellos_vencen_dias").eq("id", kiosco.id).maybeSingle(),
    ]);
    if (res.error) setMsg(mensajeFidelidad(res.error.message)); else setR(res.data as R);
    setVence(k.data?.sellos_vencen_dias ? String(k.data.sellos_vencen_dias) : "");
  }, [kiosco.id, dias]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function guardarVencimiento() {
    const v = vence.trim() === "" ? null : Number(vence);
    if (v !== null && (!Number.isInteger(v) || v < 30 || v > 1095)) return setMsg("El vencimiento tiene que estar entre 30 y 1095 días (o vacío para que no venzan).");
    const { error } = await supabase.from("kioscos").update({ sellos_vencen_dias: v }).eq("id", kiosco.id);
    setMsg(error ? "No se pudo guardar el vencimiento." : v ? `Los puntos vencen tras ${v} días sin actividad` : "Los puntos no vencen");
  }

  return (
    <>
      <div className="tabs">{[7, 30, 90].map((d) => <button key={d} className={dias === d ? "" : "sec"} onClick={() => setDias(d)}>Últimos {d} días</button>)}</div>
      {msg && <p role="status" className="mut">{msg}</p>}
      {r && (
        <>
          <div className="card">
            <div className="row"><span className="mut">Puntos dados</span><b>{r.sellos_dados}</b></div>
            <div className="row"><span className="mut">Premios canjeados</span><b>{r.canjes}</b></div>
            <div className="row"><span className="mut">Clientes con puntos</span><b>{r.clientes_con_saldo}</b></div>
            <div className="row"><span className="mut">Sellos en circulación</span><b>{r.sellos_en_circulacion}</b></div>
          </div>
          <div className="card"><h3>Qué campañas funcionan</h3>
            {r.por_campana.length === 0 && <p className="mut">Sin puntos en este período.</p>}
            {r.por_campana.map((x) => <div className="row" key={x.nombre}><span>{x.nombre}</span><b>{x.sellos}</b></div>)}
          </div>
          <div className="card"><h3>Premios más canjeados</h3>
            {r.por_premio.length === 0 && <p className="mut">Todavía no se canjeó nada.</p>}
            {r.por_premio.map((x) => <div className="row" key={x.nombre}><span>{x.nombre}</span><b>{x.canjes}</b></div>)}
          </div>
          <div className="card"><h3>Tus mejores clientes</h3>
            {r.top_clientes.length === 0 && <p className="mut">Nadie tiene puntos todavía.</p>}
            {r.top_clientes.map((x) => <div className="row" key={x.nombre}><span>{x.nombre}</span><b>{x.sellos}</b></div>)}
          </div>
        </>
      )}
      <div className="card">
        <h3>Vencimiento de puntos</h3>
        <p className="mut">Si un cliente pasa tantos días sin sumar puntos, su saldo vence. Vacío = no vencen nunca. Los puntos no se borran: si se cambia o se quita el plazo, el saldo vuelve.</p>
        <label>Días sin actividad (30 a 1095)<input inputMode="numeric" value={vence} placeholder="No vencen" onChange={(e) => setVence(e.target.value)} /></label>
        <button className="sec" onClick={guardarVencimiento}>Guardar</button>
      </div>
    </>
  );
}
