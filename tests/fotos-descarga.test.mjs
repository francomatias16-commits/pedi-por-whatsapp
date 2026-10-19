// Prueba de lib/fotos-descarga.ts con sockets reales: node tests/fotos-descarga.test.mjs  (o: npm run test:fotos-desc)
// Un nombre que resuelve a una red interna tiene que cortarse al conectar (400), no intentar la conexión (que daría 502 por rechazada).
import ts from "typescript";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "fd-"));
const compilar = (n) => ts.transpileModule(readFileSync(new URL(`../lib/${n}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
writeFileSync(join(dir, "fotos-sugerencias.mjs"), compilar("fotos-sugerencias"));
writeFileSync(join(dir, "fotos-descarga.mjs"), compilar("fotos-descarga").replace('"./fotos-sugerencias"', '"./fotos-sugerencias.mjs"'));
const D = await import(join(dir, "fotos-descarga.mjs"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const res = (dirs) => async () => dirs;
const casos = [
  ["loopback", [{ address: "127.0.0.1", family: 4 }]],
  ["red interna", [{ address: "10.1.2.3", family: 4 }]],
  ["metadatos de la nube", [{ address: "169.254.169.254", family: 4 }]],
  ["ipv6 loopback", [{ address: "::1", family: 6 }]],
  ["mezcla pública y privada", [{ address: "8.8.8.8", family: 4 }, { address: "192.168.0.9", family: 4 }]],
  ["sin direcciones", []],
];
for (const [nombre, dirs] of casos) {
  const r = await D.descargarImagen("https://foto.example.com/a.jpg", res(dirs));
  eq("bloquea " + nombre, [r.ok, r.error, r.status], [false, "foto_invalida", 400]);
}
const r1 = await D.descargarImagen("https://localhost/a.jpg", res([{ address: "8.8.8.8", family: 4 }]));
eq("URL insegura ni se intenta", [r1.ok, r1.status], [false, 400]);
const r2 = await D.descargarImagen("http://foto.example.com/a.jpg", res([{ address: "8.8.8.8", family: 4 }]));
eq("http no", [r2.ok, r2.status], [false, 400]);
const r3 = await D.descargarImagen("https://noexiste.example.com/a.jpg", async () => { throw new Error("ENOTFOUND"); });
eq("DNS caído da 502", [r3.ok, r3.error, r3.status], [false, "foto_no_responde", 502]);
console.log(fallos ? `${fallos} fallos` : "fotos-descarga: todo OK");
process.exit(fallos ? 1 : 0);
