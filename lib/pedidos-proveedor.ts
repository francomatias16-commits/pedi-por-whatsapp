import { cantidadDesdeTexto, cantidadTexto, type LineaCompra } from "./compras";

// Pedidos a proveedor como documento (0027). Por peso las cantidades van en gramos, igual que compras.
export type EstadoPedido = "borrador" | "enviada" | "recibida_parcial" | "recibida" | "cancelada";
export type ItemPedido = { id: string; producto_id: string | null; nombre: string; por_peso: boolean; cantidad: number; recibida: number };
export type PedidoProv = { id: string; numero: number; estado: EstadoPedido; proveedor_id: string; created_at: string; items: ItemPedido[] };

export const ETIQUETA_PEDIDO: Record<EstadoPedido, string> = {
  borrador: "Borrador", enviada: "Enviado", recibida_parcial: "Llegó una parte", recibida: "Recibido", cancelada: "Cancelado",
};

export const pendiente = (i: Pick<ItemPedido, "cantidad" | "recibida">) => Math.max(0, i.cantidad - i.recibida);

/** Qué botones corresponden a cada estado (las reglas reales las hace la base; esto solo evita mostrar botones inútiles). */
export function acciones(estado: EstadoPedido) {
  return {
    enviar: estado === "borrador",
    cancelar: estado === "borrador" || estado === "enviada",
    recibir: estado === "enviada" || estado === "recibida_parcial",
    cerrar: estado === "recibida_parcial",
  };
}

/** Lo que falta recibir, en texto: "Alfajor 4 · Queso 1,5 kg". Vacío si no falta nada. */
export function textoFaltante(items: ItemPedido[]): string {
  return items.filter((i) => pendiente(i) > 0).map((i) => `${i.nombre} ${cantidadTexto(pendiente(i), i.por_peso)}`).join(" · ");
}

/**
 * Convierte lo que escribió la persona al recibir (texto por línea; vacío = no llegó nada de esa línea) en el payload de la RPC.
 * Devuelve un error legible si algo no cierra, en vez de dejar que lo rechace la base.
 */
export function armarRecepcion(items: ItemPedido[], textos: Record<string, string>): { ok: true; payload: { item_id: string; cantidad: number }[] } | { ok: false; error: string } {
  const payload: { item_id: string; cantidad: number }[] = [];
  for (const i of items) {
    const t = (textos[i.id] ?? "").trim();
    if (t === "") continue;
    const n = cantidadDesdeTexto(t, i.por_peso);
    if (n === null) return { ok: false, error: `Revisá la cantidad de ${i.nombre}.` };
    if (n > pendiente(i)) return { ok: false, error: `De ${i.nombre} solo faltan ${cantidadTexto(pendiente(i), i.por_peso)}.` };
    payload.push({ item_id: i.id, cantidad: n });
  }
  if (payload.length === 0) return { ok: false, error: "Escribí lo que llegó de al menos un producto." };
  return { ok: true, payload };
}

/** Líneas para precargar "Registrar compra" con lo que llegó. El costo sale del último costo del producto (o 0 si no hay). */
export function lineasParaCompra(items: ItemPedido[], recibido: { item_id: string; cantidad: number }[], costos: Record<string, number | null>): LineaCompra[] {
  const out: LineaCompra[] = [];
  for (const r of recibido) {
    const i = items.find((x) => x.id === r.item_id);
    if (!i || !i.producto_id) continue;
    out.push({ producto_id: i.producto_id, nombre: i.nombre, por_peso: i.por_peso, cantidad: r.cantidad, costo: costos[i.producto_id] ?? 0 });
  }
  return out;
}

export const ERRORES_PEDIDO: [string, string][] = [
  ["pedido_no_encontrado", "No encontramos ese pedido."],
  ["pedido_estado_invalido", "Ese pedido ya cambió de estado. Actualizá la pantalla."],
  ["recepcion_excede_pendiente", "No podés recibir más de lo que falta de ese pedido."],
  ["items_invalidos", "Revisá las líneas del pedido."],
  ["cantidad_invalida", "Revisá las cantidades."],
  ["producto_no_encontrado", "Uno de los productos ya no existe."],
  ["proveedor_no_encontrado", "No encontramos a ese proveedor."],
  ["no_autorizado", "No tenés permiso para hacer esto."],
];
export const mensajePedido = (m: string) => ERRORES_PEDIDO.find(([k]) => m.includes(k))?.[1] ?? "No se pudo completar la operación.";
