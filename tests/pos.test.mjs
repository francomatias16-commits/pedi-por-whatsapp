// Prueba de lib/pos/*: node tests/pos.test.mjs  (o: npm run test:pos)
import ts from "typescript";
import { readFileSync } from "node:fs";
const cargar = async (rel, reemplazos = {}) => {
  let src = readFileSync(new URL("../lib/" + rel, import.meta.url), "utf8");
  for (const [a, b] of Object.entries(reemplazos)) src = src.replace(a, b);
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const ean = await cargar("ean.ts");
globalThis.__ean = ean;
const E = await cargar("pos/escaneo.ts");
const B = await cargar("pos/balanza.ts", { 'import { esCodigoValido } from "../ean";': "const esCodigoValido = globalThis.__ean.esCodigoValido;" });
const P = await cargar("pos/promos.ts");
const O = await cargar("pos/offline.ts");
const D = await cargar("pos/devolucion.ts");
const R = await cargar("pos/remoto.ts");
const W = await cargar("whatsapp.ts");
const CAJA = await cargar("caja.ts");
globalThis.__caja = CAJA; globalThis.__wa = W;
const X = await cargar("pos/escpos.ts", { 'import { ETIQUETA_MEDIO, cantidadTexto, type ItemVenta, type PagoVenta } from "../caja";': "const { ETIQUETA_MEDIO, cantidadTexto } = globalThis.__caja;", 'import { peso } from "../whatsapp";': "const { peso } = globalThis.__wa;" });
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } else console.log("ok  ", n); };

// ── Detector de lector USB ──
{
  const d = new E.DetectorEscaneo();
  const tipos = []; let t = 1000; let res;
  for (const c of "7790070410") { res = d.feed(c, t); tipos.push(res.tipo); t += 15; }
  res = d.feed("Enter", t);
  eq("ráfaga rápida + Enter = escaneo", res, { tipo: "escaneo", codigo: "7790070410" });
  eq("1ª tecla 'tecla', las siguientes 'rafaga'", [tipos[0], tipos[1], tipos[9]], ["tecla", "rafaga", "rafaga"]);
}
{
  const d = new E.DetectorEscaneo(); let t = 0; let r;
  for (const c of "1234") { r = d.feed(c, t); t += 200; }
  eq("tipeo humano lento no es ráfaga", r.tipo, "tecla");
  eq("Enter tras tipeo lento no es escaneo", d.feed("Enter", t).tipo, "tecla");
}
{
  const d = new E.DetectorEscaneo(); let t = 0;
  for (const c of "12") { d.feed(c, t); t += 10; }
  eq("ráfaga corta (<4) + Enter no es escaneo", d.feed("Enter", t).tipo, "tecla");
}
{
  const d = new E.DetectorEscaneo(); let t = 0;
  d.feed("5", t); t += 300; // tecla suelta de antes
  for (const c of "7791234") { d.feed(c, t); t += 12; }
  eq("una tecla suelta previa no contamina el escaneo", d.feed("Enter", t), { tipo: "escaneo", codigo: "7791234" });
}
{
  const d = new E.DetectorEscaneo(); let t = 0;
  for (const c of "779123456") { d.feed(c, t); t += 10; }
  eq("sin Enter: no vacía antes de la pausa", d.vaciar(t + 20), null);
  eq("sin Enter: vacía tras la pausa", d.vaciar(t + 200), "779123456");
  eq("vaciar deja el detector limpio", d.enCurso, false);
}
{
  const d = new E.DetectorEscaneo(); let t = 0; d.feed("A", t); t += 10; d.feed("B", t); t += 10;
  eq("Shift en medio no corta la ráfaga", d.feed("Shift", t).tipo, "tecla");
  d.feed("C", t + 10); d.feed("D", t + 20);
  eq("ráfaga alfanumérica", d.feed("Enter", t + 30), { tipo: "escaneo", codigo: "ABCD" });
}

// ── Balanza ──
// 2 + 00123 + ctrl(PLU)=0 + 00350 (350 g) + ctrl EAN
const conCtrl = (b12) => { const d = b12.split("").map(Number).reverse(); const s = d.reduce((a, n, i) => a + n * (i % 2 === 0 ? 3 : 1), 0); return b12 + ((10 - (s % 10)) % 10); };
const cb = conCtrl("200123" + "0" + "00350");
eq("balanza: PLU y gramos", B.parsearBalanza(cb), { plu: "123", gramos: 350 });
eq("balanza: dígito de control malo", B.parsearBalanza(cb.slice(0, 12) + ((Number(cb[12]) + 1) % 10)), null);
eq("balanza: un EAN común no es de balanza", B.parsearBalanza("7790070410120"), null);
eq("balanza: peso 0 se rechaza", B.parsearBalanza(conCtrl("200123" + "0" + "00000")), null);
eq("PLU sin ceros a la izquierda", [B.mismoPlu("0123", "123"), B.mismoPlu("12", "123"), B.mismoPlu(null, "1")], [true, false, false]);
eq("formato de peso", [B.formatoPeso(350), B.formatoPeso(1250)], ["0,350 kg", "1,250 kg"]);

// ── Cálculo de venta (mismos casos que supabase/tests/etapa11_test.py) ──
const L = (o) => ({ producto_id: "x", categoria: "c", precio: 1000, cantidad: 1, por_peso: false, descuento_pct: 0, ...o });
const pr = (o) => ({ id: "p" + Math.random(), nombre: "p", tipo: "pct", producto_id: null, categoria: null, lleva: null, paga: null, pct: null, desde: null, hasta: null, activa: true, ...o });
const HOY = "2026-10-17";
eq("333 g a $999/kg = 332,67", P.calcularVenta([L({ precio: 999, cantidad: 333, por_peso: true })], [], 0, HOY).total, 332.67);
eq("renglón 10%: 2x1000 -> 1800", P.calcularVenta([L({ cantidad: 2, descuento_pct: 10 })], [], 0, HOY).total, 1800);
const promosGas = [pr({ tipo: "nxm", producto_id: "x", lleva: 3, paga: 2 }), pr({ tipo: "pct", producto_id: "x", pct: 20 }), pr({ tipo: "pct", producto_id: "x", pct: 90, activa: false }), pr({ tipo: "pct", producto_id: "x", pct: 90, hasta: "2020-01-01" })];
eq("3 unidades: gana el 3x2", P.calcularVenta([L({ cantidad: 3 })], promosGas, 0, HOY).total, 2000);
eq("1 unidad: gana el 20%", P.calcularVenta([L({ cantidad: 1 })], promosGas, 0, HOY).total, 800);
eq("7 unidades: 2 grupos 3x2", P.calcularVenta([L({ cantidad: 7 })], promosGas, 0, HOY).total, 5000);
eq("promo + renglón: (3000-1000)-10% = 1800", P.calcularVenta([L({ cantidad: 3, descuento_pct: 10 })], promosGas, 0, HOY).total, 1800);
eq("promo por categoría", P.calcularVenta([L({ producto_id: "y", categoria: "Golosinas", precio: 300 })], [pr({ categoria: "Golosinas", pct: 10 })], 0, HOY).total, 270);
eq("promo futura no aplica", P.calcularVenta([L()], [pr({ producto_id: "x", pct: 50, desde: "2026-12-01" })], 0, HOY).total, 1000);
{
  const v = P.calcularVenta([L({ producto_id: "a", precio: 1000, cantidad: 500, por_peso: true }), L({ producto_id: "b", precio: 999, cantidad: 200, por_peso: true })], [], 10, HOY);
  eq("global 10% sobre 699,80 = 629,82", v.total, 629.82);
  eq("netos prorrateados suman el total", Math.round(v.lineas.reduce((s, l) => s + l.neto, 0) * 100) / 100, 629.82);
}
{
  const v = P.calcularVenta([L({ producto_id: "a", precio: 500, cantidad: 3 }), L({ producto_id: "b", precio: 1000, cantidad: 400, por_peso: true })], [], 10, HOY);
  eq("netos 1350 y 360 (como el test de la base)", v.lineas.map((l) => l.neto), [1350, 360]);
  eq("desglose: descuento total 190", v.descuento, 190);
}

// ── Cola offline ──
const mem = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
const venta = (id, cant = 1) => ({ offline_id: id, turno_id: "t", fecha: "2026-10-17T10:00:00Z", items: [{ producto_id: "p1", cantidad: cant, descuento_pct: 0 }], pagos: [{ medio: "efectivo", monto: 100 }], cliente_id: null, descuento_pct: 0, total: 100 });
{
  const q = new O.ColaVentas(mem(), "k");
  q.encolar(venta("a", 2)); q.encolar(venta("b", 3)); q.encolar(venta("a", 2));
  eq("encolar es idempotente por offline_id", q.pendientes().map((v) => v.offline_id), ["a", "b"]);
  eq("reserva de stock local", q.reservado(), { p1: 5 });
  const enviados = [];
  let r = await q.sincronizar(async (v) => { enviados.push(v.offline_id); return { ok: true }; });
  eq("sincroniza todo en orden", [enviados, r], [["a", "b"], { enviadas: 2, rechazadas: 0, pendientes: 0 }]);
}
{
  const q = new O.ColaVentas(mem(), "k");
  ["a", "b", "c"].forEach((i) => q.encolar(venta(i)));
  let r = await q.sincronizar(async (v) => (v.offline_id === "b" ? { ok: false, definitivo: false, mensaje: "red" } : { ok: true }));
  eq("fallo de red corta y conserva el resto en orden", [r.enviadas, q.pendientes().map((v) => v.offline_id), q.pendientes()[0].intentos], [1, ["b", "c"], 1]);
  r = await q.sincronizar(async (v) => (v.offline_id === "b" ? { ok: false, definitivo: true, mensaje: "Sin stock" } : { ok: true }));
  eq("rechazo definitivo aparta la venta y sigue", [r, q.rechazadas().map((v) => [v.offline_id, v.motivo])], [{ enviadas: 1, rechazadas: 1, pendientes: 0 }, [["b", "Sin stock"]]]);
  q.descartarRechazada("b");
  eq("descartar rechazada", q.rechazadas().length, 0);
}
{
  const alm = mem(); new O.ColaVentas(alm, "k").encolar(venta("z"));
  eq("la cola sobrevive a recargar la página", new O.ColaVentas(alm, "k").pendientes().length, 1);
  eq("cada kiosco tiene su cola", new O.ColaVentas(alm, "otro").pendientes().length, 0);
}

// ── Devoluciones parciales (espejo de devolver_venta_mostrador) ──
{
  const it = (o) => ({ id: "i", nombre: "x", cantidad: 3, por_peso: false, neto: 1350, devuelto: 0, devuelto_monto: 0, ...o });
  eq("devuelve 1 de 3 sobre neto 1350 = 450", D.reembolsoItem(it({}), 1), 450);
  eq("devuelve 2 de 3 = 900", D.reembolsoItem(it({}), 2), 900);
  eq("no deja devolver más de lo vendido", D.reembolsoItem(it({}), 4), 0);
  eq("no deja devolver 0 ni decimales", [D.reembolsoItem(it({}), 0), D.reembolsoItem(it({}), 1.5)], [0, 0]);
  eq("la última parte absorbe el redondeo (10,00 en 3)", [D.reembolsoItem(it({ neto: 10 }), 1), D.reembolsoItem(it({ neto: 10, devuelto: 1, devuelto_monto: 3.33 }), 1), D.reembolsoItem(it({ neto: 10, devuelto: 2, devuelto_monto: 6.66 }), 1)], [3.33, 3.33, 3.34]);
  eq("medio centavo redondea hacia arriba como Postgres", D.reembolsoItem(it({ neto: 0.05, cantidad: 2 }), 1), 0.03);
  eq("devuelve lo que falta aunque sea el resto", D.reembolsoItem(it({ devuelto: 1, devuelto_monto: 450 }), 2), 900);
  eq("por peso: 333 g a $332,67 devolviendo 100 g", D.reembolsoItem(it({ cantidad: 333, por_peso: true, neto: 332.67 }), 100), 99.9);
  const items = [it({ id: "a" }), it({ id: "b", neto: 10 })];
  const sel = { a: { cantidad: 1, repone_stock: true }, b: { cantidad: 0, repone_stock: false } };
  eq("total con selección parcial", D.totalReembolso(items, sel), 450);
  eq("payload solo con renglones elegidos", D.armarItemsDevolucion(items, sel), [{ item_id: "a", cantidad: 1, repone_stock: true }]);
  eq("parsea unidades", [D.parsearCantidad("2", false), D.parsearCantidad("2,5", false), D.parsearCantidad("", false), D.parsearCantidad("abc", false)], [2, 0, 0, 0]);
  eq("parsea kg a gramos", [D.parsearCantidad("0,250", true), D.parsearCantidad("1.5", true), D.parsearCantidad("-1", true)], [250, 1500, 0]);
  eq("restante", D.restante(it({ devuelto: 2 })), 1);
}

// ── Alta de promociones: validación y filas ──
{
  const base = { ...P.PROMO_VACIA, nombre: "3x2 Coca", producto_id: "p1" };
  eq("NxM válido", P.validarPromo(base), null);
  eq("nombre vacío", P.validarPromo({ ...base, nombre: "  " }) !== null, true);
  eq("NxM: paga >= lleva rechazado", P.validarPromo({ ...base, lleva: "3", paga: "3" }) !== null, true);
  eq("NxM: lleva decimal rechazado", P.validarPromo({ ...base, lleva: "2,5" }) !== null, true);
  eq("NxM sobre categoría rechazado", P.validarPromo({ ...base, alcance: "categoria", categoria: "Golosinas" }) !== null, true);
  eq("% válido sobre categoría", P.validarPromo({ ...P.PROMO_VACIA, nombre: "Dulces", tipo: "pct", alcance: "categoria", categoria: "Golosinas", pct: "15,5" }), null);
  eq("% 0 y 101 rechazados", [P.validarPromo({ ...P.PROMO_VACIA, nombre: "x", tipo: "pct", producto_id: "p1", pct: "0" }) !== null, P.validarPromo({ ...P.PROMO_VACIA, nombre: "x", tipo: "pct", producto_id: "p1", pct: "101" }) !== null], [true, true]);
  eq("desde posterior a hasta rechazado", P.validarPromo({ ...base, desde: "2026-10-20", hasta: "2026-10-10" }) !== null, true);
  eq("fila NxM", P.filaPromo({ ...base, lleva: "3", paga: "2" }), { nombre: "3x2 Coca", tipo: "nxm", producto_id: "p1", categoria: null, lleva: 3, paga: 2, pct: null, desde: null, hasta: null });
  eq("fila % por categoría", P.filaPromo({ ...P.PROMO_VACIA, nombre: "Dulces", tipo: "pct", alcance: "categoria", categoria: " Golosinas ", pct: "15,5", desde: "2026-10-01" }),
    { nombre: "Dulces", tipo: "pct", producto_id: null, categoria: "Golosinas", lleva: null, paga: null, pct: 15.5, desde: "2026-10-01", hasta: null });
  const pr = { id: "a", nombre: "n", tipo: "nxm", producto_id: "p1", categoria: null, lleva: 3, paga: 2, pct: null, desde: null, hasta: null, activa: true };
  eq("ida y vuelta formulario", P.filaPromo(P.formDePromo(pr)), { nombre: "n", tipo: "nxm", producto_id: "p1", categoria: null, lleva: 3, paga: 2, pct: null, desde: null, hasta: null });
  eq("descripción", P.describirPromo(pr, () => "Coca 500"), "Lleva 3 paga 2 · Coca 500");
  eq("vigencia", [P.vigenciaPromo({ ...pr, desde: "2026-11-01" }, "2026-10-17"), P.vigenciaPromo({ ...pr, hasta: "2026-10-01" }, "2026-10-17"), P.vigenciaPromo(pr, "2026-10-17")], ["programada", "vencida", "vigente"]);
}

// ── Formato de importes ──
{
  const norm = (s) => s.replace(/\s/g, " ");
  eq("peso entero sin decimales", norm(W.peso(1500)), "$ 1.500");
  eq("peso con centavos muestra 2 decimales", norm(W.peso(332.67)), "$ 332,67");
}

// ── Ticket térmico ESC/POS ──
{
  const t = { numero: 12, fecha: "17/10/26 10:30", kioscoNombre: "Kiosco Ñandú", cliente: null, items: [
    { nombre: "Coca Cola 500 ml con un nombre larguísimo para forzar renglones", cantidad: 2, precio_unit: 1500, por_peso: false, importe: 3000 },
    { nombre: "Jamón cocido", cantidad: 333, precio_unit: 999, por_peso: true, importe: 332.67 },
  ], subtotal: 3332.67, descuento: 332.67, descuentoPct: 10, total: 3000, pagos: [{ medio: "efectivo", monto: 5000 }], vuelto: 2000, encabezado: "Av. San Martín 123", pie: "¡Gracias por su compra!" };
  for (const ancho of [58, 80]) {
    const cols = X.COLUMNAS[ancho];
    const bytes = X.ticketEscPos(t, ancho, { cajon: true });
    eq(`ancho ${ancho}: empieza con ESC @`, [bytes[0], bytes[1]], [0x1b, 0x40]);
    // Lector de secuencias ESC/POS: separa el texto imprimible de los comandos.
    let txt = ""; let ctl = 0;
    for (let k = 0; k < bytes.length;) {
      const b = bytes[k];
      if (b === 0x1b) { const c = bytes[k + 1]; const n = c === 0x40 ? 2 : c === 0x70 ? 5 : 3; k += n; ctl++; }
      else if (b === 0x1d) { const c = bytes[k + 1]; const n = c === 0x56 ? 4 : 3; k += n; ctl++; }
      else { txt += String.fromCharCode(b); k++; }
    }
    const lineas = txt.split("\n");
    eq(`ancho ${ancho}: ningún renglón pasa de ${cols} columnas`, lineas.filter((l) => l.length > cols).length, 0);
    eq(`ancho ${ancho}: el texto es solo ASCII imprimible`, /[^\x20-\x7e\n]/.test(txt), false);
    eq(`ancho ${ancho}: muestra kg y total con centavos`, [txt.includes("0,333 kg"), txt.includes("332,67")], [true, true]);
    eq(`ancho ${ancho}: termina con pulso de cajón`, Array.from(bytes.slice(-5)), [0x1b, 0x70, 0x00, 0x19, 0xfa]);
    eq(`ancho ${ancho}: corte de papel antes del cajón`, Array.from(bytes.slice(-9, -5)), [0x1d, 0x56, 0x42, 0x00]);
  }
  eq("sin opción cajón no manda pulso", Array.from(X.ticketEscPos(t, 58).slice(-4)), [0x1d, 0x56, 0x42, 0x00]);
  eq("aAscii", X.aAscii("Ñandú — “café” €5\u00a0ok"), 'Nandu - "cafe" EUR5 ok');
  eq("envolver no corta palabras cortas", X.envolver("uno dos tres cuatro", 9), ["uno dos", "tres", "cuatro"]);
  eq("envolver parte palabras gigantes", X.envolver("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  eq("izqDer alinea a la derecha", X.izqDer("Total", "$ 10", 12), ["Total   $ 10"]);
  eq("página de prueba usa el ancho", Buffer.from(X.paginaDePrueba(58)).toString("latin1").includes("32 columnas"), true);
}

// ── Escáner remoto (vínculo celular → caja) ──
{
  const t1 = R.nuevoToken(), t2 = R.nuevoToken();
  eq("token de 43 caracteres base64url y distinto cada vez", [R.tokenValido(t1), t1 !== t2, t1.length], [true, true, 43]);
  eq("tokens inválidos", [R.tokenValido(""), R.tokenValido(null), R.tokenValido("corto"), R.tokenValido("a".repeat(43) + "!")], [false, false, false, false]);
  eq("canal y url", [R.nombreCanal("abc"), R.urlVinculo("https://x.com", "a-b_c")], ["pos-scan-abc", "https://x.com/escanear?t=a-b_c"]);
  eq("link propio detectado", [R.esLinkPropio("https://x.com/escanear?t=abc"), R.esLinkPropio("http://localhost:3000/escanear"), R.esLinkPropio("7790070410")], [true, true, false]);
  eq("código limpio", [R.limpiarCodigo(" 7790070410 "), R.limpiarCodigo(""), R.limpiarCodigo(123), R.limpiarCodigo("a".repeat(65)), R.limpiarCodigo("https://x.com/escanear?t=z"), R.limpiarCodigo("cod\u0000igo")], ["7790070410", null, null, null, null, null]);
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
  const a = mem(); const ahora = 1_000_000;
  R.guardarVinculo(a, { token: t1, kiosco: "k1", expira_at: R.nuevaExpiracion(ahora) });
  eq("expira a los 45 minutos", R.nuevaExpiracion(0), 45 * 60_000);
  eq("lee un vínculo vigente", R.leerVinculo(a, "k1", ahora + 1000)?.token, t1);
  eq("otro kiosco no ve ese vínculo", R.leerVinculo(a, "k2", ahora), null);
  eq("vencido se descarta y se borra", [R.leerVinculo(a, "k1", ahora + 46 * 60_000), R.leerVinculo(a, "k1", ahora)], [null, null]);
  a.setItem("pos-vinculo:k3", "{no es json"); eq("corrupto se descarta", R.leerVinculo(a, "k3", ahora), null);
  R.guardarVinculo(a, { token: "malo", kiosco: "k4", expira_at: ahora + 1e6 }); eq("token inválido guardado se descarta", R.leerVinculo(a, "k4", ahora), null);
}
console.log(fallos ? `\n${fallos} FALLAS` : "\npos: todo OK");
process.exit(fallos ? 1 : 0);
