// El dueño pega su Access Token (y la clave secreta de webhooks). Se valida contra Mercado Pago, se cifra y se guarda.
import { NextResponse } from "next/server";
import { cifrar, ultimos4 } from "@/lib/pagos/cifrado";
import { ErrorMP, mpUsuario, tokenMPValido } from "@/lib/pagos/mp";
import { crearAdmin, esDueno } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kiosco = String(body?.kiosco ?? "");
  const token = String(body?.token ?? "").trim();
  const secreto = String(body?.webhook_secret ?? "").trim();
  const admin = crearAdmin();
  if (!(await esDueno(req, admin, kiosco))) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  if (!tokenMPValido(token)) return NextResponse.json({ error: "token_invalido" }, { status: 400 });
  if (secreto.length < 8 || secreto.length > 200) return NextResponse.json({ error: "secreto_invalido" }, { status: 400 });

  let usuario;
  try { usuario = await mpUsuario(token); }
  catch (e) { return NextResponse.json({ error: e instanceof ErrorMP && (e.status === 401 || e.status === 403) ? "token_rechazado" : "mp_no_responde" }, { status: 400 }); }
  if (usuario.site_id && usuario.site_id !== "MLA") return NextResponse.json({ error: "cuenta_otro_pais" }, { status: 400 }); // los cobros son en pesos argentinos

  let token_cifrado: string, webhook_secret_cifrado: string;
  try { token_cifrado = cifrar(token); webhook_secret_cifrado = cifrar(secreto); }
  catch { return NextResponse.json({ error: "servidor_sin_clave" }, { status: 500 }); } // falta PAGOS_CIFRADO_KEY

  const { error } = await admin.from("integraciones_pago").upsert({
    kiosco_id: kiosco, token_cifrado, webhook_secret_cifrado, token_ultimos4: ultimos4(token), mp_user_id: String(usuario.id),
    activa: true, forma_conexion: "token", updated_at: new Date().toISOString(),
  }, { onConflict: "kiosco_id" });
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });

  // Conectar es querer cobrar: se enciende el cobro online y Mercado Pago pasa a ser un medio de pago de la tienda.
  const { data: k } = await admin.from("kioscos").select("medios_pago").eq("id", kiosco).maybeSingle();
  const medios: string[] = k?.medios_pago ?? ["efectivo"];
  await admin.from("kioscos").update({ cobro_online_activo: true, medios_pago: medios.includes("mercadopago") ? medios : [...medios, "mercadopago"] }).eq("id", kiosco);
  return NextResponse.json({ conectada: true, mp_user_id: String(usuario.id), cuenta: usuario.nickname ?? null });
}
