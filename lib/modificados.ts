// Lógica pura del panel "Productos modificados" (plan 2.6): qué productos cambiaron de stock y cuánto.
// Sin Next ni Supabase, para poder probarla en Node.
export type Periodo = "hoy" | "7" | "30";

// Movimientos de la operación diaria. Por defecto no se muestran: lo que interesa es lo que cambió a mano
// (ajustes, conteos, mermas) o por compras. Con el tilde "Incluir ventas, pedidos y devoluciones" se agregan.
export const TIPOS_OPERATIVOS = ["venta", "anulacion_venta", "devolucion", "pedido", "cancelacion_pedido"] as const;

export type Mov = { producto_id: string; tipo: string; cantidad: number; created_at: string; nombre: string; por_peso: boolean };
export type Fila = { producto_id: string; nombre: string; por_peso: boolean; neto: number; movimientos: number; ultimo: string };

const AR_OFFSET_MS = 3 * 3600 * 1000; // Argentina es UTC-3 todo el año (sin horario de verano)

// Inicio del período como instante ISO. "hoy" arranca a las 00:00 de Argentina; 7 y 30 son días corridos hacia atrás.
export function desdePeriodo(p: Periodo, ahora: Date = new Date()): string {
  if (p === "hoy") {
    const ar = new Date(ahora.getTime() - AR_OFFSET_MS);
    return new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate()) + AR_OFFSET_MS).toISOString();
  }
  return new Date(ahora.getTime() - Number(p) * 86400000).toISOString();
}

export function agruparMovimientos(movs: Mov[], incluirOperativos: boolean): Fila[] {
  const ocultos: readonly string[] = incluirOperativos ? [] : TIPOS_OPERATIVOS;
  const por = new Map<string, Fila>();
  for (const m of movs) {
    if (ocultos.includes(m.tipo)) continue;
    const f = por.get(m.producto_id);
    if (!f) {
      por.set(m.producto_id, { producto_id: m.producto_id, nombre: m.nombre, por_peso: m.por_peso, neto: m.cantidad, movimientos: 1, ultimo: m.created_at });
    } else {
      f.neto += m.cantidad;
      f.movimientos += 1;
      if (m.created_at > f.ultimo) f.ultimo = m.created_at;
    }
  }
  return [...por.values()].sort((a, b) => (a.ultimo < b.ultimo ? 1 : a.ultimo > b.ultimo ? -1 : 0));
}

// Productos por peso guardan el stock en gramos: se muestran en kg.
export function formatearNeto(neto: number, porPeso: boolean): string {
  const signo = neto > 0 ? "+" : neto < 0 ? "−" : "";
  const abs = Math.abs(neto);
  if (porPeso) return `${signo}${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(abs / 1000)} kg`;
  return `${signo}${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(abs)}`;
}
