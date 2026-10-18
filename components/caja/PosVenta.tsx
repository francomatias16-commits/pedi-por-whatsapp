"use client";
import { useConfirmar } from "@/components/ui/Confirmar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import FidelidadCaja from "./FidelidadCaja";
import { mensajeFidelidad, pctDePremio, type Premio } from "@/lib/fidelidad";
import { cantidadTexto, fecha, mensajeError, norm, type Cliente, type LineaCarrito, type PagoVenta, type PosConfig, type ProductoPos, type Turno } from "@/lib/caja";
import { DetectorEscaneo } from "@/lib/pos/escaneo";
import { formatoPeso, mismoPlu, parsearBalanza } from "@/lib/pos/balanza";
import { calcularVenta, type Promo } from "@/lib/pos/promos";
import { ColaVentas, type VentaPendiente } from "@/lib/pos/offline";
import { pitido } from "@/lib/pos/sonido";
import { pulsoCajon, ticketEscPos } from "@/lib/pos/escpos";
import { enviarAImpresora } from "@/lib/pos/impresora";
import { peso } from "@/lib/whatsapp";
import Escaner from "../Escaner";
import VincularCelular from "./VincularCelular";
import { useVinculoCelular } from "./useVinculoCelular";
import CobroModal from "./CobroModal";
import CargaStockRapida from "./CargaStockRapida";
import Ticket, { type TicketData } from "./Ticket";

type Espera = { id: number; at: number; lineas: LineaCarrito[]; descPct: string; cliente: Cliente | null };
export type Destino = "movimientos" | "cierre" | "z";

const AYUDA: [string, string][] = [
  ["F1 / 1", "Ayuda: este listado"], ["F2 / 2", "Cobrar"], ["F3 / 3", "Descuento global"], ["F4 / 4", "Nueva venta (vaciar)"],
  ["F5 / 5", "Buscar producto"], ["F6 / 6", "Elegir cliente"], ["F7 / 7", "Movimiento de caja"], ["F8 / 8", "Cerrar caja"],
  ["F9 / 9", "Resumen de la caja"], ["F10 / 0", "Escanear con la cámara"], ["Lector USB", "Escaneá en cualquier momento: suma el producto solo"], ["+ / −", "Cantidad del último ítem"], ["Supr", "Quitar último ítem"],
  ["Enter", "Cobrar / confirmar"], ["Esc", "Cerrar"],
];
const enCampoDeTexto = () => { const a = document.activeElement as HTMLElement | null; return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable); };

export default function PosVenta({ kiosco, turno, productos, favoritos, clientes, promos, config, activo, onVendida, onIr }: {
  kiosco: Kiosco; turno: Turno; productos: ProductoPos[]; favoritos: string[]; clientes: Cliente[]; promos: Promo[]; config: PosConfig;
  activo: boolean; onVendida: () => void; onIr: (d: Destino) => void;
}) {
  const [lineas, setLineas] = useState<LineaCarrito[]>([]);
  const [descPct, setDescPct] = useState("");
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [premio, setPremio] = useState<Premio | null>(null);
  const [avisoFid, setAvisoFid] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [buscaCliente, setBuscaCliente] = useState(false);
  const [filtroCliente, setFiltroCliente] = useState("");
  const [espera, setEspera] = useState<Espera[]>([]);
  const [cobrando, setCobrando] = useState(false);
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [ayuda, setAyuda] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [msg, setMsg] = useState("");
  // Producto que se quedó sin stock en el último intento (ofrece "Cargar stock" sin perder el carrito).
  const [faltante, setFaltante] = useState<ProductoPos | null>(null);
  const [cargando, setCargando] = useState<ProductoPos | null>(null);
  // Stock cargado desde la caja después de la última lectura de productos (la lista del padre todavía no lo tiene).
  const sumadosRef = useRef<Record<string, number>>({});
  useEffect(() => { sumadosRef.current = {}; }, [productos]);
  const [pesando, setPesando] = useState<ProductoPos | null>(null);
  const [gramosTxt, setGramosTxt] = useState("");
  const [pendientes, setPendientes] = useState(0);
  const [rechazadas, setRechazadas] = useState<{ offline_id: string; total: number; motivo: string; fecha: string }[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [online, setOnline] = useState(true);
  const lineasRef = useRef<LineaCarrito[]>([]);
  const detector = useRef(new DetectorEscaneo());
  const diferido = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputGramos = useRef<HTMLInputElement>(null);
  const inputProd = useRef<HTMLInputElement>(null);
  const inputDesc = useRef<HTMLInputElement>(null);
  const inputCli = useRef<HTMLInputElement>(null);

  lineasRef.current = lineas;
  const [verVinculo, setVerVinculo] = useState(false);
  const ocupadoRef = useRef(false);
  const cola = useMemo(() => new ColaVentas(typeof window === "undefined" ? { getItem: () => null, setItem: () => {} } : window.localStorage, `pos-cola:${kiosco.id}`), [kiosco.id]);
  // Premio canjeado: su descuento (en %) reemplaza al manual y se recalcula si cambia el carrito.
  const sinPremio = useMemo(() => calcularVenta(lineas, promos, 0), [lineas, promos]);
  const pctPremio = useMemo(() => {
    if (!premio || premio.tipo === "libre") return 0;
    const l = lineas.find((x) => x.producto_id === premio.producto_id);
    return pctDePremio(premio, sinPremio.total, l?.precio ?? 0, l ? l.precio * l.cantidad : 0);
  }, [premio, lineas, sinPremio.total]);
  const descUsado = premio && premio.tipo !== "libre" ? String(pctPremio) : descPct;
  const calc = useMemo(() => calcularVenta(lineas, promos, Number(descUsado.replace(",", ".")) || 0), [lineas, promos, descUsado]);
  const tot = useMemo(() => ({ subtotal: calc.subtotal, descuento: calc.descuento, total: calc.total, pct: Math.min(100, Math.max(0, Number(descUsado.replace(",", ".")) || 0)) }), [calc, descUsado]);
  useEffect(() => { setPremio(null); if (cliente) setAvisoFid(""); }, [cliente?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refrescarCola = useCallback(() => { setPendientes(cola.pendientes().length); setRechazadas(cola.rechazadas().map((v) => ({ offline_id: v.offline_id, total: v.total, motivo: v.motivo, fecha: v.fecha }))); }, [cola]);
  // Lo vendido sin conexión y aún no sincronizado ya no está disponible en el stock local.
  const stockLibre = useCallback((p: { id: string; stock: number }) => p.stock + (sumadosRef.current[p.id] ?? 0) - (cola.reservado()[p.id] ?? 0), [cola]);
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const favs = useMemo(() => favoritos.map((id) => porId.get(id)).filter((p): p is ProductoPos => !!p && p.disponible), [favoritos, porId]);

  const resultados = useMemo(() => {
    const q = norm(busqueda.trim());
    if (!q) return [];
    return productos.filter((p) => p.disponible && (norm(p.nombre).includes(q) || norm(p.categoria).includes(q) || (p.barcode ?? "").includes(q) || (p.plu ?? "") === q)).slice(0, 8);
  }, [busqueda, productos]);
  const clientesFiltrados = useMemo(() => {
    const q = norm(filtroCliente.trim());
    return clientes.filter((c) => !q || norm(c.nombre).includes(q) || c.telefono.includes(q)).slice(0, 6);
  }, [clientes, filtroCliente]);

  const sonar = useCallback((t: "ok" | "error" | "venta") => { if (config.sonido) pitido(t); }, [config.sonido]);
  const error = useCallback((m: string) => { setMsg(m); sonar("error"); }, [sonar]);

  /** Suma un producto. Por peso: `gramos` (de la balanza o del cuadro de peso); por unidad: 1. */
  const agregar = useCallback((p: ProductoPos, gramos?: number) => {
    setMsg(""); setFaltante(null);
    if (p.vendido_por_peso && !gramos) { setPesando(p); setGramosTxt(""); return; }
    const suma = p.vendido_por_peso ? (gramos as number) : 1;
    const tope = p.vendido_por_peso ? 99999 : 99;
    const libre = stockLibre(p);
    const ls = lineasRef.current;
    const i = ls.findIndex((l) => l.producto_id === p.id);
    const actual = i >= 0 ? ls[i].cantidad : 0;
    if (actual + suma > tope) return error(p.vendido_por_peso ? "Máximo 99,999 kg por producto." : "Máximo 99 unidades por producto.");
    if (p.stock_controlado && !p.permite_sin_stock && actual + suma > libre) { setFaltante(p); return error(`Sin stock suficiente de ${p.nombre} (quedan ${p.vendido_por_peso ? formatoPeso(Math.max(0, libre)) : Math.max(0, libre)}).`); }
    const nuevo = i >= 0
      ? ls.map((l, k) => (k === i ? { ...l, cantidad: l.cantidad + suma } : l))
      : [...ls, { producto_id: p.id, nombre: p.nombre, categoria: p.categoria, precio: p.precio, cantidad: suma, stock_controlado: p.stock_controlado, stock: libre, por_peso: p.vendido_por_peso, descuento_pct: 0, permite_sin_stock: p.permite_sin_stock }];
    lineasRef.current = nuevo; // inmediato: dos lecturas seguidas no se pisan
    setLineas(nuevo);
    sonar("ok");
    setBusqueda("");
    setPesando(null);
  }, [stockLibre, error, sonar]);

  const cambiarCantidad = useCallback((i: number, n: number) => {
    setLineas((ls) => {
      const l = ls[i]; if (!l) return ls;
      if (n < 1) return ls.filter((_, k) => k !== i);
      const maximo = l.por_peso ? 99999 : 99;
      const tope = l.stock_controlado && !l.permite_sin_stock ? Math.min(maximo, l.stock) : maximo;
      if (n > tope) { setMsg(l.stock_controlado && !l.permite_sin_stock && n > l.stock ? `Sin stock suficiente de ${l.nombre}.` : l.por_peso ? "Máximo 99,999 kg por producto." : "Máximo 99 unidades por producto."); return ls; }
      setMsg("");
      return ls.map((x, k) => (k === i ? { ...x, cantidad: n } : x));
    });
  }, []);

  const descuentoLinea = (i: number, v: string) => {
    const n = Math.min(100, Math.max(0, Number(v.replace(",", ".")) || 0));
    setLineas((ls) => ls.map((l, k) => (k === i ? { ...l, descuento_pct: n } : l)));
  };

  const aplicarPremio = (p: Premio) => {
    if (!navigator.onLine) return error("Sin conexión: el canje se hace cuando vuelva internet.");
    if (p.tipo === "producto") {
      const prod = porId.get(p.producto_id ?? "");
      if (!prod || !prod.disponible || prod.vendido_por_peso) return error("El producto del premio no está disponible para canjear en la Caja.");
      if (!lineasRef.current.some((l) => l.producto_id === prod.id)) agregar(prod);
    } else if (!lineasRef.current.length && p.tipo !== "libre") return error("Cargá primero los productos y después canjeá el premio.");
    setAvisoFid(""); setPremio(p); sonar("ok");
  };

  const [ventanaConfirmar, confirmar] = useConfirmar();
  const vaciar = useCallback(async () => {
    if (!lineas.length && !cliente && !descPct) return;
    if (lineas.length && !(await confirmar({ titulo: "¿Vaciar el carrito?", detalle: "Se borran los productos cargados en esta venta.", confirmar: "Sí, vaciar", peligro: true }))) return;
    setLineas([]); setDescPct(""); setCliente(null); setMsg("");
    inputProd.current?.focus();
  }, [lineas.length, cliente, descPct, confirmar]);

  const ponerEnEspera = () => {
    if (!lineas.length) return;
    setEspera((e) => [...e, { id: Date.now(), at: Date.now(), lineas, descPct, cliente }]);
    setLineas([]); setDescPct(""); setCliente(null);
    inputProd.current?.focus();
  };
  const retomar = (id: number) => {
    const e = espera.find((x) => x.id === id); if (!e) return;
    setEspera((es) => {
      const resto = es.filter((x) => x.id !== id);
      return lineas.length ? [...resto, { id: Date.now(), at: Date.now(), lineas, descPct, cliente }] : resto;
    });
    setLineas(e.lineas); setDescPct(e.descPct); setCliente(e.cliente);
  };

  const abrirCobro = useCallback(() => { if (lineas.length && tot.total > 0) setCobrando(true); else if (lineas.length) setMsg("El total es $ 0: revisá el descuento."); }, [lineas.length, tot.total]);

  // Cada venta lleva un offline_id: si la respuesta se pierde y se reintenta, el servidor no la duplica.
  const armarTicket = (numero: number, r: { subtotal: number; descuento: number; total: number; vuelto: number }, pagos: PagoVenta[], pendiente: boolean): TicketData => ({
    numero, pendiente, fecha: fecha(new Date().toISOString()), kioscoNombre: kiosco.nombre, cliente: cliente?.nombre ?? null,
    items: lineas.map((l, i) => ({ nombre: l.nombre, cantidad: l.cantidad, precio_unit: l.precio, por_peso: l.por_peso, importe: calc.lineas[i].bruto })),
    subtotal: r.subtotal, descuento: r.descuento, descuentoPct: tot.pct || undefined, total: r.total, pagos, vuelto: r.vuelto,
    encabezado: config.ticket_encabezado, pie: config.ticket_pie,
  });
  // Ticket automático y cajón: por impresora térmica directa si hay una conectada; si no, el diálogo de impresión del navegador.
  // El cajón solo se abre en ventas con efectivo (con tarjeta o transferencia no hay nada que guardar).
  const salidaVenta = async (t: TicketData, pagos: PagoVenta[]) => {
    const abre = config.abrir_cajon && pagos.some((p) => p.medio === "efectivo");
    if (!config.imprimir_auto && !abre) return;
    const enviado = await enviarAImpresora(config.imprimir_auto ? ticketEscPos(t, config.ticket_ancho, { cajon: abre }) : pulsoCajon());
    if (!enviado && config.imprimir_auto) setTimeout(() => window.print(), 300);
  };
  const terminarVenta = () => { setCobrando(false); setLineas([]); setDescPct(""); setCliente(null); setMsg(""); sonar("venta"); };

  /** Después de cobrar: registra el canje (si hubo) y avisa cuántos sellos ganó el cliente. Si falla, la venta ya está hecha: se avisa. */
  async function cierreFidelidad(cli: Cliente | null, pre: Premio | null, ventaId: string) {
    if (!cli) return;
    const partes: string[] = [];
    if (pre) {
      const { error: e } = await supabase.rpc("fidelidad_canjear", { p_cliente: cli.id, p_premio: pre.id, p_venta: ventaId });
      partes.push(e ? ` No se pudo descontar el canje de "${pre.nombre}" (${mensajeFidelidad(e.message)}). Hacelo desde Sellos.` : `Canje: ${pre.nombre}${pre.tipo === "libre" ? " — entregalo al cliente" : ""}.`);
    }
    const g = await supabase.from("sellos").select("cantidad").eq("venta_id", ventaId).eq("anulado", false);
    const ganados = (g.data ?? []).reduce((a, x) => a + Number(x.cantidad), 0);
    const sd = await supabase.from("clientes_sellos").select("sellos_disponibles").eq("id", cli.id).maybeSingle();
    if (ganados > 0) partes.push(`+${ganados} sello${ganados === 1 ? "" : "s"} para ${cli.nombre}${sd.data ? ` (tiene ${sd.data.sellos_disponibles})` : ""}.`);
    else if (sd.data) partes.push(`${cli.nombre} tiene ${sd.data.sellos_disponibles} sellos.`);
    if (partes.length) setAvisoFid(partes.join(" "));
  }

  async function confirmarCobro(pagos: PagoVenta[]): Promise<string | null> {
    const offlineId = crypto.randomUUID();
    const cliVenta = cliente; const premioVenta = premio;
    const items = lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, descuento_pct: l.descuento_pct }));
    const args = { p_turno: turno.id, p_items: items, p_pagos: pagos, p_cliente: cliente?.id ?? null, p_descuento_pct: tot.pct, p_offline_id: offlineId };
    const guardarSinConexion = () => {
      cola.encolar({ offline_id: offlineId, turno_id: turno.id, fecha: new Date().toISOString(), items, pagos, cliente_id: cliente?.id ?? null, descuento_pct: tot.pct, total: tot.total });
      const efectivo = pagos.filter((p) => p.medio === "efectivo").reduce((a, p) => a + p.monto, 0);
      const vuelto = Math.max(0, Math.round((pagos.reduce((a, p) => a + p.monto, 0) - tot.total) * 100) / 100);
      const t = armarTicket(0, { subtotal: tot.subtotal, descuento: tot.descuento, total: tot.total, vuelto: efectivo > 0 ? vuelto : 0 }, pagos, true);
      setTicket(t); void salidaVenta(t, pagos);
      if (premioVenta) setAvisoFid(` La venta quedó pendiente de sincronizar: canjeá "${premioVenta.nombre}" desde Puntos y premios cuando vuelva internet.`);
      refrescarCola(); terminarVenta();
    };
    if (!navigator.onLine) { guardarSinConexion(); return null; }
    const { data, error: err } = await supabase.rpc("registrar_venta_mostrador", args);
    if (err) {
      // Error de red (sin código de la base): se guarda y se sincroniza después. Un error de negocio se muestra tal cual.
      if (!(err as { code?: string }).code) { guardarSinConexion(); return null; }
      return mensajeError(err.message);
    }
    const r = data as { venta_id: string; numero: number; subtotal: number; descuento: number; total: number; vuelto: number };
    const t = armarTicket(Number(r.numero), { subtotal: Number(r.subtotal), descuento: Number(r.descuento), total: Number(r.total), vuelto: Number(r.vuelto) }, pagos, false);
    setTicket(t); void salidaVenta(t, pagos);
    terminarVenta();
    onVendida();
    void cierreFidelidad(cliVenta, premioVenta, r.venta_id);
    return null;
  }

  const sincronizar = useCallback(async () => {
    if (sincronizando || !cola.pendientes().length) return;
    setSincronizando(true);
    const r = await cola.sincronizar(async (v: VentaPendiente) => {
      const { error: err } = await supabase.rpc("registrar_venta_mostrador", {
        p_turno: v.turno_id, p_items: v.items, p_pagos: v.pagos, p_cliente: v.cliente_id, p_descuento_pct: v.descuento_pct, p_offline_id: v.offline_id, p_fecha: v.fecha,
      });
      if (!err) return { ok: true as const };
      const hayCodigo = !!(err as { code?: string }).code;
      return { ok: false as const, definitivo: hayCodigo, mensaje: mensajeError(err.message) };
    });
    setSincronizando(false);
    refrescarCola();
    if (r.enviadas > 0) onVendida();
  }, [cola, sincronizando, refrescarCola, onVendida]);

  useEffect(() => {
    refrescarCola(); setOnline(navigator.onLine);
    const on = () => { setOnline(true); void sincronizar(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    const iv = setInterval(() => { if (navigator.onLine) void sincronizar(); }, 30000);
    void sincronizar();
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Un código leído (cámara, lector USB o tipeado + Enter): balanza → código de barras → PLU. */
  const procesarCodigo = useCallback((codigoCrudo: string) => {
    const codigo = codigoCrudo.trim();
    if (!codigo) return;
    const bal = parsearBalanza(codigo);
    if (bal) {
      const p = productos.find((x) => x.disponible && x.vendido_por_peso && mismoPlu(x.plu, bal.plu));
      if (p) return agregar(p, bal.gramos);
      return error(`La etiqueta de balanza (PLU ${bal.plu}) no coincide con ningún producto por peso.`);
    }
    const porBarcode = productos.find((x) => x.barcode === codigo && x.disponible);
    if (porBarcode) return agregar(porBarcode);
    const porPlu = /^\d{1,6}$/.test(codigo) ? productos.find((x) => x.disponible && x.vendido_por_peso && mismoPlu(x.plu, codigo)) : undefined;
    if (porPlu) return agregar(porPlu);
    error(`No encontramos un producto con el código ${codigo}.`);
  }, [productos, agregar, error]);

  const alEscanear = (codigo: string) => { setEscaneando(false); procesarCodigo(codigo); };

  // Código que llega del celular vinculado: mismo camino que el lector USB. Si hay una ventana de acción abierta (cobro,
  // peso, ayuda) se avisa y no se suma; el ticket ya impreso sí se cierra solo para no trabar al cliente siguiente.
  ocupadoRef.current = cobrando || escaneando || ayuda || !!pesando;
  const recibirRemoto = useCallback((codigo: string) => {
    if (!activo) return;
    if (ocupadoRef.current) return error("Terminá lo que tenés abierto en la caja para sumar productos desde el celular.");
    setTicket(null); setBusqueda(""); procesarCodigo(codigo);
  }, [activo, error, procesarCodigo]);
  const vinculo = useVinculoCelular({ kioscoId: kiosco.id, onCodigo: recibirRemoto });

  // Lector USB: escucha ANTES que los atajos (fase de captura). Una ráfaga rápida de teclas + Enter es un escaneo y
  // no dispara atajos ni se escribe en pantalla; el tipeo humano pasa tal cual.
  useEffect(() => {
    if (!activo) return;
    const libre = () => !(cobrando || ticket || escaneando || ayuda || pesando);
    const timer = { v: null as ReturnType<typeof setTimeout> | null };
    const h = (e: KeyboardEvent) => {
      if (!libre() || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = enCampoDeTexto() ? (document.activeElement as HTMLElement) : null;
      // En otros campos (descuento, cliente) no se interpreta: solo en el buscador o sin foco.
      if (t && t !== inputProd.current) return;
      const r = detector.current.feed(e.key, e.timeStamp);
      if (r.tipo === "escaneo") {
        e.preventDefault(); e.stopImmediatePropagation();
        if (diferido.current) clearTimeout(diferido.current);
        setBusqueda(""); procesarCodigo(r.codigo);
      } else if (r.tipo === "rafaga") {
        e.preventDefault(); e.stopImmediatePropagation();
        if (diferido.current) clearTimeout(diferido.current);
        if (timer.v) clearTimeout(timer.v);
        // Lectores sin Enter final: si se corta la ráfaga, se toma igual.
        timer.v = setTimeout(() => { const c = detector.current.vaciar(performance.now() + 1000); if (c) { setBusqueda(""); procesarCodigo(c); } }, 150);
      }
    };
    window.addEventListener("keydown", h, true);
    return () => { window.removeEventListener("keydown", h, true); if (timer.v) clearTimeout(timer.v); };
  }, [activo, cobrando, ticket, escaneando, ayuda, pesando, procesarCodigo]);

  // Atajos de teclado: cada acción tiene F-tecla y dígito (en notebooks la fila F suele ser multimedia).
  useEffect(() => {
    if (!activo) return;
    const h = (e: KeyboardEvent) => {
      if (cobrando || ticket || escaneando || pesando) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const es = (f: string, d: string) => { if (e.key === f) return true; return e.key === d && !enCampoDeTexto(); };
      // Un dígito suelto podría ser la primera tecla de un escaneo: se espera un instante antes de tratarlo como atajo.
      const hacer = (fn: () => void) => {
        e.preventDefault();
        if (/^\d$/.test(e.key) && !enCampoDeTexto()) { if (diferido.current) clearTimeout(diferido.current); diferido.current = setTimeout(fn, 90); return; }
        fn();
      };
      if (ayuda) { if (e.key === "Escape" || e.key === "Enter" || es("F1", "1")) hacer(() => setAyuda(false)); return; }
      if (es("F1", "1")) return hacer(() => setAyuda(true));
      if (es("F2", "2")) return hacer(abrirCobro);
      if (es("F3", "3")) return hacer(() => { if (lineas.length) inputDesc.current?.focus(); });
      if (es("F4", "4")) return hacer(vaciar);
      if (es("F5", "5")) return hacer(() => inputProd.current?.focus());
      if (es("F6", "6")) return hacer(() => { setBuscaCliente(true); setTimeout(() => inputCli.current?.focus(), 0); });
      if (es("F7", "7")) return hacer(() => onIr("movimientos"));
      if (es("F8", "8")) return hacer(() => onIr("cierre"));
      if (es("F9", "9")) return hacer(() => onIr("z"));
      if (es("F10", "0")) return hacer(() => setEscaneando(true));
      if (enCampoDeTexto()) return;
      if ((e.key === "+" || e.key === "-") && lineas.length) return hacer(() => cambiarCantidad(lineas.length - 1, lineas[lineas.length - 1].cantidad + (e.key === "+" ? 1 : -1) * (lineas[lineas.length - 1].por_peso ? 100 : 1)));
      if ((e.key === "Delete" || e.key === "Backspace") && lineas.length) return hacer(() => cambiarCantidad(lineas.length - 1, 0));
      if (e.key === "Enter" && lineas.length) return hacer(abrirCobro);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [activo, cobrando, ticket, escaneando, ayuda, pesando, lineas, abrirCobro, vaciar, cambiarCantidad, onIr]);

  const onEnterBusqueda = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); e.stopPropagation();
    const q = busqueda.trim();
    if (!q) { if (lineas.length) abrirCobro(); return; }
    const hayCodigo = !!parsearBalanza(q) || productos.some((p) => p.barcode === q || (p.vendido_por_peso && mismoPlu(p.plu, q)));
    if (hayCodigo) return procesarCodigo(q);
    if (resultados.length) agregar(resultados[0]); else error("No encontramos ese producto.");
  };

  const hace = (at: number) => { const m = Math.max(0, Math.round((Date.now() - at) / 60000)); return m < 1 ? "recién" : `hace ${m} min`; };

  return (
    <div className="pos-venta">
      {ventanaConfirmar}
      <div className="pos-izq card">
        <div className="pos-buscador">
          <div className="pos-busqueda-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input ref={inputProd} autoFocus value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setMsg(""); }} onKeyDown={onEnterBusqueda}
              placeholder="Código de barras o nombre del producto…" aria-label="Buscar producto" autoComplete="off" />
          </div>
          <button type="button" className="sec" onClick={() => setEscaneando(true)} title="Escanear con la cámara (F10 o 0)">Cámara</button>
          <button type="button" className="sec" onClick={() => { vinculo.vincular(); setVerVinculo(true); }} title="Usar el celular como lector de códigos de barras"
            style={vinculo.estado === "conectado" ? { borderColor: "var(--ok)", color: "var(--ok)" } : undefined}>
            {vinculo.estado === "conectado" ? "Celular conectado" : vinculo.estado === "esperando" ? "Vinculando…" : "Vincular celular"}
          </button>
          {resultados.length > 0 && (
            <div className="pos-resultados" role="listbox">
              {resultados.map((p) => (
                <button type="button" key={p.id} className="pos-resultado" onClick={() => agregar(p)}>
                  <span>{p.nombre}<small className="mut"> · {p.categoria}</small></span>
                  <span className="mono">{peso(p.precio)}{p.stock_controlado && <small className="mut"> · stock {p.stock}</small>}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {msg && <p className="pos-error" role="alert">{msg}</p>}
        {faltante && !cargando && <button className="sec" style={{ marginBottom: 8 }} onClick={() => setCargando(faltante)}>Cargar stock de {faltante.nombre} ahora</button>}
        {favs.length > 0 && (
          <div className="pos-favoritos" aria-label="Favoritos">
            {favs.map((p) => (<button type="button" key={p.id} className="pos-fav" onClick={() => agregar(p)}><span>{p.nombre}</span><b className="mono">{peso(p.precio)}</b></button>))}
          </div>
        )}
        <div className="pos-tabla" role="table" aria-label="Detalle del ticket">
          <div className="pos-tabla-head" aria-hidden="true"><span>#</span><span>Producto</span><span>Cantidad</span><span>Precio</span><span>Importe</span><span /></div>
          {lineas.length === 0 ? (
            <div className="pos-vacio"><strong>Escaneá un producto para empezar</strong><span>O buscalo por nombre o código en el campo de arriba.</span></div>
          ) : lineas.map((l, i) => (
            <div className="pos-linea" key={l.producto_id} role="row">
              <span className="mut">{i + 1}</span>
              <span>{l.nombre}{l.stock_controlado && <small className="mut"> · stock {l.por_peso ? formatoPeso(Math.max(0, l.stock)) : Math.max(0, l.stock)}</small>}
                {calc.lineas[i]?.promo_nombre && <small className="pos-promo"> · {calc.lineas[i].promo_nombre} −{peso(calc.lineas[i].promo)}</small>}
                <small className="mut pos-dto-linea"> · Dto % <input type="number" min={0} max={100} step={1} inputMode="decimal" value={l.descuento_pct || ""} placeholder="0" aria-label={`Descuento de ${l.nombre}`} style={{ width: "4.2rem", minHeight: 0, padding: ".1rem .3rem" }}
                  onChange={(e) => descuentoLinea(i, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); inputProd.current?.focus(); } }} /></small></span>
              <span className="qty">
                <button type="button" className="sec" onClick={() => cambiarCantidad(i, l.cantidad - (l.por_peso ? 100 : 1))} aria-label="Menos">−</button>
                <b>{cantidadTexto(l.cantidad, l.por_peso)}</b>
                <button type="button" className="sec" onClick={() => cambiarCantidad(i, l.cantidad + (l.por_peso ? 100 : 1))} aria-label="Más">+</button>
              </span>
              <span className="mono">{peso(l.precio)}{l.por_peso && <small className="mut">/kg</small>}</span>
              <b className="mono">{peso(calc.lineas[i]?.linea ?? 0)}</b>
              <button type="button" className="sec pos-x" onClick={() => cambiarCantidad(i, 0)} aria-label={`Quitar ${l.nombre}`}>✕</button>
            </div>
          ))}
        </div>
      </div>

      <div className="pos-der">
        {espera.length > 0 && (
          <div className="pos-espera card" aria-label="Ventas en espera">
            <p className="pos-kicker">En espera</p>
            {espera.map((e, i) => (<button type="button" className="sec" key={e.id} onClick={() => retomar(e.id)}>Venta {i + 1} · {hace(e.at)}</button>))}
          </div>
        )}
        <div className="pos-totales">
          <div className="row"><span>Subtotal</span><span className="mono">{peso(tot.subtotal)}</span></div>
          {calc.descPromos > 0 && <div className="row"><span>Promociones</span><span className="mono">−{peso(calc.descPromos)}</span></div>}
          {calc.descLineas > 0 && <div className="row"><span>Descuentos por renglón</span><span className="mono">−{peso(calc.descLineas)}</span></div>}
          {calc.descGlobal > 0 && <div className="row"><span>Descuento {tot.pct}%</span><span className="mono">−{peso(calc.descGlobal)}</span></div>}
          {lineas.length > 0 && (
            <label className="pos-desc">Descuento global (%)
              <input ref={inputDesc} type="number" min={0} max={100} step={1} inputMode="decimal" placeholder="0" value={descPct}
                onChange={(e) => setDescPct(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); inputProd.current?.focus(); } }} />
            </label>
          )}
          <div className="pos-total-grande"><span>Total</span><b className="mono">{peso(tot.total)}</b></div>
          <button type="button" className="pos-cobrar" onClick={abrirCobro} disabled={!lineas.length}><span>Cobrar</span><kbd>F2</kbd></button>
          <div className="pos-acciones">
            <button type="button" className="sec" onClick={vaciar} disabled={!lineas.length && !cliente}>Nueva venta <kbd>F4</kbd></button>
            <button type="button" className="sec" onClick={ponerEnEspera} disabled={!lineas.length} title="Guarda esta venta para retomarla después">En espera</button>
            <button type="button" className="sec" onClick={() => inputDesc.current?.focus()} disabled={!lineas.length}>Descuento <kbd>F3</kbd></button>
          </div>
        </div>

        <div className="card pos-cliente">
          <p className="pos-kicker">Datos del cliente</p>
          <div className="row">
            <span><span className="mut">Cliente </span><b>{cliente?.nombre ?? "Consumidor final"}</b></span>
            <span className="pos-cli-acc">
              <button type="button" className="sec" onClick={() => { setBuscaCliente((v) => !v); setTimeout(() => inputCli.current?.focus(), 0); }} title="Atajo: F6 o 6">Elegir cliente</button>
              {cliente && <button type="button" className="sec" onClick={() => setCliente(null)}>Quitar</button>}
            </span>
          </div>
          {cliente && <p className="mut pos-saldo">Saldo en cuenta corriente: <b className={cliente.saldo > 0 ? "neg" : "ok"}>{peso(cliente.saldo)}</b></p>}
          {cliente && <FidelidadCaja kiosco={kiosco} cliente={cliente} aplicado={premio} pct={pctPremio} descuento={Math.max(0, calc.descuento - sinPremio.descuento)} online={online} onAplicar={aplicarPremio} onQuitar={() => setPremio(null)} />}
          {avisoFid && <p role="status" className="pos-saldo" style={{ margin: ".4rem 0 0" }}><b>{avisoFid}</b></p>}
          {buscaCliente && (
            <div className="pos-cli-buscar">
              <input ref={inputCli} value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)} placeholder="Buscar por nombre o teléfono…" aria-label="Buscar cliente" autoComplete="off"
                onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setBuscaCliente(false); } if (e.key === "Enter" && clientesFiltrados[0]) { e.preventDefault(); setCliente(clientesFiltrados[0]); setBuscaCliente(false); setFiltroCliente(""); inputProd.current?.focus(); } }} />
              {clientesFiltrados.map((c) => (
                <button type="button" className="pos-resultado" key={c.id} onClick={() => { setCliente(c); setBuscaCliente(false); setFiltroCliente(""); }}>
                  <span>{c.nombre}<small className="mut"> · {c.telefono}</small></span><span className="mono">{peso(c.saldo)}</span>
                </button>
              ))}
              {clientesFiltrados.length === 0 && <p className="mut">Sin resultados. Los clientes se crean desde un pedido o en Fiado.</p>}
            </div>
          )}
        </div>

        <div className="card pos-info">
          <div className="row"><span className="mut">Fecha</span><b>{fecha(new Date().toISOString())}</b></div>
          <div className="row"><span className="mut">Comprobante</span><b>Ticket</b></div>
          <div className="row"><span className="mut">Caja abierta</span><b>{fecha(turno.abierto_at)}</b></div>
          <button type="button" className="pos-cerrar" onClick={() => onIr("cierre")} title="Atajo: F8 o 8">Cerrar caja <kbd>F8</kbd></button>
        </div>
      </div>

      <div className="pos-hints" aria-hidden="true">
        {AYUDA.slice(1, 8).map(([k, v]) => (<span key={k}><kbd>{k}</kbd> {v}</span>))}
        <span><kbd>F1</kbd> Ayuda</span>
      </div>

      {(!online || pendientes > 0 || rechazadas.length > 0) && (
        <div className="pos-offline card" role="status" style={{ gridColumn: "1 / -1" }}>
          {!online && <b>Sin conexión. </b>}
          {!online && <span>Podés seguir vendiendo: las ventas se guardan en este equipo y se envían solas al volver internet. </span>}
          {pendientes > 0 && <span><b>{pendientes}</b> {pendientes === 1 ? "venta pendiente" : "ventas pendientes"} de enviar. <button type="button" className="sec" onClick={() => void sincronizar()} disabled={sincronizando || !online}>{sincronizando ? "Enviando…" : "Sincronizar ahora"}</button></span>}
          {rechazadas.map((r) => (
            <p className="pos-error" key={r.offline_id}>La venta de {fecha(r.fecha)} por {peso(r.total)} no se pudo registrar: {r.motivo}{" "}
              <button type="button" className="sec" onClick={() => { cola.descartarRechazada(r.offline_id); refrescarCola(); }}>Entendido, descartar</button></p>
          ))}
        </div>
      )}
      {pesando && (
        <div className="pos-overlay" role="dialog" aria-modal="true" aria-label="Peso del producto" onClick={() => setPesando(null)}>
          <div className="pos-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pos-modal-head"><h2>{pesando.nombre}</h2><button className="sec pos-x" onClick={() => setPesando(null)} aria-label="Cerrar">✕</button></div>
            <p className="mut">{peso(pesando.precio)} por kg. Ingresá el peso en gramos.</p>
            <input ref={inputGramos} autoFocus type="number" min={1} max={99999} step={1} inputMode="numeric" placeholder="Gramos (ej. 350)" aria-label="Peso en gramos" value={gramosTxt}
              onChange={(e) => setGramosTxt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setPesando(null); } if (e.key === "Enter") { e.preventDefault(); const g = Math.round(Number(gramosTxt)); if (g >= 1 && g <= 99999) agregar(pesando, g); else error("Ingresá un peso entre 1 y 99.999 g."); } }} />
            {Number(gramosTxt) > 0 && <p className="mono">{formatoPeso(Number(gramosTxt))} = {peso(Math.round(pesando.precio * Number(gramosTxt)) / 1000)}</p>}
            <div className="pos-modal-acciones"><button className="sec" onClick={() => setPesando(null)}>Cancelar <kbd>Esc</kbd></button>
              <button onClick={() => { const g = Math.round(Number(gramosTxt)); if (g >= 1 && g <= 99999) agregar(pesando, g); else error("Ingresá un peso entre 1 y 99.999 g."); }}>Agregar <kbd>Enter</kbd></button></div>
          </div>
        </div>
      )}
      {cargando && (
        <CargaStockRapida kioscoId={kiosco.id} producto={cargando} onCancelar={() => setCargando(null)}
          onCargado={(cant) => {
            const p = cargando;
            sumadosRef.current[p.id] = (sumadosRef.current[p.id] ?? 0) + cant;
            setLineas((ls) => ls.map((l) => (l.producto_id === p.id ? { ...l, stock: l.stock + cant } : l)));
            setCargando(null); setFaltante(null);
            agregar(p); // vuelve al carrito; por peso abre el cuadro de peso
          }} />
      )}
      {cobrando && <CobroModal total={tot.total} cliente={cliente} onCancelar={() => { setCobrando(false); inputProd.current?.focus(); }} onConfirmar={confirmarCobro} />}
      {ticket && <Ticket t={ticket} ancho={config.ticket_ancho} onCerrar={() => { setTicket(null); setTimeout(() => inputProd.current?.focus(), 0); }} />}
      {verVinculo && <VincularCelular estado={vinculo.estado} url={vinculo.url} error={vinculo.error} ultimo={vinculo.ultimo}
        onCerrarVinculo={() => { vinculo.cerrar(); setVerVinculo(false); }} onOcultar={() => { setVerVinculo(false); setTimeout(() => inputProd.current?.focus(), 0); }} />}
      {escaneando && <Escaner onCode={alEscanear} onClose={() => setEscaneando(false)} />}
      {ayuda && (
        <div className="pos-overlay" role="dialog" aria-modal="true" aria-label="Atajos de teclado" onClick={() => setAyuda(false)}>
          <div className="pos-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pos-modal-head"><h2>Atajos de teclado</h2><button className="sec pos-x" onClick={() => setAyuda(false)} aria-label="Cerrar">✕</button></div>
            <div className="pos-ayuda">{AYUDA.map(([k, v]) => (<div className="row" key={k}><kbd>{k}</kbd><span>{v}</span></div>))}</div>
            <p className="mut">Cada acción tiene dos teclas: en varias notebooks la fila F1–F12 es multimedia.</p>
          </div>
        </div>
      )}
    </div>
  );
}
