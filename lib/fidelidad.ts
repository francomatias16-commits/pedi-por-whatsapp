// Fidelidad: campañas de sellos y premios. Puro y sin DOM: formularios, validaciones y textos (las reglas de verdad viven en la base, 0017).
export type TipoCampana = "visita" | "monto" | "producto" | "categoria" | "bienvenida" | "reactivacion" | "multiplicador" | "manual";
export type Canal = "pedido" | "mostrador";
export type Medio = "efectivo" | "transferencia" | "mercadopago";
export type Campana = {
  id: string; nombre: string; tipo: TipoCampana; activa: boolean; sellos: number; multiplicador: number | null; por_monto: number | null;
  producto_id: string | null; categoria: string | null; dias_inactivo: number | null; monto_minimo: number | null;
  canales: Canal[]; medios: Medio[] | null; dias_semana: number[] | null; hora_desde: string | null; hora_hasta: string | null;
  desde: string | null; hasta: string | null; tope_diario: number | null;
};
export type TipoPremio = "libre" | "producto" | "pct" | "monto";
export type Premio = { id: string; nombre: string; descripcion: string | null; costo_sellos: number; tipo: TipoPremio; producto_id: string | null; valor: number | null; activo: boolean };

export const TIPOS: { tipo: TipoCampana; titulo: string; ayuda: string }[] = [
  { tipo: "visita", titulo: "Por compra", ayuda: "Cada pedido entregado o venta del mostrador suma sellos." },
  { tipo: "monto", titulo: "Por monto gastado", ayuda: "Sellos cada cierto monto: por ejemplo 1 sello cada $1.000." },
  { tipo: "producto", titulo: "Por un producto", ayuda: "Sellos extra por cada unidad de un producto." },
  { tipo: "categoria", titulo: "Por una categoría", ayuda: "Sellos extra por cada unidad de una categoría." },
  { tipo: "multiplicador", titulo: "Sellos dobles (o triples)", ayuda: "Multiplica los sellos de la compra en los días y horarios que elijas." },
  { tipo: "bienvenida", titulo: "Bienvenida", ayuda: "Bono por la primera compra de un cliente." },
  { tipo: "reactivacion", titulo: "Reactivación", ayuda: "Bono cuando un cliente vuelve después de mucho tiempo sin comprar." },
  { tipo: "manual", titulo: "Acción manual", ayuda: "Una acción que inventás vos (reseña, amigo referido…) y das con un toque desde el cliente." },
];
export const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const DIAS_CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const MEDIOS_ETQ: Record<Medio, string> = { efectivo: "efectivo", transferencia: "transferencia", mercadopago: "Mercado Pago" };

export type FormCampana = {
  nombre: string; tipo: TipoCampana; sellos: string; multiplicador: string; por_monto: string; producto_id: string; categoria: string;
  dias_inactivo: string; monto_minimo: string; canales: Canal[]; medios: Medio[]; dias_semana: number[]; usar_horario: boolean;
  hora_desde: string; hora_hasta: string; desde: string; hasta: string; tope_diario: string;
};
export const CAMPANA_VACIA: FormCampana = {
  nombre: "", tipo: "visita", sellos: "1", multiplicador: "2", por_monto: "", producto_id: "", categoria: "", dias_inactivo: "30", monto_minimo: "",
  canales: ["pedido", "mostrador"], medios: [], dias_semana: [], usar_horario: false, hora_desde: "17:00", hora_hasta: "19:00", desde: "", hasta: "", tope_diario: "",
};

/** Plantillas para arrancar: llenan el formulario y se pueden editar antes de guardar. */
export const PLANTILLAS: { titulo: string; form: Partial<FormCampana> }[] = [
  { titulo: "Un sello por compra", form: { nombre: "Un sello por compra", tipo: "visita", sellos: "1" } },
  { titulo: "1 sello cada $1.000", form: { nombre: "1 sello cada $1.000", tipo: "monto", sellos: "1", por_monto: "1000" } },
  { titulo: "Sellos dobles los martes", form: { nombre: "Martes de sellos dobles", tipo: "multiplicador", multiplicador: "2", dias_semana: [2] } },
  { titulo: "Happy hour 17 a 19", form: { nombre: "Happy hour de sellos", tipo: "multiplicador", multiplicador: "2", usar_horario: true, hora_desde: "17:00", hora_hasta: "19:00" } },
  { titulo: "Bienvenida: 3 sellos", form: { nombre: "Bienvenida", tipo: "bienvenida", sellos: "3" } },
  { titulo: "Te extrañamos (30 días)", form: { nombre: "Te extrañamos", tipo: "reactivacion", sellos: "3", dias_inactivo: "30" } },
  { titulo: "Reseña en Google (manual)", form: { nombre: "Reseña en Google", tipo: "manual", sellos: "5", tope_diario: "5" } },
  { titulo: "Trajo un amigo (manual)", form: { nombre: "Trajo un amigo", tipo: "manual", sellos: "3" } },
];

const aNum = (s: string) => Number(String(s).trim().replace(",", "."));
const vacio = (s: string) => String(s).trim() === "";
const entero = (n: number) => Number.isInteger(n);
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** Mensaje de error para mostrar, o null si el formulario es válido (mismos límites que los checks de la tabla). */
export function validarCampana(f: FormCampana): string | null {
  const nombre = f.nombre.trim();
  if (nombre.length < 1 || nombre.length > 80) return "Poné un nombre de hasta 80 letras.";
  if (f.tipo === "multiplicador") {
    const m = aNum(f.multiplicador);
    if (!(m >= 1.5 && m <= 10)) return "El multiplicador tiene que estar entre 1,5 y 10 (2 = sellos dobles).";
  } else {
    const s = aNum(f.sellos);
    if (!entero(s) || s < 1 || s > 100) return "Los sellos tienen que ser un entero entre 1 y 100.";
  }
  if (f.tipo === "monto") { const m = aNum(f.por_monto); if (vacio(f.por_monto) || !(m > 0)) return "Indicá cada cuántos pesos se da el sello."; }
  if (f.tipo === "producto" && !f.producto_id) return "Elegí el producto.";
  if (f.tipo === "categoria" && !f.categoria.trim()) return "Elegí la categoría.";
  if (f.tipo === "reactivacion") { const d = aNum(f.dias_inactivo); if (!entero(d) || d < 7 || d > 365) return "Los días sin comprar tienen que estar entre 7 y 365."; }
  if (!vacio(f.monto_minimo) && !(aNum(f.monto_minimo) >= 0)) return "El monto mínimo no es válido.";
  if (!vacio(f.tope_diario)) { const t = aNum(f.tope_diario); if (!entero(t) || t < 1 || t > 1000) return "El tope diario tiene que ser un entero entre 1 y 1000."; }
  if (f.canales.length === 0) return "Elegí al menos un canal (pedidos o mostrador).";
  if (f.usar_horario && (!f.hora_desde || !f.hora_hasta || f.hora_desde === f.hora_hasta)) return "Revisá el horario: la hora de inicio y la de fin tienen que ser distintas.";
  if (f.desde && f.hasta && f.desde > f.hasta) return "La fecha de inicio no puede ser posterior a la de fin.";
  return null;
}

/** Fila lista para insertar o actualizar (sin kiosco_id). Los datos que no aplican al tipo se mandan en null. */
export function campanaDesdeForm(f: FormCampana) {
  const t = f.tipo;
  return {
    nombre: f.nombre.trim(), tipo: t,
    sellos: t === "multiplicador" ? 1 : aNum(f.sellos),
    multiplicador: t === "multiplicador" ? aNum(f.multiplicador) : null,
    por_monto: t === "monto" ? aNum(f.por_monto) : null,
    producto_id: t === "producto" ? f.producto_id : null,
    categoria: t === "categoria" ? f.categoria.trim() : null,
    dias_inactivo: t === "reactivacion" ? aNum(f.dias_inactivo) : null,
    monto_minimo: t === "manual" || vacio(f.monto_minimo) ? null : aNum(f.monto_minimo),
    canales: t === "manual" ? ["pedido", "mostrador"] : f.canales,
    medios: t === "manual" || f.medios.length === 0 ? null : f.medios,
    dias_semana: t === "manual" || f.dias_semana.length === 0 ? null : [...f.dias_semana].sort(),
    hora_desde: t !== "manual" && f.usar_horario ? f.hora_desde : null,
    hora_hasta: t !== "manual" && f.usar_horario ? f.hora_hasta : null,
    desde: f.desde || null, hasta: f.hasta || null,
    tope_diario: vacio(f.tope_diario) ? null : aNum(f.tope_diario),
  };
}

export function formDesdeCampana(c: Campana): FormCampana {
  return {
    nombre: c.nombre, tipo: c.tipo, sellos: String(c.sellos), multiplicador: c.multiplicador == null ? "2" : String(c.multiplicador),
    por_monto: c.por_monto == null ? "" : String(c.por_monto), producto_id: c.producto_id ?? "", categoria: c.categoria ?? "",
    dias_inactivo: c.dias_inactivo == null ? "30" : String(c.dias_inactivo), monto_minimo: c.monto_minimo == null ? "" : String(c.monto_minimo),
    canales: c.canales, medios: c.medios ?? [], dias_semana: c.dias_semana ?? [], usar_horario: !!c.hora_desde,
    hora_desde: hhmm(c.hora_desde) || "17:00", hora_hasta: hhmm(c.hora_hasta) || "19:00", desde: c.desde ?? "", hasta: c.hasta ?? "",
    tope_diario: c.tope_diario == null ? "" : String(c.tope_diario),
  };
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const dinero = (n: number) => `$${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
const fechaCorta = (s: string) => s.split("-").reverse().join("/");

/** Resumen en una línea de lo que hace la campaña (para la lista). */
export function describirCampana(c: Campana, nombreProducto?: string): string {
  let q: string;
  switch (c.tipo) {
    case "visita": q = `${plural(c.sellos, "sello", "sellos")} por compra`; break;
    case "monto": q = `${plural(c.sellos, "sello", "sellos")} cada ${dinero(c.por_monto ?? 0)}`; break;
    case "producto": q = `${plural(c.sellos, "sello", "sellos")} por cada ${nombreProducto ?? "producto"}`; break;
    case "categoria": q = `${plural(c.sellos, "sello", "sellos")} por cada producto de ${c.categoria}`; break;
    case "multiplicador": q = `Sellos x${String(c.multiplicador).replace(".", ",")}`; break;
    case "bienvenida": q = `${plural(c.sellos, "sello", "sellos")} en la primera compra`; break;
    case "reactivacion": q = `${plural(c.sellos, "sello", "sellos")} si vuelve tras ${c.dias_inactivo} días`; break;
    default: q = `${plural(c.sellos, "sello", "sellos")} a mano`;
  }
  const extra: string[] = [];
  if (c.tipo !== "manual") {
    if (c.canales.length === 1) extra.push(c.canales[0] === "pedido" ? "solo pedidos" : "solo mostrador");
    if (c.medios && c.medios.length) extra.push(c.medios.map((m) => MEDIOS_ETQ[m]).join(" o "));
    if (c.dias_semana && c.dias_semana.length) extra.push(c.dias_semana.map((d) => DIAS_CORTO[d]).join(", "));
    if (c.hora_desde && c.hora_hasta) extra.push(`${hhmm(c.hora_desde)} a ${hhmm(c.hora_hasta)}`);
    if (c.monto_minimo) extra.push(`desde ${dinero(c.monto_minimo)}`);
  }
  if (c.desde || c.hasta) extra.push(c.desde && c.hasta ? `del ${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)}` : c.desde ? `desde el ${fechaCorta(c.desde)}` : `hasta el ${fechaCorta(c.hasta!)}`);
  if (c.tope_diario) extra.push(`máx. ${c.tope_diario} por día`);
  return [q, ...extra].join(" · ");
}

// ── Premios ──
export type FormPremio = { nombre: string; descripcion: string; costo_sellos: string; tipo: TipoPremio; producto_id: string; valor: string };
export const PREMIO_VACIO: FormPremio = { nombre: "", descripcion: "", costo_sellos: "10", tipo: "libre", producto_id: "", valor: "" };
export const TIPOS_PREMIO: { tipo: TipoPremio; titulo: string; ayuda: string }[] = [
  { tipo: "libre", titulo: "Libre", ayuda: "Lo escribís vos (un café, una entrada, lo que quieras) y lo entregás a mano." },
  { tipo: "producto", titulo: "Producto gratis", ayuda: "En la Caja se descuenta el precio de una unidad de ese producto." },
  { tipo: "pct", titulo: "% de descuento", ayuda: "Un porcentaje sobre el total de la venta." },
  { tipo: "monto", titulo: "Monto de descuento", ayuda: "Un descuento en pesos sobre el total de la venta." },
];

export function validarPremio(f: FormPremio): string | null {
  const n = f.nombre.trim();
  if (n.length < 1 || n.length > 80) return "Poné un nombre de hasta 80 letras.";
  if (f.descripcion.length > 200) return "La descripción puede tener hasta 200 letras.";
  const c = aNum(f.costo_sellos);
  if (!entero(c) || c < 1 || c > 1000) return "El costo en sellos tiene que ser un entero entre 1 y 1000.";
  if (f.tipo === "producto" && !f.producto_id) return "Elegí el producto del premio.";
  if (f.tipo === "pct") { const v = aNum(f.valor); if (vacio(f.valor) || !(v > 0 && v <= 100)) return "El descuento tiene que ser un porcentaje entre 0 y 100."; }
  if (f.tipo === "monto") { const v = aNum(f.valor); if (vacio(f.valor) || !(v > 0)) return "Indicá el monto del descuento."; }
  return null;
}
export const premioDesdeForm = (f: FormPremio) => ({
  nombre: f.nombre.trim(), descripcion: f.descripcion.trim() || null, costo_sellos: aNum(f.costo_sellos), tipo: f.tipo,
  producto_id: f.tipo === "producto" ? f.producto_id : null, valor: f.tipo === "pct" || f.tipo === "monto" ? aNum(f.valor) : null,
});
export const formDesdePremio = (p: Premio): FormPremio => ({
  nombre: p.nombre, descripcion: p.descripcion ?? "", costo_sellos: String(p.costo_sellos), tipo: p.tipo, producto_id: p.producto_id ?? "", valor: p.valor == null ? "" : String(p.valor),
});
export function describirPremio(p: Premio, nombreProducto?: string): string {
  const q = `${plural(p.costo_sellos, "sello", "sellos")}`;
  if (p.tipo === "pct") return `${q} · ${p.valor}% de descuento`;
  if (p.tipo === "monto") return `${q} · ${dinero(p.valor ?? 0)} de descuento`;
  if (p.tipo === "producto") return `${q} · ${nombreProducto ?? "producto"} gratis`;
  return q;
}

/**
 * Descuento global (en %) que aplica un premio en la Caja, sobre el total de la venta antes de ese descuento.
 * Para "monto" y "producto" se convierte a porcentaje con 2 decimales (lo mínimo que acepta la base): el descuento real
 * puede diferir unos centavos del monto pedido. El "libre" no descuenta nada.
 */
export function pctDePremio(p: Pick<Premio, "tipo" | "valor">, totalSinPremio: number, precioProducto = 0, subtotalProducto = Infinity): number {
  if (p.tipo === "libre" || !(totalSinPremio > 0)) return 0;
  let pct: number;
  if (p.tipo === "pct") pct = p.valor ?? 0;
  else if (p.tipo === "monto") pct = ((p.valor ?? 0) / totalSinPremio) * 100;
  else pct = (Math.min(precioProducto, subtotalProducto) / totalSinPremio) * 100;
  return Math.min(100, Math.max(0, Math.round(pct * 100) / 100));
}

export const ERRORES_FIDELIDAD: [string, string][] = [
  ["sellos_insuficientes", "No alcanzan los sellos."],
  ["motivo_requerido", "Escribí un motivo (al menos 3 letras)."],
  ["cantidad_invalida", "La cantidad de sellos no es válida."],
  ["tope_diario", "Ese cliente ya llegó al tope diario de esta acción."],
  ["campana_inactiva", "Esa campaña no está vigente."],
  ["campana_invalida", "Esa acción no se puede dar a mano."],
  ["premio_invalido", "Ese premio ya no está disponible."],
  ["venta_invalida", "No se pudo asociar el canje a la venta."],
  ["ya_anulado", "Ya estaba anulado."],
  ["producto_invalido", "Ese producto no es de tu kiosco."],
  ["no_autorizado", "No tenés permiso para esto."],
];
export function mensajeFidelidad(m: string | undefined): string {
  const t = m ?? "";
  return ERRORES_FIDELIDAD.find(([k]) => t.includes(k))?.[1] ?? "No se pudo completar la operación. Probá de nuevo.";
}
