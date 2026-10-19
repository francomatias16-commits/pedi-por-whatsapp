// "Probar la conexión": consulta a Mercado Pago con la credencial guardada. Si la revocaron, apaga el cobro online.
import { NextResponse } from "next/server";
import { ErrorMP, mpUsuario } from "@/lib/pagos/mp";
import { credenciales, crearAdmin, esDueno, marcarTokenInvalido } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kiosco = String(body?.kiosco ?? "");
  const admin = crearAdmin();
  if (!(await esDueno(req, admin, kiosco))) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  const cred = await credenciales(admin, kiosco).catch(() => null);
  if (!cred) return NextResponse.json({ ok: false, motivo: "sin_conexion" });
  try {
    const u = await mpUsuario(cred.token);
    return NextResponse.json({ ok: true, mp_user_id: String(u.id), cuenta: u.nickname ?? null, secreto_cargado: !!cred.secreto });
  } catch (e) {
    if (e instanceof ErrorMP && (e.status === 401 || e.status === 403)) {
      await marcarTokenInvalido(admin, kiosco);
      return NextResponse.json({ ok: false, motivo: "token_invalido" });
    }
    return NextResponse.json({ ok: false, motivo: "mp_no_responde" });
  }
}
