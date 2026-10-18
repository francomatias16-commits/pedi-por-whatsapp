import { esCodigoValido } from "../ean";

// Código de balanza EAN-13: "2" + PLU (5 díg.) + dígito de control del PLU + peso en gramos (5 díg.) + control EAN.
// Es el formato más usado en balanzas con etiquetadora; si la balanza del cliente usa otro, se ajusta acá.
export type CodigoBalanza = { plu: string; gramos: number };

export function parsearBalanza(codigo: string): CodigoBalanza | null {
  if (!/^2\d{12}$/.test(codigo) || !esCodigoValido(codigo)) return null;
  const plu = String(Number(codigo.slice(1, 6)));
  const gramos = Number(codigo.slice(7, 12));
  if (gramos < 1) return null;
  return { plu, gramos };
}

/** Un PLU tipeado ("0123", "123") se compara sin ceros a la izquierda. */
export const mismoPlu = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && /^\d+$/.test(a) && /^\d+$/.test(b) && Number(a) === Number(b);

export const formatoPeso = (gramos: number) => `${(gramos / 1000).toFixed(3).replace(".", ",")} kg`;
