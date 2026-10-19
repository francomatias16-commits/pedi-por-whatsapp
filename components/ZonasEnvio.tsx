"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { mensajeErrorSql } from "@/lib/errores";
import { TOPE_ZONAS, validarZona, type Zona } from "@/lib/zonas";
import { peso } from "@/lib/whatsapp";
import Aviso from "@/components/ui/Aviso";
import { useConfirmar } from "@/components/ui/Confirmar";

const VACIO = { id: null as string | null, nombre: "", descripcion: "", costo: "", minimo: "", activa: true };

// Envío por zonas (Mi negocio). Cada zona tiene su costo y su pedido mínimo; con el interruptor encendido el cliente elige una.
export default function ZonasEnvio({ kiosco, onCambio }: { kiosco: Kiosco; onCambio: () => void }) {
  const [ventana, confirmar] = useConfirmar();
  const [zonas, setZonas] = useState<Zona[] | null>(null);
  const [activo, setActivo] = useState(!!kiosco.zonas_envio_activo);
  const [f, setF] = useState(VACIO);
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from("zonas_envio").select("id,nombre,descripcion,costo,pedido_minimo,activa").eq("kiosco_id", kiosco.id).order("nombre");
    if (error) { setMsg({ tipo: "error", texto: "No pudimos cargar las zonas. Revisá la conexión." }); return; }
    setZonas((data ?? []) as Zona[]);
  }, [kiosco.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar() {
    const inv = validarZona({ nombre: f.nombre, costo: f.costo, minimo: f.minimo });
    if (inv) { setMsg({ tipo: "error", texto: mensajeErrorSql(inv) }); return; }
    setTrabajando(true); setMsg(null);
    const num = (s: string) => Number((s || "0").trim().replace(",", "."));
    const { error } = await supabase.rpc("zona_guardar", { p_kiosco: kiosco.id, p_id: f.id, p_nombre: f.nombre, p_descripcion: f.descripcion, p_costo: num(f.costo), p_minimo: num(f.minimo), p_activa: f.activa });
    setTrabajando(false);
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    setF(VACIO); setMsg({ tipo: "ok", texto: "Zona guardada." });
    await cargar(); await refrescarInterruptor();
  }
  async function quitar(z: Zona) {
    if (!(await confirmar({ titulo: `¿Quitar la zona ${z.nombre}?`, detalle: "Los pedidos que ya la usaron conservan su nombre.", confirmar: "Sí, quitar zona", peligro: true }))) return;
    const { error } = await supabase.rpc("zona_quitar", { p_kiosco: kiosco.id, p_id: z.id });
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    await cargar(); await refrescarInterruptor();
  }
  // Quitar o apagar la última zona activa apaga el interruptor en la base: se vuelve a leer.
  async function refrescarInterruptor() {
    const { data } = await supabase.from("kioscos").select("zonas_envio_activo").eq("id", kiosco.id).maybeSingle();
    setActivo(!!data?.zonas_envio_activo); kiosco.zonas_envio_activo = !!data?.zonas_envio_activo; onCambio();
  }
  async function encender(v: boolean) {
    setTrabajando(true); setMsg(null);
    const { error } = await supabase.rpc("zonas_configurar_activo", { p_kiosco: kiosco.id, p_activo: v });
    setTrabajando(false);
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    setActivo(v); kiosco.zonas_envio_activo = v; onCambio();
  }

  if (!kiosco.acepta_envio) return <p className="mut">Primero activá “Hago envíos a domicilio” en Datos del local.</p>;
  return (
    <div>
      {ventana}
      <p className="mut">Cargá las zonas a las que enviás, cada una con su costo y su pedido mínimo. Con las zonas encendidas, el cliente elige la suya al pedir y el precio se calcula solo. Apagadas, rige el costo único de Datos del local.</p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <label style={{ display: "block", margin: "8px 0" }}>
        <input type="checkbox" checked={activo} disabled={trabajando} onChange={(e) => encender(e.target.checked)} style={{ width: "auto", marginRight: 8 }} />Cobrar el envío por zonas
      </label>
      {zonas === null && <p role="status" className="mut">Cargando…</p>}
      {zonas?.length === 0 && <p className="mut">Todavía no cargaste zonas.</p>}
      {zonas?.map((z) => (
        <div className="card" key={z.id}>
          <b>{z.nombre}</b>{!z.activa && <span className="mut"> · apagada</span>}
          <div className="mut">{Number(z.costo) > 0 ? `Envío ${peso(Number(z.costo))}` : "Envío gratis"} · {Number(z.pedido_minimo) > 0 ? `mínimo ${peso(Number(z.pedido_minimo))}` : "sin mínimo"}{z.descripcion ? ` · ${z.descripcion}` : ""}</div>
          <div className="row" style={{ justifyContent: "flex-start", marginTop: 8 }}>
            <button className="sec" onClick={() => setF({ id: z.id, nombre: z.nombre, descripcion: z.descripcion ?? "", costo: String(z.costo), minimo: String(z.pedido_minimo), activa: z.activa })}>Editar</button>
            <button className="sec" onClick={() => quitar(z)}>Quitar</button>
          </div>
        </div>
      ))}
      {(zonas?.length ?? 0) < TOPE_ZONAS || f.id ? (
        <fieldset className="card">
          <legend>{f.id ? "Editar zona" : "Nueva zona"}</legend>
          <label>Nombre<input value={f.nombre} maxLength={60} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej: Centro" /></label>
          <label>Barrios o calles (opcional)<input value={f.descripcion} maxLength={200} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></label>
          <label>Costo del envío ($)<input value={f.costo} inputMode="decimal" onChange={(e) => setF({ ...f, costo: e.target.value })} placeholder="0 = gratis" /></label>
          <label>Pedido mínimo en esta zona ($)<input value={f.minimo} inputMode="decimal" onChange={(e) => setF({ ...f, minimo: e.target.value })} placeholder="0 = sin mínimo" /></label>
          <label><input type="checkbox" checked={f.activa} onChange={(e) => setF({ ...f, activa: e.target.checked })} style={{ width: "auto", marginRight: 8 }} />Zona disponible</label>
          <div className="row" style={{ justifyContent: "flex-start" }}>
            <button className="principal" disabled={trabajando} onClick={guardar}>{f.id ? "Guardar cambios" : "Agregar zona"}</button>
            {f.id && <button className="sec" onClick={() => setF(VACIO)}>Cancelar</button>}
          </div>
        </fieldset>
      ) : <p className="mut">Llegaste al máximo de {TOPE_ZONAS} zonas.</p>}
    </div>
  );
}
