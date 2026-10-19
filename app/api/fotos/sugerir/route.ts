// Busca fotos candidatas para un producto del local. No cambia nada: el dueño o el encargado elige y confirma después.
// Cascada: base de la red (por código), Open Food Facts (por código y por nombre) y, si hay clave y cupo, un buscador de imágenes.
import { NextResponse } from "next/server";
import { UUID } from "@/lib/pagos/mp";
import { crearAdmin, rolDe } from "@/lib/pagos/servidor";
import { consultaPorNombre, juntarSugerencias, leerOffBusqueda, leerOffProducto, leerSerper, limiteDiario, type Sugerencia } from "@/lib/fotos-sugerencias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASES = ["world.openfoodfacts.org", "world.openbeautyfacts.org", "world.openproductsfacts.org"];
const CAMPOS = "product_name,generic_name,image_front_small_url,image_front_thumb_url,image_front_url,image_url";

async function pedir(url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store", headers: { "User-Agent": "PediPorWhatsApp/1.0 (fotos de productos)", ...(init?.headers ?? {}) } });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kiosco = String(body?.kiosco ?? ""), producto = String(body?.producto ?? "");
  const soloGratis = body?.solo_gratis === true;   // modo lote: sin búsqueda en internet (fuente paga y con derechos de autor)
  if (!UUID.test(kiosco) || !UUID.test(producto)) return NextResponse.json({ error: "datos_invalidos" }, { status: 400 });
  const admin = crearAdmin();
  if (!(await rolDe(req, admin, kiosco, ["encargado", "dueno"]))) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });

  const { data: k } = await admin.from("kioscos").select("fotos_auto_activo").eq("id", kiosco).maybeSingle();
  if (!k?.fotos_auto_activo) return NextResponse.json({ error: "fotos_inactivo" }, { status: 409 });
  const { data: p } = await admin.from("productos").select("nombre,barcode").eq("id", producto).eq("kiosco_id", kiosco).maybeSingle();
  if (!p) return NextResponse.json({ error: "producto_no_encontrado" }, { status: 404 });

  const uso = async (fuente: string, limite: number | null) => admin.rpc("fotos_usar_cupo", { p_kiosco: kiosco, p_fuente: fuente, p_limite: limite });
  const listas: Sugerencia[][] = [];
  const codigo = (p.barcode ?? "").replace(/\D/g, "");

  // 1) Base de la red: la foto que ya cargó otro local para ese código.
  if (codigo) {
    const { data: g } = await admin.from("productos_globales").select("imagen_url,nombre").eq("barcode", codigo).maybeSingle();
    if (g?.imagen_url && /^https:\/\//.test(g.imagen_url)) { await uso("global", null); listas.push([{ url: g.imagen_url, miniatura: g.imagen_url, fuente: "global", titulo: String(g.nombre ?? "").slice(0, 80), abierta: false }]); }
  }
  // 2) Open Food Facts por código (las tres bases) y por nombre.
  const q = consultaPorNombre(p.nombre);
  if (codigo || q) await uso("openfoodfacts", null);
  if (codigo) {
    const fichas = await Promise.all(BASES.map((b) => pedir(`https://${b}/api/v2/product/${encodeURIComponent(codigo)}.json?fields=${CAMPOS}`)));
    listas.push(fichas.flatMap((f) => leerOffProducto(f)));
  }
  if (q) listas.push(leerOffBusqueda(await pedir(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=6&fields=${CAMPOS}`)));

  // 3) Buscador de imágenes (fuente paga, con tope diario por local). Solo si hace falta y hay clave.
  let sugerencias = juntarSugerencias(listas), limiteAlcanzado = false;
  const clave = process.env.SERPER_API_KEY, busquedaDisponible = !soloGratis && !!clave && !!q;
  if (busquedaDisponible && sugerencias.length < 3) {
    const { error } = await uso("busqueda", limiteDiario(process.env.FOTOS_LIMITE_DIARIO));
    if (error) limiteAlcanzado = (error.message ?? "").includes("limite_fotos");
    else {
      const j = await pedir("https://google.serper.dev/images", { method: "POST", headers: { "X-API-KEY": clave!, "Content-Type": "application/json" }, body: JSON.stringify({ q: `${q} producto`, gl: "ar", hl: "es", num: 8 }) });
      listas.push(leerSerper(j));
      sugerencias = juntarSugerencias(listas);
    }
  }
  return NextResponse.json({ sugerencias, limite_alcanzado: limiteAlcanzado, busqueda_disponible: busquedaDisponible });
}
