// QR único y visibilidad de productos en la tienda: helpers de lib/club y chequeos estáticos de la migración 0060 y de las pantallas.
// Uso: node tests/tienda.test.mjs
import ts from "typescript";
import { readFileSync } from "node:fs";
const leer = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const cargar = async (ruta) => {
  const js = ts.transpileModule(leer(ruta), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const C = await cargar("../lib/club.ts");
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };

// helpers
eq("link de la tienda", C.linkTienda("donjulio", "https://go.test/"), "https://go.test/donjulio");
eq("QR único con club activo va al club", C.linkQrUnico({ slug: "donjulio", club_activo: true }, "https://go.test"), "https://go.test/donjulio/club");
eq("QR único sin dato de club va al club (valor por defecto)", C.linkQrUnico({ slug: "donjulio" }, "https://go.test"), "https://go.test/donjulio/club");
eq("QR único con club en pausa va directo a la tienda", C.linkQrUnico({ slug: "donjulio", club_activo: false }, "https://go.test"), "https://go.test/donjulio");

// migración 0060
const mig = leer("../supabase/migrations/0060_qr_unico_tienda_visible.sql");
const sql = mig.replace(/--.*$/gm, "");
ok("0060: columna tienda_activa con default true", /add column if not exists tienda_activa boolean not null default true/.test(sql));
ok("0060: columna visible_tienda con default true", /add column if not exists visible_tienda boolean not null default true/.test(sql));
ok("0060: anon puede leer las columnas nuevas", /grant select \(tienda_activa\) on public\.kioscos to anon/.test(sql) && /grant select \(visible_tienda\) on public\.productos to anon/.test(sql));
ok("0060: la lectura pública exige disponible y visible_tienda", /alter policy productos_select_publico on public\.productos using \(disponible and visible_tienda\)/.test(sql));
ok("0060: crear_pedido rechaza tienda apagada", /if not v_kiosco\.tienda_activa[^;]*raise exception 'tienda_no_disponible'/.test(sql));
ok("0060: crear_pedido rechaza productos ocultos", /kiosco_id = v_kiosco\.id and disponible and visible_tienda;/.test(sql));
ok("0060: club_datos y club_armar_tarjeta devuelven tienda", /'tienda', public\.tienda_disponible\(k\.id\)/.test(sql) && /'tienda', public\.tienda_disponible\(c\.kiosco_id\)/.test(sql));
ok("0060: la función interna no se llama desde afuera", /revoke all on function public\.tienda_disponible\(uuid\) from public, anon, authenticated/.test(sql));
ok("0060: la función pública por slug es para anon", /grant execute on function public\.tienda_disponible_slug\(text\) to anon, authenticated/.test(sql));
ok("0060: sin DROP", !/\bdrop\b/i.test(sql));
// "disponible" (stock) y la Caja no dependen de visible_tienda
const pos = leer("../components/caja/PosVenta.tsx"), caja = leer("../components/Caja.tsx");
ok("la Caja no filtra por visible_tienda", !/visible_tienda/.test(pos) && !/visible_tienda/.test(caja));

// pantallas
const pagTienda = leer("../app/[slug]/page.tsx");
ok("tienda: pide tienda_activa y muestra aviso si está apagada", /tienda_activa/.test(pagTienda) && /TiendaApagada/.test(pagTienda));
ok("tienda: solo trae productos visibles", /\.eq\("visible_tienda", true\)/.test(pagTienda));
const pagClub = leer("../app/[slug]/club/page.tsx");
ok("club: si está apagado y hay tienda, redirige al catálogo", /tienda_disponible_slug/.test(pagClub) && /redirect\(`\/\$\{params\.slug\}`\)/.test(pagClub));
ok("registro: enlace al catálogo solo si hay tienda", /datos\.tienda && /.test(leer("../components/ClubUnirse.tsx")));
ok("tarjeta: botón al catálogo solo si hay tienda", /t\.tienda && /.test(leer("../components/ClubTarjeta.tsx")));
const prod = leer("../components/Productos.tsx");
ok("productos: botón para mostrar/ocultar en la tienda", /toggleVisible/.test(prod) && /visible_tienda/.test(prod));
ok("productos: ocultar por categoría", /visibilidadCategoria/.test(prod));
ok("mi negocio: interruptor de tienda guardado", /tienda_activa: tienda/.test(leer("../components/MiKiosco.tsx")));
ok("panel: carga tienda_activa", /tienda_activa"/.test(leer("../components/panel/PanelApp.tsx")));
ok("mensaje amigable para tienda_no_disponible", /"tienda_no_disponible"/.test(leer("../lib/errores.ts")));

if (fallos) { console.log(`${fallos} fallo(s)`); process.exit(1); }
console.log("tienda: QR único y productos visibles OK");
