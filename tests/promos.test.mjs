// Prueba lib/promos (validaciones, semáforo, familias) y que el panel del club muestra la sección de promociones.
// Uso: node tests/promos.test.mjs
import ts from "typescript";
import { readFileSync } from "node:fs";
const leer = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const cargar = async (ruta) => {
  const js = ts.transpileModule(leer(ruta), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const P = await cargar("../lib/promos.ts");
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };

eq("valores válidos", P.validarAjustesPromos("20", "5"), { ok: true, datos: { club_margen_minimo: 20, club_tope_promos_pct: 5 } });
eq("acepta coma decimal", P.validarAjustesPromos("12,5", "2,5").datos, { club_margen_minimo: 12.5, club_tope_promos_pct: 2.5 });
ok("margen vacío", !P.validarAjustesPromos("", "5").ok);
ok("margen fuera de rango", !P.validarAjustesPromos("91", "5").ok && !P.validarAjustesPromos("-1", "5").ok);
ok("tope fuera de rango", !P.validarAjustesPromos("20", "51").ok);
ok("tope no numérico", !P.validarAjustesPromos("20", "abc").ok);
eq("familias en orden", P.FAMILIAS.map((f) => f.clave), ["captar", "retener", "premio_etapa", "liquidar"]);
ok("todo semáforo tiene texto y color", ["conviene", "ajustado", "pierde_plata", "reduce_margen", "sin_datos"].every((s) => P.SEMAFORO[s].texto && P.SEMAFORO[s].tono));
eq("fase A disponible para activar", P.FASE_TEXTO.A, "Disponible para activar");
eq("fase B y C próximamente", [P.FASE_TEXTO.B, P.FASE_TEXTO.C], ["Próximamente", "Próximamente"]);

const club = leer("../components/sellos/Promociones.tsx");
ok("el panel del club muestra la sección de promociones", club.includes("<Rentabilidad kiosco={kiosco} onCambio={onCambio} />") && club.includes('from "./Rentabilidad"') && leer("../components/Sellos.tsx").includes("<Promociones"));
ok("el panel pide las columnas de margen y tope", leer("../components/panel/PanelApp.tsx").includes("club_margen_minimo,club_tope_promos_pct"));
ok("la rentabilidad se lee de la base, no se calcula en el navegador", leer("../components/sellos/Rentabilidad.tsx").includes('rpc("club_evaluar"'));

const cat = (clave, familia, fase) => ({ clave, familia, fase, nombre: "", descripcion: "", automatica: false, orden: 1 });
eq("estado activa", P.estadoPromo(cat("bienvenida", "captar", "A"), ["bienvenida"]), "activa");
eq("estado disponible", P.estadoPromo(cat("reactivacion", "retener", "A"), []), "disponible");
eq("estado próximamente (fase B)", P.estadoPromo(cat("racha", "retener", "B"), []), "proximamente");
eq("estado próximamente (premio por etapas)", P.estadoPromo(cat("premio_por_etapas", "premio_etapa", "C"), []), "proximamente");
const lista = (clave, familia, fase, modo) => ({ ...cat(clave, familia, fase), lista: true, modo });
eq("opción lista y directa se activa con un clic", P.estadoPromo(lista("racha", "retener", "B", "directa"), []), "disponible");
eq("opción por producto se configura aparte", P.estadoPromo(lista("descuento_sin_movimiento", "liquidar", "B", "producto"), []), "configurable");
eq("niveles y sorteo se configuran aparte", [P.estadoPromo(lista("premio_por_etapas", "premio_etapa", "C", "niveles"), []), P.estadoPromo(lista("sorteo_mensual", "premio_etapa", "C", "sorteo"), [])], ["configurable", "configurable"]);
eq("una opción activa gana sobre el modo", P.estadoPromo(lista("racha", "retener", "B", "directa"), ["racha"]), "activa");
ok("toda opción activable tiene confirmación en una oración", ["bienvenida", "doble_primera_compra", "reactivacion", "sellos_dobles_dias_flojos", "racha", "regalo_cumpleanos", "referido"].every((k) => P.CONFIRMACION[k]?.endsWith("¿Lo activo?")));
ok("sin colores fijos en promos.ts", !/#[0-9a-fA-F]{6}/.test(leer("../lib/promos.ts")));
ok("sin colores fijos en Rentabilidad.tsx", !/#[0-9a-fA-F]{3,6}\b/.test(leer("../components/sellos/Rentabilidad.tsx")));

// ---- Ajustes con aviso previo
eq("ajustes sin aviso siguen igual", P.validarAjustesPromos("20", "5").datos, { club_margen_minimo: 20, club_tope_promos_pct: 5 });
eq("ajustes con aviso previo", P.validarAjustesPromos("20", "5", "2").datos, { club_margen_minimo: 20, club_tope_promos_pct: 5, club_aviso_previo_dias: 2 });
ok("aviso previo fuera de rango o con decimales", !P.validarAjustesPromos("20", "5", "8").ok && !P.validarAjustesPromos("20", "5", "1,5").ok && !P.validarAjustesPromos("20", "5", "").ok);

// ---- Liquidación
const desc = P.ACCIONES_LIQUIDAR.find((a) => a.clave === "descuento_sin_movimiento");
const regalo = P.ACCIONES_LIQUIDAR.find((a) => a.clave === "liquidar_sin_rotacion");
eq("liquidación: descuento válido con coma", P.validarLiquidacion(desc, "12,5"), { ok: true, valor: 12.5 });
ok("liquidación: descuento mayor a 90 se rechaza", !P.validarLiquidacion(desc, "95").ok);
ok("liquidación: cero, negativo y texto se rechazan", ["0", "-3", "abc", ""].every((v) => !P.validarLiquidacion(desc, v).ok));
ok("liquidación: los sellos tienen que ser enteros", !P.validarLiquidacion(regalo, "2,5").ok && P.validarLiquidacion(regalo, "6").ok);

// ---- Premios por etapas
const niv = (n, s, extra = {}) => ({ nombre: n, costo_sellos: s, tipo: "libre", valor: "", producto_id: "", ...extra });
eq("etapas válidas", P.validarEtapas([niv("Uno", "5"), niv("Dos", "10", { tipo: "pct", valor: "10" })]), { ok: true, datos: [{ nombre: "Uno", costo_sellos: 5, tipo: "libre" }, { nombre: "Dos", costo_sellos: 10, tipo: "pct", valor: 10 }] });
ok("etapas: un solo nivel se rechaza", !P.validarEtapas([niv("Uno", "5")]).ok);
ok("etapas: siete niveles se rechazan", !P.validarEtapas(Array.from({ length: 7 }, (_, i) => niv("N" + i, String(i + 1)))).ok);
ok("etapas: los sellos tienen que crecer", !P.validarEtapas([niv("A", "10"), niv("B", "10")]).ok && !P.validarEtapas([niv("A", "10"), niv("B", "5")]).ok);
ok("etapas: falta el nombre, el producto o el valor", !P.validarEtapas([niv("", "5"), niv("B", "10")]).ok && !P.validarEtapas([niv("A", "5", { tipo: "producto" }), niv("B", "10")]).ok && !P.validarEtapas([niv("A", "5", { tipo: "monto" }), niv("B", "10")]).ok);
ok("etapas: porcentaje mayor a 100 se rechaza", !P.validarEtapas([niv("A", "5", { tipo: "pct", valor: "101" }), niv("B", "10")]).ok);
ok("etapas: sellos decimales se rechazan", !P.validarEtapas([niv("A", "5.5"), niv("B", "10")]).ok);

// ---- Sorteos
ok("sorteo válido descarta premios vacíos", JSON.stringify(P.validarSorteo(" Mensual ", ["Combo", "", " Gaseosa "], "2026-10-01", "2026-10-31")) === JSON.stringify({ ok: true, datos: { nombre: "Mensual", premios: ["Combo", "Gaseosa"], desde: "2026-10-01", hasta: "2026-10-31" } }));
ok("sorteo: sin nombre, sin premios, sin fechas o al revés se rechaza", !P.validarSorteo("", ["A"], "2026-10-01", "2026-10-31").ok && !P.validarSorteo("X", ["", " "], "2026-10-01", "2026-10-31").ok && !P.validarSorteo("X", ["A"], "", "2026-10-31").ok && !P.validarSorteo("X", ["A"], "2026-11-01", "2026-10-31").ok);
const sb = (estado, permiso, hasta) => ({ estado, permiso_confirmado: permiso, hasta });
ok("sortear: solo con permiso, sin sortear y período terminado", P.puedeSortear(sb("borrador", true, "2026-10-18"), "2026-10-19") && !P.puedeSortear(sb("borrador", false, "2026-10-18"), "2026-10-19") && !P.puedeSortear(sb("borrador", true, "2026-10-19"), "2026-10-19") && !P.puedeSortear(sb("realizado", true, "2026-10-01"), "2026-10-19"));
ok("el aviso legal aclara que la app no es asesoramiento", P.AVISO_LEGAL_SORTEO.includes("no da asesoramiento legal"));
ok("todo estado de sorteo y de factibilidad tiene texto y color", ["borrador", "realizado", "cancelado"].every((e) => P.ESTADO_SORTEO_TEXTO[e].texto && P.ESTADO_SORTEO_TEXTO[e].tono) && ["lista", "falta_stock", "reduce_margen", "supera_tope"].every((e) => P.FACTIBILIDAD_TEXTO[e].texto));
ok("el historial tiene texto para cada acción que registra la base", ["alta", "activar", "pausar", "cambio", "ajustes", "margen_confirmado", "apagado_tope", "apagado_stock", "sorteo_creado", "permiso_confirmado", "sorteo_realizado", "sorteo_cancelado"].every((a) => P.ACCION_TEXTO[a]));

// ---- Pantallas: sin colores fijos, y toda función que llaman existe en las migraciones
import { readdirSync } from "node:fs";
const nuevos = ["Liquidacion", "Etapas", "Sorteos", "HistorialPromos"];
ok("las secciones nuevas no usan colores fijos", nuevos.every((n) => !/#[0-9a-fA-F]{3,6}\b/.test(leer(`../components/sellos/${n}.tsx`))));
const sqlTodo = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).map((f) => leer(`../supabase/migrations/${f}`)).join("\n");
const archivos = [...nuevos.map((n) => `../components/sellos/${n}.tsx`), "../components/sellos/Rentabilidad.tsx", "../components/ClubTarjeta.tsx", "../app/api/club/unirse/route.ts"];
const existe = (f) => new RegExp(`function\\s+public\\.${f}\\s*\\(`, "i").test(sqlTodo);
const llamadas = new Set();
for (const a of archivos) {
  // Nombres con cualquier letra (un error de tipeo con mayúsculas tiene que fallar, no pasar desapercibido).
  for (const m of leer(a).matchAll(/(?:rpc|llamar)\(\s*"([A-Za-z_0-9]+)"/g)) llamadas.add(m[1]);
}
ok("el chequeo de funciones encontró las llamadas de las pantallas", llamadas.size >= 20);
eq("toda función que llaman las pantallas existe en las migraciones", [...llamadas].filter((f) => !existe(f)).sort(), []);
const rent = leer("../components/sellos/Rentabilidad.tsx");
ok("el panel muestra las secciones de liquidación, niveles, sorteos e historial", ["<Liquidacion ", "<Etapas ", "<Sorteos ", "<HistorialPromos "].every((x) => rent.includes(x)));
ok("el panel lee todo con promo_panel (revisa el tope antes de responder)", rent.includes('rpc("promo_panel"'));
ok("al activar se pide confirmación del margen bajo", rent.includes("promo_reduce_margen") && rent.includes("p_confirmar_margen: true"));
const tarjeta = leer("../components/ClubTarjeta.tsx");
ok("la tarjeta muestra niveles, sorteo, cumpleaños e invitación", ["t.niveles", "t.sorteo", "club_guardar_cumple", "mensajeInvitacion"].every((x) => tarjeta.includes(x)));
ok("el registro manda el código del amigo", leer("../components/ClubUnirse.tsx").includes("ref: refAmigo") && leer("../app/api/club/unirse/route.ts").includes("p_ref: ref"));

// 0053: tope en pesos del descuento en % y vista previa de los niveles
eq("etapas: el tope se manda como número", P.validarEtapas([niv("Uno", "5"), niv("Dos", "10", { tipo: "pct", valor: "15", tope: "250" })]).datos[1].tope, 250);
ok("etapas: un tope que no es positivo se rechaza", !P.validarEtapas([niv("Uno", "5"), niv("Dos", "10", { tipo: "pct", valor: "15", tope: "0" })]).ok);
ok("etapas: el tope solo cuenta en el descuento en %", !("tope" in P.validarEtapas([niv("Uno", "5"), niv("Dos", "10", { tipo: "monto", valor: "300", tope: "50" })]).datos[1]));
eq("vista previa de niveles", P.vistaPreviaEtapas([niv("Café", "5"), niv("Descuento", "10", { tipo: "pct", valor: "15", tope: "250" }), niv("Gaseosa", "20", { tipo: "producto", producto_id: "p1" })], (id) => (id === "p1" ? "Gaseosa" : undefined)),
  ["Nivel 1: Café, con 5 sellos.", "Nivel 2: Descuento, con 10 sellos, 15% de descuento (hasta $250).", "Nivel 3: Gaseosa, con 20 sellos, Gaseosa gratis."]);
eq("vista previa sin datos todavía", P.vistaPreviaEtapas([niv("", "", { tipo: "monto", valor: "" })])[0], "Nivel 1: (sin nombre), con ? sellos, ? de descuento.");

// 0054: sugeridas (el sistema propone, el kiosquero confirma con un clic)
ok("sugeridas: la pantalla existe y la llama la base", leer("../components/sellos/Sugeridas.tsx").includes('rpc("promo_sugerencias"') && leer("../components/sellos/Sugeridas.tsx").includes('rpc("promo_activar"') && leer("../components/sellos/Sugeridas.tsx").includes('rpc("promo_liquidar_activar"'));
ok("sugeridas: aparecen arriba de la pantalla de rentabilidad", leer("../components/sellos/Rentabilidad.tsx").includes("<Sugeridas kiosco={kiosco} onCambio={onCambio} />"));
ok("sugeridas: la base tiene la función con el permiso del panel", leer("../supabase/migrations/0054_promos_sugeridas.sql").includes("promo_sugerencias(p_kiosco uuid)") && leer("../supabase/migrations/0054_promos_sugeridas.sql").includes("array['encargado', 'dueno']"));

// 0055: "No por ahora" y período mensual del sorteo
eq("período por defecto: mes anterior completo", P.periodoMesAnterior("2026-10-19"), { desde: "2026-09-01", hasta: "2026-09-30" });
eq("período por defecto: enero pasa a diciembre del año anterior", P.periodoMesAnterior("2026-01-05"), { desde: "2025-12-01", hasta: "2025-12-31" });
eq("período por defecto: marzo, febrero bisiesto 2028", P.periodoMesAnterior("2028-03-02"), { desde: "2028-02-01", hasta: "2028-02-29" });
ok("sugeridas: tiene el botón 'No por ahora' y llama a la base", leer("../components/sellos/Sugeridas.tsx").includes("No por ahora") && leer("../components/sellos/Sugeridas.tsx").includes('rpc("promo_sugerencia_descartar"'));
ok("sorteos: arranca con el mes anterior completo", leer("../components/sellos/Sorteos.tsx").includes("periodoMesAnterior(hoyArgentina())"));
ok("base: 0055 crea el descarte y promo_sugerencias lo respeta", leer("../supabase/migrations/0055_promos_sugeridas_descarte.sql").includes("promo_sugerencias_descartadas") && leer("../supabase/migrations/0055_promos_sugeridas_descarte.sql").includes("promo_sugerencia_descartada(p_kiosco, 'reactivacion'"));

if (fallos) { console.log(`✗ ${fallos} fallo(s)`); process.exit(1); }
console.log("promos OK");
