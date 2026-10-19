// Prueba de la limpieza de fotos viejas: node tests/fotos-limpieza.test.mjs  (o: npm run test:fotos-limpieza)
import ts from "typescript";
import { readFileSync } from "node:fs";
const compilar = (ruta) => ts.transpileModule(readFileSync(new URL(ruta, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const fotos = compilar("../lib/fotos.ts");
const limp = compilar("../lib/fotos-limpieza.ts").replace(/from "@\/lib\/fotos"/, `from "data:text/javascript;base64,${Buffer.from(fotos).toString("base64")}"`);
const L = await import("data:text/javascript;base64," + Buffer.from(limp).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const K = "0b6f9f3e-1111-4222-8333-444455556666", OTRO = "9c1d2e3f-aaaa-4bbb-8ccc-ddddeeeeffff";
const url = (carpeta, f) => `https://abc.supabase.co/storage/v1/object/public/productos/${carpeta}/${f}`;

eq("retención por defecto", L.diasRetencion(undefined), 30);
eq("retención válida", L.diasRetencion("45"), 45);
eq("retención muy baja", L.diasRetencion("3"), 30);
eq("retención muy alta", L.diasRetencion("9999"), 30);
eq("retención no numérica", L.diasRetencion("abc"), 30);
eq("retención decimal", L.diasRetencion("30.5"), 30);

eq("ruta propia", L.rutaABorrar({ id: "1", kiosco_id: K, url: url(K, "p1-123.jpg") }), `${K}/p1-123.jpg`);
eq("url null", L.rutaABorrar({ id: "1", kiosco_id: K, url: null }), null);
eq("url externa", L.rutaABorrar({ id: "1", kiosco_id: K, url: "https://images.openfoodfacts.org/x.jpg" }), null);
eq("carpeta de otro local", L.rutaABorrar({ id: "1", kiosco_id: K, url: url(OTRO, "p1-123.jpg") }), null);
eq("con ..", L.rutaABorrar({ id: "1", kiosco_id: K, url: url(K, "%2E%2E/%2E%2E/x.jpg") }), null);
eq("solo la carpeta", L.rutaABorrar({ id: "1", kiosco_id: K, url: url(K, "") }), null);

const plan = L.planLimpieza([
  { id: "a", kiosco_id: K, url: url(K, "p1-1.jpg") },
  { id: "b", kiosco_id: K, url: null },
  { id: "c", kiosco_id: K, url: url(OTRO, "p2-2.jpg") },
]);
eq("plan borrar", plan.borrar, [{ id: "a", ruta: `${K}/p1-1.jpg` }]);
eq("plan solo marcar", plan.soloMarcar, ["b", "c"]);

// Migración: debe existir lo que usa el cron.
const sql = readFileSync(new URL("../supabase/migrations/0035_fotos_limpieza.sql", import.meta.url), "utf8");
for (const t of ["limpiada_at", "fotos_limpieza_pendientes", "fotos_limpieza_marcar", "foto_vencida"]) eq(`migración menciona ${t}`, sql.includes(t), true);
eq("limpieza solo servidor", /revoke all on function public\.fotos_limpieza_pendientes\(int, int\) from public, anon, authenticated/.test(sql), true);

console.log(fallos ? `${fallos} fallos` : "fotos-limpieza: todo OK");
process.exit(fallos ? 1 : 0);
