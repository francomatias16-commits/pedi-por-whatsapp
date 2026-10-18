// Chequeos estáticos sobre supabase/migrations (sin base de datos). Falla con código 1 si algo no cumple.
//  1) Numeración 0001..N sin saltos ni duplicados.
//  2) Toda tabla creada en public tiene "enable row level security" en alguna migración.
//  3) Toda función "security definer" declara "set search_path".
//  4) Ninguna migración nueva usa DROP sin comentario "-- drop-ok" (para que se revise a conciencia).
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../supabase/migrations/", import.meta.url);
const archivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const errores = [];

// 1) numeración
archivos.forEach((f, i) => {
  const n = Number(f.slice(0, 4));
  if (!/^\d{4}_/.test(f)) errores.push(`${f}: el nombre debe empezar con 4 dígitos y _`);
  else if (n !== i + 1) errores.push(`${f}: se esperaba la migración ${String(i + 1).padStart(4, "0")} (salto o duplicado)`);
});

const sql = archivos.map((f) => ({ f, t: readFileSync(new URL(f, dir), "utf8") }));
const sinComentarios = (t) => t.replace(/--.*$/gm, "");
const todo = sql.map((x) => sinComentarios(x.t)).join("\n");

// 2) RLS en toda tabla de public
for (const { f, t } of sql) {
  for (const m of sinComentarios(t).matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    const tabla = m[1];
    if (!new RegExp(`alter\\s+table\\s+(?:public\\.)?${tabla}\\s+enable\\s+row\\s+level\\s+security`, "i").test(todo))
      errores.push(`${f}: la tabla ${tabla} no tiene RLS activado`);
  }
}

// 3) security definer con search_path (se mira el encabezado: hasta el "as $$")
for (const { f, t } of sql) {
  for (const m of sinComentarios(t).matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)([\s\S]*?)\bas\s+\$/gi)) {
    if (/security\s+definer/i.test(m[2]) && !/set\s+search_path/i.test(m[2]))
      errores.push(`${f}: la función ${m[1]} es security definer sin set search_path`);
  }
}

// 4) DROP de funciones/tablas/columnas solo con "-- drop-ok" en la misma línea o la anterior
//    (las migraciones ya aplicadas antes de este chequeo se aceptan: 0001..0024)
for (const { f, t } of sql) {
  if (Number(f.slice(0, 4)) <= 24) continue;
  const lineas = t.split("\n");
  lineas.forEach((l, i) => {
    if (/^\s*drop\s+(function|table|column|schema)|\bdrop\s+column\b/i.test(l) && !/drop-ok/i.test(l + (lineas[i - 1] ?? "")))
      errores.push(`${f}:${i + 1}: DROP sin "-- drop-ok" (Supabase pide confirmación manual para estas sentencias)`);
  });
}

if (errores.length) {
  console.error(`✗ ${errores.length} problema(s) en las migraciones:\n` + errores.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log(`✓ ${archivos.length} migraciones: numeración, RLS, search_path y DROP revisados`);
