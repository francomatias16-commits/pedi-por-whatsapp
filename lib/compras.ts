import { mensajeErrorSql } from "./errores";
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

export const mensajeCompras = (m: string) => mensajeErrorSql(m, "compras");
