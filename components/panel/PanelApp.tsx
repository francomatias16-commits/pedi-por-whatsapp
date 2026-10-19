"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Kiosco } from "@/lib/supabase";
import { rutaLegacy, esRol, type Rol } from "@/lib/navegacion";
import { CLAVE_INVITACION } from "./Unirse";
import { tokenValido } from "@/lib/equipo";
import Login from "./Login";
import CrearKiosco from "./CrearKiosco";
import Dueno from "./Dueno";

// Se monta una sola vez en app/panel/layout.tsx: al pasar de /panel/pedidos a /panel/productos no se vuelve a cargar la sesión ni el kiosco.
export default function PanelApp() {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [cargando, setCargando] = useState(true);
  const [kiosco, setKiosco] = useState<Kiosco | null>(null);
  const [rol, setRol] = useState<Rol>("dueno");
  const [buscando, setBuscando] = useState(true);

  // Links viejos de avisos (/panel?tab=reponer) → ruta nueva.
  useEffect(() => {
    if (pathname !== "/panel") return;
    const r = rutaLegacy(location.search);
    if (r) router.replace(r);
  }, [pathname, router]);

  // Si venías de un enlace de invitación (entraste con Google y volviste acá), seguís con la invitación.
  useEffect(() => {
    if (!session) return;
    let t: string | null = null;
    try { t = localStorage.getItem(CLAVE_INVITACION); } catch { t = null; }
    if (tokenValido(t)) router.replace(`/unirse/${t}`);
  }, [session, router]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setCargando(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Quién sos y de qué local: primero la membresía (kiosco_miembros, que cada persona lee solo la suya); si no hay, el local que creaste.
  const cargarKiosco = useCallback(async () => {
    if (!session) return;
    const COLUMNAS = "id,nombre,slug,whatsapp,direccion,acepta_envio,sellos_por_premio,premio,abierto,horario,pedido_minimo,costo_envio,medios_pago,horario_auto,horarios,baja_solicitada_at,cobro_online_activo,seguimiento_activo,zonas_envio_activo,fotos_auto_activo";
    const { data: m } = await supabase.from("kiosco_miembros").select("kiosco_id,rol").eq("user_id", session.user.id).eq("activo", true).maybeSingle();
    if (m && esRol(m.rol)) {
      const { data } = await supabase.from("kioscos").select(COLUMNAS).eq("id", m.kiosco_id).maybeSingle();
      if (data) { setRol(m.rol); setKiosco(data as Kiosco); setBuscando(false); return; }
    }
    const { data } = await supabase.from("kioscos").select(COLUMNAS).eq("owner_id", session.user.id).maybeSingle();
    setRol("dueno"); setKiosco((data as Kiosco) ?? null); setBuscando(false);
  }, [session]);
  useEffect(() => { cargarKiosco(); }, [cargarKiosco]);

  if (cargando) return <div className="login-wrap" aria-busy="true" aria-label="Cargando"><div className="card login-card"><div className="esq esq-t" /><div className="esq" /><div className="esq esq-b" /></div></div>;
  if (!session) return <Login />;
  if (buscando) return <div className="login-wrap" aria-busy="true" aria-label="Cargando"><div className="card login-card"><div className="esq esq-t" /><div className="esq" /><div className="esq esq-b" /></div></div>;
  if (!kiosco) return <CrearKiosco userId={session.user.id} onListo={cargarKiosco} />;
  return <Dueno kiosco={kiosco} rol={rol} recargar={cargarKiosco} />;
}
