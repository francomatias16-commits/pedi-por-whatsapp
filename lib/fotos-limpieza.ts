// Limpieza de fotos viejas del bucket (Etapa 3D). Lógica pura: qué archivos borrar de las filas que devuelve fotos_limpieza_pendientes.
import { rutaDeStorage } from "@/lib/fotos";

export type FilaLimpieza = { id: string; kiosco_id: string; url: string | null };

export const RETENCION_DEFECTO = 30;

/** Días de retención desde FOTOS_RETENCION_DIAS (7 a 365). Valor ausente o inválido: 30. */
export function diasRetencion(valor: string | undefined): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 7 && n <= 365 ? n : RETENCION_DEFECTO;
}

/**
 * Ruta del bucket a borrar para una fila, o null si no hay nada que borrar.
 * Defensa extra: solo se borra dentro de la carpeta del propio local, nunca con ".." ni rutas raras.
 */
export function rutaABorrar(f: FilaLimpieza): string | null {
  const ruta = rutaDeStorage(f.url);
  if (!ruta) return null;
  if (ruta.includes("..") || ruta.startsWith("/") || ruta.includes("//")) return null;
  return ruta.startsWith(`${f.kiosco_id}/`) && ruta.length > f.kiosco_id.length + 1 ? ruta : null;
}

/** Separa las filas: las que tienen archivo para borrar y las que solo hay que marcar como procesadas. */
export function planLimpieza(filas: FilaLimpieza[]): { borrar: { id: string; ruta: string }[]; soloMarcar: string[] } {
  const borrar: { id: string; ruta: string }[] = [];
  const soloMarcar: string[] = [];
  for (const f of filas) {
    const ruta = rutaABorrar(f);
    if (ruta) borrar.push({ id: f.id, ruta }); else soloMarcar.push(f.id);
  }
  return { borrar, soloMarcar };
}
