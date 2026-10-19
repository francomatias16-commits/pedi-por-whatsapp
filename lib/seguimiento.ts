// Seguimiento público del pedido (etapa 3A): etapas, pasos para mostrar, link y texto del aviso.
// La función SQL seguimiento_pedido(token) devuelve la etapa; acá se traduce a lo que ve el cliente.
export type Etapa = "esperando_pago" | "recibido" | "confirmado" | "listo" | "en_camino" | "entregado" | "cancelado";
export type Modalidad = "retiro" | "envio";
export type Seguimiento = { numero: number; etapa: Etapa; modalidad: Modalidad; creado: string; local: string; tienda: string; whatsapp: string };

export const TOKEN_RE = /^[0-9a-f]{64}$/;
export const SEGUIMIENTO_REFRESCO_MS = 20000;

export const TITULO_ETAPA: Record<Etapa, string> = {
  esperando_pago: "Esperando el pago",
  recibido: "Recibimos tu pedido",
  confirmado: "Tu pedido está confirmado",
  listo: "Tu pedido está listo para retirar",
  en_camino: "Tu pedido está en camino",
  entregado: "Pedido entregado",
  cancelado: "Pedido cancelado",
};
export const DETALLE_ETAPA: Record<Etapa, string> = {
  esperando_pago: "Cuando se apruebe el pago, el local confirma tu pedido.",
  recibido: "El local lo está revisando. En un momento te lo confirma.",
  confirmado: "Lo están preparando.",
  listo: "Ya podés pasar a retirarlo por el local.",
  en_camino: "Va camino a tu dirección.",
  entregado: "Gracias por tu compra.",
  cancelado: "El local tuvo que cancelarlo. Escribile por WhatsApp si querés rehacerlo.",
};

export const pasosDe = (m: Modalidad): { etapa: Etapa; texto: string }[] => [
  { etapa: "recibido", texto: "Recibido" },
  { etapa: "confirmado", texto: "Confirmado" },
  m === "envio" ? { etapa: "en_camino", texto: "En camino" } : { etapa: "listo", texto: "Listo para retirar" },
  { etapa: "entregado", texto: "Entregado" },
];

/** Posición (0 a 3) en la línea de pasos. Cancelado queda fuera (-1). Esperando pago no pasa del primer paso. */
export function pasoActual(etapa: Etapa, m: Modalidad): number {
  if (etapa === "cancelado") return -1;
  if (etapa === "esperando_pago") return 0;
  return Math.max(0, pasosDe(m).findIndex((p) => p.etapa === etapa));
}
export const etapaFinal = (e: Etapa) => e === "entregado" || e === "cancelado";

/** Link que se manda al cliente. Sin origen devuelve la ruta relativa. */
export const linkSeguimiento = (token: string, origen = "") => `${origen.replace(/\/$/, "")}/seguimiento/${token}`;

/** Texto del aviso por WhatsApp según el pedido. Con link de seguimiento solo si el local lo tiene encendido. */
export function textoAviso(p: { nombre: string; local: string; numero: number; estado: string; modalidad: Modalidad; entrega?: string | null }, link?: string | null): string {
  const base = `Hola ${p.nombre}! Te escribimos de ${p.local} por tu pedido #${p.numero}.`;
  let cuerpo: string;
  if (p.estado === "pendiente") cuerpo = "Lo recibimos y en un momento te lo confirmamos.";
  else if (p.estado === "confirmado" && p.entrega === "listo") cuerpo = "Ya está listo. Podés pasar a retirarlo.";
  else if (p.estado === "confirmado" && p.entrega === "en_camino") cuerpo = "Ya salió: está en camino.";
  else if (p.estado === "confirmado") cuerpo = `Ya está confirmado. ${p.modalidad === "envio" ? "Te lo llevamos en breve." : "Podés pasar a retirarlo."}`;
  else if (p.estado === "entregado") cuerpo = "Gracias por tu compra!";
  else cuerpo = "Lo tuvimos que cancelar, disculpá. Escribinos si querés rehacerlo.";
  const conLink = link && p.estado !== "cancelado" ? `\nPodés ver en qué está acá: ${link}` : "";
  return `${base} ${cuerpo}${conLink}`;
}
