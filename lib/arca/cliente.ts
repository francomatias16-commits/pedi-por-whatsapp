// Textos y llamadas del navegador para la facturación con ARCA (los códigos los devuelven las rutas /api/arca y las funciones SQL).
import { supabase } from "../supabase";
import { mensajeErrorSql } from "../errores";

export const ERRORES_ARCA: Record<string, string> = {
  no_autorizado: "Tu sesión venció o no tenés permiso. Volvé a entrar al panel.",
  cuit_invalido: "El CUIT no es válido. Revisá los 11 números.",
  razon_invalida: "Escribí la razón social (nombre con el que estás inscripto en ARCA).",
  domicilio_invalido: "Escribí el domicilio fiscal del local.",
  pto_invalido: "El punto de venta tiene que ser un número entre 1 y 99998.",
  doc_invalido: "El DNI no es válido (7 u 8 números).",
  arca_sin_certificado: "El servicio de facturación todavía no está listo en el servidor. Avisanos.",
  arca_certificado_ilegible: "El servicio de facturación tiene un problema de configuración. Avisanos.",
  servidor_sin_clave: "Falta una configuración del servidor para facturar. Avisanos.",
  arca_wsaa: "ARCA no nos dejó autenticarnos ahora. Probá de nuevo en un momento.",
  arca_timeout: "ARCA no responde ahora. No se perdió nada: probá de nuevo en un momento.",
  arca_sin_conexion: "No pudimos comunicarnos con ARCA. Probá de nuevo en un momento.",
  arca_http: "ARCA tuvo un problema. Probá de nuevo en un momento.",
  arca_ocupada: "Hay otra factura procesándose en este momento. Probá de nuevo en unos segundos.",
  arca_consulta: "No pudimos confirmar el estado del comprobante en ARCA. Probá de nuevo en un momento.",
  arca_rechazo: "ARCA rechazó la consulta.",
  db: "No se pudo completar. Probá de nuevo.",
};
export const textoErrorArca = (codigo: unknown, detalle?: unknown) => {
  const c = String(codigo ?? "");
  const base = ERRORES_ARCA[c] ?? mensajeErrorSql(c, undefined, "No se pudo completar la operación. Probá de nuevo.");
  return detalle && c === "arca_rechazo" ? `${base} ${String(detalle)}` : base;
};

export async function llamarArca(ruta: string, kiosco: string, cuerpo: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` }, body: JSON.stringify({ kiosco, ...cuerpo }) });
  return { ok: r.ok, status: r.status, r };
}
export const jsonArca = async (r: Response) => (await r.json().catch(() => ({}))) as Record<string, unknown>;

// Abre el PDF de un comprobante en otra pestaña (la ruta pide el token de sesión, por eso se baja como blob).
export async function abrirPdf(kiosco: string, comprobante: string): Promise<string | null> {
  const { ok, r } = await llamarArca("/api/arca/pdf", kiosco, { comprobante });
  if (!ok) return "No se pudo abrir el comprobante.";
  const url = URL.createObjectURL(await r.blob());
  const w = window.open(url, "_blank", "noopener");
  if (!w) { const a = document.createElement("a"); a.href = url; a.download = "comprobante.pdf"; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return null;
}

export type ComprobanteVenta = { id: string; tipo: number; punto_venta: number; numero: number | null; total: number; estado: "pendiente" | "emitido" | "incierto" | "rechazado"; cae: string | null; cae_vto: string | null; error: string | null; devolucion_id: string | null; homologacion: boolean; fecha: string };
export type EstadoVenta = { habilitada: boolean; comprobantes: ComprobanteVenta[]; devoluciones: { id: string; numero: number; total: number }[] };

export async function comprobantesDeVenta(ventaId: string): Promise<EstadoVenta> {
  const { data, error } = await supabase.rpc("arca_comprobantes_venta", { p_venta: ventaId });
  if (error) throw new Error(mensajeErrorSql(error.message));
  const e = data as EstadoVenta;
  return { habilitada: !!e.habilitada, devoluciones: (e.devoluciones ?? []).map((d) => ({ ...d, numero: Number(d.numero), total: Number(d.total) })),
    comprobantes: (e.comprobantes ?? []).map((c) => ({ ...c, total: Number(c.total), numero: c.numero == null ? null : Number(c.numero) })) };
}

// Después de una devolución: si la venta tiene factura emitida, se emite sola la nota de crédito. Nunca lanza: devuelve un aviso para mostrar.
export async function notaCreditoDeDevolucion(kiosco: string, ventaId: string, devolucionId: string): Promise<{ tipo: "ninguna" | "ok" | "error"; texto: string }> {
  try {
    const e = await comprobantesDeVenta(ventaId);
    if (!e.habilitada || !e.comprobantes.some((c) => c.tipo === 11 && c.estado === "emitido")) return { tipo: "ninguna", texto: "" };
    const { ok, r } = await llamarArca("/api/arca/nota-credito", kiosco, { venta: ventaId, devolucion: devolucionId });
    const j = await jsonArca(r);
    if (!ok) return { tipo: "error", texto: `La devolución se registró, pero la nota de crédito no se pudo emitir: ${textoErrorArca(j.error, j.detalle)} Podés emitirla desde Buscar ventas.` };
    if (j.estado === "emitido") return { tipo: "ok", texto: "Nota de crédito emitida en ARCA." };
    return { tipo: "error", texto: `La devolución se registró, pero ARCA no emitió la nota de crédito${j.error ? `: ${String(j.error)}` : ""}. Podés reintentarla desde Buscar ventas.` };
  } catch { return { tipo: "error", texto: "La devolución se registró, pero no pudimos revisar la nota de crédito. Reintentala desde Buscar ventas." }; }
}
