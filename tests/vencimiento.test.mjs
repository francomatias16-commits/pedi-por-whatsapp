// Prueba de lib/vencimiento.ts: node tests/vencimiento.test.mjs  (o: npm run test:vencimiento)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/vencimiento.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const V = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fallos++; console.log(`${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : ` → ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`}`); };

const hoy = "2026-10-21";
eq("sin fecha no hay estado", V.estadoVencimiento(null, hoy), null);
eq("ayer = vencido", V.estadoVencimiento("2026-10-20", hoy), "vencido");
eq("hoy = por vencer (igual que la base: vence <= hoy + 7)", V.estadoVencimiento("2026-10-21", hoy), "por_vencer");
eq("en 7 días = por vencer", V.estadoVencimiento("2026-10-28", hoy), "por_vencer");
eq("en 8 días = vigente", V.estadoVencimiento("2026-10-29", hoy), "vigente");
eq("cruce de mes y año", V.estadoVencimiento("2027-01-02", "2026-12-30"), "por_vencer");
eq("vigente no avisa", V.avisoVencimiento("Alfajor", "2027-03-01", hoy), null);
eq("sin fecha no avisa", V.avisoVencimiento("Alfajor", null, hoy), null);
eq("vencido avisa con fecha", V.avisoVencimiento("Yogur", "2026-10-15", hoy), "Ojo: Yogur tiene unidades vencidas (15/10/2026). Revisá la fecha antes de venderlo.");
eq("mañana", V.avisoVencimiento("Leche", "2026-10-22", hoy), "Leche vence mañana (22/10/2026).");
eq("hoy", V.avisoVencimiento("Leche", "2026-10-21", hoy), "Leche vence hoy (21/10/2026).");
eq("en 5 días", V.avisoVencimiento("Queso", "2026-10-26", hoy), "Queso vence en 5 días (26/10/2026).");
eq("hoyAR devuelve YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(V.hoyAR()), true);
eq("hoyAR a las 01:00 UTC todavía es el día anterior en Argentina", V.hoyAR(new Date("2026-10-21T01:00:00Z")), "2026-10-20");

if (fallos) { console.log(`\n${fallos} fallos`); process.exit(1); }
console.log("\nvencimiento: OK");
