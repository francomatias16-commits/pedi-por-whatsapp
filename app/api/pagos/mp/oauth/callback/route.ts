// Vuelta de Mercado Pago tras aceptar (o cancelar). Canjea el código por el token, lo guarda cifrado, enciende el cobro online
// y devuelve al dueño al panel con ?mp=<resultado>. La autenticación es el state firmado + la cookie del navegador que lo pidió.
import { NextResponse } from "next/server";
import { ErrorMP, mpUsuario } from "@/lib/pagos/mp";
import { COOKIE_STATE, leerState, type MotivoVuelta } from "@/lib/pagos/oauth";
import { activarCobroOnline, canjearCodigoOAuth, crearAdmin, guardarConexionOAuth, oauthConfig, origenApp } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cookieDe = (req: Request, nombre: string) => req.headers.get("cookie")?.split(";").map((c) => c.trim()).find((c) => c.startsWith(nombre + "="))?.slice(nombre.length + 1) ?? null;

export async function GET(req: Request) {
  const origen = origenApp(req);
  const volver = (motivo: MotivoVuelta) => {
    const res = NextResponse.redirect(new URL(`/panel/negocio?mp=${motivo}`, origen));
    res.cookies.set(COOKIE_STATE, "", { path: "/api/pagos/mp/oauth", maxAge: 0 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
  const q = new URL(req.url).searchParams;
  const cfg = oauthConfig();
  if (!cfg) return volver("sin_configurar");

  const datos = leerState(q.get("state"), cfg.clientSecret);
  const cookie = cookieDe(req, COOKIE_STATE);
  if (!datos || !cookie || cookie !== datos.nonce) return volver("estado_invalido");
  if (q.get("error")) return volver("cancelado"); // el dueño no aceptó en Mercado Pago
  const code = q.get("code") ?? "";
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(code)) return volver("estado_invalido");

  const admin = crearAdmin();
  const { data: k } = await admin.from("kioscos").select("owner_id,es_demo").eq("id", datos.kiosco).maybeSingle();
  if (!k || k.es_demo || k.owner_id !== datos.usuario) return volver("no_autorizado");

  let token;
  try { token = await canjearCodigoOAuth(code, origen); }
  catch (e) { return volver(e instanceof ErrorMP && e.status >= 400 && e.status < 500 ? "mp_rechazo" : "mp_no_responde"); }

  try {
    const usuario = await mpUsuario(token.access_token);
    if (usuario.site_id && usuario.site_id !== "MLA") return volver("cuenta_otro_pais"); // los cobros son en pesos argentinos
  } catch { return volver("mp_no_responde"); }

  try {
    if (!(await guardarConexionOAuth(admin, datos.kiosco, token))) return volver("db");
  } catch { return volver("servidor_sin_clave"); } // falta PAGOS_CIFRADO_KEY
  await activarCobroOnline(admin, datos.kiosco);
  return volver("ok");
}
