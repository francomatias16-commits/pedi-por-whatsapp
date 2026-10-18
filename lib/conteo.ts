import { cantidadAInput } from "./reposicion";
import { cantidadDesdeTexto } from "./compras";
import { mismoPlu, parsearBalanza } from "./pos/balanza";

// Conteo por planilla con escáner: traduce un código leído (cámara o celular vinculado) en "sumar a este producto".
export type ProdCodigo = { id: string; barcode: string | null; plu: string | null };
export type ItemConteo = { producto_id: string; por_peso: boolean };

export type Lectura =
  | { tipo: "item"; producto_id: string; gramos?: number }   // está en la planilla; gramos solo si es etiqueta de balanza
  | { tipo: "fuera"; producto_id: string }                    // existe pero no está en esta planilla
  | { tipo: "nada" };                                         // código desconocido

export function resolverLectura(codigoCrudo: string, productos: ProdCodigo[], items: ItemConteo[]): Lectura {
  const codigo = codigoCrudo.trim();
  if (!codigo) return { tipo: "nada" };
  const enPlanilla = new Set(items.map((i) => i.producto_id));
  const bal = parsearBalanza(codigo);
  let p: ProdCodigo | undefined;
  let gramos: number | undefined;
  if (bal) { p = productos.find((x) => mismoPlu(x.plu, bal.plu)); gramos = bal.gramos; }
  if (!p) { p = productos.find((x) => x.barcode === codigo); gramos = undefined; }
  if (!p && /^\d{1,6}$/.test(codigo)) p = productos.find((x) => mismoPlu(x.plu, codigo));
  if (!p) return { tipo: "nada" };
  if (!enPlanilla.has(p.id)) return { tipo: "fuera", producto_id: p.id };
  return gramos ? { tipo: "item", producto_id: p.id, gramos } : { tipo: "item", producto_id: p.id };
}

/** Texto nuevo del campo "Contado" tras una lectura. null = no se puede sumar solo (producto por peso sin etiqueta de balanza). */
export function sumarLectura(textoActual: string, porPeso: boolean, gramos?: number): string | null {
  const t = textoActual.trim();
  let actual = 0;
  if (t !== "") {
    const n = cantidadDesdeTexto(t, porPeso);
    if (n === null) return null; // texto inválido: no lo pisamos
    actual = n;
  }
  if (porPeso) return gramos ? cantidadAInput(actual + gramos, true) : null;
  return String(actual + 1);
}
