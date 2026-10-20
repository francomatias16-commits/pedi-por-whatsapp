// Firma CMS/PKCS#7 (SignedData, SHA-256 + RSA) del ticket de acceso (TRA) con el `crypto` de Node: sin openssl ni librerías externas
// (en Vercel no hay garantía de tener el binario). Equivale a `openssl smime -sign -nodetach`.
import { X509Certificate, createHash, createPrivateKey, createSign } from "node:crypto";

// --- DER mínimo
const largo = (n: number) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const tlv = (tag: number, ...partes: Buffer[]) => { const c = Buffer.concat(partes); return Buffer.concat([Buffer.from([tag]), largo(c.length), c]); };
const seq = (...p: Buffer[]) => tlv(0x30, ...p);
const set = (...p: Buffer[]) => tlv(0x31, ...p);
const oid = (s: string) => {
  const n = s.split(".").map(Number);
  const bytes: number[] = [40 * n[0] + n[1]];
  for (const v of n.slice(2)) { const t = [v & 127]; for (let x = v >> 7; x > 0; x >>= 7) t.unshift((x & 127) | 128); bytes.push(...t); }
  return tlv(0x06, Buffer.from(bytes));
};
const octetos = (b: Buffer) => tlv(0x04, b);
const nulo = () => Buffer.from([0x05, 0x00]);
const entero = (n: number) => tlv(0x02, Buffer.from([n]));
const ctx = (n: number, ...p: Buffer[]) => tlv(0xa0 + n, ...p); // [n] constructed

type Nodo = { tag: number; inicio: number; contenido: number; fin: number };
function leer(b: Buffer, pos: number): Nodo {
  const tag = b[pos]; let l = b[pos + 1]; let off = pos + 2;
  if (l & 128) { const n = l & 127; l = 0; for (let i = 0; i < n; i++) l = (l << 8) | b[off + i]; off += n; }
  return { tag, inicio: pos, contenido: off, fin: off + l };
}
// Del certificado X.509 (DER): el emisor (Name) y el número de serie, tal cual están codificados.
function emisorYSerie(der: Buffer): { emisor: Buffer; serie: Buffer } {
  const cert = leer(der, 0), tbs = leer(der, cert.contenido);
  let p = tbs.contenido;
  let n = leer(der, p);
  if (n.tag === 0xa0) { p = n.fin; n = leer(der, p); } // versión explícita
  const serie = der.subarray(n.inicio, n.fin);
  p = n.fin; n = leer(der, p); // algoritmo de firma
  p = n.fin; n = leer(der, p); // emisor
  return { emisor: der.subarray(n.inicio, n.fin), serie };
}
const pemADer = (pem: string) => Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");

const OID = { data: "1.2.840.113549.1.7.1", signedData: "1.2.840.113549.1.7.2", sha256: "2.16.840.1.101.3.4.2.1", rsa: "1.2.840.113549.1.1.1", contentType: "1.2.840.113549.1.9.3", messageDigest: "1.2.840.113549.1.9.4", signingTime: "1.2.840.113549.1.9.5" };
const utcTime = (d: Date) => { const s = d.toISOString(); return tlv(0x17, Buffer.from(`${s.slice(2, 4)}${s.slice(5, 7)}${s.slice(8, 10)}${s.slice(11, 13)}${s.slice(14, 16)}${s.slice(17, 19)}Z`)); };
const atributo = (tipo: string, valor: Buffer) => seq(oid(tipo), set(valor));

export function firmarTRA(traXml: string, certPem: string, keyPem: string, ahora: Date = new Date()): string {
  let certDer: Buffer, key;
  try { certDer = pemADer(certPem); new X509Certificate(certDer); key = createPrivateKey(keyPem); }
  catch { throw new Error("certificado_invalido"); }
  const contenido = Buffer.from(traXml, "utf8");
  const algSha = seq(oid(OID.sha256), nulo());
  const atributos = [
    atributo(OID.contentType, oid(OID.data)),
    atributo(OID.signingTime, utcTime(ahora)),
    atributo(OID.messageDigest, octetos(createHash("sha256").update(contenido).digest())),
  ].sort(Buffer.compare); // DER: los elementos de un SET OF van ordenados
  // La firma se calcula sobre los atributos codificados como SET (0x31); en el SignerInfo viajan con la etiqueta [0] (0xA0).
  const paraFirmar = set(...atributos);
  const firma = createSign("sha256").update(paraFirmar).sign(key);
  const { emisor, serie } = emisorYSerie(certDer);
  const signerInfo = seq(entero(1), seq(emisor, serie), algSha, tlv(0xa0, ...atributos), seq(oid(OID.rsa), nulo()), octetos(firma));
  const signedData = seq(entero(1), set(algSha), seq(oid(OID.data), ctx(0, octetos(contenido))), tlv(0xa0, certDer), set(signerInfo));
  return seq(oid(OID.signedData), ctx(0, signedData)).toString("base64");
}

// ¿El certificado y la clave son un par y el certificado está vigente? Devuelve el vencimiento.
export function revisarCertificado(certPem: string, keyPem: string): { vence: string; coincide: boolean; vigente: boolean } {
  const c = new X509Certificate(certPem);
  const vence = new Date(c.validTo), desde = new Date(c.validFrom), ahora = new Date();
  return { vence: vence.toISOString(), coincide: c.checkPrivateKey(createPrivateKey(keyPem)), vigente: desde <= ahora && ahora <= vence };
}
