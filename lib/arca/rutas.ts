// Ayudas comunes de las rutas /api/arca: lectura del cuerpo, permisos y traducción de errores a respuestas.
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UUID } from "../pagos/mp";
import { crearAdmin, rolDe, type RolKiosco } from "../pagos/servidor";
import { ErrorArca } from "./servidor";

export type Ctx = { admin: SupabaseClient; body: Record<string, unknown>; kiosco: string; userId: string; rol: RolKiosco };
export async function contexto(req: Request, roles: RolKiosco[]): Promise<Ctx | NextResponse> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const kiosco = String(body?.kiosco ?? "");
  const admin = crearAdmin();
  const quien = await rolDe(req, admin, kiosco, roles);
  if (!body || !quien) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  return { admin, body, kiosco, userId: quien.userId, rol: quien.rol };
}
export const uuidDe = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

// Los códigos de ErrorArca y de SQL se traducen a texto en el navegador (components/caja/Facturacion.tsx).
export function respuestaError(e: unknown) {
  if (e instanceof ErrorArca) return NextResponse.json({ error: e.codigo, detalle: e.codigo === "arca_wsaa" || e.codigo === "arca_rechazo" ? e.message.slice(0, 200) : undefined }, { status: e.transitorio ? 503 : 400 });
  if (e instanceof Error && /falta_pagos_cifrado_key|pagos_cifrado_key_invalida/.test(e.message)) return NextResponse.json({ error: "servidor_sin_clave" }, { status: 500 });
  return NextResponse.json({ error: "db" }, { status: 500 });
}
