// Lógica de servidor de los cobros con Mercado Pago. Usa la service role: solo se importa desde rutas de /api.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cifrar, descifrar } from "./cifrado";
import { ErrorMP, UUID, estadoDesdeMP, mpBuscarPagos, mpOrden, pagoDecisivo, type OrdenMP, type PagoMP } from "./mp";
import { DIAS_RENOVAR, calcularExpira, leerTokenOAuth, necesitaRenovar, redirectUri, vencido, type TokenOAuth } from "./oauth";
import { estadoDesdeOrden } from "./qr";
import { armarAvisoPago, armarAvisoQR } from "../push";
import { avisarKiosco } from "../push-envio";

export const crearAdmin = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// ¿Quien llama es el dueño de ese kiosco? Se valida el token de sesión de Supabase del encabezado Authorization.
export async function esDueno(req: Request, admin: SupabaseClient, kioscoId: string): Promise<boolean> {
  const t = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!t || !UUID.test(kioscoId)) return false;
  const { data } = await admin.auth.getUser(t);
  if (!data.user) return false;
  const { data: k } = await admin.from("kioscos").select("owner_id").eq("id", kioscoId).maybeSingle();
  return k?.owner_id === data.user.id;
}

// ¿Quien llama es miembro activo de ese kiosco (o su dueño) con uno de esos roles? Devuelve su id y su rol, o null.
export type RolKiosco = "cajero" | "encargado" | "dueno";
export async function rolDe(req: Request, admin: SupabaseClient, kioscoId: string, roles: RolKiosco[] = ["cajero", "encargado", "dueno"]): Promise<{ userId: string; rol: RolKiosco } | null> {
  const t = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!t || !UUID.test(kioscoId)) return null;
  const { data } = await admin.auth.getUser(t);
  if (!data.user) return null;
  const { data: k } = await admin.from("kioscos").select("owner_id").eq("id", kioscoId).maybeSingle();
  if (!k) return null;
  let rol: RolKiosco | null = null;
  if (k.owner_id === data.user.id) rol = "dueno";
  else {
    const { data: m } = await admin.from("kiosco_miembros").select("rol").eq("kiosco_id", kioscoId).eq("user_id", data.user.id).eq("activo", true).maybeSingle();
    rol = (m?.rol as RolKiosco | undefined) ?? null;
  }
  return rol && roles.includes(rol) ? { userId: data.user.id, rol } : null;
}

export type Credenciales = { token: string; secreto: string | null; mpUserId: string; activa: boolean };

// Variables de la aplicación de Mercado Pago (una sola para todos los locales).
export const oauthConfig = () => {
  const clientId = process.env.MP_OAUTH_CLIENT_ID, clientSecret = process.env.MP_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};
export const origenApp = (req: Request) => (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/+$/, "");

// POST /oauth/token (canje del código o renovación). Cuerpo JSON, sin Bearer.
async function pedirTokenOAuth(cuerpo: Record<string, string>): Promise<TokenOAuth> {
  const cfg = oauthConfig();
  if (!cfg) throw new Error("oauth_sin_configurar");
  const r = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...cuerpo }),
  });
  if (!r.ok) throw new ErrorMP(r.status);
  const t = leerTokenOAuth(await r.json().catch(() => null));
  if (!t) throw new Error("respuesta_oauth_invalida");
  return t;
}
export const canjearCodigoOAuth = (code: string, origen: string) => pedirTokenOAuth({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origen) });

// Conectar es querer cobrar: se enciende el cobro online y Mercado Pago pasa a ser un medio de pago de la tienda.
export async function activarCobroOnline(admin: SupabaseClient, kioscoId: string) {
  const { data: k } = await admin.from("kioscos").select("medios_pago").eq("id", kioscoId).maybeSingle();
  const medios: string[] = k?.medios_pago ?? ["efectivo"];
  await admin.from("kioscos").update({ cobro_online_activo: true, medios_pago: medios.includes("mercadopago") ? medios : [...medios, "mercadopago"] }).eq("id", kioscoId);
}

// Guarda la conexión hecha con OAuth. Reemplaza cualquier credencial anterior (a mano o con OAuth).
export async function guardarConexionOAuth(admin: SupabaseClient, kioscoId: string, t: TokenOAuth): Promise<boolean> {
  const { error } = await admin.from("integraciones_pago").upsert({
    kiosco_id: kioscoId, token_cifrado: cifrar(t.access_token), refresh_token_cifrado: cifrar(t.refresh_token), token_expira_at: calcularExpira(t.expires_in),
    token_ultimos4: t.access_token.slice(-4), mp_user_id: t.user_id, public_key: t.public_key, webhook_secret_cifrado: null,
    activa: true, forma_conexion: "oauth", renovando_hasta: null, updated_at: new Date().toISOString(),
  }, { onConflict: "kiosco_id" });
  return !error;
}

type FilaOAuth = { token_cifrado: string; refresh_token_cifrado: string | null; token_expira_at: string | null };
const filaOAuth = async (admin: SupabaseClient, kioscoId: string): Promise<FilaOAuth | null> =>
  ((await admin.from("integraciones_pago").select("token_cifrado,refresh_token_cifrado,token_expira_at").eq("kiosco_id", kioscoId).eq("forma_conexion", "oauth").maybeSingle()).data as FilaOAuth | null) ?? null;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Renueva el access token de un local conectado con OAuth. El refresh token de Mercado Pago es de un solo uso, así que solo renueva
// quien toma el turno (mp_renovacion_tomar). Quien no lo toma espera a que la otra consulta guarde el token nuevo y lo relee.
// Devuelve el access token vigente, null si Mercado Pago rechazó la renovación (se apaga el cobro) o lanza si es un fallo pasajero.
export async function renovarToken(admin: SupabaseClient, kioscoId: string, dias = DIAS_RENOVAR): Promise<string | null> {
  const antes = await filaOAuth(admin, kioscoId);
  if (!antes?.refresh_token_cifrado) return null;
  const usarActual = (f: FilaOAuth) => { if (vencido(f.token_expira_at)) throw new Error("renovacion_fallida"); return descifrar(f.token_cifrado); };

  const { data: turno } = await admin.rpc("mp_renovacion_tomar", { p_kiosco: kioscoId, p_segundos: 20 });
  if (!turno) {
    for (let i = 0; i < 12; i++) {
      await esperar(500);
      const f = await filaOAuth(admin, kioscoId);
      if (!f) return null;
      if (f.refresh_token_cifrado !== antes.refresh_token_cifrado) return descifrar(f.token_cifrado); // la otra consulta ya guardó el nuevo
    }
    return usarActual(antes);
  }

  const f = await filaOAuth(admin, kioscoId); // otra consulta pudo terminar justo antes de que tomara el turno
  if (!f?.refresh_token_cifrado) return null;
  if (!necesitaRenovar(f.token_expira_at, Date.now(), dias)) return descifrar(f.token_cifrado);
  const soltar = () => admin.from("integraciones_pago").update({ renovando_hasta: null }).eq("kiosco_id", kioscoId);

  let t: TokenOAuth;
  try { t = await pedirTokenOAuth({ grant_type: "refresh_token", refresh_token: descifrar(f.refresh_token_cifrado) }); }
  catch (e) {
    await soltar();
    if (e instanceof ErrorMP && (e.status === 400 || e.status === 401 || e.status === 403)) {
      const otra = await filaOAuth(admin, kioscoId); // si otra instancia renovó por su cuenta, vale lo suyo
      if (otra?.refresh_token_cifrado && otra.refresh_token_cifrado !== f.refresh_token_cifrado) return descifrar(otra.token_cifrado);
      await marcarTokenInvalido(admin, kioscoId); // el dueño revocó el acceso o el refresh token ya no sirve
      return null;
    }
    return usarActual(f); // fallo pasajero: se sigue con el token actual mientras no haya vencido
  }
  // Compare-and-swap: solo se guarda si nadie cambió el refresh token mientras tanto.
  const { data: guardado } = await admin.from("integraciones_pago").update({
    token_cifrado: cifrar(t.access_token), refresh_token_cifrado: cifrar(t.refresh_token), token_expira_at: calcularExpira(t.expires_in),
    token_ultimos4: t.access_token.slice(-4), renovando_hasta: null, updated_at: new Date().toISOString(),
  }).eq("kiosco_id", kioscoId).eq("refresh_token_cifrado", f.refresh_token_cifrado).select("kiosco_id");
  if (guardado?.length) return t.access_token;
  await soltar();
  const otra = await filaOAuth(admin, kioscoId);
  return otra ? descifrar(otra.token_cifrado) : null;
}

export async function credenciales(admin: SupabaseClient, kioscoId: string): Promise<Credenciales | null> {
  const { data } = await admin.from("integraciones_pago").select("token_cifrado,webhook_secret_cifrado,mp_user_id,activa,forma_conexion,token_expira_at").eq("kiosco_id", kioscoId).maybeSingle();
  if (!data) return null;
  let token = descifrar(data.token_cifrado);
  if (data.forma_conexion === "oauth" && data.activa && necesitaRenovar(data.token_expira_at)) {
    const nuevo = await renovarToken(admin, kioscoId);
    if (!nuevo) return null; // el acceso se cayó (revocado): ya quedó marcado
    token = nuevo;
  }
  return {
    token,
    secreto: data.webhook_secret_cifrado ? descifrar(data.webhook_secret_cifrado) : (process.env.MP_WEBHOOK_SECRET ?? null),
    mpUserId: data.mp_user_id, activa: data.activa,
  };
}

// Locales conectados con esa cuenta vendedora (los avisos de la aplicación traen el user_id). Normalmente es uno.
export async function kioscosPorCuentaMP(admin: SupabaseClient, mpUserId: string): Promise<string[]> {
  if (!/^\d{1,20}$/.test(mpUserId)) return [];
  const { data } = await admin.from("integraciones_pago").select("kiosco_id").eq("mp_user_id", mpUserId).eq("activa", true).limit(5);
  return (data ?? []).map((x: { kiosco_id: string }) => x.kiosco_id);
}

// El dueño revocó el token: se apaga el cobro online y el panel lo avisa.
export async function marcarTokenInvalido(admin: SupabaseClient, kioscoId: string) {
  await admin.from("integraciones_pago").update({ activa: false, updated_at: new Date().toISOString() }).eq("kiosco_id", kioscoId);
  await admin.from("kioscos").update({ cobro_online_activo: false, cobro_qr_activo: false }).eq("id", kioscoId);
}

// Aplica un pago de Mercado Pago a su pedido. La fuente de verdad es el pago consultado a la API con el token del kiosco,
// nunca lo que diga el aviso. El pedido tiene que ser de ese mismo kiosco. Devuelve el resultado de pago_confirmar.
export async function aplicarPago(admin: SupabaseClient, kioscoId: string, pago: PagoMP): Promise<string | null> {
  const ref = pago.external_reference;
  const estado = estadoDesdeMP(pago.status);
  if (!ref || !UUID.test(ref) || !estado) return null;
  const { data: pedido } = await admin.from("pedidos").select("id,kiosco_id,numero,cliente_nombre,total").eq("id", ref).maybeSingle();
  if (!pedido) return null;
  if (pedido.kiosco_id !== kioscoId) return null;
  const { data, error } = await admin.rpc("pago_confirmar", {
    p_proveedor: "mercadopago", p_payment_id: String(pago.id), p_pedido: pedido.id,
    p_monto: pago.transaction_amount ?? null, p_moneda: pago.currency_id ?? null, p_estado: estado,
  });
  if (error) throw new Error(error.message);
  const resultado = (data as { resultado: string }).resultado;
  // Cada resultado que merece aviso solo sale en el llamado que lo produjo ("duplicado" no avisa).
  const aviso = armarAvisoPago(resultado, pedido);
  if (aviso) await avisarKiosco(admin, kioscoId, aviso).catch(() => 0);
  return resultado;
}

// Consulta a Mercado Pago los pagos de un pedido y aplica el que decide. Respaldo del webhook.
// Las consultas están limitadas por pedido (la pantalla de retorno es pública); el cron las fuerza.
export async function reconciliarPedido(admin: SupabaseClient, pedidoId: string, forzar = false): Promise<string | null> {
  const { data: p } = await admin.from("pedidos").select("kiosco_id,pago_estado").eq("id", pedidoId).maybeSingle();
  if (!p || p.pago_estado !== "pendiente") return null;
  const { data: puede } = await admin.rpc("pago_puede_consultar", { p_pedido: pedidoId, p_segundos: forzar ? 0 : 10 });
  if (!puede) return null;
  const cred = await credenciales(admin, p.kiosco_id).catch(() => null);
  if (!cred?.activa) return null;
  try {
    const pago = pagoDecisivo(await mpBuscarPagos(cred.token, pedidoId));
    return pago ? await aplicarPago(admin, p.kiosco_id, pago) : null;
  } catch (e) {
    if (e instanceof ErrorMP && (e.status === 401 || e.status === 403)) await marcarTokenInvalido(admin, p.kiosco_id);
    return null;
  }
}

// Aplica la orden de Mercado Pago a su cobro QR del mostrador. Igual que con los pedidos, la orden viene consultada a la API (el aviso solo trae su id).
// La caja se entera sola (consulta el estado); solo se avisa al dueño de lo raro: cobro tardío, monto distinto o reembolso con venta.
// Una orden tiene un solo pago, así que el id de la orden hace de id de pago en la base.
export async function aplicarOrdenQR(admin: SupabaseClient, kioscoId: string, orden: OrdenMP): Promise<string | null> {
  const ref = orden.external_reference;
  const estado = estadoDesdeOrden(orden.status);
  if (!ref || !UUID.test(ref) || !estado || !orden.id) return null;
  const { data: cobro } = await admin.from("cobros_qr_pos").select("id,kiosco_id,monto,mp_order_id").eq("id", ref).maybeSingle();
  if (!cobro || cobro.kiosco_id !== kioscoId) return null;
  if (cobro.mp_order_id && cobro.mp_order_id !== orden.id) return null; // otra orden con la misma referencia: no es la nuestra
  const monto = orden.total_amount != null ? Number(orden.total_amount) : null;
  const { data, error } = await admin.rpc("qr_confirmar", { p_payment_id: orden.id, p_cobro: cobro.id, p_monto: monto, p_moneda: "ARS", p_estado: estado });
  if (error) throw new Error(error.message);
  const resultado = (data as { resultado: string }).resultado;
  const aviso = armarAvisoQR(resultado, Number(cobro.monto));
  if (aviso) await avisarKiosco(admin, kioscoId, aviso).catch(() => 0);
  return resultado;
}

// Respaldo del aviso para un cobro QR: consulta a Mercado Pago la orden de ese cobro y la aplica. Limitado por cobro; el cron lo fuerza.
export async function reconciliarCobroQR(admin: SupabaseClient, cobroId: string, forzar = false): Promise<string | null> {
  const { data: c } = await admin.from("cobros_qr_pos").select("kiosco_id,estado,mp_order_id").eq("id", cobroId).maybeSingle();
  if (!c || !c.mp_order_id || !["pendiente", "vencido", "cancelado"].includes(c.estado)) return null;
  const { data: puede } = await admin.rpc("qr_puede_consultar", { p_cobro: cobroId, p_segundos: forzar ? 0 : 2 });
  if (!puede) return null;
  const cred = await credenciales(admin, c.kiosco_id).catch(() => null);
  if (!cred?.activa) return null;
  try {
    return await aplicarOrdenQR(admin, c.kiosco_id, await mpOrden(cred.token, c.mp_order_id));
  } catch (e) {
    if (e instanceof ErrorMP && (e.status === 401 || e.status === 403)) await marcarTokenInvalido(admin, c.kiosco_id);
    return null;
  }
}
