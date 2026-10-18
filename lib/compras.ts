// Proveedores y compras (0015). El cálculo espeja a registrar_compra: por peso la cantidad va en gramos y el costo es por kg.
export type Proveedor = { id: string; nombre: string; telefono: string | null; cuit: string | null; notas: string | null; activo: boolean; saldo: number; ultimo_movimiento: string | null };
export type LineaCompra = { producto_id: string; nombre: string; por_peso: boolean; cantidad: number; costo: number };
export type MovStock = { id: string; tipo: string; cantidad: number; stock_resultante: number; motivo: string | null; motivo_tipo?: string | null; created_at: string; productos: { nombre: string; vendido_por_peso: boolean } | null };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const totalLinea = (l: Pick<LineaCompra, "por_peso" | "cantidad" | "costo">) => r2(l.por_peso ? (l.costo * l.cantidad) / 1000 : l.costo * l.cantidad);
export const totalCompra = (ls: LineaCompra[]) => r2(ls.reduce((s, l) => s + totalLinea(l), 0));

// Lo que escribe la persona (kg si es por peso, unidades si no) → lo que guarda el sistema (gramos / unidades enteras).
export function cantidadDesdeTexto(texto: string, porPeso: boolean): number | null {
  const n = Number(String(texto).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const q = porPeso ? Math.round(n * 1000) : n;
  return Number.isInteger(q) && q >= 1 && q <= 9999999 ? q : null;
}
export const cantidadTexto = (cant: number, porPeso: boolean) => (porPeso ? `${(cant / 1000).toLocaleString("es-AR", { maximumFractionDigits: 3 })} kg` : String(cant));

export const ERRORES_COMPRAS: [string, string][] = [
  ["no_autorizado", "No tenés permiso para esta operación."],
  ["proveedor_duplicado", "Ya tenés un proveedor con ese nombre."],
  ["nombre_invalido", "Escribí el nombre del proveedor (hasta 80 letras)."],
  ["proveedor_no_encontrado", "Ese proveedor ya no existe. Actualizá la página."],
  ["producto_no_encontrado", "Un producto de la compra ya no existe. Actualizá la página."],
  ["items_invalidos", "Agregá al menos un producto a la compra."],
  ["cantidad_invalida", "Revisá las cantidades."],
  ["costo_invalido", "Falta el costo de algún producto."],
  ["monto_invalido", "Revisá el monto: tiene que ser mayor a cero."],
  ["pago_excede_total", "Lo que pagás ahora no puede superar el total de la compra."],
  ["medio_pago_invalido", "Ese medio de pago no es válido."],
  ["ya_anulada", "Esa compra ya estaba anulada."],
  ["stock_insuficiente", "No se puede anular: ya se vendió parte de esa mercadería."],
  ["stock_no_controlado", "Ese producto no controla stock. Activalo desde Productos."],
  ["motivo_requerido", "Indicá el motivo (mínimo 3 letras)."],
  ["sin_cambios", "El stock nuevo es igual al actual."],
];
export const mensajeCompras = (m: string) => ERRORES_COMPRAS.find(([k]) => m.includes(k))?.[1] ?? "No se pudo completar la operación.";
