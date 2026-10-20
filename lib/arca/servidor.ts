// Facturación electrónica con ARCA: lógica de servidor (service role). Solo se importa desde rutas de /api.
// Un único certificado del proveedor firma por todos los locales (WSAA); cada local delega el servicio a la CUIT del proveedor y
// factura con su propia CUIT en <Auth><Cuit>.
import type { SupabaseClient } from "@supabase/supabase-js";
import { descifrar } from "../pagos/cifrado";
import {
  TIPO_FACTURA_C, TIPO_NC_C, WSAA_URL, WSFE_URL, armarConsultaComprobante, armarLoginCms, armarSolicitarCAE, armarUltimoAutorizado, construirTRA,
  esFaltaDelegacion, fechaArgentina, fechaIsoAArca, leerConsultaComprobante, leerLoginCms, leerRespuestaCAE, leerUltimoNumero, type Auth,
} from "./comun";
import { firmarTRA } from "./firma";

// Ambiente: por defecto homologación (pruebas). Para facturar de verdad: ARCA_AMBIENTE=produccion en Vercel.
export const esHomologacion = () => (process.env.ARCA_AMBIENTE ?? "homologacion").toLowerCase() !== "produccion";
const TIMEOUT_MS = 15_000;
const MARGEN_TOKEN_MS = 10 * 60_000;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ErrorArca extends Error {
  constructor(public codigo: string, mensaje?: string, public transitorio = false) { super(mensaje ?? codigo); }
}

async function llamarSoap(url: string, accion: string | null, cuerpo: string): Promise<string> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: accion ? `http://ar.gov.afip.dif.FEV1/${accion}` : '""' },
      body: cuerpo,
    });
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
    throw new ErrorArca(timeout ? "arca_timeout" : "arca_sin_conexion", (e as Error).message, true);
  }
  const texto = await r.text();
  // Un SOAP Fault es una respuesta de negocio de ARCA (viene con HTTP 500): se devuelve el XML para leerlo.
  if (!r.ok && !/faultstring/i.test(texto)) throw new ErrorArca("arca_http", `HTTP ${r.status}`, r.status >= 500);
  return texto;
}

// --- Certificado del proveedor y token WSAA compartido
type Proveedor = { cuit: string; cert: string; key: string };
export async function cargarProveedor(admin: SupabaseClient, homologacion: boolean): Promise<Proveedor> {
  const { data } = await admin.from("arca_proveedor_config").select("cuit,cert_cifrado,key_cifrada,activo").eq("homologacion", homologacion).maybeSingle();
  if (!data || !data.activo) throw new ErrorArca("arca_sin_certificado");
  try { return { cuit: data.cuit, cert: descifrar(data.cert_cifrado), key: descifrar(data.key_cifrada) }; }
  catch { throw new ErrorArca("arca_certificado_ilegible"); }
}

async function tokenCacheado(admin: SupabaseClient, homologacion: boolean): Promise<{ token: string; sign: string } | null> {
  const { data } = await admin.from("tokens_wsaa_proveedor").select("token,sign,expira_at").eq("homologacion", homologacion).maybeSingle();
  return data && new Date(data.expira_at).getTime() - Date.now() > MARGEN_TOKEN_MS ? { token: data.token, sign: data.sign } : null;
}

export async function obtenerToken(admin: SupabaseClient, homologacion: boolean, forzar = false): Promise<{ token: string; sign: string }> {
  if (!forzar) { const c = await tokenCacheado(admin, homologacion); if (c) return c; }
  const p = await cargarProveedor(admin, homologacion);
  let cms: string;
  try { cms = firmarTRA(construirTRA("wsfe"), p.cert, p.key); } catch { throw new ErrorArca("arca_certificado_ilegible"); }
  const xml = await llamarSoap(homologacion ? WSAA_URL.homologacion : WSAA_URL.produccion, null, armarLoginCms(cms));
  const r = leerLoginCms(xml);
  if ("error" in r) {
    // WSAA no entrega un ticket nuevo mientras hay uno vigente: si otra consulta lo acaba de pedir, se espera a que lo guarde.
    if (r.yaTieneTicket) {
      for (let i = 0; i < 6; i++) { await esperar(700); const c = await tokenCacheado(admin, homologacion); if (c) return c; }
    }
    throw new ErrorArca("arca_wsaa", r.error, true);
  }
  await admin.from("tokens_wsaa_proveedor").upsert({ homologacion, token: r.token, sign: r.sign, expira_at: new Date(r.expira).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "homologacion" });
  return { token: r.token, sign: r.sign };
}

type ConfigLocal = {
  kiosco_id: string; cuit: string; razon_social: string; domicilio: string; punto_venta: number; condicion_iva: string;
  inicio_actividades: string | null; activo: boolean; estado_delegacion: "pendiente" | "activa" | "rechazada";
};
export async function configLocal(admin: SupabaseClient, kioscoId: string): Promise<ConfigLocal | null> {
  const { data } = await admin.from("facturacion_config").select("*").eq("kiosco_id", kioscoId).maybeSingle();
  return (data as ConfigLocal | null) ?? null;
}

// Pide una operación a ARCA con el token del proveedor. Si el token venció antes de tiempo, lo renueva y repite una vez.
async function conAuth<T>(admin: SupabaseClient, homologacion: boolean, cuit: string, f: (a: Auth, url: string) => Promise<T>): Promise<T> {
  const url = homologacion ? WSFE_URL.homologacion : WSFE_URL.produccion;
  const t = await obtenerToken(admin, homologacion);
  try { return await f({ ...t, cuit }, url); }
  catch (e) {
    if (e instanceof ErrorArca && e.codigo === "arca_token_vencido") {
      const n = await obtenerToken(admin, homologacion, true);
      return f({ ...n, cuit }, url);
    }
    throw e;
  }
}
const vencidoMsg = (m: string) => /token.*(expir|venc)|expired|ticket.*venc/i.test(m);

export async function ultimoAutorizado(admin: SupabaseClient, homologacion: boolean, cuit: string, pto: number, tipo: number): Promise<number> {
  return conAuth(admin, homologacion, cuit, async (a, url) => {
    const r = leerUltimoNumero(await llamarSoap(url, "FECompUltimoAutorizado", armarUltimoAutorizado(a, pto, tipo)));
    if ("error" in r) throw new ErrorArca(vencidoMsg(r.error) ? "arca_token_vencido" : esFaltaDelegacion(r.error) ? "arca_sin_delegacion" : "arca_rechazo", r.error);
    return r.nro;
  });
}

// --- Delegación: se prueba con una consulta de solo lectura usando el token del proveedor y la CUIT del local.
export type ResultadoDelegacion = { estado: "activa" | "pendiente" | "rechazada"; mensaje: string };
export async function verificarDelegacion(admin: SupabaseClient, kioscoId: string, homologacion = esHomologacion()): Promise<ResultadoDelegacion> {
  const c = await configLocal(admin, kioscoId);
  if (!c) return { estado: "pendiente", mensaje: "Primero cargá los datos fiscales del local." };
  let res: ResultadoDelegacion;
  try {
    await ultimoAutorizado(admin, homologacion, c.cuit, c.punto_venta, TIPO_FACTURA_C);
    res = { estado: "activa", mensaje: "Conexión con ARCA verificada." };
  } catch (e) {
    const m = (e as Error).message;
    if (e instanceof ErrorArca && e.codigo === "arca_sin_delegacion") res = { estado: "pendiente", mensaje: "ARCA todavía no reconoce la delegación. Puede tardar unos minutos en aplicarse, o falta hacerla." };
    else if (e instanceof ErrorArca && ["arca_sin_certificado", "arca_certificado_ilegible"].includes(e.codigo)) throw e;
    else if (e instanceof ErrorArca && e.transitorio) throw e;
    else if (/punto de venta|PtoVta|punto venta/i.test(m)) res = { estado: "rechazada", mensaje: "ARCA no reconoce ese punto de venta para Factura electrónica. Revisá que esté dado de alta como “Factura Electrónica - Web Services”." };
    else res = { estado: "rechazada", mensaje: `ARCA respondió: ${m}` };
  }
  await admin.from("facturacion_config").update({
    estado_delegacion: res.estado, activo: res.estado === "activa",
    delegacion_verificada_at: new Date().toISOString(), delegacion_error: res.estado === "activa" ? null : res.mensaje.slice(0, 300), updated_at: new Date().toISOString(),
  }).eq("kiosco_id", kioscoId);
  return res;
}

// --- Emisión
type Fila = {
  id: string; kiosco_id: string; venta_id: string; devolucion_id: string | null; asociado_id: string | null; tipo_cbte: number; punto_venta: number; numero: number | null;
  fecha: string; total: number; receptor_doc_tipo: number; receptor_doc_nro: string; receptor_nombre: string | null; estado: "pendiente" | "emitido" | "rechazado" | "incierto";
  cae: string | null; cae_vto: string | null; error: string | null; homologacion: boolean; cuit_emisor: string;
};
const leerFila = async (admin: SupabaseClient, id: string) => (await admin.from("comprobantes_arca").select("*").eq("id", id).single()).data as Fila;
export type ResultadoEmision = { id: string; estado: Fila["estado"]; numero?: number | null; cae?: string | null; error?: string | null };
const resumen = (f: Fila): ResultadoEmision => ({ id: f.id, estado: f.estado, numero: f.numero, cae: f.cae, error: f.error });

export const reservarFactura = async (admin: SupabaseClient, p: { kiosco: string; venta: string; usuario: string; docTipo: number; docNro: string; nombre: string | null; homologacion?: boolean }) => {
  const { data, error } = await admin.rpc("arca_reservar_factura", {
    p_kiosco: p.kiosco, p_venta: p.venta, p_usuario: p.usuario, p_doc_tipo: p.docTipo, p_doc_nro: p.docNro, p_nombre: p.nombre,
    p_fecha: fechaArgentina().iso, p_homologacion: p.homologacion ?? esHomologacion(),
  });
  if (error) throw new ErrorArca(codigoSql(error.message), error.message);
  return (data as { id: string }).id;
};
export const reservarNC = async (admin: SupabaseClient, p: { kiosco: string; venta: string; devolucion: string | null; usuario: string; homologacion?: boolean }) => {
  const { data, error } = await admin.rpc("arca_reservar_nc", {
    p_kiosco: p.kiosco, p_venta: p.venta, p_devolucion: p.devolucion, p_usuario: p.usuario, p_fecha: fechaArgentina().iso, p_homologacion: p.homologacion ?? esHomologacion(),
  });
  if (error) throw new ErrorArca(codigoSql(error.message), error.message);
  return (data as { id: string }).id;
};
// El código "raise exception 'xxx'" viaja dentro del mensaje de Postgres.
const codigoSql = (m: string) => m.match(/\b(venta_[a-z_]+|arca_[a-z_]+|devolucion_[a-z_]+|no_autorizado)\b/)?.[1] ?? "db";

// Lleva un comprobante reservado hasta tener CAE. Idempotente: si ya está emitido lo devuelve; si quedó incierto, primero consulta a ARCA.
export async function emitirReservado(admin: SupabaseClient, id: string): Promise<ResultadoEmision> {
  let f = await leerFila(admin, id);
  if (f.estado === "emitido" || f.estado === "rechazado") return resumen(f);
  const cfg = await configLocal(admin, f.kiosco_id);
  if (!cfg || !cfg.activo || cfg.estado_delegacion !== "activa") throw new ErrorArca("arca_sin_delegacion");

  const { data: tk } = await admin.rpc("arca_lock_adquirir", { p_kiosco: f.kiosco_id, p_punto_venta: f.punto_venta, p_tipo: f.tipo_cbte });
  if (!tk) throw new ErrorArca("arca_ocupada", "Hay otra factura emitiéndose en este momento.", true);
  try {
    f = await leerFila(admin, id); // otra consulta pudo terminarla mientras esperábamos el candado
    if (f.estado === "emitido" || f.estado === "rechazado") return resumen(f);
    const guardar = async (estado: "emitido" | "rechazado" | "incierto", numero: number | null, cae: string | null, vto: string | null, error: string | null) => {
      await admin.rpc("arca_guardar_resultado", { p_id: id, p_estado: estado, p_numero: numero, p_cae: cae, p_cae_vto: vto, p_error: error });
      return resumen(await leerFila(admin, id));
    };

    // Comprobante incierto (se cortó la respuesta de ARCA): ver si ARCA lo llegó a autorizar antes de pedir otro número.
    if (f.estado === "incierto" && f.numero) {
      const c = await conAuth(admin, f.homologacion, cfg.cuit, async (a, url) => leerConsultaComprobante(await llamarSoap(url, "FECompConsultar", armarConsultaComprobante(a, f.punto_venta, f.tipo_cbte, f.numero!))));
      if ("error" in c) throw new ErrorArca("arca_consulta", c.error, true);
      if (c.existe && c.cae && c.caeVto && Math.abs((c.total ?? f.total) - Number(f.total)) < 0.005) return guardar("emitido", f.numero, c.cae, c.caeVto, null);
      if (c.existe) return guardar("rechazado", f.numero, null, null, "El número quedó usado por otro comprobante en ARCA. Emití de nuevo.");
      // No existe en ARCA: se puede pedir de nuevo con seguridad.
    }

    let asociado: Fila | null = null;
    if (f.tipo_cbte === TIPO_NC_C) {
      asociado = f.asociado_id ? await leerFila(admin, f.asociado_id) : null;
      if (!asociado || asociado.estado !== "emitido" || !asociado.numero) return guardar("rechazado", null, null, null, "La factura asociada no está emitida.");
    }

    let nro: number;
    try { nro = (await ultimoAutorizado(admin, f.homologacion, cfg.cuit, f.punto_venta, f.tipo_cbte)) + 1; }
    catch (e) {
      if (e instanceof ErrorArca && e.codigo === "arca_sin_delegacion") await admin.from("facturacion_config").update({ estado_delegacion: "pendiente", delegacion_error: "ARCA no reconoce la delegación." }).eq("kiosco_id", f.kiosco_id);
      if (e instanceof ErrorArca && !e.transitorio) return guardar("rechazado", null, null, null, (e as Error).message.slice(0, 300)); // nada se envió: se puede reintentar de cero
      throw e; // pasajero: queda pendiente y se reintenta con el mismo registro
    }

    const pedido = {
      pto: f.punto_venta, tipo: f.tipo_cbte, nro, fechaArca: fechaIsoAArca(f.fecha), total: Number(f.total),
      docTipo: (f.receptor_doc_tipo === 96 ? 96 : 99) as 96 | 99, docNro: f.receptor_doc_nro,
      asociado: asociado ? { tipo: asociado.tipo_cbte, pto: asociado.punto_venta, nro: asociado.numero!, cuit: asociado.cuit_emisor, fechaArca: fechaIsoAArca(asociado.fecha) } : undefined,
    };
    // Se anota el número antes de pedir el CAE: si la respuesta se pierde, el comprobante queda "incierto" con su número para consultarlo.
    await admin.from("comprobantes_arca").update({ numero: nro, updated_at: new Date().toISOString() }).eq("id", id).in("estado", ["pendiente", "incierto"]);
    let xml: string;
    try {
      xml = await conAuth(admin, f.homologacion, cfg.cuit, (a, url) => llamarSoap(url, "FECAESolicitar", armarSolicitarCAE(a, pedido)));
    } catch (e) {
      // FECAESolicitar numera y emite: tras un corte no se reintenta a ciegas.
      return guardar("incierto", nro, null, null, `No llegó la respuesta de ARCA (${(e as Error).message}). Se verifica solo al reintentar.`.slice(0, 300));
    }
    const r = leerRespuestaCAE(xml);
    if (r.aprobado) return guardar("emitido", nro, r.cae!, r.caeVto!, r.observaciones.join(" | ") || null);
    if (esFaltaDelegacion(r.error ?? "")) await admin.from("facturacion_config").update({ estado_delegacion: "pendiente", delegacion_error: "ARCA no reconoce la delegación." }).eq("kiosco_id", f.kiosco_id);
    return guardar("rechazado", null, null, null, (r.error ?? "ARCA rechazó el comprobante.").slice(0, 300));
  } finally {
    await admin.rpc("arca_lock_liberar", { p_kiosco: f.kiosco_id, p_punto_venta: f.punto_venta, p_tipo: f.tipo_cbte, p_token: tk });
  }
}
