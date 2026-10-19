// Piezas compartidas por las dos rutas públicas del club: el cliente anónimo de Supabase y el aviso al kiosquero.
import { createClient } from "@supabase/supabase-js";
import { armarAvisoClub } from "@/lib/club";
import { avisarKiosco } from "@/lib/push-envio";

export const anonimo = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

type Aviso = { kiosco_id: string; cliente: string; cantidad: number; nuevo: boolean; medio?: string | null };

/** Avisa al kiosquero. Si falla no se rompe nada: el sello ya está sumado y también se ve en el panel. */
export async function avisarClub(a: Aviso | undefined) {
  if (!a?.kiosco_id) return;
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    await avisarKiosco(admin, a.kiosco_id, armarAvisoClub(a));
  } catch { /* sin aviso */ }
}

/** Saca de la respuesta lo que solo sirve para el aviso (el cliente no lo necesita). */
export function sinAviso<T extends { _aviso?: unknown }>(r: T): Omit<T, "_aviso"> {
  const { _aviso, ...resto } = r; void _aviso; return resto;
}
