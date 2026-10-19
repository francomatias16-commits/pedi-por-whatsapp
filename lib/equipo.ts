// Equipo del kiosco: enlaces de invitación y mensajes. Lógica pura (sin React) para probarla con `npm test`.
import type { Rol } from "./navegacion";

export type Miembro = { user_id: string; rol: Rol; activo: boolean; email: string | null; desde: string };
export type Invitacion = { id: string; rol: Exclude<Rol, "dueno">; expira_at: string; creada: string };

// El token son 64 caracteres hexadecimales (lo genera la base; acá solo se valida el formato antes de llamarla).
export const tokenValido = (t: unknown): t is string => typeof t === "string" && /^[0-9a-f]{64}$/.test(t);

export const rutaInvitacion = (token: string): string => `/unirse/${token}`;
export const linkInvitacion = (origen: string, token: string): string => `${origen.replace(/\/+$/, "")}${rutaInvitacion(token)}`;

// "/unirse/abc…" → token (o null si el formato no es válido).
export function tokenDeRuta(pathname: string): string | null {
  const m = /^\/unirse\/([^/?#]+)\/?$/.exec(pathname);
  return m && tokenValido(m[1]) ? m[1] : null;
}

const ARTICULO: Record<string, string> = { cajero: "como cajero", encargado: "como encargado" };
export function mensajeInvitacion(nombreLocal: string, rol: Exclude<Rol, "dueno">, link: string): string {
  return `Hola. Te invito a sumarte a ${nombreLocal} ${ARTICULO[rol]} en Pedí por WhatsApp. Entrá con tu cuenta de Google desde este enlace (sirve una sola vez y vence en 7 días): ${link}`;
}

// Días que le quedan a una invitación (0 si ya venció).
export function diasRestantes(expira: string, ahora: Date = new Date()): number {
  const ms = new Date(expira).getTime() - ahora.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

// El dueño va primero, después los activos, y al final los que se quitaron.
export function ordenarMiembros(ms: Miembro[]): Miembro[] {
  const peso = (m: Miembro) => (m.rol === "dueno" ? 0 : m.activo ? 1 : 2);
  return [...ms].sort((a, b) => peso(a) - peso(b) || a.desde.localeCompare(b.desde));
}
