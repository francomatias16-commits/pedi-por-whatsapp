import type { Tab } from "@/lib/navegacion";

// Modo simple (por defecto): oculta las pantallas avanzadas del menú de cada destino.
// Se guarda en este celular o computadora; el modo completo muestra todo.
export type Modo = "simple" | "completo";
const CLAVE = "pdw-modo";

// Pantallas que el modo simple oculta en las pestañas. Siguen existiendo por link.
export const AVANZADOS: Tab[] = ["radar", "conteo", "etiquetas", "proveedores", "sellos"];

export function leerModo(): Modo {
  try { return localStorage.getItem(CLAVE) === "completo" ? "completo" : "simple"; } catch { return "simple"; }
}

export function guardarModo(m: Modo): void {
  try { localStorage.setItem(CLAVE, m); } catch { /* sin almacenamiento: queda en simple */ }
}

// Qué pestañas mostrar según el modo. Si la pantalla actual es avanzada, siempre se muestra.
export function pestanasVisibles<T extends { tab: Tab }>(subs: T[], modo: Modo, actual: Tab): T[] {
  if (modo === "completo") return subs;
  return subs.filter((s) => !AVANZADOS.includes(s.tab) || s.tab === actual);
}
