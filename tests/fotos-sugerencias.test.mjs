// Prueba de lib/fotos-sugerencias.ts: node tests/fotos-sugerencias.test.mjs  (o: npm run test:fotos-sug)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/fotos-sugerencias.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const F = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };

// consulta por nombre
eq("limpia símbolos", F.consultaPorNombre("  Alfajor   Jorgito® (x3) "), "Alfajor Jorgito x3");
eq("conserva acentos y ñ", F.consultaPorNombre("Dulce de leche La Serenísima ñandú"), "Dulce de leche La Serenísima ñandú");
eq("muy corto", F.consultaPorNombre("ab"), "");
eq("solo símbolos", F.consultaPorNombre("®®®™™"), "");
eq("máx 80", F.consultaPorNombre("a".repeat(200)).length, 80);

// límite diario
eq("límite por defecto", F.limiteDiario(undefined), 30);
eq("límite válido", F.limiteDiario("50"), 50);
eq("límite inválido", F.limiteDiario("abc"), 30);
eq("límite cero", F.limiteDiario("0"), 30);
eq("límite decimal", F.limiteDiario("2.5"), 30);
eq("límite enorme", F.limiteDiario("999999"), 30);

// Open Food Facts
const off = F.leerOffBusqueda({ products: [
  { product_name: "Alfajor", image_front_url: "https://images.openfoodfacts.org/a.jpg", image_front_small_url: "https://images.openfoodfacts.org/a.200.jpg" },
  { product_name: "Sin foto" },
  { product_name: "Http", image_front_url: "http://images.openfoodfacts.org/b.jpg" },
  null,
  { image_url: "https://images.openfoodfacts.org/c.jpg" },
] });
eq("off: solo https y con foto", off.map((s) => s.url), ["https://images.openfoodfacts.org/a.jpg", "https://images.openfoodfacts.org/c.jpg"]);
eq("off: miniatura", off[0].miniatura, "https://images.openfoodfacts.org/a.200.jpg");
eq("off: sin miniatura usa la imagen", off[1].miniatura, "https://images.openfoodfacts.org/c.jpg");
eq("off: abierta", off[0].abierta, true);
eq("off: basura", F.leerOffBusqueda("x"), []); eq("off: null", F.leerOffBusqueda(null), []); eq("off: sin lista", F.leerOffBusqueda({ products: 3 }), []);
eq("ficha: status 0", F.leerOffProducto({ status: 0 }), []);
eq("ficha: ok", F.leerOffProducto({ status: 1, product: { product_name: "X", image_url: "https://images.openfoodfacts.org/z.jpg" } }).length, 1);

// Serper
const sp = F.leerSerper({ images: [{ imageUrl: "https://tienda.com/a.jpg", thumbnailUrl: "https://t.gstatic.com/a", title: "A" }, { imageUrl: "http://x.com/b.jpg" }, { imageUrl: "https://y.com/c.jpg" }, null] });
eq("serper: https", sp.map((s) => s.url), ["https://tienda.com/a.jpg", "https://y.com/c.jpg"]);
eq("serper: no abierta", sp[0].abierta, false); eq("serper: sin miniatura", sp[1].miniatura, "https://y.com/c.jpg");
eq("serper: basura", F.leerSerper({ images: "x" }), []);

// juntar
const mk = (u, f = "busqueda") => ({ url: u, miniatura: u, fuente: f, titulo: "", abierta: false });
eq("sin repetidos y en orden", F.juntarSugerencias([[mk("https://a/1")], [mk("https://a/1"), mk("https://a/2")]]).map((s) => s.url), ["https://a/1", "https://a/2"]);
eq("tope", F.juntarSugerencias([Array.from({ length: 20 }, (_, i) => mk(`https://a/${i}`))]).length, F.MAX_SUGERENCIAS);

// hosts abiertos
eq("host abierto", F.esHostAbierto("https://images.openfoodfacts.org/a.jpg"), true);
eq("host no abierto", F.esHostAbierto("https://openfoodfacts.org.evil.com/a.jpg"), false);
eq("host inválido", F.esHostAbierto("no es url"), false);

// IPs privadas
for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "::1", "::", "fd12::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.1.1.1", "ff02::1"])
  eq("privada " + ip, F.ipPrivada(ip), true);
for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "190.2.3.4", "2606:4700::1111", "::ffff:8.8.8.8", "100.128.0.1"])
  eq("pública " + ip, F.ipPrivada(ip), false);

// URL segura
for (const u of ["https://images.openfoodfacts.org/a.jpg", "https://tienda.com.ar/img/a.png?x=1", "https://cdn.x.com:443/a.jpg"]) eq("segura " + u, F.urlImagenSegura(u), true);
for (const u of ["http://a.com/x.jpg", "https://127.0.0.1/a.jpg", "https://169.254.169.254/latest", "https://localhost/a.jpg", "https://servidor/a.jpg", "https://u:p@a.com/x.jpg", "https://a.com:8443/x.jpg", "https://[::1]/a.jpg", "https://app.internal/a.jpg", "https://nas.local/a.jpg", "ftp://a.com/x", "javascript:alert(1)", "", "https://a.com/" + "x".repeat(1000)])
  eq("insegura " + u.slice(0, 40), F.urlImagenSegura(u), false);

// tipos
eq("jpeg", F.tipoImagenValido("image/jpeg"), true); eq("webp con charset", F.tipoImagenValido("image/webp; charset=binary"), true);
eq("mayúsculas", F.tipoImagenValido("IMAGE/PNG"), true);
eq("svg no", F.tipoImagenValido("image/svg+xml"), false); eq("html no", F.tipoImagenValido("text/html"), false); eq("gif no", F.tipoImagenValido("image/gif"), false); eq("null", F.tipoImagenValido(null), false);


// lookup que valida al conectar (DNS rebinding)
const llamar = (resolver, all) => new Promise((ok) => F.crearLookup(resolver)("x.com", { all }, (...a) => ok(a)));
const pub = [{ address: "8.8.8.8", family: 4 }], priv = [{ address: "10.0.0.5", family: 4 }];
const r1 = await llamar(async () => pub, false); eq("lookup público (una)", [r1[0], r1[1], r1[2]], [null, "8.8.8.8", 4]);
const r2 = await llamar(async () => pub, true); eq("lookup público (all)", r2, [null, pub]);
eq("lookup privada", (await llamar(async () => priv, false))[0].code, "EDESTINO");
eq("lookup mezcla pública y privada", (await llamar(async () => [...pub, ...priv], true))[0].code, "EDESTINO");
eq("lookup loopback ipv6", (await llamar(async () => [{ address: "::1", family: 6 }], false))[0].code, "EDESTINO");
eq("lookup sin direcciones", (await llamar(async () => [], false))[0].code, "EDESTINO");
eq("lookup con error de DNS", (await llamar(async () => { throw new Error("ENOTFOUND"); }, false))[0].message, "ENOTFOUND");

console.log(fallos ? `${fallos} fallos` : "fotos-sugerencias: todo OK");
process.exit(fallos ? 1 : 0);
