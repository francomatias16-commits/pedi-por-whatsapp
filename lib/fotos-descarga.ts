// Descarga de una foto ajena (solo servidor). La IP se valida al conectar (crearLookup), cada redirección se revisa, y se corta por tipo, tiempo y tamaño.
import https from "node:https";
import dns from "node:dns";
import { MAX_DESCARGA_BYTES, crearLookup, tipoImagenValido, urlImagenSegura, type Direccion } from "./fotos-sugerencias";

export type ResultadoDescarga = { ok: true; tipo: string; bytes: Buffer } | { ok: false; error: "foto_invalida" | "foto_muy_grande" | "foto_no_responde"; status: number };

const resolverReal = (host: string): Promise<Direccion[]> =>
  new Promise((ok, mal) => dns.lookup(host, { all: true }, (e, dirs) => (e ? mal(e) : ok(dirs.map((d) => ({ address: d.address, family: d.family }))))));

type Paso = { redirige: string } | ResultadoDescarga;

function pedir(url: string, resolver: (h: string) => Promise<Direccion[]>): Promise<Paso> {
  return new Promise((fin) => {
    const err = (error: "foto_invalida" | "foto_muy_grande" | "foto_no_responde", status: number): Paso => ({ ok: false, error, status });
    const req = https.request(url, {
      method: "GET", timeout: 8000, lookup: crearLookup(resolver) as never,
      headers: { "User-Agent": "PediPorWhatsApp/1.0 (fotos de productos)", Accept: "image/jpeg,image/png,image/webp" },
    }, (res) => {
      const st = res.statusCode ?? 0;
      if (st >= 300 && st < 400) { res.resume(); const loc = res.headers.location; return fin(loc ? { redirige: loc } : err("foto_invalida", 400)); }
      const tipo = String(res.headers["content-type"] ?? "");
      if (st !== 200 || !tipoImagenValido(tipo)) { res.resume(); return fin(err("foto_invalida", 422)); }
      if (Number(res.headers["content-length"] ?? 0) > MAX_DESCARGA_BYTES) { res.destroy(); return fin(err("foto_muy_grande", 413)); }
      const partes: Buffer[] = []; let total = 0;
      res.on("data", (c: Buffer) => { total += c.length; if (total > MAX_DESCARGA_BYTES) { res.destroy(); fin(err("foto_muy_grande", 413)); } else partes.push(c); });
      res.on("end", () => fin({ ok: true, tipo: tipo.split(";")[0].trim().toLowerCase(), bytes: Buffer.concat(partes) }));
      res.on("error", () => fin(err("foto_no_responde", 502)));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", (e: NodeJS.ErrnoException) => fin(e.code === "EDESTINO" ? err("foto_invalida", 400) : err("foto_no_responde", 502)));
    req.end();
  });
}

export async function descargarImagen(urlInicial: string, resolver = resolverReal): Promise<ResultadoDescarga> {
  let url = urlInicial;
  for (let salto = 0; salto < 4; salto++) {
    if (!urlImagenSegura(url)) return { ok: false, error: "foto_invalida", status: 400 };
    const r = await pedir(url, resolver);
    if (!("redirige" in r)) return r;
    try { url = new URL(r.redirige, url).toString(); } catch { return { ok: false, error: "foto_invalida", status: 400 }; }
  }
  return { ok: false, error: "foto_invalida", status: 400 };   // demasiadas redirecciones
}
