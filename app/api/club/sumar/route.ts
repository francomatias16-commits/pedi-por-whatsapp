// El cliente toca "Sumar mi compra" en su tarjeta: se suma el sello y se avisa al kiosquero.
import { NextResponse } from "next/server";
import { CLUB_TOKEN_RE } from "@/lib/club";
import { anonimo, avisarClub, sinAviso } from "../_comun";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (typeof token !== "string" || !CLUB_TOKEN_RE.test(token)) return NextResponse.json({ error: "club_token_invalido" }, { status: 400 });
  const { data, error } = await anonimo().rpc("club_sumar", { p_token: token });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  await avisarClub((data as { _aviso?: Parameters<typeof avisarClub>[0] })._aviso);
  return NextResponse.json(sinAviso(data as { _aviso?: unknown }));
}
