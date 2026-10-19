// Llamadas del navegador a /api/fotos/*, con la sesión de quien está en el panel.
import { supabase } from "@/lib/supabase";
import type { Sugerencia } from "@/lib/fotos-sugerencias";

export const MENSAJES_FOTOS: Record<string, string> = {
  no_autorizado: "Tu sesión venció o tu rol no puede hacer esto. Volvé a entrar.",
  fotos_inactivo: "Las fotos automáticas están apagadas. El dueño las enciende en Mi negocio.",
  producto_no_encontrado: "No encontramos ese producto.",
  foto_invalida: "Esa foto no se pudo usar. Probá con otra.",
  foto_muy_grande: "Esa foto es demasiado pesada. Probá con otra.",
  foto_no_responde: "El sitio de esa foto no respondió. Probá con otra.",
  imagen_muy_grande: "Esa foto es demasiado pesada. Probá con otra.",
  imagen_ilegible: "No pudimos leer esa foto. Probá con otra.",
  sin_conexion: "No hay conexión. Revisala y probá de nuevo.",
};

async function cabeceras(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" };
}

export type RespuestaSugerir = { sugerencias: Sugerencia[]; limite_alcanzado: boolean; busqueda_disponible: boolean };

/** Pide fotos candidatas. Lanza Error con el código si falla. */
export async function buscarSugerencias(kiosco: string, producto: string): Promise<RespuestaSugerir> {
  let r: Response;
  try { r = await fetch("/api/fotos/sugerir", { method: "POST", headers: await cabeceras(), body: JSON.stringify({ kiosco, producto }), cache: "no-store" }); }
  catch { throw new Error("sin_conexion"); }
  const j = (await r.json().catch(() => ({}))) as Partial<RespuestaSugerir> & { error?: string };
  if (!r.ok) throw new Error(j.error ?? "foto_no_responde");
  return { sugerencias: j.sugerencias ?? [], limite_alcanzado: !!j.limite_alcanzado, busqueda_disponible: !!j.busqueda_disponible };
}

/** Trae los bytes de la foto elegida a través del servidor. Lanza Error con el código si falla. */
export async function descargarFoto(kiosco: string, url: string): Promise<Blob> {
  let r: Response;
  try { r = await fetch("/api/fotos/descargar", { method: "POST", headers: await cabeceras(), body: JSON.stringify({ kiosco, url }), cache: "no-store" }); }
  catch { throw new Error("sin_conexion"); }
  if (!r.ok) { const j = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(j.error ?? "foto_no_responde"); }
  return r.blob();
}
