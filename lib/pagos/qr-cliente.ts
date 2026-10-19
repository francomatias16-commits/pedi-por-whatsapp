// Llamadas del navegador a las rutas del QR del mostrador, con la sesión de quien está en la caja.
import { supabase } from "@/lib/supabase";

export async function llamarQR(ruta: string, cuerpo?: Record<string, unknown>): Promise<{ ok: boolean; j: Record<string, unknown> }> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { Authorization: `Bearer ${session?.access_token ?? ""}` };
  const init: RequestInit = cuerpo ? { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), cache: "no-store" } : { headers, cache: "no-store" };
  try {
    const r = await fetch(ruta, init);
    return { ok: r.ok, j: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, j: { error: "sin_conexion" } };
  }
}

export const MENSAJES_QR: Record<string, string> = {
  no_autorizado: "Tu sesión venció. Volvé a entrar.",
  qr_inactivo: "El cobro con QR está apagado en este local.",
  qr_sin_config: "El QR del local no está listo. Avisale al dueño: tiene que revisarlo en Mi negocio.",
  turno_cerrado: "La caja está cerrada. Abrila para cobrar.",
  qr_monto_invalido: "El monto del QR tiene que ser de $15 o más.",
  qr_ocupado: "Ya hay otro cobro con QR esperando el pago. Esperá que termine o cancelalo.",
  mp_no_responde: "Mercado Pago no responde ahora. Probá de nuevo o cobrá con otro medio.",
  sin_conexion: "No hay internet. El QR necesita conexión: cobrá con otro medio.",
  cobro_no_encontrado: "No encontramos ese cobro.",
  db: "No se pudo completar. Probá de nuevo.",
};
export const mensajeQR = (codigo: unknown) => MENSAJES_QR[String(codigo)] ?? "No se pudo completar el cobro con QR.";
