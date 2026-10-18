// Margen sobre el precio de venta: (precio − costo) / precio, en %. Null si no hay costo o precio.
export function margenPct(precio: number, costo: number | null | undefined): number | null {
  if (costo === null || costo === undefined || !(costo > 0) || !(precio > 0)) return null;
  return Math.round(((precio - costo) / precio) * 1000) / 10;
}

// Productos con costo cargado cuyo margen quedó por debajo del objetivo (los que conviene revisar).
export function productosMargenBajo<T extends { precio: number; costo: number | null }>(lista: T[], objetivo: number): (T & { margen: number })[] {
  return lista
    .map((p) => ({ ...p, margen: margenPct(p.precio, p.costo) }))
    .filter((p): p is T & { margen: number } => p.margen !== null && p.margen < objetivo)
    .sort((a, b) => a.margen - b.margen);
}

// Variación del costo al cargar una compra. Devuelve null si no hay costo anterior o si el cambio es menor al umbral (en %).
export const UMBRAL_VARIACION_COSTO = 10;
export function variacionCosto(anterior: number | null | undefined, nuevo: number, umbral = UMBRAL_VARIACION_COSTO): { anterior: number; nuevo: number; pct: number } | null {
  if (anterior === null || anterior === undefined || !(anterior > 0) || !(nuevo >= 0)) return null;
  const pct = Math.round(((nuevo - anterior) / anterior) * 1000) / 10;
  return Math.abs(pct) >= umbral ? { anterior, nuevo, pct } : null;
}
