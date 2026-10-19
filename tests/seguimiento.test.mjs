// Prueba lib/seguimiento (etapas, pasos, link, texto del aviso) y chequeos estáticos de la migración 0032, la página y el panel.
// Uso: node tests/seguimiento.test.mjs
import ts from "typescript";
import { readFileSync } from "node:fs";
const leer = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const cargar = async (ruta) => {
  const js = ts.transpileModule(leer(ruta), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const S = await cargar("../lib/seguimiento.ts");
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };
const T = "a".repeat(64);

eq("retiro: pasos", S.pasosDe("retiro").map((p) => p.etapa), ["recibido", "confirmado", "listo", "entregado"]);
eq("envío: pasos", S.pasosDe("envio").map((p) => p.etapa), ["recibido", "confirmado", "en_camino", "entregado"]);
eq("recibido es el paso 0", S.pasoActual("recibido", "retiro"), 0);
eq("esperando pago no pasa del primer paso", S.pasoActual("esperando_pago", "envio"), 0);
eq("confirmado", S.pasoActual("confirmado", "retiro"), 1);
eq("listo (retiro)", S.pasoActual("listo", "retiro"), 2);
eq("en camino (envío)", S.pasoActual("en_camino", "envio"), 2);
eq("entregado", S.pasoActual("entregado", "envio"), 3);
eq("cancelado queda fuera", S.pasoActual("cancelado", "retiro"), -1);
for (const e of ["esperando_pago", "recibido", "confirmado", "listo", "en_camino", "entregado", "cancelado"]) ok(`etapa ${e}: título y detalle`, !!S.TITULO_ETAPA[e] && !!S.DETALLE_ETAPA[e]);
ok("solo entregado y cancelado son finales", ["entregado", "cancelado"].every(S.etapaFinal) && !["recibido", "confirmado", "listo", "en_camino", "esperando_pago"].some(S.etapaFinal));
ok("token válido y no válido", S.TOKEN_RE.test(T) && !S.TOKEN_RE.test("a".repeat(63)) && !S.TOKEN_RE.test("A".repeat(64)) && !S.TOKEN_RE.test("g".repeat(64)));
eq("link con origen", S.linkSeguimiento(T, "https://app.test/"), `https://app.test/seguimiento/${T}`);
eq("link relativo", S.linkSeguimiento(T), `/seguimiento/${T}`);

const base = { nombre: "Ana", local: "Kiosco A", numero: 7, estado: "confirmado", modalidad: "retiro", entrega: null };
const L = S.linkSeguimiento(T, "https://app.test");
ok("aviso con link", S.textoAviso(base, L).includes(L));
ok("aviso sin link no lo trae", !S.textoAviso(base, null).includes("seguimiento"));
ok("cancelado no lleva link", !S.textoAviso({ ...base, estado: "cancelado" }, L).includes(L));
ok("texto listo", S.textoAviso({ ...base, entrega: "listo" }, null).includes("listo"));
ok("texto en camino", S.textoAviso({ ...base, modalidad: "envio", entrega: "en_camino" }, null).includes("en camino"));
ok("entregado agradece", S.textoAviso({ ...base, estado: "entregado" }, null).includes("Gracias"));

// --- chequeos estáticos
const sql = leer("../supabase/migrations/0032_seguimiento.sql").replace(/--.*$/gm, "");
ok("0032 sin drop ni delete", !/\bdrop\b|\bdelete\b/i.test(sql));
ok("0032: funciones con search_path fijo", (sql.match(/create or replace function/gi) ?? []).length === (sql.match(/set search_path = public/gi) ?? []).length);
ok("0032: solo la consulta pública va a anon", /grant execute on function public\.seguimiento_pedido\(text\) to anon/.test(sql) && !/seguimiento_configurar_activo\(uuid, boolean\) to anon/.test(sql));
ok("0032: no devuelve datos personales", !/cliente_nombre|cliente_telefono|direccion|notas|total/.test(sql.slice(sql.indexOf("return jsonb_build_object('numero'"), sql.indexOf("end $$;", sql.indexOf("return jsonb_build_object('numero'")))));
const pagina = leer("../app/seguimiento/[token]/page.tsx");
ok("página: no indexa y no manda referencia", pagina.includes("index: false") && pagina.includes("no-referrer"));
ok("página: valida el token antes de consultar", pagina.includes("TOKEN_RE.test"));
ok("panel pide la columna del interruptor", leer("../components/panel/PanelApp.tsx").includes("seguimiento_activo"));
ok("Pedidos: el interruptor es solo del dueño", /rol === "dueno"[\s\S]{0,200}cambiarSeguimiento/.test(leer("../components/Pedidos.tsx")));
if (fallos) { console.log(`seguimiento: ${fallos} falla(s)`); process.exit(1); }
console.log("seguimiento: ok");
