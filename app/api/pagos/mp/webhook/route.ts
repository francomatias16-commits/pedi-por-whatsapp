// Avisos de Mercado Pago. Firma verificada (rechazo si falta el secreto), cada evento registrado y proceso idempotente.
// El aviso solo dice "cambió el pago X" (pedidos de la tienda) o "cambió la orden Y" (cobros QR del mostrador):
// el estado real se consulta a Mercado Pago con el token del kiosco.
// Qué local es: por ?kiosco= si la dirección lo trae; si no (aviso general de la aplicación), por la cuenta vendedora (user_id del aviso).
import { NextResponse } from "next/server";
import { ErrorMP, UUID, mpOrden, mpPago, verificarFirma } from "@/lib/pagos/mp";
import { aplicarOrdenQR, aplicarPago, credenciales, crearAdmin, kioscosPorCuentaMP, marcarTokenInvalido, type Credenciales } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const body = await req.json().catch(() => null);
  const tipo = String(body?.type ?? body?.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
  // La firma cubre el id de la query (data.id); si no vino ahí, el del cuerpo.
  const dataId = url.searchParams.get("data.id") ?? (body?.data?.id != null ? String(body.data.id) : null);
  // Los avisos de la API de Orders traen el tipo "order" (tema "Order (Mercado Pago)") y el id de la orden (ORD…).
  const esOrden = tipo.startsWith("order") || /^ord/i.test(dataId ?? "");
  if ((tipo !== "payment" && !esOrden) || !dataId) return NextResponse.json({ ok: true, ignorado: true }); // otros tipos de aviso no nos interesan

  const admin = crearAdmin();
  const paramKiosco = url.searchParams.get("kiosco") ?? "";
  let candidatos: string[];
  if (paramKiosco) {
    if (!UUID.test(paramKiosco)) return NextResponse.json({ error: "kiosco_invalido" }, { status: 400 });
    candidatos = [paramKiosco];
  } else {
    const uid = body?.user_id ?? body?.data?.user_id;
    candidatos = uid != null ? await kioscosPorCuentaMP(admin, String(uid)).catch(() => []) : [];
    if (!candidatos.length) return NextResponse.json({ error: "kiosco_invalido" }, { status: 400 });
  }

  // Credenciales de cada candidato. Un fallo pasajero (renovar el token, descifrar) se contesta 503 para que Mercado Pago reintente.
  const creds: { kiosco: string; cred: Credenciales }[] = [];
  for (const kiosco of candidatos) {
    let cred: Credenciales | null;
    try { cred = await credenciales(admin, kiosco); } catch { return NextResponse.json({ error: "reintentar" }, { status: 503 }); }
    if (cred) creds.push({ kiosco, cred });
  }
  if (!creds.length) return NextResponse.json({ ok: true, ignorado: "sin_integracion" });
  if (creds.every((c) => !c.cred.secreto)) return NextResponse.json({ error: "sin_secreto" }, { status: 503 }); // Mercado Pago reintenta

  const xSignature = req.headers.get("x-signature"), xRequestId = req.headers.get("x-request-id");
  const validos = creds.filter((c) => verificarFirma({ xSignature, xRequestId, dataId, secreto: c.cred.secreto ?? undefined }));
  const evento = body?.id != null ? String(body.id) : `${dataId}:${xRequestId ?? ""}`;
  const principal = (validos[0] ?? creds[0]).kiosco;
  const { data: procesar, error: errReg } = await admin.rpc("webhook_registrar", { p_proveedor: "mercadopago", p_evento: evento, p_firma_valida: validos.length > 0, p_tipo: tipo, p_kiosco: principal });
  if (!validos.length) return NextResponse.json({ error: "firma_invalida" }, { status: 401 });
  if (errReg) return NextResponse.json({ error: "db" }, { status: 500 });
  if (!procesar) return NextResponse.json({ ok: true, duplicado: true });

  // Con una cuenta compartida por varios locales, el que corresponde es el dueño del pedido o del cobro (las funciones lo verifican).
  let resultado: string | null = null;
  try {
    for (const { kiosco, cred } of validos) {
      try {
        resultado = esOrden ? await aplicarOrdenQR(admin, kiosco, await mpOrden(cred.token, dataId)) : await aplicarPago(admin, kiosco, await mpPago(cred.token, dataId));
      } catch (e) {
        if (e instanceof ErrorMP && (e.status === 401 || e.status === 403)) { await marcarTokenInvalido(admin, kiosco); if (validos.length > 1) continue; }
        throw e;
      }
      if (resultado) break;
    }
    await admin.rpc("webhook_marcar", { p_proveedor: "mercadopago", p_evento: evento, p_estado: "procesado", p_detalle: resultado ?? "sin_pedido" });
    return NextResponse.json({ ok: true, resultado });
  } catch (e) {
    await admin.rpc("webhook_marcar", { p_proveedor: "mercadopago", p_evento: evento, p_estado: "error", p_detalle: e instanceof Error ? e.message : "error" });
    return NextResponse.json({ error: "reintentar" }, { status: 500 }); // Mercado Pago reintenta
  }
}
