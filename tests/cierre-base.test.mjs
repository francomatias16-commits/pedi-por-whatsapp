// Etapa 0: salud, limpieza de eventos de Sentry y exportación. Uso: node tests/cierre-base.test.mjs  (o: npm run test:cierre)
import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
const cargar = async (ruta) => {
  const js = ts.transpileModule(readFileSync(new URL(ruta, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const S = await cargar("../lib/salud.ts");
const Z = await cargar("../lib/sentry.ts");
const E = await cargar("../lib/exportar.ts");
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };

// salud
eq("salud ok", S.armarSalud({ ok: true, ms: 10 }, "abc1234").estado, "ok");
eq("salud degradada si la base no responde", S.armarSalud({ ok: false }, "abc1234").estado, "degradado");
eq("variables faltantes", S.variablesFaltantes({ CRON_SECRET: "x", VAPID_PRIVATE_KEY: "y" }), ["SUPABASE_SERVICE_ROLE_KEY", "PUSH_WEBHOOK_SECRET"]);
eq("variables completas", S.variablesFaltantes(Object.fromEntries(S.VARIABLES_SERVIDOR.map((k) => [k, "1"]))), []);

// sentry: no salen teléfonos, cuerpos ni cookies
const ev = Z.limpiarEvento({
  message: "No se pudo avisar a 3415551234 y a +54 9 341 555-9999",
  request: { data: { telefono: "3415551234" }, cookies: { sb: "x" }, query_string: "t=1", headers: { authorization: "Bearer zzz", "x-signature": "s", accept: "json" } },
  user: { email: "a@b.com" },
});
eq("sentry: teléfono local oculto", ev.message.includes("3415551234"), false);
eq("sentry: teléfono internacional oculto", ev.message.includes("555-9999"), false);
eq("sentry: sin cuerpo ni cookies ni usuario", [ev.request.data, ev.request.cookies, ev.request.query_string, ev.user], [undefined, undefined, undefined, undefined]);
eq("sentry: headers sensibles fuera, el resto queda", Object.keys(ev.request.headers), ["accept"]);
eq("sentry: no toca texto sin datos", Z.limpiarTexto("Falló la consulta de productos"), "Falló la consulta de productos");

// exportación
eq("nombre de archivo", E.nombreArchivo("Kiosco-Ana!", new Date("2026-10-18T12:00:00Z")), "datos-kiosco-ana-2026-10-18.json");
eq("exportación trae fecha y formato", Object.keys(E.armarExportacion({ productos: [] }, new Date("2026-10-18T12:00:00Z"))), ["generado", "formato", "productos"]);
const borrado = E.fechaDeBorrado("2026-10-18T12:00:00Z");
eq("borrado a los 30 días", borrado.toISOString().slice(0, 10), "2026-11-17");
// Las secciones de la app tienen que existir en la función SQL, y al revés.
const sql = readFileSync(new URL("../supabase/migrations/0028_cierre_base.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
const enSql = new Set([...sql.matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]));
const sinSql = E.SECCIONES_EXPORTABLES.filter((s) => !enSql.has(s));
eq("todas las secciones de la app existen en 0028", sinSql, []);
const directas = sql.match(/v_directas text\[\] := array\[([\s\S]*?)\];/)[1].match(/'([a-z_]+)'/g).map((x) => x.replace(/'/g, ""));
const hijas = Object.keys(JSON.parse(sql.match(/v_hijas jsonb := '([\s\S]*?)'::jsonb/)[1]));
eq("la app exporta todas las secciones de la función SQL", [...directas, ...hijas, "kiosco"].filter((s) => !E.SECCIONES_EXPORTABLES.includes(s)), []);
// Datos que nunca se exportan: hash de PIN, claves push, tokens.
eq("no se exportan secretos", ["pos_config", "push_suscripciones", "pos_pin_tokens", "pos_pin_intentos"].filter((s) => E.SECCIONES_EXPORTABLES.includes(s)), []);

if (fallos) { console.log(`${fallos} falla(s)`); process.exit(1); }
console.log("cierre de base: salud, sentry y exportación OK");
