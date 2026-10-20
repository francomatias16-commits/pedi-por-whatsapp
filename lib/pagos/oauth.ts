// Mercado Pago OAuth ("conectar con un clic"): lógica pura (dirección de autorización, state firmado, lectura de la respuesta,
// vencimiento del token). Sin imports relativos: se prueba directo con `npm test`.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const AUTORIZACION_URL = "https://auth.mercadopago.com.ar/authorization";
export const MINUTOS_STATE = 10;
// Se renueva cuando faltan menos de estos días (el token dura ~180). El cron diario renueva con más margen (DIAS_CRON).
export const DIAS_RENOVAR = 3;
export const DIAS_CRON = 30;
export const COOKIE_STATE = "mp_oauth";

export const redirectUri = (origen: string) => `${origen.replace(/\/+$/, "")}/api/pagos/mp/oauth/callback`;

// Clave para firmar el state: derivada del secreto de la aplicación (no se guarda ni se reutiliza el secreto crudo).
const claveState = (secreto: string) => createHash("sha256").update("mp-oauth-state:" + secreto).digest();
const firmar = (cuerpo: string, secreto: string) => createHmac("sha256", claveState(secreto)).update(cuerpo).digest("base64url");

export type DatosState = { kiosco: string; usuario: string; nonce: string; vence: number };

// state = base64url(kiosco|usuario|nonce|vence) . firma. El nonce también viaja en una cookie httpOnly: sin las dos cosas no se acepta
// (un enlace de retorno armado por otra persona no sirve para conectar la cuenta de otra).
export function crearState(o: { kiosco: string; usuario: string; secreto: string; ahora?: number; nonce?: string }): { state: string; nonce: string } {
  const nonce = o.nonce ?? randomBytes(16).toString("base64url");
  const vence = (o.ahora ?? Date.now()) + MINUTOS_STATE * 60_000;
  const cuerpo = Buffer.from([o.kiosco, o.usuario, nonce, String(vence)].join("|")).toString("base64url");
  return { state: `${cuerpo}.${firmar(cuerpo, o.secreto)}`, nonce };
}

export function leerState(state: string | null | undefined, secreto: string | undefined, ahora = Date.now()): DatosState | null {
  if (!state || !secreto) return null;
  const [cuerpo, firma, resto] = state.split(".");
  if (!cuerpo || !firma || resto !== undefined) return null;
  const esperada = Buffer.from(firmar(cuerpo, secreto)), recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  const partes = Buffer.from(cuerpo, "base64url").toString("utf8").split("|");
  if (partes.length !== 4) return null;
  const [kiosco, usuario, nonce, v] = partes;
  const vence = Number(v);
  if (!kiosco || !usuario || !nonce || !Number.isFinite(vence) || vence < ahora) return null;
  return { kiosco, usuario, nonce, vence };
}

export function urlAutorizacion(o: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({ client_id: o.clientId, response_type: "code", platform_id: "mp", state: o.state, redirect_uri: o.redirectUri });
  return `${AUTORIZACION_URL}?${q.toString()}`;
}

export type TokenOAuth = { access_token: string; refresh_token: string; expires_in: number; user_id: string; public_key: string | null };

// Respuesta de POST /oauth/token (canje del código o renovación). Devuelve null si falta algo esencial.
export function leerTokenOAuth(r: unknown): TokenOAuth | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const acc = o.access_token, ref = o.refresh_token;
  if (typeof acc !== "string" || acc.length < 20 || typeof ref !== "string" || ref.length < 10) return null;
  const exp = Number(o.expires_in);
  const uid = o.user_id;
  if (uid == null || !/^\d+$/.test(String(uid))) return null;
  return {
    access_token: acc, refresh_token: ref,
    expires_in: Number.isFinite(exp) && exp > 0 ? exp : 15_552_000, // si no vino, se asume 180 días
    user_id: String(uid), public_key: typeof o.public_key === "string" ? o.public_key : null,
  };
}

export const calcularExpira = (expiresIn: number, ahora = Date.now()) => new Date(ahora + expiresIn * 1000).toISOString();

// ¿Toca renovar? Sin fecha de vencimiento (dato dañado) se renueva.
export function necesitaRenovar(expiraAt: string | null | undefined, ahora = Date.now(), dias = DIAS_RENOVAR): boolean {
  if (!expiraAt) return true;
  const t = Date.parse(expiraAt);
  return !Number.isFinite(t) || t - ahora < dias * 86_400_000;
}
export const vencido = (expiraAt: string | null | undefined, ahora = Date.now()) => !expiraAt || !(Date.parse(expiraAt) > ahora);

// Mensajes de regreso al panel (?mp=...): lista cerrada para no reflejar texto de la URL.
export const MOTIVOS_VUELTA = ["ok", "cancelado", "sin_configurar", "estado_invalido", "cuenta_otro_pais", "mp_rechazo", "mp_no_responde", "no_autorizado", "db", "servidor_sin_clave"] as const;
export type MotivoVuelta = (typeof MOTIVOS_VUELTA)[number];
export const motivoVuelta = (v: unknown): MotivoVuelta | null => (MOTIVOS_VUELTA as readonly string[]).includes(String(v)) ? (String(v) as MotivoVuelta) : null;
