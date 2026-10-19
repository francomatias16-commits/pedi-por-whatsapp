"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { mensajeErrorSql } from "@/lib/errores";
import { TOPE_FRANJAS, etiquetaFranja, horaCorta, validarFranja, type Franja } from "@/lib/franjas";
import Aviso from "@/components/ui/Aviso";
import { useConfirmar } from "@/components/ui/Confirmar";

const VACIO = { id: null as string | null, nombre: "", desde: "", hasta: "", activa: true };

// Ventana de entrega (Mi negocio). El local carga franjas horarias; con el interruptor encendido, quien pide envío elige una.
export default function FranjasEntrega({ kiosco, onCambio }: { kiosco: Kiosco; onCambio: () => void }) {
  const [ventana, confirmar] = useConfirmar();
  const [franjas, setFranjas] = useState<Franja[] | null>(null);
  const [activo, setActivo] = useState(!!kiosco.franjas_entrega_activo);
  const [f, setF] = useState(VACIO);
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from("franjas_entrega").select("id,nombre,desde,hasta,activa").eq("kiosco_id", kiosco.id).order("desde").order("nombre");
    if (error) { setMsg({ tipo: "error", texto: "No pudimos cargar las franjas. Revisá la conexión." }); return; }
    setFranjas((data ?? []) as Franja[]);
  }, [kiosco.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  // Quitar o apagar la última franja activa apaga el interruptor en la base: se vuelve a leer.
  async function refrescarInterruptor() {
    const { data } = await supabase.from("kioscos").select("franjas_entrega_activo").eq("id", kiosco.id).maybeSingle();
    setActivo(!!data?.franjas_entrega_activo); kiosco.franjas_entrega_activo = !!data?.franjas_entrega_activo; onCambio();
  }
  async function guardar() {
    const inv = validarFranja(f);
    if (inv) { setMsg({ tipo: "error", texto: mensajeErrorSql(inv) }); return; }
    setTrabajando(true); setMsg(null);
    const { error } = await supabase.rpc("franja_guardar", { p_kiosco: kiosco.id, p_id: f.id, p_nombre: f.nombre, p_desde: f.desde, p_hasta: f.hasta, p_activa: f.activa });
    setTrabajando(false);
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    setF(VACIO); setMsg({ tipo: "ok", texto: "Franja guardada." });
    await cargar(); await refrescarInterruptor();
  }
  async function quitar(x: Franja) {
    if (!(await confirmar({ titulo: `¿Quitar la franja ${x.nombre}?`, detalle: "Los pedidos que ya la eligieron conservan su texto.", confirmar: "Sí, quitar franja", peligro: true }))) return;
    const { error } = await supabase.rpc("franja_quitar", { p_kiosco: kiosco.id, p_id: x.id });
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    await cargar(); await refrescarInterruptor();
  }
  async function encender(v: boolean) {
    setTrabajando(true); setMsg(null);
    const { error } = await supabase.rpc("franjas_configurar_activo", { p_kiosco: kiosco.id, p_activo: v });
    setTrabajando(false);
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    setActivo(v); kiosco.franjas_entrega_activo = v; onCambio();
  }

  if (!kiosco.acepta_envio) return <p className="mut">Primero activá “Hago envíos a domicilio” en Datos del local.</p>;
  return (
    <div>
      {ventana}
      <p className="mut">Cargá las franjas en las que entregás (por ejemplo, Mañana de 9 a 13). Con las franjas encendidas, quien pide envío elige una y vos la ves en el pedido. Es la preferencia del cliente: no se controla contra la hora ni contra tu horario de atención.</p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <label style={{ display: "block", margin: "8px 0" }}>
        <input type="checkbox" checked={activo} disabled={trabajando} onChange={(e) => encender(e.target.checked)} style={{ width: "auto", marginRight: 8 }} />Pedir al cliente que elija una franja de entrega
      </label>
      {franjas === null && <p role="status" className="mut">Cargando…</p>}
      {franjas?.length === 0 && <p className="mut">Todavía no cargaste franjas.</p>}
      {franjas?.map((x) => (
        <div className="card" key={x.id}>
          <b>{etiquetaFranja(x)}</b>{!x.activa && <span className="mut"> · apagada</span>}
          <div className="row" style={{ justifyContent: "flex-start", marginTop: 8 }}>
            <button className="sec" onClick={() => setF({ id: x.id, nombre: x.nombre, desde: horaCorta(x.desde).padStart(5, "0"), hasta: horaCorta(x.hasta).padStart(5, "0"), activa: x.activa })}>Editar</button>
            <button className="sec" onClick={() => quitar(x)}>Quitar</button>
          </div>
        </div>
      ))}
      {(franjas?.length ?? 0) < TOPE_FRANJAS || f.id ? (
        <fieldset className="card">
          <legend>{f.id ? "Editar franja" : "Nueva franja"}</legend>
          <label>Nombre<input value={f.nombre} maxLength={40} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej: Mañana" /></label>
          <label>Desde<input type="time" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></label>
          <label>Hasta<input type="time" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></label>
          <label><input type="checkbox" checked={f.activa} onChange={(e) => setF({ ...f, activa: e.target.checked })} style={{ width: "auto", marginRight: 8 }} />Franja disponible</label>
          <div className="row" style={{ justifyContent: "flex-start" }}>
            <button className="principal" disabled={trabajando} onClick={guardar}>{f.id ? "Guardar cambios" : "Agregar franja"}</button>
            {f.id && <button className="sec" onClick={() => setF(VACIO)}>Cancelar</button>}
          </div>
        </fieldset>
      ) : <p className="mut">Llegaste al máximo de {TOPE_FRANJAS} franjas.</p>}
    </div>
  );
}
