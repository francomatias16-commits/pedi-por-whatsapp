// Prueba de lib/fidelidad.ts: node tests/fidelidad.test.mjs  (o: npm run test:fidelidad)
import ts from "typescript";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../lib/fidelidad.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const F = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fallos++; console.log(`${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : ` → ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`}`); };
const V = F.CAMPANA_VACIA;
const f = (o) => ({ ...V, nombre: "Prueba", ...o });

// Validación de campañas
eq("campaña simple válida", F.validarCampana(f({})), null);
eq("sin nombre", F.validarCampana(f({ nombre: "  " })) !== null, true);
eq("sellos decimales", F.validarCampana(f({ sellos: "1.5" })) !== null, true);
eq("sellos 0", F.validarCampana(f({ sellos: "0" })) !== null, true);
eq("monto sin importe", F.validarCampana(f({ tipo: "monto", por_monto: "" })) !== null, true);
eq("monto con coma decimal", F.validarCampana(f({ tipo: "monto", por_monto: "1000,50" })), null);
eq("producto sin elegir", F.validarCampana(f({ tipo: "producto" })) !== null, true);
eq("categoría sin elegir", F.validarCampana(f({ tipo: "categoria" })) !== null, true);
eq("multiplicador 2 válido", F.validarCampana(f({ tipo: "multiplicador", multiplicador: "2" })), null);
eq("multiplicador 1 inválido", F.validarCampana(f({ tipo: "multiplicador", multiplicador: "1" })) !== null, true);
eq("multiplicador 11 inválido", F.validarCampana(f({ tipo: "multiplicador", multiplicador: "11" })) !== null, true);
eq("reactivación 3 días inválida", F.validarCampana(f({ tipo: "reactivacion", dias_inactivo: "3" })) !== null, true);
eq("sin canales", F.validarCampana(f({ canales: [] })) !== null, true);
eq("horario con inicio = fin", F.validarCampana(f({ usar_horario: true, hora_desde: "10:00", hora_hasta: "10:00" })) !== null, true);
eq("horario que cruza medianoche es válido", F.validarCampana(f({ usar_horario: true, hora_desde: "22:00", hora_hasta: "02:00" })), null);
eq("fechas invertidas", F.validarCampana(f({ desde: "2026-12-01", hasta: "2026-11-01" })) !== null, true);
eq("tope diario 0", F.validarCampana(f({ tope_diario: "0" })) !== null, true);

// Conversión a fila
const r = F.campanaDesdeForm(f({ tipo: "multiplicador", multiplicador: "2,5", dias_semana: [4, 2], usar_horario: true, hora_desde: "17:00", hora_hasta: "19:00", medios: ["transferencia"], monto_minimo: "500" }));
eq("multiplicador: fila", [r.multiplicador, r.sellos, r.dias_semana, r.hora_desde, r.medios, r.monto_minimo, r.producto_id, r.por_monto], [2.5, 1, [2, 4], "17:00", ["transferencia"], 500, null, null]);
const m = F.campanaDesdeForm(f({ tipo: "manual", sellos: "5", medios: ["efectivo"], dias_semana: [1], usar_horario: true, monto_minimo: "100" }));
eq("manual: ignora filtros que no aplican", [m.medios, m.dias_semana, m.hora_desde, m.monto_minimo, m.canales], [null, null, null, null, ["pedido", "mostrador"]]);
const p = F.campanaDesdeForm(f({ tipo: "producto", producto_id: "abc", categoria: "x" }));
eq("producto: no manda categoría", [p.producto_id, p.categoria], ["abc", null]);
const fila = F.campanaDesdeForm(f({ tipo: "monto", por_monto: "1000", tope_diario: "3", desde: "2026-11-01" }));
eq("ida y vuelta formulario ⇄ campaña", F.campanaDesdeForm(F.formDesdeCampana({ id: "1", activa: true, ...fila })), fila);

// Descripciones
const base = { id: "1", activa: true, sellos: 1, multiplicador: null, por_monto: null, producto_id: null, categoria: null, dias_inactivo: null, monto_minimo: null, canales: ["pedido", "mostrador"], medios: null, dias_semana: null, hora_desde: null, hora_hasta: null, desde: null, hasta: null, tope_diario: null, nombre: "x" };
eq("describe visita", F.describirCampana({ ...base, tipo: "visita" }), "1 sello por compra");
eq("describe monto", F.describirCampana({ ...base, tipo: "monto", por_monto: 1000 }).startsWith("1 sello cada $1.000"), true);
eq("describe dobles martes y horario", F.describirCampana({ ...base, tipo: "multiplicador", multiplicador: 2, dias_semana: [2], hora_desde: "17:00:00", hora_hasta: "19:00:00" }), "Sellos x2 · Mar · 17:00 a 19:00");
eq("describe solo transferencia y pedidos", F.describirCampana({ ...base, tipo: "visita", sellos: 2, canales: ["pedido"], medios: ["transferencia"] }), "2 sellos por compra · solo pedidos · transferencia");
eq("describe vigencia y tope", F.describirCampana({ ...base, tipo: "visita", desde: "2026-11-01", hasta: "2026-11-30", tope_diario: 2 }), "1 sello por compra · del 01/11/2026 al 30/11/2026 · máx. 2 por día");
eq("describe producto con nombre", F.describirCampana({ ...base, tipo: "producto", sellos: 2, producto_id: "p" }, "Coca 500"), "2 sellos por cada Coca 500");

// Plantillas: todas dan un formulario válido (salvo las que piden elegir producto o categoría)
eq("todas las plantillas son válidas", F.PLANTILLAS.map((t) => F.validarCampana({ ...V, ...t.form })), F.PLANTILLAS.map(() => null));

// Premios
const P = { ...F.PREMIO_VACIO, nombre: "Café" };
eq("premio libre válido", F.validarPremio(P), null);
eq("premio costo 0", F.validarPremio({ ...P, costo_sellos: "0" }) !== null, true);
eq("premio % sin valor", F.validarPremio({ ...P, tipo: "pct" }) !== null, true);
eq("premio % de 150", F.validarPremio({ ...P, tipo: "pct", valor: "150" }) !== null, true);
eq("premio monto válido", F.validarPremio({ ...P, tipo: "monto", valor: "500" }), null);
eq("premio producto sin producto", F.validarPremio({ ...P, tipo: "producto" }) !== null, true);
eq("premio libre ignora valor", F.premioDesdeForm({ ...P, valor: "99" }).valor, null);
eq("describe premios", [F.describirPremio({ costo_sellos: 5, tipo: "pct", valor: 10 }), F.describirPremio({ costo_sellos: 1, tipo: "libre" }), F.describirPremio({ costo_sellos: 8, tipo: "producto" }, "Coca")], ["5 sellos · 10% de descuento", "1 sello", "8 sellos · Coca gratis"]);

// Descuento de premio en la Caja
eq("pct 10 sobre 5000", F.pctDePremio({ tipo: "pct", valor: 10 }, 5000), 10);
eq("monto 500 sobre 5000 = 10%", F.pctDePremio({ tipo: "monto", valor: 500 }, 5000), 10);
eq("monto 300 sobre 7000 = 4,29% (aprox)", F.pctDePremio({ tipo: "monto", valor: 300 }, 7000), 4.29);
eq("monto mayor al total = 100%", F.pctDePremio({ tipo: "monto", valor: 9000 }, 5000), 100);
eq("producto gratis (precio 1000) sobre 4000 = 25%", F.pctDePremio({ tipo: "producto", valor: null }, 4000, 1000, 3000), 25);
eq("producto gratis: tope por lo que hay en el carrito", F.pctDePremio({ tipo: "producto", valor: null }, 4000, 1000, 400), 10);
eq("premio libre no descuenta", F.pctDePremio({ tipo: "libre", valor: null }, 4000), 0);
eq("carrito vacío no descuenta", F.pctDePremio({ tipo: "pct", valor: 10 }, 0), 0);

eq("mensaje conocido", F.mensajeFidelidad("sellos_insuficientes"), "No alcanzan los sellos.");
eq("mensaje desconocido", F.mensajeFidelidad("boom").startsWith("No se pudo"), true);
console.log(fallos ? `\n${fallos} fallos` : "\nfidelidad: todo OK");
process.exit(fallos ? 1 : 0);
