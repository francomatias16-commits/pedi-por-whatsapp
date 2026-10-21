// Prueba lib/auditoria (resumen por empleado, señales, rango de fechas) y chequeos estáticos de la migración 0041 y del panel.
// Uso: node tests/auditoria.test.mjs
import ts from "typescript";
import { readFileSync } from "node:fs";
const leer = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const js = ts.transpileModule(leer("../lib/auditoria.ts"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const A = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };

// fechas en Argentina (UTC-3)
eq("hoy AR de madrugada UTC", A.hoyAR(new Date("2026-10-20T01:30:00Z")), "2026-10-19");
eq("rango 7 días", A.rangoDias(7, new Date("2026-10-19T15:00:00Z")), { desde: "2026-10-13", hasta: "2026-10-19" });
eq("rango mínimo 1 día", A.rangoDias(0, new Date("2026-10-19T15:00:00Z")), { desde: "2026-10-19", hasta: "2026-10-19" });
eq("fecha corta", A.fechaCorta("2026-10-05"), "05/10");

// resumen
const f = (dia, u, nombre, sellos, manuales, anulados, canjes) => ({ dia, usuario_id: u, nombre, sellos, manuales, anulados, canjes });
const r = A.resumirPorEmpleado([
  f("2026-10-18", null, "Sin registrar", 4, 0, 0, 0),
  f("2026-10-18", "u1", "ana@x.com", 6, 3, 1, 1),
  f("2026-10-19", "u1", "ana@x.com", "2", "0", "0", "0"),
  f("2026-10-19", "u2", "beto@x.com", 20, 12, 3, 0),
]);
eq("orden: más sellos primero, sin registrar al final", r.map((e) => e.nombre), ["beto@x.com", "ana@x.com", "Sin registrar"]);
const ana = r.find((e) => e.clave === "u1");
eq("suma por persona", [ana.sellos, ana.manuales, ana.anulados, ana.canjes], [8, 3, 1, 1]);
eq("días de más nuevo a más viejo", ana.dias.map((d) => d.dia), ["2026-10-19", "2026-10-18"]);
eq("señales de beto", r[0].senales, ["Muchos sellos manuales", "Varios sellos anulados"]);
eq("ana sin señales", ana.senales, []);
eq("sin registrar nunca tiene señales", r[2].senales, []);
ok("sin registrar marcado", r[2].sinRegistrar === true && r[2].clave === "sin-registrar");
eq("vacío", A.resumirPorEmpleado([]), []);
eq("manuales bajo el mínimo no avisan", A.senalesDe({ sellos: 9, manuales: 9, anulados: 0, sinRegistrar: false }), []);

// migración y panel
const m = leer("../supabase/migrations/0041_auditoria_sellos.sql");
ok("0041 agrega usuario_id con default auth.uid()", m.includes("add column usuario_id uuid default auth.uid()"));
ok("0041 solo el dueño", m.includes("es_dueno(p_kiosco)") && m.includes("no_autorizado"));
ok("0041 sin acceso anónimo", m.includes("from public, anon") && m.includes("to authenticated"));
ok("0041 sin DROP", !/\bdrop\b/i.test(m.replace(/--.*$/gm, "")));
const p = leer("../components/Sellos.tsx");
ok("panel con pestaña Por empleado", p.includes("ReporteEmpleados") && p.includes('"equipo"'));
ok("reporte llama a la función", leer("../components/sellos/ReporteEmpleados.tsx").includes('rpc("sellos_por_empleado"'));

if (fallos) { console.log(fallos, "fallos"); process.exit(1); }
console.log("auditoria OK");
