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
eq("aviso url y tag", [av.url, av.tag], ["/panel/clientes/puntos", "club"]);
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
ok("el panel muestra la pestaña Club", leer("../components/Sellos.tsx").includes('["club", "Club"]'));
ok("el service worker respeta el tag", leer("../public/sw.js").includes("datos.tag"));
ok("anon lee las columnas del club solo por funciones", !/grant select[^;]*club_/.test(mig));

// aviso de tarjeta completa
eq("mensaje premio listo", C.mensajePremioListo("Marta Gómez", "Kiosco Sol", "Gaseosa"), "¡Hola Marta! Completaste tu tarjeta de Kiosco Sol y tu premio (Gaseosa) te espera. Pasá cuando quieras a retirarlo.");
eq("mensaje premio listo sin nombre", C.mensajePremioListo(" ", "Sol", "Café").startsWith("¡Hola! Completaste"), true);
eq("completas: solo las que llegan a la meta, más sellos primero", C.conPremioListo([{ nombre: "B", sellos_disponibles: 10 }, { nombre: "A", sellos_disponibles: 12 }, { nombre: "C", sellos_disponibles: 9 }, { nombre: "D", sellos_disponibles: 10 }], 10).map((c) => c.nombre), ["A", "B", "D"]);
eq("completas: sin premio no hay lista", C.conPremioListo([{ nombre: "A", sellos_disponibles: 50 }], null), []);
ok("el panel del club muestra las tarjetas completas", leer("../components/sellos/Club.tsx").includes("<PremiosListos"));

if (fallos) { console.log(`✗ ${fallos} fallo(s)`); process.exit(1); }
console.log("club OK");
