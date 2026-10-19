// Marca consistente: todo lo que se ve fuera de la pantalla (ícono de la app, favicon, avisos) dice y muestra Go Fluxo.
// Uso: node tests/marca.test.mjs
import { readFileSync, existsSync } from "node:fs";
const leer = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const bin = (r) => readFileSync(new URL(r, import.meta.url));
let fallos = 0;
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };

const png = (r) => { const b = bin(r); return { firma: b.subarray(0, 8).toString("hex"), w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
for (const [r, t] of [["../public/icons/gofluxo-192.png", 192], ["../public/icons/gofluxo-512.png", 512], ["../app/icon.png", 512], ["../app/apple-icon.png", 180]]) {
  const p = png(r);
  ok(`${r} es PNG de ${t}x${t}`, p.firma === "89504e470d0a1a0a" && p.w === t && p.h === t);
}
ok("hay favicon.ico", existsSync(new URL("../app/favicon.ico", import.meta.url)) && bin("../app/favicon.ico").readUInt16LE(2) === 1);
ok("no quedan los íconos viejos", !existsSync(new URL("../public/icon-192.png", import.meta.url)) && !existsSync(new URL("../public/icon-512.png", import.meta.url)));

const manifest = leer("../app/manifest.ts");
const tarjeta = leer("../app/tarjeta/[token]/manifest.webmanifest/route.ts");
const sw = leer("../public/sw.js");
ok("el manifest se llama Go Fluxo", manifest.includes('name: "Go Fluxo"') && manifest.includes('short_name: "Go Fluxo"'));
for (const [n, s] of [["manifest", manifest], ["manifest de la tarjeta", tarjeta], ["service worker", sw]]) {
  ok(`${n}: usa los íconos de Go Fluxo`, s.includes("/icons/gofluxo-192.png") && !/\/icon-(192|512)\.png/.test(s));
}
ok("manifest y tarjeta con los mismos colores de marca", [manifest, tarjeta].every((s) => s.includes('theme_color: "#14181d"') && s.includes('background_color: "#edefee"')));
ok("el aviso sin título dice Go Fluxo", (sw.match(/Go Fluxo/g) || []).length >= 2);
for (const [n, s] of [["manifest", manifest], ["tarjeta", tarjeta], ["sw", sw], ["layout", leer("../app/layout.tsx")]]) {
  ok(`${n}: sin el nombre viejo`, !/pedí por whatsapp|pedi por whatsapp/i.test(s.replace(/Catálogo y pedidos por WhatsApp/g, "")));
}

if (fallos) { console.log(`✗ ${fallos} fallo(s)`); process.exit(1); }
console.log("marca OK");
