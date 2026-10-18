"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Kiosco } from "@/lib/supabase";
import { rutaLegacy } from "@/lib/navegacion";
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

  // Links viejos de avisos (/panel?tab=reponer) → ruta nueva.
  useEffect(() => {
    if (pathname !== "/panel") return;
    const r = rutaLegacy(location.search);
    if (r) router.replace(r);
  }, [pathname, router]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setCargando(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const cargarKiosco = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase.from("kioscos").select("id,nombre,slug,whatsapp,direccion,acepta_envio,sellos_por_premio,premio,abierto,horario,pedido_minimo,costo_envio,medios_pago,horario_auto,horarios").eq("owner_id", session.user.id).maybeSingle();
    setKiosco((data as Kiosco) ?? null);
  }, [session]);
  useEffect(() => { cargarKiosco(); }, [cargarKiosco]);

  if (cargando) return <div className="login-wrap" aria-busy="true" aria-label="Cargando"><div className="card login-card"><div className="esq esq-t" /><div className="esq" /><div className="esq esq-b" /></div></div>;
  if (!session) return <Login />;
  if (!kiosco) return <CrearKiosco userId={session.user.id} onListo={cargarKiosco} />;
  return <Dueno kiosco={kiosco} recargar={cargarKiosco} />;
}
