// Cifrado de credenciales de pago (AES-256-GCM). La clave vive solo en PAGOS_CIFRADO_KEY (variable del servidor).
// Formato guardado: v1:<iv>:<tag>:<cifrado>, todo en base64. Sin imports relativos: se prueba directo con `npm test`.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function clave(k: string | undefined): Buffer {
  if (!k) throw new Error("falta_pagos_cifrado_key");
  const b = Buffer.from(k, "base64");
  if (b.length !== 32) throw new Error("pagos_cifrado_key_invalida"); // 32 bytes en base64: openssl rand -base64 32
  return b;
}

export function cifrar(texto: string, k: string | undefined = process.env.PAGOS_CIFRADO_KEY): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave(k), iv);
  const ct = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function descifrar(valor: string, k: string | undefined = process.env.PAGOS_CIFRADO_KEY): string {
  const [v, iv, tag, ct] = valor.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("formato_invalido");
  const d = createDecipheriv("aes-256-gcm", clave(k), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

// Para mostrarle al dueño solo el final de su credencial, nunca completa.
export const ultimos4 = (t: string) => t.slice(-4);
export const enmascarar = (t: string) => (t.length <= 8 ? "••••" : `••••${t.slice(-4)}`);
