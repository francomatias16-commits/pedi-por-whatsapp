// Prueba de lib/arca (CUIT, fechas, sobres SOAP, respuestas, QR, firma CMS contra openssl) y de la migración 0058. Uso: node tests/arca.test.mjs
import ts from "typescript";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const cargar = async (ruta) => {
  const js = ts.transpileModule(readFileSync(new URL(ruta, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const A = await cargar("../lib/arca/comun.ts");
const F = await cargar("../lib/arca/firma.ts");
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };

// CUIT
ok("cuit valido", A.cuitValido("20-12345678-6")); ok("cuit valido 2", A.cuitValido("30500010912"));
ok("cuit dv malo", !A.cuitValido("20-12345678-5")); ok("cuit prefijo", !A.cuitValido("11-12345678-6")); ok("cuit corto", !A.cuitValido("2012345678"));
eq("formato cuit", A.formatoCuit("20123456786"), "20-12345678-6");
eq("numero", A.formatoNumero(2, 123), "00002-00000123");
eq("tipos", [A.nombreTipo(11), A.nombreTipo(13), A.codigoTipo(11)], ["Factura C", "Nota de crédito C", "011"]);
// fecha Argentina: 23:30 en Buenos Aires = 02:30 UTC del día siguiente
eq("fecha AR", A.fechaArgentina(new Date("2026-10-20T02:30:00Z")), { iso: "2026-10-19", arca: "20261019" });

const auth = { token: "T&K", sign: "S", cuit: "20-12345678-6" };
// Factura C
const x = A.armarSolicitarCAE(auth, { pto: 2, tipo: 11, nro: 7, fechaArca: "20261019", total: 1234.5, docTipo: 99, docNro: "0" });
ok("cae: cuit sin guiones", x.includes("<ar:Cuit>20123456786</ar:Cuit>")); ok("cae: token escapado", x.includes("T&amp;K"));
ok("cae: total", x.includes("<ar:ImpTotal>1234.50</ar:ImpTotal>") && x.includes("<ar:ImpNeto>1234.50</ar:ImpNeto>") && x.includes("<ar:ImpIVA>0.00</ar:ImpIVA>"));
ok("cae: sin bloque Iva ni asociados", !x.includes("<ar:Iva>") && !x.includes("CbtesAsoc"));
ok("cae: consumidor final", x.includes("<ar:DocTipo>99</ar:DocTipo>") && x.includes("<ar:DocNro>0</ar:DocNro>") && x.includes("<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>"));
ok("cae: desde=hasta", x.includes("<ar:CbteDesde>7</ar:CbteDesde><ar:CbteHasta>7</ar:CbteHasta>"));
// Nota de crédito
let falla = ""; try { A.armarSolicitarCAE(auth, { pto: 2, tipo: 13, nro: 1, fechaArca: "20261019", total: 10, docTipo: 99, docNro: "0" }); } catch (e) { falla = e.message; }
eq("nc sin asociado", falla, "nc_sin_comprobante_asociado");
const nc = A.armarSolicitarCAE(auth, { pto: 2, tipo: 13, nro: 1, fechaArca: "20261019", total: 10, docTipo: 96, docNro: "30111222", asociado: { tipo: 11, pto: 2, nro: 7, cuit: "20123456786", fechaArca: "20261019" } });
ok("nc: asociado", nc.includes("<ar:CbteAsoc><ar:Tipo>11</ar:Tipo><ar:PtoVta>2</ar:PtoVta><ar:Nro>7</ar:Nro><ar:Cuit>20123456786</ar:Cuit><ar:CbteFch>20261019</ar:CbteFch>"));
ok("nc: dni", nc.includes("<ar:DocTipo>96</ar:DocTipo><ar:DocNro>30111222</ar:DocNro>"));
falla = ""; try { A.armarSolicitarCAE(auth, { pto: 2, tipo: 11, nro: 1, fechaArca: "20261019", total: 0, docTipo: 99, docNro: "0" }); } catch (e) { falla = e.message; }
eq("total cero", falla, "total_invalido");

// Respuestas
const aprobada = `<s:Envelope><s:Body><FECAESolicitarResponse><FECAESolicitarResult><FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>71234567890123</CAE><CAEFchVto>20261029</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse></s:Body></s:Envelope>`;
eq("aprobada", A.leerRespuestaCAE(aprobada), { aprobado: true, cae: "71234567890123", caeVto: "2026-10-29", observaciones: [] });
const rechazada = `<r><Resultado>R</Resultado><Observaciones><Obs><Code>10016</Code><Msg>El campo CbteFch es inv&aacute;lido</Msg></Obs></Observaciones></r>`;
const rr = A.leerRespuestaCAE(rechazada); ok("rechazada", !rr.aprobado && /CbteFch/.test(rr.error));
const conErr = `<r><Errors><Err><Code>600</Code><Msg>ValidacionDeToken: No aparecio CUIT en lista de relaciones</Msg></Err></Errors></r>`;
const re = A.leerRespuestaCAE(conErr); ok("error arca", !re.aprobado && /ValidacionDeToken/.test(re.error)); ok("falta delegacion", A.esFaltaDelegacion(re.error));
ok("cae invalido no aprueba", !A.leerRespuestaCAE(`<r><Resultado>A</Resultado><CAE>123</CAE><CAEFchVto>20261029</CAEFchVto></r>`).aprobado);
eq("fault", A.leerRespuestaCAE(`<f><faultstring>boom</faultstring></f>`).error, "boom");
eq("ultimo ok", A.leerUltimoNumero(`<r><CbteNro>41</CbteNro></r>`), { nro: 41 });
ok("ultimo error", "error" in A.leerUltimoNumero(`<r><Errors><Err><Msg>x</Msg></Err></Errors></r>`));
eq("consulta no existe", A.leerConsultaComprobante(`<r><Errors><Err><Code>602</Code><Msg>No existe el comprobante</Msg></Err></Errors></r>`), { existe: false });
const cons = A.leerConsultaComprobante(`<r><ResultGet><CodAutorizacion>71234567890123</CodAutorizacion><FchVto>20261029</FchVto><ImpTotal>1234.50</ImpTotal><CbteFch>20261019</CbteFch><Resultado>A</Resultado></ResultGet></r>`);
ok("consulta existe", cons.existe && cons.cae === "71234567890123" && cons.caeVto === "2026-10-29" && cons.total === 1234.5);

// QR: JSON en base64 según la especificación de ARCA
const u = A.urlQR({ fechaIso: "2026-10-19", cuit: "20-12345678-6", pto: 2, tipo: 11, nro: 7, importe: 1234.5, docTipo: 99, docNro: "0", cae: "71234567890123" });
ok("qr url", u.startsWith("https://www.afip.gob.ar/fe/qr/?p="));
const j = JSON.parse(Buffer.from(u.split("?p=")[1], "base64").toString());
eq("qr json", j, { ver: 1, fecha: "2026-10-19", cuit: 20123456786, ptoVta: 2, tipoCmp: 11, nroCmp: 7, importe: 1234.5, moneda: "PES", ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: "E", codAut: 71234567890123 });

// TRA y firma CMS: se verifica con openssl (si está instalado)
const tra = A.construirTRA("wsfe", new Date("2026-10-19T12:00:00Z"));
ok("tra", tra.includes("<service>wsfe</service>") && tra.includes("<generationTime>2026-10-19T11:50:00.000Z</generationTime>") && tra.includes("<expirationTime>2026-10-19T12:10:00.000Z</expirationTime>"));
const tmp = mkdtempSync(join(tmpdir(), "arca-"));
const hay = spawnSync("openssl", ["version"]).status === 0;
if (hay) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(tmp, "k.pem"), "-out", join(tmp, "c.pem"), "-days", "30", "-subj", "/C=AR/O=Prueba/CN=prueba-arca"], { stdio: "ignore" });
  const cert = readFileSync(join(tmp, "c.pem"), "utf8"), key = readFileSync(join(tmp, "k.pem"), "utf8");
  const b64 = F.firmarTRA(tra, cert, key);
  writeFileSync(join(tmp, "m.der"), Buffer.from(b64, "base64"));
  const v = spawnSync("openssl", ["cms", "-verify", "-inform", "DER", "-in", join(tmp, "m.der"), "-noverify", "-out", join(tmp, "salida.xml")], { encoding: "utf8" });
  ok("openssl verifica la firma CMS: " + (v.stderr || ""), v.status === 0);
  if (v.status === 0) eq("contenido firmado = TRA", readFileSync(join(tmp, "salida.xml"), "utf8"), tra);
  const p7 = spawnSync("openssl", ["pkcs7", "-inform", "DER", "-in", join(tmp, "m.der"), "-print_certs", "-noout"], { encoding: "utf8" });
  ok("openssl lee el PKCS#7", p7.status === 0);
  const rev = F.revisarCertificado(cert, key); ok("revisar cert", rev.coincide && rev.vigente);
  // clave de otro par
  execFileSync("openssl", ["genrsa", "-out", join(tmp, "otra.pem"), "2048"], { stdio: "ignore" });
  ok("clave ajena no coincide", !F.revisarCertificado(cert, readFileSync(join(tmp, "otra.pem"), "utf8")).coincide);
  let e2 = ""; try { F.firmarTRA(tra, "no es pem", key); } catch (e) { e2 = e.message; }
  eq("cert invalido", e2, "certificado_invalido");
} else console.log("(openssl no está instalado: se omite la verificación de la firma)");

// Migración 0058
const sql = readFileSync(new URL("../supabase/migrations/0058_facturacion_arca.sql", import.meta.url), "utf8");
for (const t of ["arca_proveedor_config", "tokens_wsaa_proveedor", "arca_lock_emision", "facturacion_config", "comprobantes_arca"]) ok(`RLS ${t}`, new RegExp(`alter table public\\.${t} enable row level security`).test(sql));
ok("secretos sin acceso", /revoke all on public\.arca_proveedor_config, public\.tokens_wsaa_proveedor from anon, authenticated/.test(sql));
ok("indices unicos", ["comprobantes_factura_viva", "comprobantes_nc_devolucion_viva", "comprobantes_nc_saldo_viva", "comprobantes_numero_unico"].every((i) => sql.includes(i)));
ok("funciones de servidor sin grant", !/grant execute on function public\.arca_(lock|reservar|guardar)/.test(sql));
ok("security definer con search_path", (sql.match(/security definer set search_path = public/g) ?? []).length >= 6);

if (fallos) { console.log(`${fallos} fallo(s)`); process.exit(1); }
console.log("arca: todo bien");
