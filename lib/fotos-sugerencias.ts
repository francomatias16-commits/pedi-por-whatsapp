// Fotos automáticas (etapa 3D), parte pura: normalizar consultas, leer respuestas de cada fuente, juntar sugerencias y
// decidir qué URLs se pueden descargar. Lo usan las rutas /api/fotos/*; no depende de Supabase ni de la red.
export type FuenteFoto = "global" | "openfoodfacts" | "busqueda";
export type Sugerencia = { url: string; miniatura: string; fuente: FuenteFoto; titulo: string; abierta: boolean };

export const MAX_SUGERENCIAS = 6;
const LIMITE_DIARIO_DEFECTO = 30;     // consultas diarias por local a la fuente paga
export const MAX_DESCARGA_BYTES = 5 * 1024 * 1024;
export const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp"];
/** Open Food Facts y sus hermanas publican fotos con licencia abierta (CC BY-SA). El resto son de terceros. */
export const HOSTS_ABIERTOS = ["images.openfoodfacts.org", "static.openfoodfacts.org", "images.openbeautyfacts.org", "images.openproductsfacts.org"];

export const limiteDiario = (env: string | undefined): number => {
  const n = Number(env);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : LIMITE_DIARIO_DEFECTO;
};

/** Texto para buscar por nombre: sin símbolos raros ni espacios de más, hasta 80 caracteres. Vacío si no alcanza para buscar. */
export function consultaPorNombre(nombre: string): string {
  const q = nombre.normalize("NFC").replace(/[^\p{L}\p{N}\s.,%-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return q.length >= 3 ? q : "";
}

const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\//.test(u) && u.length <= 1000;
export const esHostAbierto = (url: string) => { try { return HOSTS_ABIERTOS.includes(new URL(url).hostname); } catch { return false; } };

/** Respuesta de la búsqueda por nombre de Open Food Facts (cgi/search.pl con json=1). */
export function leerOffBusqueda(j: unknown): Sugerencia[] {
  const productos = (j as { products?: unknown[] } | null)?.products;
  if (!Array.isArray(productos)) return [];
  const sal: Sugerencia[] = [];
  for (const p of productos as Record<string, unknown>[]) {
    if (!p || typeof p !== "object") continue;
    const url = [p.image_front_url, p.image_url].find(https) as string | undefined;
    if (!url) continue;
    const mini = [p.image_front_small_url, p.image_front_thumb_url, url].find(https) as string;
    sal.push({ url, miniatura: mini, fuente: "openfoodfacts", titulo: String(p.product_name ?? p.generic_name ?? "").slice(0, 80), abierta: true });
  }
  return sal;
}

/** Respuesta de la ficha de un código en Open Food Facts (api/v2/product). */
export function leerOffProducto(j: unknown): Sugerencia[] {
  const p = (j as { status?: number; product?: Record<string, unknown> } | null);
  if (!p || p.status !== 1 || !p.product) return [];
  return leerOffBusqueda({ products: [p.product] });
}

/** Respuesta de Serper (google.serper.dev/images). Son fotos de terceros. */
export function leerSerper(j: unknown): Sugerencia[] {
  const imgs = (j as { images?: unknown[] } | null)?.images;
  if (!Array.isArray(imgs)) return [];
  const sal: Sugerencia[] = [];
  for (const i of imgs as Record<string, unknown>[]) {
    if (!i || typeof i !== "object" || !https(i.imageUrl)) continue;
    sal.push({ url: i.imageUrl, miniatura: https(i.thumbnailUrl) ? i.thumbnailUrl : i.imageUrl, fuente: "busqueda", titulo: String(i.title ?? "").slice(0, 80), abierta: false });
  }
  return sal;
}

/** Junta las listas en orden de prioridad (base de la red, Open Food Facts, búsqueda): sin repetidos y hasta MAX_SUGERENCIAS. */
export function juntarSugerencias(listas: Sugerencia[][]): Sugerencia[] {
  const vistas = new Set<string>(), sal: Sugerencia[] = [];
  for (const s of listas.flat()) {
    if (vistas.has(s.url)) continue;
    vistas.add(s.url); sal.push(s);
    if (sal.length >= MAX_SUGERENCIAS) break;
  }
  return sal;
}

const ipv4 = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
/** ¿La dirección es de la red interna, de loopback o reservada? (IPv4 e IPv6). Para no descargar de servidores propios. */
export function ipPrivada(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s.startsWith("::ffff:")) return ipPrivada(s.slice(7));
  if (ipv4(s)) {
    const [a, b] = s.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return s === "::" || s === "::1" || s.startsWith("fc") || s.startsWith("fd") || /^fe[89ab]/.test(s) || s.startsWith("ff");
}

/** Chequeo previo a descargar: https, sin usuario ni contraseña, puerto estándar, con nombre de dominio (no IP) y no interno. */
export function urlImagenSegura(url: string): boolean {
  if (typeof url !== "string" || url.length > 1000) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.includes(":") || ipv4(h) || /^\[/.test(h)) return false;
  if (h === "localhost" || /\.(local|localhost|internal|lan|home|corp|intranet)$/.test(h)) return false;
  return true;
}

export const tipoImagenValido = (ct: string | null) => TIPOS_IMAGEN.includes((ct ?? "").split(";")[0].trim().toLowerCase());

export type Direccion = { address: string; family: number };
/**
 * Función `lookup` para https.request que valida la IP en el mismo momento de conectar: si el nombre resuelve a una dirección interna
 * (o a ninguna), la conexión falla. Así no hay intervalo entre "validar" y "conectar" (DNS rebinding). El resolvedor se inyecta para poder probarlo.
 */
export function crearLookup(resolver: (host: string) => Promise<Direccion[]>) {
  return (host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    resolver(host).then((dirs) => {
      if (!dirs.length || dirs.some((d) => ipPrivada(d.address))) return cb(Object.assign(new Error("destino_privado"), { code: "EDESTINO" }));
      if (opts?.all) cb(null, dirs); else cb(null, dirs[0].address, dirs[0].family);
    }, (e) => cb(e));
  };
}
