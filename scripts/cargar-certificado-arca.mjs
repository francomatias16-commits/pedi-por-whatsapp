// Carga el certificado del PROVEEDOR de facturación (el que firma por todos los locales) en arca_proveedor_config, cifrado.
// Se corre una vez por ambiente, desde tu computadora (la clave privada no pasa por ningún chat ni por el repo).
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PAGOS_CIFRADO_KEY=... \
//   node scripts/cargar-certificado-arca.mjs --cuit 20123456786 --cert certificado.crt --key privada.key [--produccion]
//
// Sin --produccion carga el de homologación (pruebas). Las variables son las mismas que ya tenés en Vercel.
import { readFileSync } from "node:fs";
import { X509Certificate, createCipheriv, createPrivateKey, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const cuit = (val("cuit") ?? "").replace(/\D/g, ""), certRuta = val("cert"), keyRuta = val("key"), homologacion = !args.includes("--produccion");
const fallar = (m) => { console.error(`Error: ${m}`); process.exit(1); };

if (!/^\d{11}$/.test(cuit) || !certRuta || !keyRuta) fallar("Uso: node scripts/cargar-certificado-arca.mjs --cuit <11 dígitos> --cert <certificado.crt> --key <privada.key> [--produccion]");
const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: sr, PAGOS_CIFRADO_KEY: clave } = process.env;
if (!url || !sr) fallar("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
if (!clave || Buffer.from(clave, "base64").length !== 32) fallar("Falta PAGOS_CIFRADO_KEY (la misma que usás en Vercel; 32 bytes en base64).");

const certPem = readFileSync(certRuta, "utf8"), keyPem = readFileSync(keyRuta, "utf8");
let cert, key;
try { cert = new X509Certificate(certPem); key = createPrivateKey(keyPem); } catch { fallar("El certificado o la clave no son PEM válidos."); }
if (!cert.checkPrivateKey(key)) fallar("La clave privada no corresponde a ese certificado.");
const ahora = new Date();
if (ahora < new Date(cert.validFrom) || ahora > new Date(cert.validTo)) fallar(`El certificado no está vigente (válido ${cert.validFrom} – ${cert.validTo}).`);

// Mismo formato que lib/pagos/cifrado.ts: v1:<iv>:<tag>:<cifrado> (AES-256-GCM)
function cifrar(texto) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", Buffer.from(clave, "base64"), iv);
  const ct = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}
const admin = createClient(url, sr, { auth: { persistSession: false } });
const { error } = await admin.from("arca_proveedor_config").upsert({ homologacion, cuit, cert_cifrado: cifrar(certPem), key_cifrada: cifrar(keyPem), activo: true, updated_at: new Date().toISOString() }, { onConflict: "homologacion" });
if (error) fallar(error.message);
await admin.from("tokens_wsaa_proveedor").delete().eq("homologacion", homologacion); // el token anterior era de otro certificado
console.log(`Listo. Certificado de ${homologacion ? "HOMOLOGACIÓN" : "PRODUCCIÓN"} cargado para el CUIT ${cuit}. Vence: ${new Date(cert.validTo).toISOString().slice(0, 10)}.`);
