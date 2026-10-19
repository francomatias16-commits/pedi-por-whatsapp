// Ventana de entrega (etapa 3C, opcional). La base valida y copia el texto al pedido; esto solo valida el formulario y arma las etiquetas.
export type Franja = { id: string; nombre: string; desde: string; hasta: string; activa: boolean };

export const TOPE_FRANJAS = 10;

/** "09:00:00" o "9:00" → "9:00". Si no es una hora válida devuelve el texto tal cual. */
export function horaCorta(h: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(h.trim());
  return m ? `${Number(m[1])}:${m[2]}` : h;
}

/** Texto que ve el cliente y el local: "Mañana · de 9:00 a 13:00". */
export const etiquetaFranja = (f: Pick<Franja, "nombre" | "desde" | "hasta">) => `${f.nombre} · de ${horaCorta(f.desde)} a ${horaCorta(f.hasta)}`;

const minutos = (h: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(h.trim());
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  return hh <= 23 && mm <= 59 ? hh * 60 + mm : null;
};

/** Valida el formulario del panel. Devuelve el código de error (el mismo que lanza la base) o null. */
export function validarFranja(f: { nombre: string; desde: string; hasta: string }): string | null {
  const n = f.nombre.trim();
  if (n.length < 1 || n.length > 40) return "franja_nombre_invalido";
  const d = minutos(f.desde), h = minutos(f.hasta);
  if (d === null || h === null || d >= h) return "franja_horas_invalidas";
  return null;
}
