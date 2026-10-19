"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { mensajeErrorSql } from "@/lib/errores";
import { DETALLE_ROL, ETIQUETA_ROL, type Rol } from "@/lib/navegacion";
import { diasRestantes, linkInvitacion, mensajeInvitacion, ordenarMiembros, type Invitacion, type Miembro } from "@/lib/equipo";
import Aviso from "@/components/ui/Aviso";
import { useConfirmar } from "@/components/ui/Confirmar";

type RolInvitable = Exclude<Rol, "dueno">;
type Lista = { miembros: Miembro[]; invitaciones: Invitacion[] };
type Nueva = { link: string; rol: RolInvitable };

// Mi equipo (solo el dueño): invita por enlace de un solo uso, cambia el rol o quita a alguien. El enlace se muestra una sola vez.
export default function Equipo({ kiosco }: { kiosco: Kiosco }) {
  const [ventana, confirmar] = useConfirmar();
  const [lista, setLista] = useState<Lista | null>(null);
  const [rol, setRol] = useState<RolInvitable>("cajero");
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [nueva, setNueva] = useState<Nueva | null>(null);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("equipo_listar", { p_kiosco: kiosco.id });
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    setLista(data as Lista);
  }, [kiosco.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function accion(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setTrabajando(true); setMsg(null);
    const { error } = await fn();
    setTrabajando(false);
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return false; }
    setMsg({ tipo: "ok", texto: ok }); await cargar(); return true;
  }

  async function invitar() {
    setTrabajando(true); setMsg(null); setNueva(null); setCopiado(false);
    const { data, error } = await supabase.rpc("equipo_invitar", { p_kiosco: kiosco.id, p_rol: rol });
    setTrabajando(false);
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    const t = (data as { token: string }).token;
    setNueva({ link: linkInvitacion(window.location.origin, t), rol });
    await cargar();
  }

  async function copiar() {
    if (!nueva) return;
    try { await navigator.clipboard.writeText(nueva.link); setCopiado(true); } catch { setMsg({ tipo: "error", texto: "No pudimos copiar. Mantené apretado el enlace para copiarlo a mano." }); }
  }

  async function quitar(m: Miembro) {
    if (!(await confirmar({ titulo: `¿Quitar a ${m.email ?? "esta persona"}?`, detalle: "Pierde el acceso al local en el acto. Sus ventas anteriores quedan registradas.", confirmar: "Sí, quitar", peligro: true }))) return;
    await accion(() => supabase.rpc("equipo_quitar", { p_kiosco: kiosco.id, p_user: m.user_id }), "Listo, ya no tiene acceso.");
  }

  if (!lista) return <>{msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : <p role="status" className="mut">Cargando…</p>}</>;
  const miembros = ordenarMiembros(lista.miembros).filter((m) => m.activo);

  return (
    <div>
      {ventana}
      <p className="mut">Cada persona entra con su propia cuenta de Google y ve solo lo que le toca. Así sabés quién hizo cada venta.</p>
      <ul className="mut" style={{ paddingLeft: 20 }}>
        {(["cajero", "encargado", "dueno"] as Rol[]).map((r) => <li key={r}><b>{ETIQUETA_ROL[r]}:</b> {DETALLE_ROL[r]}</li>)}
      </ul>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}

      <h3>Quiénes trabajan acá</h3>
      {miembros.map((m) => (
        <div className="card row" key={m.user_id} style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span><b>{m.email ?? "Sin mail"}</b><br /><span className="mut">{m.rol === "dueno" ? "Dueño de la cuenta" : ETIQUETA_ROL[m.rol]}</span></span>
          {m.rol !== "dueno" && (
            <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <label style={{ margin: 0 }}><span className="sr-only">Rol de {m.email}</span>
                <select value={m.rol} disabled={trabajando} onChange={(e) => accion(() => supabase.rpc("equipo_cambiar_rol", { p_kiosco: kiosco.id, p_user: m.user_id, p_rol: e.target.value }), "Rol cambiado.")}>
                  <option value="cajero">Cajero</option><option value="encargado">Encargado</option>
                </select>
              </label>
              <button type="button" className="peligro" disabled={trabajando} onClick={() => quitar(m)}>Quitar</button>
            </span>
          )}
        </div>
      ))}

      <h3>Invitar a alguien</h3>
      <label>¿Qué rol va a tener?
        <select value={rol} onChange={(e) => { setRol(e.target.value as RolInvitable); setNueva(null); }}>
          <option value="cajero">Cajero</option><option value="encargado">Encargado</option>
        </select>
      </label>
      <button type="button" className="principal" onClick={invitar} disabled={trabajando}>{trabajando ? "Creando…" : "Crear enlace de invitación"}</button>

      {nueva && (
        <div className="card" role="group" aria-label="Enlace de invitación">
          <p style={{ marginTop: 0 }}><b>Enlace para un {ETIQUETA_ROL[nueva.rol].toLowerCase()}</b>. Sirve una sola vez y vence en 7 días. Copialo ahora: después no se puede volver a ver.</p>
          <input readOnly value={nueva.link} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de invitación" />
          <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" className="sec" onClick={copiar}>{copiado ? "Copiado" : "Copiar enlace"}</button>
            <a className="btn sec" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(mensajeInvitacion(kiosco.nombre, nueva.rol, nueva.link))}`}>Mandar por WhatsApp</a>
          </div>
        </div>
      )}

      {lista.invitaciones.length > 0 && (
        <>
          <h3>Invitaciones sin usar</h3>
          {lista.invitaciones.map((i) => (
            <div className="card row" key={i.id} style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span>{ETIQUETA_ROL[i.rol]} · <span className="mut">vence en {diasRestantes(i.expira_at)} {diasRestantes(i.expira_at) === 1 ? "día" : "días"}</span></span>
              <button type="button" className="sec" disabled={trabajando} onClick={() => accion(() => supabase.rpc("equipo_revocar_invitacion", { p_invitacion: i.id }), "Invitación cancelada.")}>Cancelar</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
