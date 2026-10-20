"use client";
import { useCallback, useEffect, useState } from "react";
import type { Kiosco } from "@/lib/supabase";
import { cuitValido, formatoCuit, limpiarCuit } from "@/lib/arca/comun";
import { jsonArca, llamarArca, textoErrorArca } from "@/lib/arca/cliente";
import Aviso from "@/components/ui/Aviso";

type Config = { cuit: string; razon_social: string; domicilio: string; punto_venta: number; condicion_iva: "monotributo" | "exento"; inicio_actividades: string | null; activo: boolean; estado_delegacion: "pendiente" | "activa" | "rechazada"; delegacion_verificada_at: string | null; delegacion_error: string | null };
type Estado = { proveedor_cuit: string | null; ambiente: "homologacion" | "produccion"; config: Config | null };
type Msg = { tipo: "ok" | "error" | "alerta"; texto: string } | null;

// Facturación electrónica (Factura C): datos fiscales del local y conexión con ARCA. Solo el dueño.
export default function FacturacionArca({ kiosco }: { kiosco: Kiosco }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cuit, setCuit] = useState("");
  const [razon, setRazon] = useState("");
  const [dom, setDom] = useState(kiosco.direccion ?? "");
  const [pto, setPto] = useState("");
  const [cond, setCond] = useState<"monotributo" | "exento">("monotributo");
  const [inicio, setInicio] = useState("");
  const [editando, setEditando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const aplicar = (e: Estado) => {
    setEstado(e);
    const c = e.config;
    if (c) { setCuit(formatoCuit(c.cuit)); setRazon(c.razon_social); setDom(c.domicilio); setPto(String(c.punto_venta)); setCond(c.condicion_iva); setInicio(c.inicio_actividades ?? ""); }
  };
  const cargar = useCallback(async () => {
    const { ok, r } = await llamarArca("/api/arca/config", kiosco.id);
    const j = await jsonArca(r);
    if (!ok) { setMsg({ tipo: "error", texto: textoErrorArca(j.error) }); return; }
    aplicar(j as unknown as Estado);
  }, [kiosco.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const valido = cuitValido(cuit) && razon.trim().length >= 2 && dom.trim().length >= 3 && Number.isInteger(Number(pto)) && Number(pto) >= 1 && Number(pto) <= 99998;

  async function guardar() {
    setTrabajando(true); setMsg(null);
    const { ok, r } = await llamarArca("/api/arca/config", kiosco.id, { guardar: true, cuit: limpiarCuit(cuit), razon_social: razon.trim(), domicilio: dom.trim(), punto_venta: Number(pto), condicion_iva: cond, inicio_actividades: inicio || null });
    const j = await jsonArca(r);
    setTrabajando(false);
    if (!ok) { setMsg({ tipo: "error", texto: textoErrorArca(j.error) }); return; }
    aplicar(j as unknown as Estado); setEditando(false);
    setMsg({ tipo: "ok", texto: "Datos guardados. Ahora seguí con el paso 2 para conectar con ARCA." });
  }

  async function verificar() {
    setTrabajando(true); setMsg(null);
    const { ok, r } = await llamarArca("/api/arca/verificar", kiosco.id);
    const j = await jsonArca(r);
    setTrabajando(false);
    if (!ok) setMsg({ tipo: "error", texto: textoErrorArca(j.error, j.detalle) });
    else if (j.estado === "activa") setMsg({ tipo: "ok", texto: "Listo. La conexión con ARCA funciona y ya podés facturar desde la caja." });
    else setMsg({ tipo: j.estado === "pendiente" ? "alerta" : "error", texto: String(j.mensaje ?? "No se pudo verificar.") });
    await cargar();
  }

  async function apagar() {
    setTrabajando(true); setMsg(null);
    const { ok, r } = await llamarArca("/api/arca/config", kiosco.id, { apagar: true });
    const j = await jsonArca(r);
    setTrabajando(false);
    if (!ok) { setMsg({ tipo: "error", texto: textoErrorArca(j.error) }); return; }
    aplicar(j as unknown as Estado);
    setMsg({ tipo: "ok", texto: "La facturación quedó apagada. Podés volver a activarla verificando la conexión." });
  }

  if (!estado) return <>{msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : <p role="status" className="mut">Cargando…</p>}</>;
  const c = estado.config;
  const formulario = !c || editando;
  const prueba = estado.ambiente === "homologacion";

  return (
    <div>
      <p className="mut">Emití Factura C a tus clientes desde la caja, con su comprobante en PDF y código QR. Las devoluciones generan la nota de crédito. Sirve para monotributistas y exentos.</p>
      {prueba && <Aviso tipo="alerta">Estás en modo de prueba: los comprobantes no tienen validez fiscal.</Aviso>}
      {!estado.proveedor_cuit && <Aviso tipo="error">El servicio de facturación todavía no está listo en el servidor. Avisanos para activarlo.</Aviso>}

      <h3>1. Datos de tu local</h3>
      {formulario ? (
        <div>
          <label>CUIT<input inputMode="numeric" value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="20-12345678-6" autoComplete="off" /></label>
          {cuit && !cuitValido(cuit) && <p className="error" role="alert">Ese CUIT no es válido.</p>}
          <label>Razón social<input value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Como figura en ARCA" maxLength={120} /></label>
          <label>Domicilio fiscal<input value={dom} onChange={(e) => setDom(e.target.value)} maxLength={200} autoComplete="street-address" /></label>
          <label>Punto de venta<input inputMode="numeric" value={pto} onChange={(e) => setPto(e.target.value.replace(/\D/g, ""))} placeholder="Ej.: 2" /></label>
          <p className="mut">Tiene que estar dado de alta en ARCA como “Factura Electrónica - Web Services”. Si no lo tenés, en ARCA entrá a <b>Administración de puntos de venta y domicilios</b> y creá uno.</p>
          <label>Condición frente al IVA
            <select value={cond} onChange={(e) => setCond(e.target.value as typeof cond)}><option value="monotributo">Responsable Monotributo</option><option value="exento">IVA Exento</option></select>
          </label>
          <label>Inicio de actividades (opcional)<input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
          <div className="acciones">
            <button onClick={guardar} disabled={!valido || trabajando}>{trabajando ? "Guardando…" : "Guardar datos"}</button>
            {c && <button className="sec" onClick={() => { setEditando(false); aplicar(estado); }}>Cancelar</button>}
          </div>
        </div>
      ) : c && (
        <div className="card" role="group" aria-label="Datos fiscales">
          <p style={{ marginTop: 0 }}><b>{c.razon_social}</b> · CUIT {formatoCuit(c.cuit)} · punto de venta {String(c.punto_venta).padStart(5, "0")}</p>
          <p className="mut" style={{ margin: 0 }}>{c.domicilio} · {c.condicion_iva === "exento" ? "IVA Exento" : "Responsable Monotributo"}</p>
          <div className="acciones"><button className="sec" onClick={() => setEditando(true)}>Cambiar datos</button></div>
          {editando === false && <p className="mut">Si cambiás el CUIT o el punto de venta, hay que volver a verificar la conexión.</p>}
        </div>
      )}

      {c && (
        <>
          <h3>2. Conectar con ARCA</h3>
          {c.estado_delegacion === "activa" && c.activo ? (
            <Aviso tipo="ok">Conectado con ARCA. Ya podés facturar desde la caja.</Aviso>
          ) : (
            <>
              <p>Para que podamos emitir facturas a tu nombre, tenés que autorizar nuestro servicio una sola vez en ARCA:</p>
              <ol>
                <li>Entrá a <b>arca.gob.ar</b> con tu CUIT y clave fiscal.</li>
                <li>Abrí <b>Administrador de Relaciones de Clave Fiscal</b> y tocá <b>Nueva relación</b>.</li>
                <li>En servicio elegí <b>ARCA &gt; WebServices &gt; Facturación Electrónica</b> (WSFE).</li>
                <li>En representante poné el CUIT <b>{estado.proveedor_cuit ? formatoCuit(estado.proveedor_cuit) : "(todavía sin definir)"}</b> y confirmá.</li>
                <li>Volvé acá y tocá <b>Verificar conexión</b>. Puede tardar unos minutos en aplicarse.</li>
              </ol>
              {c.estado_delegacion === "rechazada" && c.delegacion_error && <Aviso tipo="error">{c.delegacion_error}</Aviso>}
              {c.estado_delegacion === "pendiente" && c.delegacion_error && <Aviso tipo="alerta">{c.delegacion_error}</Aviso>}
            </>
          )}
          <div className="acciones">
            <button onClick={verificar} disabled={trabajando || !estado.proveedor_cuit}>{trabajando ? "Verificando…" : "Verificar conexión"}</button>
            {c.activo && <button className="sec" onClick={apagar} disabled={trabajando}>Apagar facturación</button>}
          </div>
        </>
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </div>
  );
}
