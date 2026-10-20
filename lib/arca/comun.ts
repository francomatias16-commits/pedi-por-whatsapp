// ARCA (ex AFIP): lógica pura de Factura C y Nota de crédito C — CUIT, fechas, sobres SOAP, lectura de respuestas y QR.
// Sin imports: se prueba directo con `npm test`.

export const TIPO_FACTURA_C = 11;
export const TIPO_NC_C = 13;
export const WSFE_URL = { homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx", produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx" };
export const WSAA_URL = { homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms", produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms" };

export const limpiarCuit = (c: unknown) => String(c ?? "").replace(/\D/g, "");

// CUIT/CUIL: 11 dígitos con dígito verificador (módulo 11) y prefijo válido.
export function cuitValido(c: unknown): boolean {
  const s = limpiarCuit(c);
  if (!/^\d{11}$/.test(s) || !["20", "23", "24", "27", "30", "33", "34"].includes(s.slice(0, 2))) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((a, p, i) => a + p * Number(s[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === Number(s[10]);
}
export const formatoCuit = (c: string) => { const s = limpiarCuit(c); return s.length === 11 ? `${s.slice(0, 2)}-${s.slice(2, 10)}-${s[10]}` : s; };

export const formatoNumero = (pto: number, nro: number | string) => `${String(pto).padStart(5, "0")}-${String(nro).padStart(8, "0")}`;
export const nombreTipo = (t: number) => (t === TIPO_FACTURA_C ? "Factura C" : t === TIPO_NC_C ? "Nota de crédito C" : `Comprobante ${t}`);
export const codigoTipo = (t: number) => String(t).padStart(3, "0");

// La fecha del comprobante es la de Argentina (el servidor corre en UTC: pasadas las 21:00 sería la del día siguiente).
export function fechaArgentina(d: Date = new Date()): { iso: string; arca: string } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); // 2026-10-19
  return { iso: p, arca: p.replace(/-/g, "") };
}
export const fechaIsoAArca = (iso: string) => iso.replace(/-/g, "");
export const vtoArcaAIso = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);

export const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export const xmlDecode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const m2 = (n: number) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);

export type Auth = { token: string; sign: string; cuit: string };
const sobre = (cuerpo: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">\n<soapenv:Header/>\n<soapenv:Body>\n${cuerpo}\n</soapenv:Body>\n</soapenv:Envelope>`;
const auth = (a: Auth) => `<ar:Auth><ar:Token>${xmlEscape(a.token)}</ar:Token><ar:Sign>${xmlEscape(a.sign)}</ar:Sign><ar:Cuit>${limpiarCuit(a.cuit)}</ar:Cuit></ar:Auth>`;

export const armarUltimoAutorizado = (a: Auth, pto: number, tipo: number) =>
  sobre(`<ar:FECompUltimoAutorizado>${auth(a)}<ar:PtoVta>${pto}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo></ar:FECompUltimoAutorizado>`);

export const armarConsultaComprobante = (a: Auth, pto: number, tipo: number, nro: number) =>
  sobre(`<ar:FECompConsultar>${auth(a)}<ar:FeCompConsReq><ar:CbteTipo>${tipo}</ar:CbteTipo><ar:CbteNro>${nro}</ar:CbteNro><ar:PtoVta>${pto}</ar:PtoVta></ar:FeCompConsReq></ar:FECompConsultar>`);

export type PedidoCAE = {
  pto: number; tipo: number; nro: number; fechaArca: string; total: number;
  docTipo: 96 | 99; docNro: string; // DNI o consumidor final (DocNro 0)
  asociado?: { tipo: number; pto: number; nro: number; cuit: string; fechaArca: string }; // obligatorio en la nota de crédito
};

// Factura C / Nota de crédito C: monotributo no discrimina IVA (neto = total, IVA 0, sin bloque <Iva>). Concepto 1 (productos), pesos.
// CondicionIVAReceptorId (obligatorio, RG 5616): 5 = consumidor final.
export function armarSolicitarCAE(a: Auth, p: PedidoCAE): string {
  if (p.tipo === TIPO_NC_C && !p.asociado) throw new Error("nc_sin_comprobante_asociado");
  if (!(p.total > 0)) throw new Error("total_invalido");
  const asoc = p.asociado
    ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${p.asociado.tipo}</ar:Tipo><ar:PtoVta>${p.asociado.pto}</ar:PtoVta><ar:Nro>${p.asociado.nro}</ar:Nro><ar:Cuit>${limpiarCuit(p.asociado.cuit)}</ar:Cuit><ar:CbteFch>${p.asociado.fechaArca}</ar:CbteFch></ar:CbteAsoc></ar:CbtesAsoc>`
    : "";
  const t = m2(p.total);
  return sobre(
    `<ar:FECAESolicitar>${auth(a)}<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${p.pto}</ar:PtoVta><ar:CbteTipo>${p.tipo}</ar:CbteTipo></ar:FeCabReq>` +
      `<ar:FeDetReq><ar:FECAEDetRequest><ar:Concepto>1</ar:Concepto><ar:DocTipo>${p.docTipo}</ar:DocTipo><ar:DocNro>${p.docTipo === 99 ? 0 : limpiarCuit(p.docNro)}</ar:DocNro>` +
      `<ar:CbteDesde>${p.nro}</ar:CbteDesde><ar:CbteHasta>${p.nro}</ar:CbteHasta><ar:CbteFch>${p.fechaArca}</ar:CbteFch>` +
      `<ar:ImpTotal>${t}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${t}</ar:ImpNeto><ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpIVA>0.00</ar:ImpIVA><ar:ImpTrib>0.00</ar:ImpTrib>` +
      `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>${asoc}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar>`,
  );
}

// --- lectura de respuestas
const tag = (xml: string, t: string) => xml.match(new RegExp(`<(?:\\w+:)?${t}>([\\s\\S]*?)</(?:\\w+:)?${t}>`))?.[1]?.trim();
const mensajes = (xml: string, bloque: string) => {
  const b = tag(xml, bloque);
  return b ? [...b.matchAll(/<(?:\w+:)?Msg>([\s\S]*?)<\/(?:\w+:)?Msg>/g)].map((m) => xmlDecode(m[1].trim())).filter(Boolean) : [];
};
export const fallaSoap = (xml: string) => { const f = tag(xml, "faultstring"); return f ? xmlDecode(f) : null; };
export const erroresArca = (xml: string) => mensajes(xml, "Errors");

export function leerUltimoNumero(xml: string): { nro: number } | { error: string } {
  const f = fallaSoap(xml); if (f) return { error: f };
  const e = erroresArca(xml); if (e.length) return { error: e.join(" | ") };
  const n = tag(xml, "CbteNro");
  return n && /^\d+$/.test(n) ? { nro: Number(n) } : { error: "ARCA no devolvió el último número." };
}

export type RespuestaCAE = { aprobado: boolean; cae?: string; caeVto?: string; error?: string; observaciones: string[] };
export function leerRespuestaCAE(xml: string): RespuestaCAE {
  const f = fallaSoap(xml); if (f) return { aprobado: false, error: f, observaciones: [] };
  const errores = erroresArca(xml), obs = mensajes(xml, "Observaciones");
  const resultado = tag(xml, "Resultado");
  const cae = tag(xml, "CAE"), vto = tag(xml, "CAEFchVto");
  if (resultado === "A" && cae && /^\d{14}$/.test(cae) && vto && /^\d{8}$/.test(vto)) return { aprobado: true, cae, caeVto: vtoArcaAIso(vto)!, observaciones: obs };
  const detalle = [...errores, ...obs].join(" | ");
  return { aprobado: false, error: detalle || (resultado === "A" ? "ARCA aprobó pero no devolvió el CAE." : "ARCA rechazó el comprobante."), observaciones: obs };
}

export type ComprobanteConsultado = { existe: boolean; cae?: string; caeVto?: string; total?: number; fecha?: string; resultado?: string };
export function leerConsultaComprobante(xml: string): ComprobanteConsultado | { error: string } {
  const f = fallaSoap(xml); if (f) return { error: f };
  const e = erroresArca(xml);
  if (e.length) return /602|no existe|no se encuentra/i.test(e.join(" ")) ? { existe: false } : { error: e.join(" | ") };
  const cae = tag(xml, "CodAutorizacion") ?? tag(xml, "CAE");
  if (!cae) return { existe: false };
  const vto = tag(xml, "FchVto") ?? tag(xml, "CAEFchVto");
  const total = Number(tag(xml, "ImpTotal"));
  return { existe: true, cae, caeVto: vto ? vtoArcaAIso(vto) ?? undefined : undefined, total: Number.isFinite(total) ? total : undefined, fecha: tag(xml, "CbteFch"), resultado: tag(xml, "Resultado") };
}

// --- QR de la factura electrónica (especificación de ARCA): JSON en base64 en la dirección /fe/qr/?p=
export type DatosQR = { fechaIso: string; cuit: string; pto: number; tipo: number; nro: number; importe: number; docTipo: number; docNro: string; cae: string };
export function urlQR(d: DatosQR): string {
  const json = JSON.stringify({
    ver: 1, fecha: d.fechaIso, cuit: Number(limpiarCuit(d.cuit)), ptoVta: d.pto, tipoCmp: d.tipo, nroCmp: d.nro, importe: Math.round(d.importe * 100) / 100,
    moneda: "PES", ctz: 1, tipoDocRec: d.docTipo, nroDocRec: Number(d.docNro) || 0, tipoCodAut: "E", codAut: Number(d.cae),
  });
  return `https://www.afip.gob.ar/fe/qr/?p=${btoa(json)}`;
}

// --- WSAA (autenticación)
export function construirTRA(servicio: string, ahora: Date = new Date()): string {
  const gen = new Date(ahora.getTime() - 10 * 60_000).toISOString(), exp = new Date(ahora.getTime() + 10 * 60_000).toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId><generationTime>${gen}</generationTime><expirationTime>${exp}</expirationTime></header><service>${xmlEscape(servicio)}</service></loginTicketRequest>`;
}
export const armarLoginCms = (cmsBase64: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="https://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
export function leerLoginCms(xml: string): { token: string; sign: string; expira: string } | { error: string; yaTieneTicket?: boolean } {
  const f = fallaSoap(xml);
  if (f) return { error: f, yaTieneTicket: /alreadyAuthenticated|ya posee un TA|ya tiene un TA/i.test(f) };
  const ret = tag(xml, "loginCmsReturn");
  if (!ret) return { error: "WSAA no devolvió el ticket de acceso." };
  const interno = xmlDecode(ret);
  const token = tag(interno, "token"), sign = tag(interno, "sign"), expira = tag(interno, "expirationTime");
  return token && sign && expira ? { token, sign, expira } : { error: "No se pudo leer el ticket de acceso de WSAA." };
}

// ¿El error de ARCA es "este CUIT no nos delegó el servicio"? (todavía no hizo la delegación o no se propagó)
export const esFaltaDelegacion = (msg: string) => /no autorizad|no aparecio cuit|lista de relaciones|no encuentra relacion|no tiene relacion|not authorized|cuit.*no.*habilitad|computador fiscal|no posee/i.test(msg);
