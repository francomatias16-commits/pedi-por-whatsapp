// Club de clientes (lógica pura, sin Next ni Supabase, para poder probarla en Node).
// El cliente se registra una vez con el QR del local y después suma su propio sello; el kiosquero recibe un aviso y puede rechazarlo.

export const CLUB_TOKEN_RE = /^[0-9a-f]{32}$/;
/** Papelito: 6 caracteres sin I, L, O, 0 ni 1 (igual que la generación en la 0044). Se acepta en minúsculas y con espacios o guiones. */
export const CODIGO_CLUB_RE = /^[2-9A-HJKMNP-Z]{6}$/;
export const normalizarCodigoClub = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const RUTA_CLUB_PANEL = "/panel/clientes/puntos"; // misma ruta que rutaDeTab("sellos")
export const claveTokenLocal = (slug: string) => `gf-club-${slug}`;

export type Bloqueo = { codigo: "club_inactivo" | "club_fuera_horario" | "club_limite_dia" | "club_espera"; espera_seg?: number };
export type Tarjeta = {
  local: string; slug: string; whatsapp: string; cliente: string; sellos: number; premio: string | null; meta: number | null;
  listo: boolean; puede_sumar: boolean; bloqueo: Bloqueo | null; historial: { fecha: string; cantidad: number }[];
  por_compra?: number; // sellos que suma hoy una compra, según las campañas activas del local (sellos dobles incluidos)
  exige_codigo?: boolean; // el local pide el papelito para pagos en efectivo
  ref?: string | null; cumple_dia?: number | null; cumple_mes?: number | null; // código para invitar amigos y cumpleaños cargado
  hay_cumple?: boolean; hay_referido?: boolean; // el local tiene activos el regalo de cumpleaños y "Traé un amigo"
  niveles?: { nombre: string; costo_sellos: number; alcanzado: boolean }[]; // premios por etapas
  proximo?: { nombre: string; costo_sellos: number; faltan: number } | null;
  sorteo?: { nombre: string; hasta: string; mis_chances: number } | null; // sorteo vigente con permiso confirmado
  tienda?: boolean; // el local tiene catálogo para pedir: la tarjeta muestra el acceso a la tienda
};

/** Link para invitar a un amigo: lleva a la pantalla de registro del local con el código. */
export const linkInvitacion = (slug: string, ref: string, origen = "") => `${origen.replace(/\/$/, "")}/${slug}/club?ref=${encodeURIComponent(ref)}`;
export const mensajeInvitacion = (local: string, link: string) => `¡Hola! Sumate al club de sellos de ${local}. Si te registrás con este link, los dos sumamos sellos: ${link}`;
export const REF_CLUB_RE = /^[A-Z0-9]{4,16}$/;
/** Limpia el código del link (mayúsculas y sin símbolos). Vacío si no sirve. */
export const normalizarRef = (r: string | null | undefined) => { const t = (r ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return REF_CLUB_RE.test(t) ? t : ""; };
export type DatosClub = { nombre: string; slug: string; whatsapp: string; premio: string | null; meta: number | null; por_compra?: number; bienvenida?: number; tienda?: boolean };
export type MedioClub = "efectivo" | "transferencia" | "mercadopago";
export const MEDIOS_CLUB: MedioClub[] = ["efectivo", "transferencia", "mercadopago"];
export const esMedioClub = (m: unknown): m is MedioClub => typeof m === "string" && (MEDIOS_CLUB as string[]).includes(m);
/** Transferencia y Mercado Pago dejan comprobante: el kiosquero los verifica. El efectivo no se puede verificar. */
export const esMedioDigital = (m: string | null | undefined) => m === "transferencia" || m === "mercadopago";
export const nombreMedio = (m: string | null | undefined) => m === "transferencia" ? "transferencia" : m === "mercadopago" ? "Mercado Pago" : m === "efectivo" ? "efectivo" : "";
export type ActividadClub = { evento: string; cliente_id: string; nombre: string; telefono: string; cantidad: number; cuando: string; rechazado: boolean; nuevo: boolean; medio?: MedioClub | null; verificado?: boolean | null };
export type AjustesClub = { club_activo: boolean; club_max_por_dia: number | null; club_espera_min: number | null; club_hora_desde: string | null; club_hora_hasta: string | null };

/** Link de la tienda (catálogo y pedidos) del local. */
export const linkTienda = (slug: string, origen = "") => `${origen.replace(/\/$/, "")}/${slug}`;
/** El QR único del local: lleva al club si está activo (y desde ahí al catálogo); si no, directo a la tienda. */
export const linkQrUnico = (k: { slug: string; club_activo?: boolean }, origen = "") => (k.club_activo === false ? linkTienda(k.slug, origen) : linkClub(k.slug, origen));
export const linkClub = (slug: string, origen = "") => `${origen.replace(/\/$/, "")}/${slug}/club`;
export const linkTarjeta = (token: string, origen = "") => `${origen.replace(/\/$/, "")}/tarjeta/${token}`;

const horaAR = (fecha: Date) => new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" }).format(fecha);

/** Aviso push al kiosquero. Un solo aviso a la vez (tag): si llegan varios seguidos, el último reemplaza al anterior sin hacer ruido de más.
 *  Si el cliente dice que pagó por transferencia o Mercado Pago el aviso es distinto y no se pisa con los demás: hay un comprobante para mirar. */
export function armarAvisoClub(a: { cliente: string; cantidad: number; nuevo: boolean; medio?: string | null }, cuando: Date = new Date()) {
  const n = a.cantidad === 1 ? "un sello" : `${a.cantidad} sellos`;
  if (!a.nuevo && esMedioDigital(a.medio)) {
    return {
      title: `Verificá: ${a.cliente} dice que pagó por ${nombreMedio(a.medio)}`,
      body: `${horaAR(cuando)} · Revisá el comprobante y confirmá el sello. Si no figura, rechazalo.`,
      url: RUTA_CLUB_PANEL, tag: `club-verificar-${a.cliente}`.slice(0, 60),
    };
  }
  return {
    title: a.nuevo ? `${a.cliente} se sumó al club` : `${a.cliente} sumó ${n}`,
    body: `${horaAR(cuando)} · ¿Está en el local? Si no corresponde, rechazalo.`,
    url: RUTA_CLUB_PANEL, tag: "club",
  };
}

/** Lo que promete el QR, siempre según lo que el kiosquero tiene configurado hoy. */
export function textoPromesa(d: { premio: string | null; meta: number | null; por_compra?: number; bienvenida?: number }): string {
  const por = Math.max(0, Math.floor(d.por_compra ?? 0)), bien = Math.max(0, Math.floor(d.bienvenida ?? 0));
  const partes: string[] = [];
  if (por > 0) partes.push(`Cada compra suma ${por} sello${por === 1 ? "" : "s"}.`);
  if (bien > 0) partes.push(`Al crear tu tarjeta te regalamos ${bien} más.`);
  if (d.premio && d.meta) partes.push(`Juntá ${d.meta} y llevate ${d.premio}.`);
  return partes.join(" ");
}

/** Texto para el cliente cuando todavía no puede sumar. */
export function textoBloqueo(b: Bloqueo | null): string {
  if (!b) return "";
  switch (b.codigo) {
    case "club_limite_dia": return "Hoy ya sumaste tu sello. ¡Te esperamos mañana!";
    case "club_espera": return `Todavía no podés sumar otro. Probá ${textoEspera(b.espera_seg ?? 0)}.`;
    case "club_fuera_horario": return "Ahora no se suman sellos. Probá en el horario del local.";
    default: return "El club está en pausa por ahora.";
  }
}

export function textoEspera(seg: number): string {
  const min = Math.max(1, Math.ceil(seg / 60));
  if (min < 60) return `en ${min} minuto${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `en ${h} h ${m} min` : `en ${h} hora${h === 1 ? "" : "s"}`;
}

/** Casillas de la tarjeta: hasta `max` casilleros, llenos los primeros `sellos % meta` (o todos si juntó la meta). */
export function casilleros(sellos: number, meta: number | null, max = 20): { total: number; llenos: number } {
  if (!meta || meta < 1) return { total: 0, llenos: 0 };
  const total = Math.min(meta, max);
  const llenos = sellos >= meta ? total : Math.min(Math.round((sellos / meta) * total), total);
  return { total, llenos };
}

export const faltan = (sellos: number, meta: number | null) => (meta && sellos < meta ? meta - sellos : 0);

/** Mensaje de WhatsApp para mandarle a un cliente el link de su tarjeta. */
export const mensajeTarjeta = (local: string, link: string) => `¡Hola! Esta es tu tarjeta de sellos de ${local}. Abrila después de cada compra y elegí cómo pagaste para sumar tu sello: ${link}`;

/** Aviso por WhatsApp cuando el cliente completó la tarjeta (lo manda el kiosquero con un toque; no hay envío automático). */
export const mensajePremioListo = (nombre: string, local: string, premio: string) =>
  `¡Hola ${nombre.trim().split(/\s+/)[0] || ""}! Completaste tu tarjeta de ${local} y tu premio (${premio}) te espera. Pasá cuando quieras a retirarlo.`.replace("¡Hola !", "¡Hola!");

/** Clientes que ya juntaron los sellos del premio, los que más tienen primero. */
export function conPremioListo<T extends { sellos_disponibles: number; nombre: string }>(lista: T[], meta: number | null): T[] {
  if (!meta || meta < 1) return [];
  return lista.filter((c) => Number(c.sellos_disponibles) >= meta).sort((a, b) => Number(b.sellos_disponibles) - Number(a.sellos_disponibles) || a.nombre.localeCompare(b.nombre, "es"));
}

/** Valida el formulario de registro antes de mandarlo. null = está bien. */
export function validarRegistro(nombre: string, telefono: string): string | null {
  if (nombre.trim().length < 2) return "Escribí tu nombre.";
  const d = telefono.replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return "Revisá tu número de teléfono.";
  return null;
}

/** Valida y convierte los límites del panel a lo que guarda la base. */
export function ajustesDesdeForm(f: { maxDia: string; espera: string; horario: boolean; desde: string; hasta: string; activo: boolean }): { ok: true; datos: AjustesClub } | { ok: false; error: string } {
  const maxDia = f.maxDia === "" ? null : Number(f.maxDia);
  const espera = f.espera === "" ? null : Number(f.espera);
  if (maxDia !== null && (!Number.isInteger(maxDia) || maxDia < 1 || maxDia > 50)) return { ok: false, error: "Los sellos por día tienen que ser entre 1 y 50." };
  if (espera !== null && (!Number.isInteger(espera) || espera < 1 || espera > 1440)) return { ok: false, error: "La espera tiene que ser entre 1 y 1440 minutos." };
  if (f.horario) {
    if (!/^\d{2}:\d{2}$/.test(f.desde) || !/^\d{2}:\d{2}$/.test(f.hasta)) return { ok: false, error: "Completá el horario de inicio y de fin." };
    if (f.desde === f.hasta) return { ok: false, error: "El horario de inicio y de fin no pueden ser iguales." };
  }
  return { ok: true, datos: { club_activo: f.activo, club_max_por_dia: maxDia, club_espera_min: espera, club_hora_desde: f.horario ? f.desde : null, club_hora_hasta: f.horario ? f.hasta : null } };
}

/** El resumen en una frase de lo que está configurado ("1 sello por día"). */
export function resumenLimites(a: AjustesClub): string {
  if (!a.club_activo) return "El club está en pausa.";
  const partes: string[] = [];
  partes.push(a.club_max_por_dia ? `hasta ${a.club_max_por_dia} sello${a.club_max_por_dia === 1 ? "" : "s"} por día` : "sin tope por día");
  if (a.club_espera_min) partes.push(`${a.club_espera_min} min entre sellos`);
  if (a.club_hora_desde && a.club_hora_hasta) partes.push(`solo de ${a.club_hora_desde.slice(0, 5)} a ${a.club_hora_hasta.slice(0, 5)}`);
  const t = partes.join(", ");
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}
