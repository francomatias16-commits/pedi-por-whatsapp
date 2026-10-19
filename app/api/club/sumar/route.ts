// El cliente elige cómo pagó en su tarjeta: se suma el sello y se avisa al kiosquero (aviso especial si fue transferencia o Mercado Pago).
// Si el local exige papelito para efectivo, va el código. Un código mal o ya usado no es un error de SQL: vuelve como _error y acá se responde 409.
import { NextResponse } from "next/server";
import { CLUB_TOKEN_RE, esMedioClub, normalizarCodigoClub } from "@/lib/club";
import { anonimo, avisarClub, sinAviso } from "../_comun";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token, medio, codigo } = (await req.json().catch(() => ({}))) as { token?: string; medio?: string; codigo?: unknown };
  if (typeof token !== "string" || !CLUB_TOKEN_RE.test(token)) return NextResponse.json({ error: "club_token_invalido" }, { status: 400 });
  const m = medio === undefined ? "efectivo" : medio; // versiones viejas de la tarjeta no mandan el medio
  if (!esMedioClub(m)) return NextResponse.json({ error: "club_medio_invalido" }, { status: 400 });
  if (codigo !== undefined && codigo !== null && (typeof codigo !== "string" || codigo.length > 40)) return NextResponse.json({ error: "club_codigo_invalido" }, { status: 400 });
  const cod = typeof codigo === "string" ? normalizarCodigoClub(codigo) : null;
  const { data, error } = await anonimo().rpc("club_sumar", { p_token: token, p_medio: m, p_codigo: cod || null });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  const r = data as { _aviso?: Parameters<typeof avisarClub>[0]; _error?: string };
  if (r._error) return NextResponse.json({ error: r._error }, { status: 409 });
  await avisarClub(r._aviso);
  return NextResponse.json(sinAviso(r));
}
