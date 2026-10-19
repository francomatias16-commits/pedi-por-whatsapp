// Mapa de navegación del panel: 7 destinos con sus pantallas, y las rutas (/panel/productos/precios).
// Es lógica pura (sin React) para poder probarla con `npm test`.
export type Tab = "pedidos" | "productos" | "fiado" | "caja" | "sellos" | "precios" | "proveedores" | "reponer" | "conteo" | "etiquetas" | "resumen" | "radar" | "local";
export type Destino = "inicio" | "vender" | "pedidos" | "productos" | "clientes" | "compras" | "negocio";
export type Sub = { tab: Tab; slug: string; titulo: string };
export type DestinoInfo = { id: Destino; titulo: string; detalle: string; subs: Sub[] };

// La primera pantalla de cada destino va con slug "" (es la que se abre al entrar).
export const DESTINOS: DestinoInfo[] = [
  { id: "inicio", titulo: "Inicio", detalle: "Qué hacer hoy", subs: [{ tab: "resumen", slug: "", titulo: "Inicio" }] },
  { id: "vender", titulo: "Vender", detalle: "Cobrar en el mostrador", subs: [{ tab: "caja", slug: "", titulo: "Caja" }] },
  { id: "pedidos", titulo: "Pedidos", detalle: "Los que llegan por WhatsApp", subs: [{ tab: "pedidos", slug: "", titulo: "Pedidos" }] },
  { id: "productos", titulo: "Productos", detalle: "Qué vendés y a cuánto", subs: [
    { tab: "productos", slug: "", titulo: "Productos" }, { tab: "precios", slug: "precios", titulo: "Cambiar precios" },
    { tab: "etiquetas", slug: "carteles", titulo: "Carteles de precio" }, { tab: "conteo", slug: "contar", titulo: "Contar mercadería" },
  ] },
  { id: "clientes", titulo: "Clientes", detalle: "Quién te compra y quién te debe", subs: [
    { tab: "fiado", slug: "", titulo: "Fiado" }, { tab: "sellos", slug: "puntos", titulo: "Puntos" }, { tab: "radar", slug: "alertas", titulo: "Alertas" },
  ] },
  { id: "compras", titulo: "Compras", detalle: "Qué te falta y a quién comprarle", subs: [
    { tab: "reponer", slug: "", titulo: "Qué comprar" }, { tab: "proveedores", slug: "proveedores", titulo: "Proveedores" },
  ] },
  { id: "negocio", titulo: "Mi negocio", detalle: "Datos, horarios y QR", subs: [{ tab: "local", slug: "", titulo: "Datos del local" }] },
];

const TABS = DESTINOS.flatMap((d) => d.subs.map((s) => ({ ...s, destino: d.id })));

export const destinoDeTab = (t: Tab): Destino => TABS.find((x) => x.tab === t)!.destino;

export function rutaDeTab(t: Tab): string {
  const x = TABS.find((y) => y.tab === t)!;
  return "/panel" + (x.destino === "inicio" ? "" : `/${x.destino}`) + (x.slug ? `/${x.slug}` : "");
}

// ["productos","precios"] → "precios". Sin segmentos → "resumen". Destino desconocido → null.
// Un slug desconocido dentro de un destino válido abre la primera pantalla de ese destino.
export function tabDeRuta(segmentos: string[]): Tab | null {
  if (segmentos.length === 0) return "resumen";
  const d = DESTINOS.find((x) => x.id === segmentos[0]);
  if (!d || d.id === "inicio") return null;
  return (d.subs.find((s) => s.slug === (segmentos[1] ?? "")) ?? d.subs[0]).tab;
}

// "/panel/productos/precios" → ["productos","precios"]
export const segmentosDe = (pathname: string): string[] => pathname.replace(/^\/panel\/?/, "").split("/").filter(Boolean);

// Links viejos de avisos y favoritos: /panel?tab=reponer → /panel/compras
export function rutaLegacy(search: string): string | null {
  const t = new URLSearchParams(search).get("tab");
  const x = TABS.find((y) => y.tab === t);
  return x ? rutaDeTab(x.tab) : null;
}

// ───────── Roles (Etapa 2A) ─────────
// El menú se filtra por rol. La base es la que manda (RLS y RPC): esto solo evita mostrar pantallas que fallarían.
export type Rol = "cajero" | "encargado" | "dueno";
export const ROLES: Rol[] = ["cajero", "encargado", "dueno"];
export const ETIQUETA_ROL: Record<Rol, string> = { cajero: "Cajero", encargado: "Encargado", dueno: "Dueño" };
export const DETALLE_ROL: Record<Rol, string> = {
  cajero: "Vende y cobra en el mostrador, ve y confirma pedidos y anota fiado.",
  encargado: "Además maneja productos, precios, stock, compras, proveedores y reportes.",
  dueno: "Todo, incluidos los datos del local, los cobros con Mercado Pago y el equipo.",
};
export const esRol = (x: unknown): x is Rol => x === "cajero" || x === "encargado" || x === "dueno";

// Pantallas que ve cada rol. "local" (Mi negocio) para el encargado muestra solo los resultados, sin la configuración.
const PANTALLAS_CAJERO: Tab[] = ["caja", "pedidos", "fiado"];
export function puedeVer(rol: Rol, t: Tab): boolean {
  return rol === "cajero" ? PANTALLAS_CAJERO.includes(t) : true;
}
// Por dónde entra cada rol: el cajero cae directo en la caja.
export const tabInicio = (rol: Rol): Tab => (rol === "cajero" ? "caja" : "resumen");

// Destinos con al menos una pantalla visible, y solo con las pantallas visibles.
export function destinosPara(rol: Rol): DestinoInfo[] {
  return DESTINOS.map((d) => ({ ...d, subs: d.subs.filter((s) => puedeVer(rol, s.tab)) })).filter((d) => d.subs.length > 0);
}

// Qué partes de Mi negocio y de la caja puede tocar cada uno.
export const puedeConfigurarLocal = (rol: Rol): boolean => rol === "dueno";
export const puedeAdministrarCaja = (rol: Rol): boolean => rol !== "cajero"; // atajos, ofertas, carga de mercadería
export const puedeCorregirFiado = (rol: Rol): boolean => rol !== "cajero";
// El cajero siempre necesita un supervisor para anular o devolver, aunque el local tenga esa opción apagada.
export const exigeSupervisor = (rol: Rol): boolean => rol === "cajero";
