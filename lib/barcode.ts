import { supabase } from "./supabase";

export type ProductoEncontrado = { nombre: string; imagen_url?: string | null; fuente: "global" | "openfoodfacts" };

import { esCodigoValido } from "./ean";
export { esCodigoValido };

// Las tres bases del proyecto Open*Facts usan la misma API:
//  - openfoodfacts:     alimentos, bebidas, golosinas
//  - openbeautyfacts:   higiene personal, cuidado bucal, desodorantes
//  - openproductsfacts: limpieza, bazar
const BASES = ["world.openfoodfacts.org", "world.openbeautyfacts.org", "world.openproductsfacts.org"];
const CAMPOS = "product_name,generic_name,brands,image_front_small_url,image_front_url,image_url";

async function consultarBase(base: string, codigo: string): Promise<ProductoEncontrado | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`https://${base}/api/v2/product/${encodeURIComponent(codigo)}.json?fields=${CAMPOS}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.status !== 1) return null; // 0 = no está en esta base
    const p = j.product ?? {};
    const nombre = [p.product_name || p.generic_name, p.brands?.split(",")[0]].filter(Boolean).join(" ").trim();
    if (!nombre) return null;
    // La ficha puede tener nombre pero la foto guardada en otro campo: se prueban los tres.
    const imagen_url = p.image_front_small_url || p.image_front_url || p.image_url || null;
    return { nombre, imagen_url, fuente: "openfoodfacts" };
  } catch { return null; /* sin red o timeout: se carga a mano */ }
}

/** Busca un código en la base propia (compartida entre kioscos) y después, en paralelo, en las 3 bases Open*Facts. */
export async function buscarPorBarcode(barcode: string): Promise<ProductoEncontrado | null> {
  const { data: g } = await supabase.from("productos_globales").select("nombre,marca,imagen_url").eq("barcode", barcode).maybeSingle();
  if (g) return { nombre: [g.nombre, g.marca].filter(Boolean).join(" ").trim(), imagen_url: g.imagen_url, fuente: "global" };

  if (!esCodigoValido(barcode)) return null;
  const resultados = await Promise.all(BASES.map((b) => consultarBase(b, barcode)));
  // Prioridad: la primera base que tenga nombre (alimentos > higiene > limpieza), con foto si alguna la tiene.
  const mejor = resultados.find(Boolean) ?? null;
  if (!mejor) return null;
  return { ...mejor, imagen_url: mejor.imagen_url ?? resultados.find((r) => r?.imagen_url)?.imagen_url ?? null };
}

/**
 * Aporta el nombre a la base de la red. No escribe directo: la base lo guarda como aporte de este usuario y recién
 * lo publica para todos cuando otro usuario distinto coincide en el nombre (migración 0006). Si falla, no se avisa:
 * el producto ya quedó guardado en el kiosco y el aporte es un extra.
 */
export async function aportarAGlobal(barcode: string, nombre: string) {
  try { await supabase.rpc("aportar_global", { p_barcode: barcode, p_nombre: nombre }); } catch { /* aporte opcional */ }
}
