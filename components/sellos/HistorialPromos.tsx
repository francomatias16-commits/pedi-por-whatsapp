"use client";
import { useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { ACCION_TEXTO } from "@/lib/promos";
import { mensajeErrorSql } from "@/lib/errores";
import Aviso from "@/components/ui/Aviso";

type Fila = { cuando: string; accion: string; nombre: string | null; tabla: string; promo_clave: string | null };
const cuando = (s: string) => new Date(s).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Registro de todo lo que se cambió en promociones, premios y ajustes (lo ve solo el dueño; la lectura la controla la base, 0050). */
export default function HistorialPromos({ kiosco }: { kiosco: Kiosco }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [msg, setMsg] = useState("");

  async function ver() {
    setMsg("");
    const { data, error } = await supabase.rpc("promo_historial", { p_kiosco: kiosco.id, p_limite: 50 });
    if (error) return setMsg(mensajeErrorSql(error.message, "club"));
    setFilas((data as Fila[]) ?? []);
  }

  return (
    <div className="card">
      <h3>Historial de cambios</h3>
      <p className="mut">Quién activó, pausó o cambió cada promoción. Lo ve solo el dueño.</p>
      {!filas && <button type="button" className="sec" onClick={ver}>Ver los últimos cambios</button>}
      {msg && <Aviso tipo="alerta">{msg}</Aviso>}
      {filas?.length === 0 && <p className="mut">Todavía no hay cambios.</p>}
      {filas?.map((f, i) => (
        <div className="row fila-sep" key={i}>
          <span>{ACCION_TEXTO[f.accion] ?? f.accion}{f.nombre ? <b>{`: ${f.nombre}`}</b> : null}</span>
          <span className="mut">{cuando(f.cuando)}</span>
        </div>
      ))}
    </div>
  );
}
