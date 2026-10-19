// Estado de salud del servicio (lo usa /api/salud). Lógica pura para poder probarla con `npm test`.
export type Chequeo = { ok: boolean; ms?: number };
export type Salud = { estado: "ok" | "degradado"; db: Chequeo; version: string };

// Variables que el servidor necesita para funcionar. Solo se informa si están o no, nunca su valor.
export const VARIABLES_SERVIDOR = ["SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "PUSH_WEBHOOK_SECRET", "VAPID_PRIVATE_KEY"] as const;

export function armarSalud(db: Chequeo, version: string): Salud {
  return { estado: db.ok ? "ok" : "degradado", db, version };
}

export const variablesFaltantes = (env: Record<string, string | undefined>) =>
  VARIABLES_SERVIDOR.filter((k) => !env[k]);
