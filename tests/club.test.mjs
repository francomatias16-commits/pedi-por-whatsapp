// Prueba lib/club (aviso, textos, límites, tarjeta) y chequeos estáticos de la migración 0039, las rutas, las páginas y el panel del club.
// Uso: node tests/club.test.mjs
import ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
const leer = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const cargar = async (ruta) => {
  const js = ts.transpileModule(leer(ruta), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const C = await cargar("../lib/club.ts");
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };

// token y links
ok("token válido", C.CLUB_TOKEN_RE.test("a".repeat(32)) && !C.CLUB_TOKEN_RE.test("a".repeat(31)) && !C.CLUB_TOKEN_RE.test("A".repeat(32)) && !C.CLUB_TOKEN_RE.test("g".repeat(32)));
eq("link del club", C.linkClub("donjulio", "https://go.test/"), "https://go.test/donjulio/club");
eq("link de la tarjeta", C.linkTarjeta("ab".repeat(16)), `/tarjeta/${"ab".repeat(16)}`);
eq("clave local", C.claveTokenLocal("donjulio"), "gf-club-donjulio");

// aviso push
const av = C.armarAvisoClub({ cliente: "Marta", cantidad: 1, nuevo: false }, new Date("2026-10-19T17:32:00Z"));
eq("aviso título", av.title, "Marta sumó un sello");
ok("aviso con hora argentina (14:32)", av.body.startsWith("14:32"));
eq("aviso url y tag", [av.url, av.tag], ["/panel/puntos", "club"]);
eq("aviso plural", C.armarAvisoClub({ cliente: "Ana", cantidad: 3, nuevo: false }).title, "Ana sumó 3 sellos");
eq("aviso cliente nuevo", C.armarAvisoClub({ cliente: "Luis", cantidad: 1, nuevo: true }).title, "Luis se sumó al club");

// textos de bloqueo
ok("bloqueo vacío", C.textoBloqueo(null) === "");
ok("límite diario", C.textoBloqueo({ codigo: "club_limite_dia" }).includes("mañana"));
ok("espera con minutos", C.textoBloqueo({ codigo: "club_espera", espera_seg: 1500 }).includes("25 minutos"));
eq("espera 1 minuto", C.textoEspera(20), "en 1 minuto");
eq("espera en horas", C.textoEspera(7200), "en 2 horas");
eq("espera mixta", C.textoEspera(5400), "en 1 h 30 min");
ok("fuera de horario", C.textoBloqueo({ codigo: "club_fuera_horario" }).includes("horario"));
ok("club en pausa", C.textoBloqueo({ codigo: "club_inactivo" }).includes("pausa"));

// casilleros
eq("casilleros 3 de 10", C.casilleros(3, 10), { total: 10, llenos: 3 });
eq("casilleros completo", C.casilleros(12, 10), { total: 10, llenos: 10 });
eq("casilleros sin premio", C.casilleros(3, null), { total: 0, llenos: 0 });
eq("casilleros meta grande se acota", C.casilleros(50, 100), { total: 20, llenos: 10 });
eq("faltan", [C.faltan(3, 10), C.faltan(10, 10), C.faltan(3, null)], [7, 0, 0]);

// registro
ok("registro válido", C.validarRegistro("Marta", "11 5555-1234") === null);
ok("nombre corto", C.validarRegistro("M", "1155551234") !== null);
ok("teléfono corto", C.validarRegistro("Marta", "123") !== null);
ok("mensaje de tarjeta lleva el link", C.mensajeTarjeta("Don Julio", "https://x/y").includes("https://x/y"));

// límites
const base = { maxDia: "1", espera: "", horario: false, desde: "08:00", hasta: "22:00", activo: true };
eq("límites por defecto", C.ajustesDesdeForm(base), { ok: true, datos: { club_activo: true, club_max_por_dia: 1, club_espera_min: null, club_hora_desde: null, club_hora_hasta: null } });
eq("sin tope", C.ajustesDesdeForm({ ...base, maxDia: "" }).datos.club_max_por_dia, null);
eq("con espera y horario", C.ajustesDesdeForm({ ...base, espera: "30", horario: true }).datos, { club_activo: true, club_max_por_dia: 1, club_espera_min: 30, club_hora_desde: "08:00", club_hora_hasta: "22:00" });
ok("tope inválido", !C.ajustesDesdeForm({ ...base, maxDia: "0" }).ok && !C.ajustesDesdeForm({ ...base, maxDia: "2.5" }).ok && !C.ajustesDesdeForm({ ...base, maxDia: "99" }).ok);
ok("espera inválida", !C.ajustesDesdeForm({ ...base, espera: "0" }).ok && !C.ajustesDesdeForm({ ...base, espera: "2000" }).ok);
ok("horario incompleto o igual", !C.ajustesDesdeForm({ ...base, horario: true, desde: "" }).ok && !C.ajustesDesdeForm({ ...base, horario: true, desde: "10:00", hasta: "10:00" }).ok);
eq("resumen por defecto", C.resumenLimites({ club_activo: true, club_max_por_dia: 1, club_espera_min: null, club_hora_desde: null, club_hora_hasta: null }), "Hasta 1 sello por día.");
eq("resumen completo", C.resumenLimites({ club_activo: true, club_max_por_dia: 3, club_espera_min: 30, club_hora_desde: "08:00:00", club_hora_hasta: "20:00:00" }), "Hasta 3 sellos por día, 30 min entre sellos, solo de 08:00 a 20:00.");
eq("resumen en pausa", C.resumenLimites({ club_activo: false, club_max_por_dia: 1, club_espera_min: null, club_hora_desde: null, club_hora_hasta: null }), "El club está en pausa.");

// estático: migración, rutas, páginas y panel
const mig = leer("../supabase/migrations/0039_club.sql");
for (const f of ["club_unirse", "club_tarjeta", "club_sumar", "club_datos"]) ok(`${f}: anon puede ejecutarla`, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to anon`).test(mig));
for (const f of ["club_actividad", "club_rechazar", "club_reenviar"]) ok(`${f}: anon NO`, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon;`).test(mig) && !new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to anon`).test(mig));
for (const f of ["club_bloqueo", "club_otorgar", "club_armar_tarjeta"]) ok(`${f}: interna`, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`).test(mig));
ok("la tarjeta ya registrada no devuelve token", /ya_registrado'\)/.test(mig));
ok("reactivación y bienvenida miran también el club", mig.includes("'pedido', 'venta', 'club'"));
for (const r of ["../app/api/club/sumar/route.ts", "../app/api/club/unirse/route.ts", "../app/[slug]/club/page.tsx", "../app/tarjeta/[token]/page.tsx", "../app/tarjeta/[token]/manifest.webmanifest/route.ts", "../components/ClubUnirse.tsx", "../components/ClubTarjeta.tsx", "../components/sellos/Club.tsx"]) ok(`existe ${r}`, existsSync(new URL(r, import.meta.url)));
ok("la ruta de sumar valida el token", leer("../app/api/club/sumar/route.ts").includes("CLUB_TOKEN_RE"));
ok("el cliente no recibe el aviso interno", leer("../app/api/club/_comun.ts").includes("sinAviso") && leer("../app/api/club/sumar/route.ts").includes("sinAviso(") && leer("../app/api/club/unirse/route.ts").includes("sinAviso("));
ok("la tarjeta tiene manifest propio", leer("../app/tarjeta/[token]/page.tsx").includes("manifest.webmanifest"));
ok("el panel muestra la pestaña Hoy del club", leer("../components/Sellos.tsx").includes('["hoy", "Hoy"]') && leer("../components/Sellos.tsx").includes("<SellosHoy"));
ok("el service worker respeta el tag", leer("../public/sw.js").includes("datos.tag"));
ok("anon lee las columnas del club solo por funciones", !/grant select[^;]*club_/.test(mig));

// aviso de tarjeta completa
eq("mensaje premio listo", C.mensajePremioListo("Marta Gómez", "Kiosco Sol", "Gaseosa"), "¡Hola Marta! Completaste tu tarjeta de Kiosco Sol y tu premio (Gaseosa) te espera. Pasá cuando quieras a retirarlo.");
eq("mensaje premio listo sin nombre", C.mensajePremioListo(" ", "Sol", "Café").startsWith("¡Hola! Completaste"), true);
eq("completas: solo las que llegan a la meta, más sellos primero", C.conPremioListo([{ nombre: "B", sellos_disponibles: 10 }, { nombre: "A", sellos_disponibles: 12 }, { nombre: "C", sellos_disponibles: 9 }, { nombre: "D", sellos_disponibles: 10 }], 10).map((c) => c.nombre), ["A", "B", "D"]);
eq("completas: sin premio no hay lista", C.conPremioListo([{ nombre: "A", sellos_disponibles: 50 }], null), []);
ok("el panel del club muestra las tarjetas completas", leer("../components/sellos/Club.tsx").includes("<PremiosListos") && leer("../components/Sellos.tsx").includes("<SellosHoy"));

// instalar la tarjeta como app
ok("la tarjeta del cliente ofrece instalar la app", leer("../components/ClubTarjeta.tsx").includes("<InstalarApp"));

// el QR y la tarjeta prometen lo que el kiosquero configuró (0042)
eq("promesa: 1 por compra", C.textoPromesa({ premio: "Gaseosa", meta: 3, por_compra: 1 }), "Cada compra suma 1 sello. Juntá 3 y llevate Gaseosa.");
eq("promesa: sellos dobles", C.textoPromesa({ premio: "Gaseosa", meta: 3, por_compra: 2 }), "Cada compra suma 2 sellos. Juntá 3 y llevate Gaseosa.");
eq("promesa: con bienvenida", C.textoPromesa({ premio: "Café", meta: 5, por_compra: 1, bienvenida: 2 }), "Cada compra suma 1 sello. Al crear tu tarjeta te regalamos 2 más. Juntá 5 y llevate Café.");
eq("promesa: sin campañas no promete sellos", C.textoPromesa({ premio: "Café", meta: 5, por_compra: 0 }), "Juntá 5 y llevate Café.");
eq("promesa: sin premio ni datos", C.textoPromesa({ premio: null, meta: null }), "");
const mig42 = leer("../supabase/migrations/0042_club_roles_aviso.sql");
ok("0042: club_datos y la tarjeta devuelven por_compra", (mig42.match(/'por_compra'/g) || []).length === 2);
ok("0042: el encargado puede ver y rechazar", (mig42.match(/es_miembro\(/g) || []).length >= 3);
ok("0042: rechazar avisa descubierto y deja rastro", mig42.includes("'descubierto'") && mig42.includes("anulado_por"));
ok("el QR de registro usa la promesa", leer("../components/ClubUnirse.tsx").includes("textoPromesa(datos)"));
ok("el panel avisa cuando el sello rechazado ya se canjeó", leer("../components/sellos/Club.tsx").includes("descubierto"));
ok("el test SQL del club existe", existsSync(new URL("../supabase/tests/club_test.py", import.meta.url)));

// cómo pagó (0043)
ok("medios válidos", C.esMedioClub("efectivo") && C.esMedioClub("transferencia") && C.esMedioClub("mercadopago") && !C.esMedioClub("bitcoin") && !C.esMedioClub(undefined));
ok("solo los medios con comprobante se verifican", C.esMedioDigital("transferencia") && C.esMedioDigital("mercadopago") && !C.esMedioDigital("efectivo") && !C.esMedioDigital(null));
const avT = C.armarAvisoClub({ cliente: "Marta", cantidad: 1, nuevo: false, medio: "transferencia" }, new Date("2026-10-19T17:32:00Z"));
ok("aviso digital pide verificar", avT.title.startsWith("Verificá: Marta") && avT.title.includes("transferencia") && avT.body.startsWith("14:32"));
ok("aviso Mercado Pago", C.armarAvisoClub({ cliente: "Ana", cantidad: 1, nuevo: false, medio: "mercadopago" }).title.includes("Mercado Pago"));
ok("aviso digital no se pisa con el de efectivo", avT.tag !== "club" && C.armarAvisoClub({ cliente: "Marta", cantidad: 1, nuevo: false, medio: "efectivo" }).tag === "club");
eq("aviso de efectivo no cambia", C.armarAvisoClub({ cliente: "Marta", cantidad: 1, nuevo: false, medio: "efectivo" }).title, "Marta sumó un sello");
eq("el alta de un cliente nuevo siempre es aviso normal", C.armarAvisoClub({ cliente: "Luis", cantidad: 1, nuevo: true, medio: "transferencia" }).title, "Luis se sumó al club");
const mig43 = leer("../supabase/migrations/0043_club_medio_pago.sql");
ok("0043: sin DROP y con permisos de verificar", !/\bdrop\b/i.test(mig43.replace(/--.*$/gm, "")) && mig43.includes("grant execute on function public.club_verificar(uuid) to authenticated"));
ok("0043: club_sumar con medio es público", mig43.includes("grant execute on function public.club_sumar(text, text) to anon, authenticated"));
ok("la ruta pide un medio válido", leer("../app/api/club/sumar/route.ts").includes("esMedioClub"));
ok("la tarjeta ofrece los tres medios", ["efectivo", "transferencia", "mercadopago"].every((m) => leer("../components/ClubTarjeta.tsx").includes(`sumar("${m}")`)));
ok("el panel permite confirmar sellos digitales", leer("../components/sellos/Club.tsx").includes("club_verificar"));

// Talonario de papelitos (0044): el código se normaliza igual en la tarjeta y en la ruta; el alfabeto no tiene I, L, O, 0 ni 1.
eq("papelito: se normaliza con minúsculas, espacios y guiones", C.normalizarCodigoClub(" ab-cd 23 "), "ABCD23");
ok("papelito: el formato acepta 6 caracteres del alfabeto", C.CODIGO_CLUB_RE.test("ABCD23") && C.CODIGO_CLUB_RE.test("KMNPQR"));
ok("papelito: no acepta I, L, O, 0 ni 1", !C.CODIGO_CLUB_RE.test("ABCDIL") && !C.CODIGO_CLUB_RE.test("ABCDO0") && !C.CODIGO_CLUB_RE.test("ABCD1Z"));
ok("papelito: no acepta menos ni más de 6", !C.CODIGO_CLUB_RE.test("ABCDE") && !C.CODIGO_CLUB_RE.test("ABCDEFG"));
const rutaSumar = leer("../app/api/club/sumar/route.ts");
ok("la ruta manda el papelito a la función", rutaSumar.includes("p_codigo: cod || null"));
ok("la ruta responde 409 cuando la función devuelve _error", rutaSumar.includes("if (r._error)") && rutaSumar.includes("status: 409"));
const errs = leer("../lib/errores.ts");
ok("todos los errores de papelito tienen mensaje", ["club_codigo_requerido", "club_codigo_invalido", "club_codigo_usado", "club_codigo_bloqueado"].every((c) => errs.includes(`\"${c}\"`) || errs.includes(`"${c}"`)));
ok("la tarjeta pide el papelito solo si el local lo exige", leer("../components/ClubTarjeta.tsx").includes("t.exige_codigo ? setPidiendoCodigo(true)"));
ok("la migración 0044 cierra el acceso directo a los papelitos", leer("../supabase/migrations/0044_club_talonario.sql").includes("revoke all on public.club_codigos from anon, authenticated"));

// Panel del talonario (0044): prender el papelito, generar, imprimir.
const pap = leer("../components/sellos/PapelitosClub.tsx");
ok("el panel incluye el talonario en Puntos → Mi programa", leer("../components/Sellos.tsx").includes("<PapelitosClub kiosco={kiosco} />"));
ok("el panel prende y apaga el papelito con la función del dueño", pap.includes('rpc("club_configurar_codigos"'));
ok("el panel genera con la función del lote y valida 1..200", pap.includes('rpc("club_generar_codigos"') && pap.includes("n > 200"));
ok("el panel imprime solo lo que hace falta (sin usar)", pap.includes('rpc("club_codigos_sin_usar"') && pap.includes("window.print()"));
ok("el tope por local está en la migración", leer("../supabase/migrations/0044_club_talonario.sql").includes("v_fallos_local >= 50"));

// Visitas por cliente: un día con sello válido = una visita; anulados y ajustes manuales no cuentan.
{
  const S = (f, o = "club", c = 1, a = false) => ({ created_at: f, origen: o, cantidad: c, anulado: a });
  const ahora = new Date("2026-10-21T15:00:00Z");
  const r = C.resumenVisitas([
    S("2026-10-01T15:00:00Z", "venta"), S("2026-10-01T20:00:00Z", "club"), // mismo día: 1 visita
    S("2026-10-11T15:00:00Z", "club"), S("2026-10-20T15:00:00Z", "venta"),
    S("2026-10-15T15:00:00Z", "club", 1, true), S("2026-10-16T15:00:00Z", "manual", 5), S("2026-10-17T15:00:00Z", "club", -1),
  ], ahora);
  eq("visitas: cuenta días, no sellos", r.visitas, 3);
  eq("visitas: primera y última", [r.primera, r.ultima], ["2026-10-01", "2026-10-20"]);
  eq("visitas: días desde la última", r.diasDesdeUltima, 1);
  eq("visitas: promedio entre visitas", r.promedioDias, 9.5);
  eq("visitas: últimos 30 días", r.ultimos30, 3);
  eq("visitas: solo por toque del club", r.soloClub, 1);
  eq("visitas: sin sellos", C.resumenVisitas([], ahora).visitas, 0);
  eq("visitas: medianoche argentina (02:30 UTC = día anterior)", C.resumenVisitas([S("2026-10-20T02:30:00Z", "venta")], ahora).primera, "2026-10-19");
  ok("visitas: texto", C.textoVisitas(r).includes("3 visitas") && C.textoVisitas(r).includes("última ayer"));
  ok("el panel muestra las visitas del cliente", leer("../components/sellos/ClientesSellos.tsx").includes("textoVisitas(rv)"));
}

if (fallos) { console.log(`✗ ${fallos} fallo(s)`); process.exit(1); }
console.log("club OK");
