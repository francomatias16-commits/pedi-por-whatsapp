// "Conectar con Mercado Pago": el dueño toca el botón y el panel pide acá la dirección de autorización de Mercado Pago.
// Es POST con la sesión del dueño (una redirección del navegador no puede llevar el encabezado Authorization).
// El state va firmado y atado a este navegador con una cookie httpOnly; el callback exige las dos cosas.
import { NextResponse } from "next/server";
import { COOKIE_STATE, MINUTOS_STATE, crearState, redirectUri, urlAutorizacion } from "@/lib/pagos/oauth";
import { crearAdmin, esDueno, oauthConfig, origenApp } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kiosco = String(body?.kiosco ?? "");
  const admin = crearAdmin();
  if (!(await esDueno(req, admin, kiosco))) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  const cfg = oauthConfig();
  if (!cfg) return NextResponse.json({ error: "oauth_sin_configurar" }, { status: 503 });

  const t = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: u } = await admin.auth.getUser(t);
  if (!u.user) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });

  const origen = origenApp(req);
  const { state, nonce } = crearState({ kiosco, usuario: u.user.id, secreto: cfg.clientSecret });
  const res = NextResponse.json({ url: urlAutorizacion({ clientId: cfg.clientId, redirectUri: redirectUri(origen), state }) });
  res.cookies.set(COOKIE_STATE, nonce, { httpOnly: true, secure: origen.startsWith("https://"), sameSite: "lax", path: "/api/pagos/mp/oauth", maxAge: MINUTOS_STATE * 60 });
  return res;
}
