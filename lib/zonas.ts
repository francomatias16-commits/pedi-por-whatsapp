// Envío por zonas (etapa 3C). La base calcula el costo y el mínimo; esto solo los muestra antes de pedir.
export type Zona = { id: string; nombre: string; descripcion: string | null; costo: number; pedido_minimo: number; activa: boolean };

/** Mínimo que rige para un pedido: el del local o el de la zona, el mayor (igual que crear_pedido). Retiro: solo el del local. */
export const minimoEfectivo = (minimoLocal: number, modalidad: "retiro" | "envio", zona?: Pick<Zona, "pedido_minimo"> | null) =>
  modalidad === "envio" && zona ? Math.max(minimoLocal, Number(zona.pedido_minimo)) : minimoLocal;

/** Costo de envío que se muestra. Con zonas encendidas sale de la zona elegida; sin zonas, del costo único del local. */
export const costoEnvioMostrado = (zonasActivas: boolean, costoLocal: number, modalidad: "retiro" | "envio", zona?: Pick<Zona, "costo"> | null) =>
  modalidad !== "envio" ? 0 : zonasActivas ? Number(zona?.costo ?? 0) : costoLocal;

export const TOPE_ZONAS = 30;

/** Valida el formulario del panel. Devuelve el código de error (el mismo que lanza la base) o null. */
export function validarZona(f: { nombre: string; costo: string; minimo: string }): string | null {
  const num = (s: string) => Number(s.trim().replace(",", "."));
  const dosDec = (v: number) => Math.round(v * 100) / 100 === v;
  if (f.nombre.trim().length < 1 || f.nombre.trim().length > 60) return "zona_nombre_invalido";
  const c = num(f.costo === "" ? "0" : f.costo), m = num(f.minimo === "" ? "0" : f.minimo);
  if (!Number.isFinite(c) || !Number.isFinite(m) || c < 0 || m < 0 || c > 1000000 || m > 10000000 || !dosDec(c) || !dosDec(m)) return "zona_costo_invalido";
  return null;
}
