"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { mensajeErrorSql } from "@/lib/errores";
import { DETALLE_ROL, ETIQUETA_ROL, esRol } from "@/lib/navegacion";
import { tokenValido } from "@/lib/equipo";
import Aviso from "@/components/ui/Aviso";

export const CLAVE_INVITACION = "pdw-invitacion";
type Datos = { rol: string; nombre: string };

// Pantalla a la que llega alguien con el enlace de invitación: entra con Google, ve a qué local lo invitaron y acepta.
export default function Unirse({ token }: { token: string }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [cargando, setCargando] = useState(true);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [listo, setListo] = useState(false);
  const formatoOk = tokenValido(token);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setCargando(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !formatoOk) return;
    let vivo = true;
    supabase.rpc("equipo_ver_invitacion", { p_token: token }).then(({ data, error: e }) => {
      if (!vivo) return;
      if (e) { setError(mensajeErrorSql(e.message)); try { localStorage.removeItem(CLAVE_INVITACION); } catch { /* sin almacenamiento */ } return; }
      setDatos(data as Datos);
    });
    return () => { vivo = false; };
  }, [session, token, formatoOk]);

  async function entrar() {
    setError(""); setTrabajando(true);
    // Se recuerda la invitación y se vuelve a /panel (la dirección que ya acepta Google); el panel te trae de vuelta acá.
    try { localStorage.setItem(CLAVE_INVITACION, token); } catch { /* sin almacenamiento: hay que volver a abrir el enlace */ }
    try {
      const { error: e } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/panel` } });
      if (e) throw e;
    } catch {
      setTrabajando(false);
      setError("No pudimos abrir Google. Revisá tu conexión a internet y tocá el botón de nuevo.");
    }
  }

  async function aceptar() {
    setError(""); setTrabajando(true);
    const { error: e } = await supabase.rpc("equipo_aceptar", { p_token: token });
    setTrabajando(false);
    try { localStorage.removeItem(CLAVE_INVITACION); } catch { /* sin almacenamiento */ }
    if (e) { setError(mensajeErrorSql(e.message)); return; }
    setListo(true);
    setTimeout(() => router.replace("/panel"), 1200);
  }

  const caja = (hijos: React.ReactNode) => (
    <div className="login-wrap"><div className="card login-card">{hijos}</div></div>
  );

  if (!formatoOk) return caja(<><h1>Invitación no válida</h1><Aviso tipo="error">Este enlace está incompleto. Pedile al dueño que te mande uno nuevo.</Aviso><Link href="/" className="volver">Ir al inicio</Link></>);
  if (cargando) return caja(<p role="status" className="mut">Cargando…</p>);

  if (!session) return caja(
    <>
      <h1>Te invitaron a un kiosco</h1>
      <p className="mut login-sub">Para aceptar la invitación, entrá con tu cuenta de Google. Después vas a ver a qué local te invitaron antes de confirmar.</p>
      <button type="button" className="btn-google" onClick={entrar} disabled={trabajando}>{trabajando ? "Abriendo Google…" : "Continuar con Google"}</button>
      {error && <Aviso tipo="error">{error}</Aviso>}
    </>
  );

  if (listo) return caja(<><h1>Listo</h1><Aviso tipo="ok">Ya sos parte del equipo. Te llevamos al panel…</Aviso></>);
  if (error && !datos) return caja(<><h1>No pudimos usar esta invitación</h1><Aviso tipo="error">{error}</Aviso><Link href="/panel" className="volver">Ir al panel</Link></>);
  if (!datos) return caja(<p role="status" className="mut">Revisando la invitación…</p>);

  const rol = esRol(datos.rol) ? datos.rol : null;
  return caja(
    <>
      <h1>Te invitaron a {datos.nombre}</h1>
      <p>Vas a entrar como <b>{rol ? ETIQUETA_ROL[rol].toLowerCase() : datos.rol}</b>. {rol ? DETALLE_ROL[rol] : ""}</p>
      <p className="mut">Vas a entrar con la cuenta {session.user.email}. Cada cuenta puede estar en un solo local.</p>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <button type="button" className="principal" onClick={aceptar} disabled={trabajando}>{trabajando ? "Entrando…" : "Aceptar e ingresar"}</button>
      <Link href="/" className="volver">No, gracias</Link>
    </>
  );
}
