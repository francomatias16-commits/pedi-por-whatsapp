// Auditoría de sellos: arma el resumen por empleado a partir de sellos_por_empleado (0041). Puro y sin DOM.
export type FilaEmpleado = { dia: string; usuario_id: string | null; nombre: string; sellos: number; manuales: number; anulados: number; canjes: number };
export type ResumenEmpleado = {
  clave: string; nombre: string; sinRegistrar: boolean; sellos: number; manuales: number; anulados: number; canjes: number;
  dias: { dia: string; sellos: number; manuales: number; anulados: number; canjes: number }[]; senales: string[];
};

export const MANUALES_MINIMO = 10;     // desde cuántos sellos manuales se mira la proporción
export const MANUALES_PROPORCION = 0.5; // y se avisa si son la mitad o más de lo que dio
export const ANULADOS_MINIMO = 3;      // sellos anulados suyos para avisar

/** Fecha de hoy en Argentina (YYYY-MM-DD), sin depender de la zona del navegador. */
export const hoyAR = (ahora: Date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(ahora);

/** Rango de los últimos N días incluido hoy. */
export function rangoDias(dias: number, ahora: Date = new Date()): { desde: string; hasta: string } {
  const hasta = hoyAR(ahora);
  const d = new Date(`${hasta}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (Math.max(1, Math.floor(dias)) - 1));
  return { desde: d.toISOString().slice(0, 10), hasta };
}

export function senalesDe(e: Pick<ResumenEmpleado, "sellos" | "manuales" | "anulados" | "sinRegistrar">): string[] {
  if (e.sinRegistrar) return [];
  const s: string[] = [];
  if (e.manuales >= MANUALES_MINIMO && e.manuales / Math.max(e.sellos, 1) >= MANUALES_PROPORCION) s.push("Muchos sellos manuales");
  if (e.anulados >= ANULADOS_MINIMO) s.push("Varios sellos anulados");
  return s;
}

/** Agrupa por persona (los sellos sin usuario quedan juntos como "Sin registrar"), con el detalle por día y señales para mirar. */
export function resumirPorEmpleado(filas: FilaEmpleado[]): ResumenEmpleado[] {
  const mapa = new Map<string, ResumenEmpleado>();
  for (const f of filas) {
    const clave = f.usuario_id ?? "sin-registrar";
    const e = mapa.get(clave) ?? { clave, nombre: f.usuario_id ? f.nombre : "Sin registrar", sinRegistrar: !f.usuario_id, sellos: 0, manuales: 0, anulados: 0, canjes: 0, dias: [], senales: [] };
    const n = { sellos: Number(f.sellos), manuales: Number(f.manuales), anulados: Number(f.anulados), canjes: Number(f.canjes) };
    e.sellos += n.sellos; e.manuales += n.manuales; e.anulados += n.anulados; e.canjes += n.canjes;
    e.dias.push({ dia: f.dia, ...n });
    mapa.set(clave, e);
  }
  const lista = [...mapa.values()];
  for (const e of lista) { e.dias.sort((a, b) => b.dia.localeCompare(a.dia)); e.senales = senalesDe(e); }
  // Primero las personas con más sellos; "Sin registrar" siempre al final.
  return lista.sort((a, b) => Number(a.sinRegistrar) - Number(b.sinRegistrar) || b.sellos - a.sellos || a.nombre.localeCompare(b.nombre, "es"));
}

export const fechaCorta = (dia: string) => { const [, m, d] = dia.split("-"); return `${d}/${m}`; };
