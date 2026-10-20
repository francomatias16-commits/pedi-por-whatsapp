// Prueba de la paginación de consultas: node tests/paginar.test.mjs  (o: npm run test:paginar)
import ts from "typescript";
import { readFileSync } from "node:fs";
const leer = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const js = ts.transpileModule(leer("../lib/paginar.ts"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { traerTodo } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };

// Simula PostgREST: corta cada respuesta en 1000 filas.
const tabla = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
const falsa = (filas, llamadas) => async (d, h) => { llamadas.push([d, h]); return { data: filas.slice(d, Math.min(h + 1, d + 1000)), error: null }; };

for (const n of [0, 1, 999, 1000, 1001, 2500, 3000]) {
  const ll = [];
  const r = await traerTodo(falsa(tabla(n), ll));
  eq(`trae ${n} filas`, r.data.length, n);
  eq(`sin error con ${n}`, r.error, null);
  eq(`sin repetidas con ${n}`, new Set(r.data.map((x) => x.id)).size, n);
}
// Con exactamente 1000 hace una segunda consulta (vacía) para confirmar que no hay más.
{ const ll = []; await traerTodo(falsa(tabla(1000), ll)); eq("1000 exactas: 2 consultas", ll.length, 2); }
// Un error a mitad de camino se devuelve (no se oculta) junto con lo ya traído.
{ let k = 0; const r = await traerTodo(async (d) => (k++ === 1 ? { data: null, error: { message: "boom" } } : { data: tabla(1000), error: null })); eq("error propagado", r.error?.message, "boom"); eq("parcial", r.data.length, 1000); }
// Tope de seguridad: una consulta que nunca termina no cuelga la pantalla.
{ const r = await traerTodo(async () => ({ data: tabla(1000), error: null }), 1000, 5); eq("tope de páginas", r.data.length, 5000); }

if (fallos) { console.log(`✗ ${fallos} falla(s)`); process.exit(1); }
console.log("paginar: todo OK");
