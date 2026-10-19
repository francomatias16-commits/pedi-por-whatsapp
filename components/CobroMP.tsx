"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { mensajeErrorSql } from "@/lib/errores";
import Aviso from "@/components/ui/Aviso";
import CobroQR from "@/components/CobroQR";
import { useConfirmar } from "@/components/ui/Confirmar";

type Estado = { conectada: boolean; activa?: boolean; cobro_online_activo: boolean; mp_user_id?: string; token_ultimos4?: string | null; sin_secreto?: boolean; pendientes?: number };
const ERRORES: Record<string, string> = {
  no_autorizado: "Tu sesión venció. Volvé a entrar al panel.",
  token_invalido: "El Access Token no tiene el formato correcto. Copialo completo, empieza con APP_USR- o TEST-.",
  secreto_invalido: "Pegá la clave secreta de las notificaciones (Webhooks). Tiene que tener al menos 8 caracteres.",
  token_rechazado: "Mercado Pago no aceptó ese Access Token. Revisá que sea el de producción y que esté completo.",
  mp_no_responde: "Mercado Pago no responde ahora. Probá de nuevo en un momento.",
  cuenta_otro_pais: "Esa cuenta de Mercado Pago no es de Argentina. Los cobros son en pesos argentinos.",
  servidor_sin_clave: "Falta una configuración del servidor para guardar la credencial. Avisanos.",
  db: "No se pudo guardar. Probá de nuevo.",
};

// Cobrar con Mercado Pago: el cliente paga al pedir y la plata va directo a la cuenta de Mercado Pago del local.
export default function CobroMP({ kiosco, onCambio }: { kiosco: Kiosco; onCambio: () => void }) {
  const [ventana, confirmar] = useConfirmar();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [token, setToken] = useState("");
  const [secreto, setSecreto] = useState("");
  const [editando, setEditando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error" | "alerta"; texto: string } | null>(null);
  const [urlAviso, setUrlAviso] = useState("");
  useEffect(() => { setUrlAviso(`${window.location.origin}/api/pagos/mp/webhook?kiosco=${kiosco.id}`); }, [kiosco.id]);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("mp_estado_conexion", { p_kiosco: kiosco.id });
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    setEstado(data as Estado);
  }, [kiosco.id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function llamar(ruta: string, cuerpo: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` }, body: JSON.stringify({ kiosco: kiosco.id, ...cuerpo }) });
    return { ok: r.ok, j: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async function conectar() {
    setTrabajando(true); setMsg(null);
    const { ok, j } = await llamar("/api/pagos/mp/conectar", { token: token.trim(), webhook_secret: secreto.trim() });
    setTrabajando(false);
    if (!ok) { setMsg({ tipo: "error", texto: ERRORES[j.error as string] ?? "No se pudo conectar. Probá de nuevo." }); return; }
    setToken(""); setSecreto(""); setEditando(false);
    setMsg({ tipo: "ok", texto: "Listo. Mercado Pago quedó conectado y tu tienda ya cobra online." });
    await cargar(); onCambio();
  }

  async function probar() {
    setTrabajando(true); setMsg(null);
    const { ok, j } = await llamar("/api/pagos/mp/probar", {});
    setTrabajando(false);
    if (!ok) { setMsg({ tipo: "error", texto: ERRORES[j.error as string] ?? "No se pudo probar la conexión." }); return; }
    if (j.ok) setMsg({ tipo: "ok", texto: `La conexión funciona. Cuenta de Mercado Pago ${j.cuenta ?? j.mp_user_id}.` });
    else if (j.motivo === "token_invalido") setMsg({ tipo: "error", texto: "Mercado Pago rechazó tu credencial (la revocaste o venció). Apagamos el cobro online: conectala de nuevo." });
    else if (j.motivo === "sin_conexion") setMsg({ tipo: "alerta", texto: "Todavía no conectaste Mercado Pago." });
    else setMsg({ tipo: "alerta", texto: "Mercado Pago no responde ahora. Probá de nuevo en un momento." });
    await cargar(); onCambio();
  }

  async function desconectar() {
    const pend = estado?.pendientes ?? 0;
    const si = await confirmar({
      titulo: "¿Desconectar Mercado Pago?",
      detalle: pend > 0 ? `Hay ${pend} pedido(s) esperando pago. Si los clientes pagan después, vas a tener que revisarlos a mano en Mercado Pago. Tu tienda deja de cobrar online.` : "Tu tienda deja de cobrar online. Borramos tu credencial guardada.",
      confirmar: "Sí, desconectar", cancelar: "No, volver", peligro: true,
    });
    if (!si) return;
    setTrabajando(true); setMsg(null);
    const { error } = await supabase.rpc("mp_desconectar", { p_kiosco: kiosco.id });
    setTrabajando(false);
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    setMsg({ tipo: "ok", texto: "Mercado Pago se desconectó." });
    await cargar(); onCambio();
  }

  async function encender(v: boolean) {
    setTrabajando(true); setMsg(null);
    const { error } = await supabase.from("kioscos").update({ cobro_online_activo: v }).eq("id", kiosco.id);
    setTrabajando(false);
    if (error) { setMsg({ tipo: "error", texto: "No se pudo cambiar. Probá de nuevo." }); return; }
    await cargar(); onCambio();
  }

  if (!estado) return <>{msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : <p role="status" className="mut">Cargando…</p>}</>;
  const formulario = !estado.conectada || editando;

  return (
    <div>
      {ventana}
      <p className="mut">Tus clientes pagan al hacer el pedido y la plata va directo a tu cuenta de Mercado Pago. El pedido te llega cuando el pago se aprueba. Mercado Pago cobra su comisión de cada venta.</p>

      {estado.conectada && (
        <div className="card" role="group" aria-label="Estado de la conexión">
          <p style={{ marginTop: 0 }}><b>{estado.activa ? "Conectado" : "Conexión caída"}</b> · cuenta N° {estado.mp_user_id}{estado.token_ultimos4 ? ` · Access Token ••••${estado.token_ultimos4}` : ""}</p>
          {!estado.activa && <Aviso tipo="error">Mercado Pago rechazó tu credencial. Cargala de nuevo para volver a cobrar online.</Aviso>}
          {estado.sin_secreto && <Aviso tipo="alerta">Falta la clave secreta de las notificaciones. Sin ella no se pueden confirmar los pagos.</Aviso>}
          {(estado.pendientes ?? 0) > 0 && <p className="mut">Pedidos esperando pago: {estado.pendientes}.</p>}
          {estado.activa && (
            <label>
              <input type="checkbox" checked={estado.cobro_online_activo} disabled={trabajando} onChange={(e) => encender(e.target.checked)} style={{ width: "auto", marginRight: 8 }} />
              Cobrar online en mi tienda
            </label>
          )}
          <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" className="sec" onClick={probar} disabled={trabajando}>Probar la conexión</button>
            <button type="button" className="sec" onClick={() => setEditando(!editando)} disabled={trabajando}>{editando ? "No cambiar" : "Cambiar credenciales"}</button>
            <button type="button" className="peligro" onClick={desconectar} disabled={trabajando}>Desconectar</button>
          </div>
        </div>
      )}

      {formulario && (
        <>
          <h3>{estado.conectada ? "Cargar credenciales nuevas" : "Conectar en 4 pasos"}</h3>
          <ol style={{ paddingLeft: 20 }}>
            <li>Entrá a <b>mercadopago.com.ar/developers</b> con tu cuenta y creá una aplicación de pagos online (Checkout Pro).</li>
            <li>En las credenciales de <b>producción</b>, copiá el <b>Access Token</b>.</li>
            <li>En <b>Webhooks</b> (notificaciones), cargá esta dirección, elegí los eventos <b>Pagos</b> y <b>Order (Mercado Pago)</b> (este segundo es para cobrar con QR en el mostrador) y copiá la <b>clave secreta</b> que te da Mercado Pago:
              <input readOnly value={urlAviso} onFocus={(e) => e.currentTarget.select()} aria-label="Dirección para las notificaciones" />
            </li>
            <li>Pegá las dos cosas acá abajo y tocá <b>Conectar</b>.</li>
          </ol>
          <label>Access Token
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder="APP_USR-…" />
          </label>
          <label>Clave secreta de las notificaciones
            <input type="password" value={secreto} onChange={(e) => setSecreto(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <button type="button" className="principal" onClick={conectar} disabled={trabajando || token.trim().length < 20 || secreto.trim().length < 8}>{trabajando ? "Conectando…" : "Conectar Mercado Pago"}</button>
          <p className="mut">Guardamos tus datos cifrados y nunca los volvemos a mostrar completos.</p>
        </>
      )}

      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <p className="mut">Si cancelás un pedido que ya está pagado, el reembolso lo hacés vos desde tu cuenta de Mercado Pago.</p>

      {estado.conectada && estado.activa && !formulario && (
        <>
          <h3>QR en el mostrador</h3>
          <CobroQR kiosco={kiosco} onCambio={onCambio} />
        </>
      )}
    </div>
  );
}
