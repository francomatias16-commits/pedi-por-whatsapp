// Registro del cliente con el QR del local: crea la tarjeta, suma el primer sello y avisa al kiosquero.
import { NextResponse } from "next/server";
import { anonimo, avisarClub, sinAviso } from "../_comun";
import { normalizarRef } from "@/lib/club";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { slug?: string; nombre?: string; telefono?: string; ref?: string };
  if (typeof b.slug !== "string" || typeof b.nombre !== "string" || typeof b.telefono !== "string") return NextResponse.json({ error: "club_nombre_invalido" }, { status: 400 });
  const ref = typeof b.ref === "string" ? normalizarRef(b.ref) : "";
  // Con código de un amigo se usa la función de 4 parámetros (0051); sin código, la de siempre (QR viejos).
  const { data, error } = await anonimo().rpc("club_unirse", ref ? { p_slug: b.slug, p_nombre: b.nombre, p_telefono: b.telefono, p_ref: ref } : { p_slug: b.slug, p_nombre: b.nombre, p_telefono: b.telefono });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  await avisarClub((data as { _aviso?: Parameters<typeof avisarClub>[0] })._aviso);
  return NextResponse.json(sinAviso(data as { _aviso?: unknown }));
}
