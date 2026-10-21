// Mercado Pago: firma de webhooks, mapeo de estados, armado de la preferencia y llamadas a la API.
// Sin imports relativos: se prueba directo con `npm test`.
import { createHmac, timingSafeEqual } from "node:crypto";

export type EstadoPago = "pendiente" | "aprobado" | "rechazado" | "vencido" | "reembolsado";
export type PagoMP = { id: number | string; status?: string; external_reference?: string | null; transaction_amount?: number; currency_id?: string };

// Horas que un pedido espera su pago antes de vencer y liberar el stock. Tiene que coincidir con pago_horas_vencimiento() de la base
// (lo verifica tests/pagos.test.mjs).
export const HORAS_VENCIMIENTO = 3;

const API = "https://api.mercadopago.com";
export class ErrorMP extends Error {
  constructor(public status: number) { super(`mp_${status}`); }
}

export function estadoDesdeMP(status?: string): EstadoPago | null {
  switch (status) {
    case "approved": return "aprobado";
    case "pending": case "in_process": case "in_mediation": case "authorized": return "pendiente";
    case "rejected": case "cancelled": return "rechazado";
    case "refunded": case "charged_back": return "reembolsado";
    default: return null;
  }
}

// Access Token de Mercado Pago: APP_USR-… (producción) o TEST-… (pruebas).
export const tokenMPValido = (t: unknown): t is string => typeof t === "string" && /^(APP_USR|TEST)-[A-Za-z0-9_-]{20,200}$/.test(t.trim());
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// x-signature: "ts=…,v1=…". El texto firmado es "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" (se omite la parte que falte).
export function verificarFirma(o: { xSignature: string | null; xRequestId: string | null; dataId: string | null; secreto: string | undefined }): boolean {
  if (!o.secreto || !o.xSignature) return false; // sin secreto, se rechaza
  const partes: Record<string, string> = {};
  for (const p of o.xSignature.split(",")) {
    const i = p.indexOf("=");
    if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  const ts = partes.ts, v1 = partes.v1;
  if (!ts || !v1) return false;
  const id = o.dataId && /^[a-z0-9]+$/i.test(o.dataId) ? o.dataId.toLowerCase() : o.dataId;
  const manifiesto = `${id ? `id:${id};` : ""}${o.xRequestId ? `request-id:${o.xRequestId};` : ""}ts:${ts};`;
  const esperado = createHmac("sha256", o.secreto).update(manifiesto).digest("hex");
  const a = Buffer.from(esperado), b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

// El monto sale SIEMPRE de la base. Un solo ítem con el total evita diferencias de redondeo con los renglones.
export function armarPreferencia(o: { pedidoId: string; numero: number; total: number; kioscoId: string; kioscoNombre: string; slug: string; origen: string; ahora?: Date }) {
  const https = o.origen.startsWith("https://"); // Mercado Pago exige https para el regreso automático y los avisos
  const volver = `${o.origen}/${o.slug}/pago?pedido=${o.pedidoId}`;
  const vence = new Date((o.ahora ?? new Date()).getTime() + HORAS_VENCIMIENTO * 3600 * 1000).toISOString();
  return {
    items: [{ title: `Pedido #${o.numero} en ${o.kioscoNombre}`.slice(0, 120), quantity: 1, unit_price: Number(o.total), currency_id: "ARS" }],
    external_reference: o.pedidoId,
    ...(https ? { notification_url: `${o.origen}/api/pagos/mp/webhook?kiosco=${o.kioscoId}`, auto_return: "approved" } : {}),
    back_urls: { success: volver, pending: volver, failure: volver },
    expires: true,
    expiration_date_to: vence,
  };
}

export async function mp<T>(token: string, ruta: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + ruta, {
    ...init, cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new ErrorMP(r.status);
  const texto = await r.text(); // algunas respuestas (borrar una orden) vienen vacías
  return (texto ? JSON.parse(texto) : {}) as T;
}

export const mpUsuario = (token: string) => mp<{ id: number; nickname?: string; site_id?: string }>(token, "/users/me");
export const mpCrearPreferencia = (token: string, body: unknown) => mp<{ id: string; init_point: string }>(token, "/checkout/preferences", { method: "POST", body: JSON.stringify(body) });
export const mpPago = (token: string, id: string | number) => mp<PagoMP>(token, `/v1/payments/${encodeURIComponent(String(id))}`);
export const mpBuscarPagos = async (token: string, referencia: string) =>
  (await mp<{ results?: PagoMP[] }>(token, `/v1/payments/search?external_reference=${encodeURIComponent(referencia)}&sort=date_created&criteria=desc&limit=10`)).results ?? [];

// De varios pagos del mismo pedido, el que decide: uno aprobado; si no, uno pendiente (se espera); si no, el último.
export function pagoDecisivo(pagos: PagoMP[]): PagoMP | null {
  const a = pagos.find((p) => estadoDesdeMP(p.status) === "aprobado");
  if (a) return a;
  if (pagos.some((p) => estadoDesdeMP(p.status) === "pendiente")) return null;
  return pagos[0] ?? null;
}

// --- QR del mostrador (Etapa 2B). Los datos de cada llamada los arma lib/pagos/qr.ts.
// Sucursal y caja: API de Instore (POST /users/{id}/stores y POST /v2/pos). Cobros: API de Orders (type "qr", modo static sobre el QR fijo de la caja).
export type TiendaMP = { id: number | string; external_id?: string };
export type CajaMP = {
  id: number | string; external_id?: string;
  qr_response?: { image?: string; template_document?: string; template_image?: string };
  qr?: { image?: string; template_document?: string; template_image?: string }; // formato anterior de la respuesta
};
export const imagenQR = (c: CajaMP) => c.qr_response ?? c.qr ?? null;
export const mpBuscarTienda = async (token: string, mpUserId: string, externalId: string) =>
  (await mp<{ results?: TiendaMP[] }>(token, `/users/${encodeURIComponent(mpUserId)}/stores/search?external_id=${encodeURIComponent(externalId)}`)).results?.[0] ?? null;
export const mpCrearTienda = (token: string, mpUserId: string, body: unknown) =>
  mp<TiendaMP>(token, `/users/${encodeURIComponent(mpUserId)}/stores`, { method: "POST", body: JSON.stringify(body) });
export const mpBuscarCaja = async (token: string, externalId: string) =>
  (await mp<{ results?: CajaMP[] }>(token, `/pos?external_id=${encodeURIComponent(externalId)}`)).results?.[0] ?? null;
export const mpCrearCaja = (token: string, body: unknown, idempotencia: string) =>
  mp<CajaMP>(token, "/v2/pos", { method: "POST", body: JSON.stringify(body), headers: { "X-Idempotency-Key": idempotencia } });

export type OrdenMP = {
  id: string; status?: string; status_detail?: string; external_reference?: string | null; total_amount?: string | number;
  transactions?: { payments?: { id?: string; amount?: string | number; status?: string }[]; refunds?: { id?: string; amount?: string | number; status?: string }[] };
};
// La clave de idempotencia es el id del cobro: reintentar la misma creación no duplica la orden.
export const mpCrearOrdenQR = (token: string, body: unknown, idempotencia: string) =>
  mp<OrdenMP>(token, "/v1/orders", { method: "POST", body: JSON.stringify(body), headers: { "X-Idempotency-Key": idempotencia } });
export const mpOrden = (token: string, id: string) => mp<OrdenMP>(token, `/v1/orders/${encodeURIComponent(id)}`);
// Solo se cancela una orden en estado "created"; si ya se pagó, Mercado Pago la rechaza y el cobro se reconcilia como aprobado.
export const mpCancelarOrdenQR = (token: string, id: string, idempotencia: string) =>
  mp<OrdenMP>(token, `/v1/orders/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { "X-Idempotency-Key": idempotencia } });
// Reembolso de una orden QR ya pagada (Orders API). `cuerpo` vacío (null/undefined) reembolsa el total;
// para uno parcial: { transactions: [{ id: <id del pago>, amount: "100.00" }] }.
// La clave de idempotencia evita reembolsar dos veces si se reintenta.
export const mpReembolsarOrden = (token: string, id: string, cuerpo: unknown, idempotencia: string) =>
  mp<OrdenMP>(token, `/v1/orders/${encodeURIComponent(id)}/refund`, {
    method: "POST",
    headers: { "X-Idempotency-Key": idempotencia },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
