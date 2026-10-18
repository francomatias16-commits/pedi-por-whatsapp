"use client";
import { useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { suscripcionValida } from "@/lib/push";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
type Estado = "cargando" | "no_soportado" | "sin_clave" | "bloqueado" | "inactivo" | "activo";

// La clave pública VAPID viene en base64url; el navegador la pide como bytes.
function aBytes(b64: string): BufferSource {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export default function Avisos({ kiosco, soloPendiente = false }: { kiosco: Kiosco; soloPendiente?: boolean }) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setEstado("no_soportado");
      if (!VAPID) return setEstado("sin_clave");
      if (Notification.permission === "denied") return setEstado("bloqueado");
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      setEstado(sub ? "activo" : "inactivo");
    })();
  }, []);

  async function activar() {
    setMsg("");
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") return setEstado(permiso === "denied" ? "bloqueado" : "inactivo");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(VAPID) });
      const j = sub.toJSON();
      if (!suscripcionValida(j as Parameters<typeof suscripcionValida>[0])) { setMsg("No pudimos activar los avisos en este navegador."); return; }
      const { error } = await supabase.from("push_suscripciones").upsert(
        { kiosco_id: kiosco.id, endpoint: j.endpoint!, p256dh: j.keys!.p256dh!, auth_secret: j.keys!.auth! },
        { onConflict: "endpoint" },
      );
      if (error) { setMsg("No se pudo guardar el aviso. Probá de nuevo."); return; }
      setEstado("activo");
      setMsg("Avisos activados en este celular");
    } catch {
      setMsg("No pudimos activar los avisos en este navegador.");
    }
  }

  if (estado === "cargando" || estado === "no_soportado" || estado === "sin_clave") return null;
  if (soloPendiente && estado === "activo" && !msg) return null;
  return (
    <div className="card row">
      {estado === "activo" && <span>Avisos de pedidos <b className="ok">activados</b> en este celular</span>}
      {estado === "inactivo" && <span>Recibí un aviso cuando llegue un pedido, aunque tengas la app cerrada.</span>}
      {estado === "bloqueado" && <span className="mut">Los avisos están bloqueados. Habilitalos desde la configuración del navegador.</span>}
      {(estado === "inactivo") && <button onClick={activar}>Activar avisos</button>}
      {msg && <span role="status" className="mut">{msg}</span>}
    </div>
  );
}
