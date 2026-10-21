// Estado de vencimiento de un lote, con el mismo criterio que lotes_repartir en la base:
// vencido si la fecha ya pasó, por vencer si faltan 7 días o menos, vigente en cualquier otro caso.
export type EstadoVenc = "vencido" | "por_vencer" | "vigente";

/** Fecha de hoy en Argentina como YYYY-MM-DD (el servidor también usa America/Argentina/Buenos_Aires). */
export function hoyAR(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

function dias(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export function estadoVencimiento(vence: string | null | undefined, hoy: string = hoyAR()): EstadoVenc | null {
  if (!vence) return null;
  const d = dias(hoy, vence);
  if (d < 0) return "vencido";
  if (d <= 7) return "por_vencer";
  return "vigente";
}

export function fechaCorta(vence: string): string {
  const [y, m, d] = vence.split("-");
  return `${d}/${m}/${y}`;
}

/** Texto para el cajero; null si no hace falta avisar. */
export function avisoVencimiento(nombre: string, vence: string | null | undefined, hoy: string = hoyAR()): string | null {
  const e = estadoVencimiento(vence, hoy);
  if (!vence || !e || e === "vigente") return null;
  if (e === "vencido") return `Ojo: ${nombre} tiene unidades vencidas (${fechaCorta(vence)}). Revisá la fecha antes de venderlo.`;
  const d = dias(hoy, vence);
  return `${nombre} vence ${d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`} (${fechaCorta(vence)}).`;
}
