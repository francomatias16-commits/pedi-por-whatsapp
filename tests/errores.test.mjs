// Cada "raise exception 'codigo'" de las migraciones tiene que tener mensaje amigable en lib/. Uso: node tests/errores.test.mjs
import { readdirSync, readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const leer = (dir, ext) => readdirSync(new URL(dir, root), { recursive: true })
  .filter((f) => ext.some((e) => String(f).endsWith(e))).map((f) => readFileSync(new URL(`${dir}${f}`, root), "utf8"));
const codigos = new Set();
for (const t of leer("supabase/migrations/", [".sql"])) {
  for (const m of t.replace(/--.*$/gm, "").matchAll(/raise\s+exception\s+'([^']+)'/gi)) codigos.add(m[1]);
}
const fuentes = [...leer("lib/", [".ts"]), ...leer("components/", [".tsx"]), ...leer("app/", [".ts", ".tsx"])].join("\n");
const sinMensaje = [...codigos].filter((c) => !fuentes.includes(`"${c}"`) && !fuentes.includes(`'${c}'`));
if (sinMensaje.length) { console.log("FALTA mensaje amigable para:", sinMensaje.join(", ")); process.exit(1); }
console.log(`errores: ${codigos.size} códigos SQL con mensaje amigable`);
