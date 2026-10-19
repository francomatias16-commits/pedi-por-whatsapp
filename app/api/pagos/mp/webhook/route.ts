// Avisos de Mercado Pago. Firma verificada (rechazo si falta el secreto), cada evento registrado y proceso idempotente.
// El aviso solo dice "cambió el pago X" (pedidos de la tienda) o "cambió la orden Y" (cobros QR del mostrador):
// el estado real se consulta a Mercado Pago con el token del kiosco.
import { NextResponse } from "next/server";
import { ErrorMP, UUID, mpOrden, mpPago, verificarFirma } from "@/lib/pagos/mp";
import { aplicarOrdenQR, aplicarPago, credenciales, crearAdmin, marcarTokenInvalido } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const kiosco = url.searchParams.get("kiosco") ?? "";
  const body = await req.json().catch(() => null);
  const tipo = String(body?.type ?? body?.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
  // La firma cubre el id de la query (data.id); si no vino ahí, el del cuerpo.
  const dataId = url.searchParams.get("data.id") ?? (body?.data?.id != null ? String(body.data.id) : null);
  if (!UUID.test(kiosco)) return NextResponse.json({ error: "kiosco_invalido" }, { status: 400 });
  // Los avisos de la API de Orders traen el tipo "order" (tema "Order (Mercado Pago)") y el id de la orden (ORD…).
  const esOrden = tipo.startsWith("order") || /^ord/i.test(dataId ?? "");
  if ((tipo !== "payment" && !esOrden) || !dataId) return NextResponse.json({ ok: true, ignorado: true }); // otros tipos de aviso no nos interesan

  const admin = crearAdmin();
  const cred = await credenciales(admin, kiosco).catch(() => null);
  if (!cred) return NextResponse.json({ ok: true, ignorado: "sin_integracion" });
  if (!cred.secreto) return NextResponse.json({ error: "sin_secreto" }, { status: 503 }); // Mercado Pago reintenta

  const firmaOk = verificarFirma({ xSignature: req.headers.get("x-signature"), xRequestId: req.headers.get("x-request-id"), dataId, secreto: cred.secreto });
  const evento = body?.id != null ? String(body.id) : `${dataId}:${req.headers.get("x-request-id") ?? ""}`;
  const { data: procesar, error: errReg } = await admin.rpc("webhook_registrar", { p_proveedor: "mercadopago", p_evento: evento, p_firma_valida: firmaOk, p_tipo: tipo, p_kiosco: kiosco });
  if (!firmaOk) return NextResponse.json({ error: "firma_invalida" }, { status: 401 });
  if (errReg) return NextResponse.json({ error: "db" }, { status: 500 });
  if (!procesar) return NextResponse.json({ ok: true, duplicado: true });

  try {
    const resultado = esOrden ? await aplicarOrdenQR(admin, kiosco, await mpOrden(cred.token, dataId)) : await aplicarPago(admin, kiosco, await mpPago(cred.token, dataId));
    await admin.rpc("webhook_marcar", { p_proveedor: "mercadopago", p_evento: evento, p_estado: "procesado", p_detalle: resultado ?? "sin_pedido" });
    return NextResponse.json({ ok: true, resultado });
  } catch (e) {
    if (e instanceof ErrorMP && (e.status === 401 || e.status === 403)) await marcarTokenInvalido(admin, kiosco);
    await admin.rpc("webhook_marcar", { p_proveedor: "mercadopago", p_evento: evento, p_estado: "error", p_detalle: e instanceof Error ? e.message : "error" });
    return NextResponse.json({ error: "reintentar" }, { status: 500 }); // Mercado Pago reintenta
  }
}
