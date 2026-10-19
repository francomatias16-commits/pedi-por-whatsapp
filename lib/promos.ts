// Promociones (fases A, B y C): textos, estados y validaciones del panel. Sin efectos: lo que calcula la base está en club_evaluar (0045),
// promo_panel (0050), la liquidación (0051) y los sorteos (0052).

export type Semaforo = "conviene" | "ajustado" | "pierde_plata" | "reduce_margen" | "sin_datos";

export type PromoPremio = {
  premio_id: string; nombre: string; tipo: string; costo_sellos: number;
  costo_local: number | null; margen_pct: number | null; compras_para_llegar: number | null;
  gasto_para_llegar: number | null; pct_del_gasto: number | null; semaforo: Semaforo; frase: string;
};

export type PromoEvaluacion = {
  ticket_promedio: number | null; sellos_por_compra: number;
  margen_minimo: number; tope_promos_pct: number; premios: PromoPremio[];
};

export type Familia = "captar" | "retener" | "premio_etapa" | "liquidar";
export type ModoPromo = "directa" | "producto" | "niveles" | "sorteo";
export type PromoCatalogo = { clave: string; familia: Familia; nombre: string; descripcion: string; fase: "A" | "B" | "C"; automatica: boolean; orden: number; lista?: boolean; modo?: ModoPromo };

export type EstadoFactibilidad = "lista" | "falta_stock" | "reduce_margen" | "supera_tope";
export type CostoMes = { ventas_mes: number; sellos_promo: number; costo_sello: number | null; costo_promos: number; tope_pct: number; tope_pesos: number; usado_pct: number | null; supera: boolean };
export type PromoPanel = {
  activas: { clave: string; campana_id: string; nombre: string; tipo: string; desde: string | null }[];
  factibilidad: { estado: EstadoFactibilidad; motivo: string };
  costo_mes: CostoMes; aviso_previo_dias: number;
};

export const FAMILIAS: { clave: Familia; titulo: string }[] = [
  { clave: "captar", titulo: "Traer clientes nuevos" },
  { clave: "retener", titulo: "Que vuelvan" },
  { clave: "premio_etapa", titulo: "Premios por etapas" },
  { clave: "liquidar", titulo: "Vender lo que no sale" },
];

// Cada estado usa el sello de estado del sistema (Insignia): palabra + color, nunca solo color.
export type Tono = "ok" | "alerta" | "error" | "info" | "neutro";
export const SEMAFORO: Record<Semaforo, { texto: string; tono: Tono }> = {
  conviene: { texto: "Conviene", tono: "ok" },
  ajustado: { texto: "Ajustado", tono: "alerta" },
  pierde_plata: { texto: "Pierde plata", tono: "error" },
  reduce_margen: { texto: "Baja el margen", tono: "error" },
  sin_datos: { texto: "Sin datos todavía", tono: "neutro" },
};

/** Estado de una opción del catálogo en el panel. "configurable" = se arma en su propia sección (productos, niveles o sorteo). */
export type EstadoPromo = "activa" | "disponible" | "configurable" | "proximamente";
export function estadoPromo(c: PromoCatalogo, activas: string[]): EstadoPromo {
  if (activas.includes(c.clave)) return "activa";
  const lista = c.lista ?? (c.fase === "A" && (c.familia === "captar" || c.familia === "retener"));
  if (!lista) return "proximamente";
  return (c.modo ?? "directa") === "directa" ? "disponible" : "configurable";
}

/** Confirmación en una oración, con los valores por defecto que aplica la base (0048). */
export const CONFIRMACION: Record<string, string> = {
  bienvenida: "Cada cliente nuevo va a sumar 1 sello de bienvenida al registrarse. ¿Lo activo?",
  doble_primera_compra: "La primera compra de cada cliente va a sumar 1 sello extra. ¿Lo activo?",
  reactivacion: "Quien lleve 30 días sin comprar va a recibir 1 sello extra. ¿Lo activo?",
  sellos_dobles_dias_flojos: "Los martes y miércoles los sellos van a valer el doble. ¿Lo activo?",
  racha: "Quien compre 4 semanas seguidas va a recibir 1 sello extra, y lo mismo cada 4 semanas más. ¿Lo activo?",
  regalo_cumpleanos: "En el mes de su cumpleaños, cada cliente que cargó su fecha va a recibir 1 sello de regalo, una vez al año. ¿Lo activo?",
  referido: "Cuando un cliente traiga a un amigo con su código, los dos van a sumar 1 sello. ¿Lo activo?",
};

/** Texto de la tarjeta de cada opción por producto o por niveles (se arman en su sección, no con un clic). */
export const DONDE_SE_ARMA: Record<string, string> = {
  liquidar_sin_rotacion: "Se arma abajo, en “Productos que no salen”.",
  descuento_sin_movimiento: "Se arma abajo, en “Productos que no salen”.",
  llevá_dos_suma_mas: "Se arma abajo, en “Productos que no salen”.",
  premio_por_etapas: "Se arma abajo, en “Premios por etapas”.",
  sorteo_mensual: "Se arma abajo, en “Sorteos”.",
};

/** Textos del historial de cambios (promo_historial). */
export const ACCION_TEXTO: Record<string, string> = {
  alta: "Se creó", baja: "Se borró", activar: "Se activó", pausar: "Se pausó", cambio: "Se modificó",
  ajustes: "Se cambiaron los ajustes", margen_confirmado: "Confirmaste bajar el margen",
  apagado_tope: "Se pausó sola por llegar al tope del mes", apagado_stock: "Se pausó sola por falta de stock",
  sorteo_creado: "Se creó el sorteo", permiso_confirmado: "Confirmaste el permiso del sorteo",
  sorteo_realizado: "Se realizó el sorteo", sorteo_cancelado: "Se canceló el sorteo",
};

export const FACTIBILIDAD_TEXTO: Record<EstadoFactibilidad, { texto: string; tono: Tono }> = {
  lista: { texto: "Lista para activar", tono: "ok" },
  falta_stock: { texto: "Falta stock", tono: "error" },
  reduce_margen: { texto: "Baja el margen", tono: "alerta" },
  supera_tope: { texto: "Supera el tope del mes", tono: "error" },
};

// ---- Productos que no salen (liquidación)
export type ProductoParado = { producto_id: string; nombre: string; stock: number; costo: number | null; precio: number; margen_pct: number | null; dias_sin_venta: number; capital: number | null; liquidacion: string | null };
export type Liquidacion = { id: string; clave: string; tipo: "regalo" | "descuento" | "dos_sellos"; producto_id: string; producto: string; valor: number; desde: string };
export type AccionLiquidar = { clave: "descuento_sin_movimiento" | "liquidar_sin_rotacion" | "llevá_dos_suma_mas"; boton: string; etiqueta: string; unidad: string; defecto: string; max: number; entero: boolean };
export const ACCIONES_LIQUIDAR: AccionLiquidar[] = [
  { clave: "descuento_sin_movimiento", boton: "Descuento", etiqueta: "Descuento (%)", unidad: "%", defecto: "20", max: 90, entero: false },
  { clave: "liquidar_sin_rotacion", boton: "Regalo", etiqueta: "Sellos que cuesta como premio", unidad: "sellos", defecto: "5", max: 1000, entero: true },
  { clave: "llevá_dos_suma_mas", boton: "Llevá dos", etiqueta: "Sellos extra al llevar dos", unidad: "sellos", defecto: "2", max: 100, entero: true },
];
export const TIPO_LIQUIDACION_TEXTO: Record<Liquidacion["tipo"], string> = { regalo: "Regalo con sellos", descuento: "Descuento", dos_sellos: "Llevá dos" };

/** Valida lo que escribe el kiosquero para una liquidación. Devuelve el número listo para mandar. */
export function validarLiquidacion(a: AccionLiquidar, texto: string): { ok: true; valor: number } | { ok: false; error: string } {
  const t = texto.trim().replace(",", ".");
  if (t === "" || !Number.isFinite(Number(t))) return { ok: false, error: "Escribí el valor como número." };
  const n = Number(t);
  if (n <= 0) return { ok: false, error: "El valor tiene que ser mayor a 0." };
  if (n > a.max) return { ok: false, error: `El valor no puede pasar de ${a.max}${a.unidad === "%" ? "%" : ""}.` };
  if (a.entero && n !== Math.floor(n)) return { ok: false, error: "Escribí un número entero." };
  return { ok: true, valor: n };
}

// ---- Premios por etapas
export type NivelForm = { nombre: string; costo_sellos: string; tipo: "libre" | "producto" | "pct" | "monto"; valor: string; producto_id: string; tope?: string };
export const TIPOS_NIVEL: { clave: NivelForm["tipo"]; texto: string }[] = [
  { clave: "libre", texto: "Premio a elección del local" }, { clave: "producto", texto: "Un producto gratis" },
  { clave: "pct", texto: "Un descuento (%)" }, { clave: "monto", texto: "Un descuento en pesos" },
];
export const NIVELES_SUGERIDOS: NivelForm[] = [
  { nombre: "", costo_sellos: "5", tipo: "libre", valor: "", producto_id: "" },
  { nombre: "", costo_sellos: "10", tipo: "libre", valor: "", producto_id: "" },
  { nombre: "", costo_sellos: "20", tipo: "libre", valor: "", producto_id: "" },
];

/** Valida los niveles antes de mandarlos y arma el JSON que espera promo_etapas_guardar. */
export function validarEtapas(niveles: NivelForm[]): { ok: true; datos: Record<string, unknown>[] } | { ok: false; error: string } {
  if (niveles.length < 2 || niveles.length > 6) return { ok: false, error: "Armá entre 2 y 6 niveles." };
  let prev = 0; const datos: Record<string, unknown>[] = [];
  for (const [i, n] of niveles.entries()) {
    const num = `Nivel ${i + 1}`;
    if (n.nombre.trim() === "") return { ok: false, error: `${num}: escribí el nombre del premio.` };
    if (n.nombre.trim().length > 80) return { ok: false, error: `${num}: el nombre es muy largo (máximo 80 letras).` };
    const sellos = Number(n.costo_sellos);
    if (!Number.isInteger(sellos) || sellos < 1 || sellos > 1000) return { ok: false, error: `${num}: los sellos tienen que ser un número entero entre 1 y 1000.` };
    if (sellos <= prev) return { ok: false, error: `${num}: tiene que pedir más sellos que el nivel anterior (${prev}).` };
    prev = sellos;
    const d: Record<string, unknown> = { nombre: n.nombre.trim(), costo_sellos: sellos, tipo: n.tipo };
    if (n.tipo === "producto") { if (!n.producto_id) return { ok: false, error: `${num}: elegí el producto.` }; d.producto_id = n.producto_id; }
    if (n.tipo === "pct" || n.tipo === "monto") {
      const v = Number(n.valor.trim().replace(",", "."));
      if (n.valor.trim() === "" || !Number.isFinite(v) || v <= 0) return { ok: false, error: `${num}: escribí el valor del descuento.` };
      if (n.tipo === "pct" && v > 100) return { ok: false, error: `${num}: el descuento no puede pasar de 100%.` };
      d.valor = v;
      if (n.tipo === "pct" && (n.tope ?? "").trim() !== "") {
        const t = Number(n.tope!.trim().replace(",", "."));
        if (!Number.isFinite(t) || t <= 0) return { ok: false, error: `${num}: el tope en pesos tiene que ser mayor que cero (o dejalo vacío).` };
        d.tope = t;
      }
    }
    datos.push(d);
  }
  return { ok: true, datos };
}

/** Lo que verá el cliente en su tarjeta, nivel por nivel. Se muestra mientras el kiosquero arma los niveles. */
export function vistaPreviaEtapas(niveles: NivelForm[], nombreProducto: (id: string) => string | undefined = () => undefined): string[] {
  const money = (n: number) => `$${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
  return niveles.map((n, i) => {
    const premio = n.nombre.trim() || "(sin nombre)";
    const sellos = n.costo_sellos.trim() || "?";
    let que = "";
    if (n.tipo === "producto") que = nombreProducto(n.producto_id) ? `, ${nombreProducto(n.producto_id)} gratis` : ", un producto gratis";
    if (n.tipo === "pct") {
      const t = Number((n.tope ?? "").replace(",", "."));
      que = `, ${n.valor.trim() || "?"}% de descuento${n.tope?.trim() && t > 0 ? ` (hasta ${money(t)})` : ""}`;
    }
    if (n.tipo === "monto") que = `, ${n.valor.trim() ? money(Number(n.valor.replace(",", "."))) : "?"} de descuento`;
    return `Nivel ${i + 1}: ${premio}, con ${sellos} sellos${que}.`;
  });
}

// ---- Sorteos
export type SorteoGanador = { etapa: number; premio: string; cliente: string | null; cliente_id: string | null; codigo: string | null };
export type Sorteo = {
  id: string; nombre: string; desde: string; hasta: string; etapas: number; estado: "borrador" | "realizado" | "cancelado";
  permiso_confirmado: boolean; permiso_confirmado_at: string | null; semilla: string | null; realizado_at: string | null; ganadores: SorteoGanador[];
};
export const AVISO_LEGAL_SORTEO = "Esta app no da asesoramiento legal. Muchos sorteos comerciales necesitan autorización previa y cumplir reglas del lugar donde se hacen: consultalo con un profesional antes de sortear. Si ya tenés el permiso, confirmalo acá y queda registrado quién y cuándo.";
export const ESTADO_SORTEO_TEXTO: Record<Sorteo["estado"], { texto: string; tono: Tono }> = {
  borrador: { texto: "Sin sortear", tono: "info" }, realizado: { texto: "Realizado", tono: "ok" }, cancelado: { texto: "Cancelado", tono: "neutro" },
};

/** Valida el formulario de un sorteo nuevo. Los premios vacíos se descartan. */
export function validarSorteo(nombre: string, premios: string[], desde: string, hasta: string):
  { ok: true; datos: { nombre: string; premios: string[]; desde: string; hasta: string } } | { ok: false; error: string } {
  if (nombre.trim() === "") return { ok: false, error: "Ponele un nombre al sorteo." };
  if (nombre.trim().length > 80) return { ok: false, error: "El nombre es muy largo (máximo 80 letras)." };
  const lista = premios.map((p) => p.trim()).filter(Boolean);
  if (lista.length < 1) return { ok: false, error: "Cargá al menos un premio." };
  if (lista.some((p) => p.length > 80)) return { ok: false, error: "Algún premio tiene un nombre muy largo (máximo 80 letras)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return { ok: false, error: "Elegí las fechas del período." };
  if (desde > hasta) return { ok: false, error: "La fecha de inicio no puede ser posterior a la de fin." };
  return { ok: true, datos: { nombre: nombre.trim(), premios: lista, desde, hasta } };
}

/** ¿Ya se puede sortear? El período tiene que haber terminado (la base lo vuelve a controlar). */
export const puedeSortear = (s: Pick<Sorteo, "estado" | "permiso_confirmado" | "hasta">, hoy: string) => s.estado === "borrador" && s.permiso_confirmado && s.hasta < hoy;

export const FASE_TEXTO: Record<PromoCatalogo["fase"], string> = {
  A: "Disponible para activar",
  B: "Próximamente",
  C: "Próximamente",
};

/** Margen mínimo, tope de promociones y (opcional) días de aviso previo que escribe el kiosquero. Acepta coma o punto decimal. */
export function validarAjustesPromos(margen: string, tope: string, aviso?: string):
  { ok: true; datos: { club_margen_minimo: number; club_tope_promos_pct: number; club_aviso_previo_dias?: number } } | { ok: false; error: string } {
  if (margen.trim() === "" || !Number.isFinite(Number(margen.replace(",", ".")))) return { ok: false, error: "Escribí el margen mínimo como número." };
  const m = Number(margen.replace(",", "."));
  if (m < 0 || m > 90) return { ok: false, error: "El margen mínimo tiene que estar entre 0 y 90%." };
  if (tope.trim() === "" || !Number.isFinite(Number(tope.replace(",", ".")))) return { ok: false, error: "Escribí el tope de promociones como número." };
  const t = Number(tope.replace(",", "."));
  if (t < 0 || t > 50) return { ok: false, error: "El tope de promociones tiene que estar entre 0 y 50%." };
  if (aviso === undefined) return { ok: true, datos: { club_margen_minimo: m, club_tope_promos_pct: t } };
  const a = Number(aviso.trim());
  if (aviso.trim() === "" || !Number.isInteger(a) || a < 0 || a > 7) return { ok: false, error: "El aviso previo tiene que ser un número entero de días, entre 0 y 7." };
  return { ok: true, datos: { club_margen_minimo: m, club_tope_promos_pct: t, club_aviso_previo_dias: a } };
}

// ---- Sugeridas (0054): propuestas que el sistema arma con datos reales; el kiosquero confirma con un clic.
export type Sugerencia = { clave: string; titulo: string; motivo: string; boton: string; producto_id?: string; producto?: string; valor?: number };

/** Fecha de hoy en Argentina, como YYYY-MM-DD. */
export const hoyArgentina = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

/** Período por defecto de un sorteo mensual: el mes anterior completo (plan, sección 12). */
export function periodoMesAnterior(hoy: string): { desde: string; hasta: string } {
  const [y, m] = hoy.split("-").map(Number);
  const anio = m === 1 ? y - 1 : y;
  const mes = m === 1 ? 12 : m - 1;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { desde: `${anio}-${p(mes)}-01`, hasta: `${anio}-${p(mes)}-${p(ultimo)}` };
}
