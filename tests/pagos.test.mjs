// Prueba de lib/pagos (cifrado, firma de webhooks, estados, preferencia, retorno) y de los avisos de pago. Uso: node tests/pagos.test.mjs
import ts from "typescript";
import { readFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
const cargar = async (ruta) => {
  const js = ts.transpileModule(readFileSync(new URL(ruta, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const C = await cargar("../lib/pagos/cifrado.ts");
const M = await cargar("../lib/pagos/mp.ts");
const P = await cargar("../lib/push.ts");
const R = await cargar("../lib/pagos/retorno.ts");
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };
const falla = (n, f) => { try { f(); fallos++; console.log("FALLA (no lanzó)", n); } catch { /* esperado */ } };

// --- cifrado
const k = randomBytes(32).toString("base64");
const token = "APP_USR-1234567890123456-abcdef-0123456789";
const c1 = C.cifrar(token, k);
eq("cifrar y descifrar vuelve al original", C.descifrar(c1, k), token);
ok("el cifrado no contiene el texto original", !c1.includes("APP_USR") && c1.startsWith("v1:"));
ok("cifrar dos veces da distinto resultado (iv aleatorio)", C.cifrar(token, k) !== c1);
falla("otra clave no descifra", () => C.descifrar(c1, randomBytes(32).toString("base64")));
falla("un valor adulterado no descifra", () => C.descifrar(c1.slice(0, -4) + "AAAA", k));
falla("formato inválido", () => C.descifrar("hola", k));
falla("sin clave no cifra", () => C.cifrar("x", undefined));
falla("clave de largo incorrecto", () => C.cifrar("x", Buffer.from("corta").toString("base64")));
eq("últimos 4", C.ultimos4(token), "6789");
eq("enmascarar muestra solo el final", C.enmascarar(token), "••••6789");
eq("enmascarar un valor corto no muestra nada", C.enmascarar("abc"), "••••");

// --- firma de webhooks
const secreto = "clave-secreta-del-webhook";
const firmar = (id, req, ts) => `ts=${ts},v1=${createHmac("sha256", secreto).update(`id:${id};request-id:${req};ts:${ts};`).digest("hex")}`;
const base = { dataId: "123456789", xRequestId: "req-1", secreto };
ok("firma correcta", M.verificarFirma({ ...base, xSignature: firmar("123456789", "req-1", "1700000000000") }));
ok("firma con otro secreto", !M.verificarFirma({ ...base, xSignature: firmar("123456789", "req-1", "1700000000000"), secreto: "otro" }));
ok("firma de otro pago", !M.verificarFirma({ ...base, dataId: "999", xSignature: firmar("123456789", "req-1", "1700000000000") }));
ok("firma de otra solicitud", !M.verificarFirma({ ...base, xRequestId: "req-2", xSignature: firmar("123456789", "req-1", "1700000000000") }));
ok("sin secreto se rechaza", !M.verificarFirma({ ...base, secreto: undefined, xSignature: firmar("123456789", "req-1", "1700000000000") }));
ok("sin encabezado de firma se rechaza", !M.verificarFirma({ ...base, xSignature: null }));
ok("firma sin v1 se rechaza", !M.verificarFirma({ ...base, xSignature: "ts=1700000000000" }));
ok("firma de largo distinto se rechaza", !M.verificarFirma({ ...base, xSignature: "ts=1,v1=abc" }));
ok("firma basura se rechaza", !M.verificarFirma({ ...base, xSignature: "basura" }));
const firmarMay = `ts=5,v1=${createHmac("sha256", secreto).update("id:abcdef;request-id:r;ts:5;").digest("hex")}`;
ok("el id alfanumérico se pasa a minúsculas", M.verificarFirma({ dataId: "ABCDEF", xRequestId: "r", secreto, xSignature: firmarMay }));
const sinReq = `ts=7,v1=${createHmac("sha256", secreto).update("id:55;ts:7;").digest("hex")}`;
ok("sin x-request-id se omite esa parte", M.verificarFirma({ dataId: "55", xRequestId: null, secreto, xSignature: sinReq }));

// --- estados
eq("approved", M.estadoDesdeMP("approved"), "aprobado");
for (const s of ["pending", "in_process", "in_mediation", "authorized"]) eq(s, M.estadoDesdeMP(s), "pendiente");
for (const s of ["rejected", "cancelled"]) eq(s, M.estadoDesdeMP(s), "rechazado");
for (const s of ["refunded", "charged_back"]) eq(s, M.estadoDesdeMP(s), "reembolsado");
eq("estado desconocido", M.estadoDesdeMP("raro"), null);
eq("sin estado", M.estadoDesdeMP(undefined), null);

// --- token
ok("token de producción", M.tokenMPValido(token));
ok("token de prueba", M.tokenMPValido("TEST-1234567890123456-abcdef-0123456789"));
ok("token con espacios en los bordes", M.tokenMPValido(`  ${token}  `));
ok("token inventado", !M.tokenMPValido("hola"));
ok("token corto", !M.tokenMPValido("APP_USR-123"));
ok("no es texto", !M.tokenMPValido(12345));
ok("token con caracteres raros", !M.tokenMPValido("APP_USR-1234567890123456-ab cd;drop"));

// --- pago decisivo
const pg = (id, status) => ({ id, status });
eq("hay uno aprobado: decide ese", M.pagoDecisivo([pg(1, "rejected"), pg(2, "approved")]).id, 2);
eq("hay uno pendiente: se espera", M.pagoDecisivo([pg(1, "rejected"), pg(2, "in_process")]), null);
eq("solo rechazados: el último", M.pagoDecisivo([pg(3, "rejected"), pg(1, "rejected")]).id, 3);
eq("sin pagos", M.pagoDecisivo([]), null);

// --- preferencia
const ahora = new Date("2026-10-18T12:00:00Z");
const o = { pedidoId: "11111111-1111-1111-1111-111111111111", numero: 42, total: 2800.5, kioscoId: "22222222-2222-2222-2222-222222222222", kioscoNombre: "Kiosco A", slug: "kiosco-a", origen: "https://pedi.app", ahora };
const pref = M.armarPreferencia(o);
eq("un solo ítem con el total", pref.items, [{ title: "Pedido #42 en Kiosco A", quantity: 1, unit_price: 2800.5, currency_id: "ARS" }]);
eq("referencia externa = pedido", pref.external_reference, o.pedidoId);
eq("aviso con el kiosco", pref.notification_url, `https://pedi.app/api/pagos/mp/webhook?kiosco=${o.kioscoId}`);
eq("vuelta a la pantalla de retorno", pref.back_urls.success, `https://pedi.app/kiosco-a/pago?pedido=${o.pedidoId}`);
eq("regreso automático con https", pref.auto_return, "approved");
eq("vence a las horas configuradas", pref.expiration_date_to, "2026-10-18T15:00:00.000Z");
const local = M.armarPreferencia({ ...o, origen: "http://localhost:3000" });
ok("sin https no hay regreso automático ni aviso", !("auto_return" in local) && !("notification_url" in local));
ok("el título largo se corta", M.armarPreferencia({ ...o, kioscoNombre: "x".repeat(300) }).items[0].title.length === 120);

// --- el vencimiento de la app coincide con el de la base
const sql = readFileSync(new URL("../supabase/migrations/0029_pagos.sql", import.meta.url), "utf8");
eq("HORAS_VENCIMIENTO coincide con pago_horas_vencimiento()", Number(/pago_horas_vencimiento\(\)[^$]*\$\$ select (\d+) \$\$/.exec(sql)?.[1]), M.HORAS_VENCIMIENTO);

// --- avisos
const ped = { numero: 7, cliente_nombre: "Ana", total: 3500 };
eq("pago confirmado", P.armarAvisoPago("confirmado", ped), { title: "Pedido #7 pagado", body: "Ana · $3.500 · Mercado Pago", url: "/panel" });
for (const r of ["cancelado_con_pago", "pago_duplicado", "pagado_sin_stock", "monto_invalido"]) ok("aviso de " + r, P.armarAvisoPago(r, ped)?.title.includes("#7"));
for (const r of ["duplicado", "pendiente", "rechazado", "reembolsado", "ignorado", "no_aplica", null]) eq("sin aviso para " + r, P.armarAvisoPago(r, ped), null);

// --- pantalla de retorno
const e = (pago_estado, estado, extra = {}) => ({ pago_estado, estado, numero: 1, total: 100, ...extra });
eq("pagado y confirmado", R.vistaPago(e("pagado", "confirmado")), "pagado");
eq("pagado pero el dueño canceló", R.vistaPago(e("pagado", "cancelado")), "cobrado_cancelado");
eq("esperando pago", R.vistaPago(e("pendiente", "pendiente")), "pendiente");
eq("esperando pago con un intento rechazado", R.vistaPago(e("pendiente", "pendiente", { rechazado: true })), "reintentar");
eq("venció o falló", R.vistaPago(e("fallido", "cancelado")), "fallido");
eq("reembolsado", R.vistaPago(e("reembolsado", "confirmado")), "reembolsado");
eq("pedido que no es online", R.vistaPago(e("no_aplica", "pendiente")), "no_online");

console.log(fallos ? `pagos: ${fallos} fallos` : "pagos: todo OK");
process.exitCode = fallos ? 1 : 0;
