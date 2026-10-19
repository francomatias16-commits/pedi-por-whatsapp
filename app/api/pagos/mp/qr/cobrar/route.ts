// Crea un cobro QR en el mostrador: registra el cobro en la base (que valida turno abierto, monto, interruptor y que no haya otro pendiente)
// y le pide a Mercado Pago la orden (API de Orders, modo static) sobre el QR fijo del local. El monto es el que se cobra por QR en esta venta, no el de otro medio.
// Pueden cobrar cajero, encargado y dueño.
import { NextResponse } from "next/server";
import { ErrorMP, UUID, mpCancelarOrdenQR, mpCrearOrdenQR } from "@/lib/pagos/mp";
import { armarOrdenQR, montoQRValido } from "@/lib/pagos/qr";
import { credenciales, crearAdmin, marcarTokenInvalido, rolDe } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODIGOS_BASE = ["qr_inactivo", "qr_sin_config", "turno_cerrado", "qr_monto_invalido", "qr_ocupado"];

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kiosco = String(body?.kiosco ?? ""), turno = String(body?.turno ?? ""), monto = Number(body?.monto);
  if (!UUID.test(kiosco) || !UUID.test(turno)) return NextResponse.json({ error: "datos_invalidos" }, { status: 400 });
  const admin = crearAdmin();
  const quien = await rolDe(req, admin, kiosco);
  if (!quien) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  if (!montoQRValido(monto)) return NextResponse.json({ error: "qr_monto_invalido" }, { status: 400 });

  const { data, error } = await admin.rpc("qr_crear_cobro", { p_kiosco: kiosco, p_turno: turno, p_monto: monto, p_usuario: quien.userId });
  if (error) {
    const m = error.message ?? "";
    // El índice de "un cobro pendiente por local" también frena a dos cajeros que cobran en el mismo instante.
    const codigo = CODIGOS_BASE.find((c) => m.includes(c)) ?? (m.includes("cobros_qr_pos_uno_pendiente") ? "qr_ocupado" : "db");
    return NextResponse.json({ error: codigo }, { status: codigo === "db" ? 500 : 409 });
  }
  const cobroId = (data as { cobro_id: string }).cobro_id;
  const expiraAt = (data as { expira_at: string }).expira_at;

  const liberar = async () => { await admin.rpc("qr_cancelar_cobro", { p_cobro: cobroId }); };
  const cred = await credenciales(admin, kiosco).catch(() => null);
  const { data: cfg } = await admin.from("pos_qr_config").select("external_pos_id,mp_user_id").eq("kiosco_id", kiosco).maybeSingle();
  if (!cred?.activa || !cfg || cfg.mp_user_id !== cred.mpUserId) { await liberar(); return NextResponse.json({ error: "qr_sin_config" }, { status: 409 }); }
  const { data: k } = await admin.from("kioscos").select("nombre").eq("id", kiosco).maybeSingle();
  try {
    // La clave de idempotencia es el cobro: si la respuesta se pierde y se reintenta, Mercado Pago no crea una segunda orden.
    const orden = await mpCrearOrdenQR(cred.token, armarOrdenQR({ cobroId, monto, kioscoNombre: k?.nombre ?? "el local", externalPosId: cfg.external_pos_id }), cobroId);
    if (!orden.id) throw new ErrorMP(502);
    const { error: errOrden } = await admin.from("cobros_qr_pos").update({ mp_order_id: orden.id, updated_at: new Date().toISOString() }).eq("id", cobroId);
    if (errOrden) { await liberar(); await mpCancelarOrdenQR(cred.token, orden.id, `${cobroId}-c`).catch(() => null); return NextResponse.json({ error: "db" }, { status: 500 }); }
    return NextResponse.json({ cobro_id: cobroId, expira_at: expiraAt, monto });
  } catch (e) {
    await liberar(); // sin orden en Mercado Pago no hay nada que cobrar: se libera el QR para el próximo intento
    if (e instanceof ErrorMP && (e.status === 401 || e.status === 403)) { await marcarTokenInvalido(admin, kiosco); return NextResponse.json({ error: "qr_sin_config" }, { status: 409 }); }
    return NextResponse.json({ error: "mp_no_responde" }, { status: 502 });
  }
}
