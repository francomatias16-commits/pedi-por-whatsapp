// Qué le mostramos al cliente cuando vuelve de Mercado Pago, según lo que devuelve /api/pagos/mp/estado. Sin imports: se prueba en Node.
export type EstadoPublico = { pago_estado: string; estado: string; numero: number; total: number; rechazado?: boolean; link?: string | null };
export type VistaPago = "pagado" | "cobrado_cancelado" | "pendiente" | "reintentar" | "fallido" | "reembolsado" | "no_online";

export function vistaPago(d: EstadoPublico): VistaPago {
  switch (d.pago_estado) {
    case "pagado": return d.estado === "cancelado" ? "cobrado_cancelado" : "pagado";
    case "reembolsado": return "reembolsado";
    case "fallido": return "fallido";
    case "pendiente": return d.rechazado ? "reintentar" : "pendiente";
    default: return "no_online";
  }
}
// Cuántas veces se consulta (cada 3 segundos) antes de dejar de insistir y ofrecer un botón.
export const CONSULTAS_MAX = 40;
