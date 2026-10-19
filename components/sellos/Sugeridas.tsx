"use client";
import { useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import type { Sugerencia } from "@/lib/promos";
import { mensajeErrorSql } from "@/lib/errores";
import Aviso from "@/components/ui/Aviso";
import { useConfirmar } from "@/components/ui/Confirmar";

/** Sugeridas para vos (plan, sección 7): el sistema propone y el kiosquero confirma con un clic. Las arma promo_sugerencias (0054). */
export default function Sugeridas({ kiosco, onCambio }: { kiosco: Kiosco; onCambio: () => void }) {
  const [lista, setLista] = useState<Sugerencia[] | null>(null);
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [ventana, confirmar] = useConfirmar();

  async function cargar() {
    const { data, error } = await supabase.rpc("promo_sugerencias", { p_kiosco: kiosco.id });
    if (error) { setLista([]); setMsg(mensajeErrorSql(error.message, "club")); return; }
    const d = (data ?? {}) as { sugerencias?: Sugerencia[]; motivo?: string };
    setLista(d.sugerencias ?? []);
    setMotivo(d.motivo ?? "");
  }

  useEffect(() => { void cargar(); }, [kiosco.id]);

  async function descartar(s: Sugerencia) {
    setMsg("");
    setOcupado(s.clave + (s.producto_id ?? ""));
    const { error } = await supabase.rpc("promo_sugerencia_descartar", { p_kiosco: kiosco.id, p_clave: s.clave, p_producto: s.producto_id ?? null, p_dias: 14 });
    setOcupado(null);
    if (error) { setOk(false); return setMsg(mensajeErrorSql(error.message, "club")); }
    await cargar();
  }

  async function activar(s: Sugerencia) {
    setMsg("");
    setOcupado(s.clave + (s.producto_id ?? ""));
    const liquida = s.producto_id != null;
    const llamar = (confirmarMargen: boolean) => (liquida
      ? supabase.rpc("promo_liquidar_activar", { p_kiosco: kiosco.id, p_clave: s.clave, p_producto: s.producto_id, p_valor: s.valor, p_hasta: null, p_confirmar_margen: confirmarMargen })
      : supabase.rpc("promo_activar", { p_kiosco: kiosco.id, p_clave: s.clave, p_confirmar_margen: confirmarMargen }));
    let r = await llamar(false);
    if (r.error?.message.includes("promo_reduce_margen")) {
      const sigue = await confirmar({ titulo: "Baja el margen", detalle: `${s.titulo}: queda por debajo del margen mínimo de ${kiosco.club_margen_minimo ?? 20}%. ¿La activo igual?`, confirmar: "Sí, activarla", cancelar: "No, volver", peligro: true });
      if (!sigue) { setOcupado(null); return; }
      r = await llamar(true);
    }
    setOcupado(null);
    if (r.error) { setOk(false); return setMsg(mensajeErrorSql(r.error.message, "club")); }
    setOk(true);
    setMsg(`Listo: ${s.titulo} quedó activa.`);
    await cargar();
    onCambio();
  }

  if (lista === null) return null;
  return (
    <div className="card">
      {ventana}
      <h3>Sugeridas para vos</h3>
      {lista.length === 0 && <p className="mut">{motivo || "Por ahora no hay nada que sugerirte. Cuando haya algo, va a aparecer acá."}</p>}
      {lista.map((s) => (
        <div className="fila-sep" key={s.clave + (s.producto_id ?? "")}>
          <b>{s.titulo}</b>
          <p className="mut">{s.motivo}</p>
          <div className="row">
            <button type="button" disabled={ocupado !== null} onClick={() => activar(s)}>{s.boton}</button>
            <button type="button" className="sec" disabled={ocupado !== null} onClick={() => descartar(s)}>No por ahora</button>
          </div>
        </div>
      ))}
      {msg && <Aviso tipo={ok ? "ok" : "alerta"}>{msg}</Aviso>}
    </div>
  );
}
