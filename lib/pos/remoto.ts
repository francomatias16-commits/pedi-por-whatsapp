// Escáner remoto: el celular lee los códigos y los manda a la caja por un canal de Realtime (broadcast).
// No hay servidor propio de por medio: el "secreto" es un token aleatorio de 256 bits que viaja en el QR y da el nombre
// del canal. Quien no tiene el link no puede adivinar el canal. Cerrar el vínculo (o el vencimiento) lo deja sin uso.
export const DURACION_MIN = 45;               // sin escaneos durante este tiempo, el vínculo vence
export const PREFIJO_CANAL = "pos-scan-";

export function nuevoToken(): string {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const tokenValido = (t: string | null | undefined) => /^[A-Za-z0-9_-]{43}$/.test(t ?? "");
export const nombreCanal = (t: string) => PREFIJO_CANAL + t;
export const urlVinculo = (origin: string, t: string) => `${origin}/escanear?t=${encodeURIComponent(t)}`;

// Si la cámara del celular lee por error el QR de vinculación (el primer cuadro puede apuntar a la pantalla), no es un producto.
export const esLinkPropio = (c: string) => /\/escanear(?:[/?]|$)/i.test(c);

/** Valida lo que llega por el canal (viene de la red: nunca se confía). Devuelve el código limpio o null. */
export function limpiarCodigo(c: unknown): string | null {
  if (typeof c !== "string") return null;
  const t = c.trim();
  if (t.length < 1 || t.length > 64 || !/^[\x20-\x7e]+$/.test(t) || esLinkPropio(t)) return null;
  return t;
}

export type Guardado = { token: string; kiosco: string; expira_at: number };
type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const clave = (kiosco: string) => `pos-vinculo:${kiosco}`;
export const nuevaExpiracion = (ahora: number) => ahora + DURACION_MIN * 60_000;

export function guardarVinculo(a: Almacen, g: Guardado) { try { a.setItem(clave(g.kiosco), JSON.stringify(g)); } catch { /* modo privado: no persiste */ } }
export function borrarVinculo(a: Almacen, kiosco: string) { try { a.removeItem(clave(kiosco)); } catch { /* nada */ } }
/** Vínculo guardado de ESTE kiosco que siga vigente; si está vencido o corrupto, lo borra y devuelve null. */
export function leerVinculo(a: Almacen, kiosco: string, ahora: number): Guardado | null {
  try {
    const raw = a.getItem(clave(kiosco)); if (!raw) return null;
    const g = JSON.parse(raw) as Guardado;
    if (g && g.kiosco === kiosco && tokenValido(g.token) && Number.isFinite(g.expira_at) && g.expira_at > ahora) return g;
  } catch { /* corrupto */ }
  borrarVinculo(a, kiosco); return null;
}
