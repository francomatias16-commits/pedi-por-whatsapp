// Horario de atención. Espejo de public.kiosco_abierto_ahora (supabase/migrations/0006): la base es la que manda
// al recibir el pedido; esto solo sirve para mostrar el estado y el próximo horario de apertura.
export type Tramo = { desde: string; hasta: string };            // "HH:MM" 24 h; hasta < desde = cruza la medianoche
export type Horarios = Record<string, Tramo[]>;                  // "0" domingo … "6" sábado; sin clave = cerrado
export type ConfigHorario = { abierto: boolean; horario_auto: boolean; horarios: Horarios };
export type EstadoTienda = "abierta" | "pausada" | "fuera_de_horario";

export const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ABREV = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];
export const MAX_TRAMOS = 2;
const RE_HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/** Día de la semana y minuto del día en Argentina (UTC-3 todo el año, sin horario de verano). */
export function horaArgentina(ahora: Date): { dow: number; min: number } {
  const d = new Date(ahora.getTime() - 3 * 3600 * 1000);
  return { dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

export function tramoValido(t: Tramo): boolean {
  return RE_HORA.test(t?.desde ?? "") && RE_HORA.test(t?.hasta ?? "") && t.desde !== t.hasta;
}
export function horariosValidos(h: Horarios): boolean {
  return Object.entries(h).every(([k, ts]) => /^[0-6]$/.test(k) && Array.isArray(ts) && ts.length <= MAX_TRAMOS && ts.every(tramoValido));
}
export const hayDiasAbiertos = (h: Horarios) => Object.values(h).some((ts) => ts.length > 0);

export function enHorario(h: Horarios, ahora: Date): boolean {
  const { dow, min } = horaArgentina(ahora);
  for (const t of h[String(dow)] ?? []) {
    const d = aMin(t.desde), f = aMin(t.hasta);
    if (d < f ? min >= d && min < f : min >= d) return true;       // tramo normal, o la parte de hoy de uno que cruza la medianoche
  }
  for (const t of h[String((dow + 6) % 7)] ?? []) {                // la parte de hoy de un tramo que empezó ayer
    if (aMin(t.desde) > aMin(t.hasta) && min < aMin(t.hasta)) return true;
  }
  return false;
}

export function estadoTienda(k: ConfigHorario, ahora: Date = new Date()): EstadoTienda {
  if (!k.abierto) return "pausada";
  if (!k.horario_auto) return "abierta";
  return enHorario(k.horarios ?? {}, ahora) ? "abierta" : "fuera_de_horario";
}

/** "Abre hoy a las 18:00" / "Abre mañana a las 08:00" / "Abre el lunes a las 08:00". Null si no hay ningún día abierto. */
export function textoApertura(h: Horarios, ahora: Date = new Date()): string | null {
  const { dow, min } = horaArgentina(ahora);
  for (let off = 0; off <= 7; off++) {
    const ts = [...(h[String((dow + off) % 7)] ?? [])].sort((a, b) => aMin(a.desde) - aMin(b.desde));
    const prox = ts.find((t) => off > 0 || aMin(t.desde) > min);
    if (!prox) continue;
    const dia = off === 0 ? "hoy" : off === 1 ? "mañana" : `el ${DIAS[(dow + off) % 7].toLowerCase()}`;
    return `Abre ${dia} a las ${prox.desde}`;
  }
  return null;
}

const textoTramos = (ts: Tramo[]) => ts.map((t) => `${t.desde}–${t.hasta}`).join(" y ");

/** "Lun a Vie 08:00–13:00 y 17:00–22:00 · Sáb 09:00–14:00" (agrupa días consecutivos con el mismo horario). */
export function resumenHorario(h: Horarios): string {
  const partes: string[] = [];
  let i = 0;
  while (i < ORDEN_SEMANA.length) {
    const ts = h[String(ORDEN_SEMANA[i])] ?? [];
    if (ts.length === 0) { i++; continue; }
    const clave = textoTramos(ts);
    let j = i;
    while (j + 1 < ORDEN_SEMANA.length && textoTramos(h[String(ORDEN_SEMANA[j + 1])] ?? []) === clave) j++;
    const ini = ABREV[ORDEN_SEMANA[i]], fin = ABREV[ORDEN_SEMANA[j]];
    partes.push(`${j === i ? ini : j === i + 1 ? `${ini} y ${fin}` : `${ini} a ${fin}`} ${clave}`);
    i = j + 1;
  }
  return partes.join(" · ");
}
