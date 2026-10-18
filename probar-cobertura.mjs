// Prueba cuántos códigos de barras de tu kiosco están en Open Food Facts.
// Consulta Open Food Facts, Open Beauty Facts y Open Products Facts en paralelo,
// igual que el barcode.ts actualizado, así que el resultado es el que vería la app.
//
// Uso (desde la carpeta del proyecto, Node 18 o más nuevo):
//   node probar-cobertura.mjs codigos.txt
//
// codigos.txt: un código por línea. Opcional: una etiqueta después de una coma.
//   7790895000997,Coca-Cola 500ml
//   # las líneas que empiezan con # se ignoran
import { readFileSync, writeFileSync } from "node:fs";

const archivo = process.argv[2] || "codigos.txt";
let crudo;
try { crudo = readFileSync(archivo, "utf8"); }
catch { console.error(`No encuentro "${archivo}". Creá el archivo con un código por línea.`); process.exit(1); }

const vistos = new Set();
const items = [];
for (const linea of crudo.split(/\r?\n/)) {
  const l = linea.trim();
  if (!l || l.startsWith("#")) continue;
  const [c, ...resto] = l.split(",");
  const codigo = c.replace(/\D/g, "");
  if (!codigo || vistos.has(codigo)) continue;
  vistos.add(codigo);
  items.push({ codigo, etiqueta: resto.join(",").trim() });
}
if (!items.length) { console.error("El archivo no tiene códigos válidos."); process.exit(1); }

const UA = "pedi-por-whatsapp-prueba/0.5 (prueba de cobertura)";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const BASES = [
  ["OFF", "world.openfoodfacts.org"],     // alimentos y bebidas
  ["OBF", "world.openbeautyfacts.org"],   // higiene personal
  ["OPF", "world.openproductsfacts.org"], // limpieza y bazar
];
const CAMPOS = "product_name,generic_name,brands,image_front_small_url,image_front_url,image_url";

function valido(c) { // EAN-8 / UPC-A / EAN-13 con dígito verificador
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(c)) return false;
  const d = c.split("").map(Number); const k = d.pop();
  return (10 - (d.reverse().reduce((s, n, i) => s + n * (i % 2 ? 1 : 3), 0) % 10)) % 10 === k;
}

async function unaBase(base, codigo) {
  const url = `https://${base}/api/v2/product/${encodeURIComponent(codigo)}.json?fields=${CAMPOS}`;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA } });
      clearTimeout(t);
      if (r.status === 404) return { estado: "no_esta" };
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (j?.status !== 1) return { estado: "no_esta" };
      const p = j.product ?? {};
      const nombre = [p.product_name || p.generic_name, p.brands?.split(",")[0]].filter(Boolean).join(" ").trim();
      const imagen = !!(p.image_front_small_url || p.image_front_url || p.image_url);
      return nombre ? { estado: "ok", nombre, imagen } : { estado: "sin_nombre", imagen };
    } catch (e) {
      if (intento === 1) return { estado: "error", nombre: String(e.message || e) };
      await espera(1500);
    }
  }
}

async function consultar(codigo) {
  if (!valido(codigo)) return { estado: "codigo_invalido", fuentes: {} };
  const res = await Promise.all(BASES.map(([, host]) => unaBase(host, codigo)));
  const fuentes = Object.fromEntries(BASES.map(([k], i) => [k, res[i].estado]));
  const mejor = res.find((r) => r.estado === "ok");
  if (mejor) return { estado: "ok", nombre: mejor.nombre, imagen: res.some((r) => r.estado === "ok" && r.imagen), fuentes };
  if (res.some((r) => r.estado === "sin_nombre")) return { estado: "sin_nombre", fuentes };
  if (res.every((r) => r.estado === "error")) return { estado: "error", nombre: res[0].nombre, fuentes };
  return { estado: "no_esta", fuentes };
}

const filas = [];
console.log(`Probando ${items.length} códigos...\n`);
for (const [i, it] of items.entries()) {
  const r = await consultar(it.codigo);
  filas.push({ ...it, ...r });
  const marca = { ok: "OK      ", sin_nombre: "SIN NOMB", no_esta: "NO ESTÁ ", error: "ERROR   ", codigo_invalido: "COD MAL " }[r.estado];
  console.log(`${String(i + 1).padStart(3)}. ${marca} ${it.codigo}  ${r.nombre || it.etiqueta || ""}`);
  await espera(2000); // 3 consultas por código: se espacia para respetar el límite de Open*Facts
}

const n = filas.length;
const c = (e) => filas.filter((f) => f.estado === e).length;
const invalidos = c("codigo_invalido");
const ok = c("ok"), sinNombre = c("sin_nombre"), noEsta = c("no_esta"), err = c("error");
const conFoto = filas.filter((f) => f.estado === "ok" && f.imagen).length;
const pct = (x, d = n) => (d ? ((x / d) * 100).toFixed(0) : "0") + "%";

console.log("\n=== RESULTADO ===");
console.log(`Probados:                          ${n}`);
console.log(`Encontrados con nombre (sirven):   ${ok}  (${pct(ok)})`);
console.log(`   de ellos, con foto:             ${conFoto}  (${pct(conFoto, ok)})`);
console.log(`Existen pero sin nombre:           ${sinNombre}  (${pct(sinNombre)})`);
console.log(`No están en Open Food Facts:       ${noEsta}  (${pct(noEsta)})`);
if (invalidos) console.log(`Código inválido (mal leído):       ${invalidos}  (${pct(invalidos)})  <- revisalos, no se consultaron`);
const porFuente = Object.fromEntries(BASES.map(([k]) => [k, filas.filter((f) => f.fuentes?.[k] === "ok").length]));
console.log(`Hallados por base:                 ${BASES.map(([k]) => k + " " + porFuente[k]).join("  |  ")}`);
if (err) console.log(`Con error de red (repetir):        ${err}  (${pct(err)})`);

const csv = ["codigo,etiqueta,estado,nombre,foto,OFF,OBF,OPF"]
  .concat(filas.map((f) => [f.codigo, f.etiqueta, f.estado, f.nombre || "", f.imagen ? "si" : "", f.fuentes?.OFF || "", f.fuentes?.OBF || "", f.fuentes?.OPF || ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")))
  .join("\n");
writeFileSync("resultados-cobertura.csv", csv, "utf8");
console.log("\nDetalle guardado en resultados-cobertura.csv");
