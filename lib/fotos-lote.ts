// Completar fotos en lote (Etapa 3D): parte pura. Qué productos entran, cuántos por tanda y qué sugerencia se propone.
// En lote solo se usan fuentes gratuitas (base de la red y Open Food Facts); la búsqueda en internet, que pide confirmar derechos, queda para el modo de a uno.
import type { Sugerencia } from "@/lib/fotos-sugerencias";

export const TANDA = 25;   // productos por tanda: alcanza para revisar con calma y no abusa de Open Food Facts

type ProductoMin = { id: string; nombre: string; barcode?: string | null; imagen_url?: string | null; disponible?: boolean };

const sinFoto = (p: ProductoMin) => !(p.imagen_url ?? "").trim();
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Productos sin foto, ordenados por nombre. Los disponibles primero: son los que ve el cliente en la tienda. */
export function faltantes<T extends ProductoMin>(lista: T[]): T[] {
  return lista.filter(sinFoto).sort((a, b) => Number(b.disponible !== false) - Number(a.disponible !== false) || norm(a.nombre).localeCompare(norm(b.nombre)));
}

/** Los próximos `n` de la lista que todavía no se procesaron. */
export function proximaTanda<T extends ProductoMin>(pendientes: T[], yaVistos: Set<string>, n = TANDA): T[] {
  return pendientes.filter((p) => !yaVistos.has(p.id)).slice(0, n);
}

const PRIORIDAD: Record<string, number> = { global: 0, openfoodfacts: 1 };

/** La sugerencia que se propone en lote: la de mejor fuente gratuita. Nunca una de búsqueda en internet. null si no hay. */
export function primeraGratuita(sugerencias: Sugerencia[]): Sugerencia | null {
  const ok = sugerencias.filter((s) => s.fuente in PRIORIDAD);
  return ok.length ? ok.reduce((a, b) => (PRIORIDAD[b.fuente] < PRIORIDAD[a.fuente] ? b : a)) : null;
}

/** ¿El producto tiene código de barras usable? Con código la coincidencia es exacta; sin código se busca por nombre y hay que mirar con más cuidado. */
export const tieneCodigo = (p: ProductoMin): boolean => (p.barcode ?? "").replace(/\D/g, "").length >= 8;
