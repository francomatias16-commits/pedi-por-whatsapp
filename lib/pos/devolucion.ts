// Devoluciones parciales: cálculo espejo de devolver_venta_mostrador (0013) para mostrar el reembolso antes de confirmar.
// El servidor siempre recalcula; esto es solo para que la pantalla coincida con lo que va a devolver.
export type ItemDevolvible = {
  id: string; nombre: string; cantidad: number; por_peso: boolean; neto: number;
  devuelto: number;        // cantidad ya devuelta en devoluciones anteriores
  devuelto_monto: number;  // plata ya reembolsada de este renglón
};

const aCentavos = (n: number) => Math.round(n * 100);
export const restante = (i: ItemDevolvible) => Math.max(0, i.cantidad - i.devuelto);

// Reembolso proporcional al neto cobrado (con el descuento ya prorrateado). La última parte absorbe el redondeo.
export function reembolsoItem(i: ItemDevolvible, cant: number): number {
  if (!Number.isInteger(cant) || cant < 1 || cant > restante(i)) return 0;
  const neto = aCentavos(i.neto);
  if (i.devuelto + cant === i.cantidad) return (neto - aCentavos(i.devuelto_monto)) / 100;
  // Entero exacto con "medio hacia arriba", igual que round() de Postgres para positivos.
  const c = Math.floor((2 * neto * cant + i.cantidad) / (2 * i.cantidad));
  return c / 100;
}

export type SeleccionItem = { cantidad: number; repone_stock: boolean };

export function totalReembolso(items: ItemDevolvible[], sel: Record<string, SeleccionItem>): number {
  let c = 0;
  for (const i of items) { const s = sel[i.id]; if (s && s.cantidad > 0) c += aCentavos(reembolsoItem(i, s.cantidad)); }
  return c / 100;
}

// Payload de p_items para la RPC (solo renglones con cantidad > 0).
export function armarItemsDevolucion(items: ItemDevolvible[], sel: Record<string, SeleccionItem>) {
  return items.filter((i) => (sel[i.id]?.cantidad ?? 0) > 0)
    .map((i) => ({ item_id: i.id, cantidad: sel[i.id].cantidad, repone_stock: sel[i.id].repone_stock }));
}

// Texto que tipea el cajero → cantidad entera. Por peso se escribe en kg ("0,250" = 250 g); por unidad, entero.
export function parsearCantidad(txt: string, porPeso: boolean): number {
  const s = String(txt ?? "").trim().replace(",", ".");
  if (s === "" || !/^\d*\.?\d*$/.test(s)) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return porPeso ? Math.round(n * 1000) : (Number.isInteger(n) ? n : 0);
}
export const cantidadATexto = (cant: number, porPeso: boolean) => (porPeso ? (cant / 1000).toFixed(3).replace(".", ",") : String(cant));
