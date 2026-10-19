// Prueba lib/zonas (mínimo y costo mostrados, validación del formulario) y chequeos estáticos de la migración 0033.
// Uso: node tests/zonas.test.mjs
import ts from "typescript";
import { readFileSync } from "node:fs";
const leer = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const js = ts.transpileModule(leer("../lib/zonas.ts"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const Z = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };

eq("retiro: mínimo del local", Z.minimoEfectivo(500, "retiro", { pedido_minimo: 2000 }), 500);
eq("envío con zona: gana el mayor (zona)", Z.minimoEfectivo(500, "envio", { pedido_minimo: 2000 }), 2000);
eq("envío con zona: gana el mayor (local)", Z.minimoEfectivo(3000, "envio", { pedido_minimo: 2000 }), 3000);
eq("envío sin zona elegida: mínimo del local", Z.minimoEfectivo(500, "envio", null), 500);
eq("retiro: costo 0", Z.costoEnvioMostrado(true, 300, "retiro", { costo: 200 }), 0);
eq("zonas apagadas: costo único", Z.costoEnvioMostrado(false, 300, "envio", { costo: 200 }), 300);
eq("zonas encendidas: costo de la zona", Z.costoEnvioMostrado(true, 300, "envio", { costo: 200 }), 200);
eq("zonas encendidas sin elegir: 0", Z.costoEnvioMostrado(true, 300, "envio", null), 0);
eq("zona gratis", Z.costoEnvioMostrado(true, 300, "envio", { costo: 0 }), 0);

eq("válido", Z.validarZona({ nombre: "Centro", costo: "200", minimo: "1000" }), null);
eq("válido con coma y vacíos", Z.validarZona({ nombre: "Centro", costo: "", minimo: "" }), null);
eq("nombre vacío", Z.validarZona({ nombre: "  ", costo: "1", minimo: "0" }), "zona_nombre_invalido");
eq("nombre largo", Z.validarZona({ nombre: "x".repeat(61), costo: "1", minimo: "0" }), "zona_nombre_invalido");
eq("costo negativo", Z.validarZona({ nombre: "A", costo: "-1", minimo: "0" }), "zona_costo_invalido");
eq("costo con 3 decimales", Z.validarZona({ nombre: "A", costo: "1,555", minimo: "0" }), "zona_costo_invalido");
eq("mínimo no numérico", Z.validarZona({ nombre: "A", costo: "1", minimo: "abc" }), "zona_costo_invalido");
eq("costo enorme", Z.validarZona({ nombre: "A", costo: "2000000", minimo: "0" }), "zona_costo_invalido");
eq("tope de zonas igual al de la base", Z.TOPE_ZONAS, 30);

const sql = leer("../supabase/migrations/0033_zonas_envio.sql").replace(/--.*$/gm, "");
ok("0033 sin drop", !/\bdrop\b/i.test(sql));
ok("0033: RLS en la tabla nueva y sin escritura directa", /enable row level security/.test(sql) && /revoke all on public\.zonas_envio from anon, authenticated/.test(sql) && !/grant (insert|update|delete)/i.test(sql));
ok("0033: funciones con search_path fijo", (sql.match(/create or replace function/gi) ?? []).length === (sql.match(/set search_path = public/gi) ?? []).length);
ok("0033: anon no escribe zonas", !/zona_guardar[^;]*to anon/.test(sql) && !/zona_quitar[^;]*to anon/.test(sql) && !/zonas_configurar_activo[^;]*to anon/.test(sql));
ok("0033: la tienda manda la zona y no el costo", /p_zona:/.test(leer("../components/Tienda.tsx")) && !/p_costo_envio/.test(leer("../components/Tienda.tsx")));
ok("Mi negocio tiene el editor de zonas", leer("../components/MiKiosco.tsx").includes("<ZonasEnvio"));
if (fallos) { console.log(`zonas: ${fallos} falla(s)`); process.exit(1); }
console.log("zonas: ok");
