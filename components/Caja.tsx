"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { CONFIG_POR_DEFECTO, fecha, mensajeError, normalizarResumen, num, type Cliente, type PosConfig, type ProductoPos, type Resumen, type Turno } from "@/lib/caja";
import type { Promo } from "@/lib/pos/promos";
import { peso } from "@/lib/whatsapp";
import PosVenta, { type Destino } from "./caja/PosVenta";
import VentasTurno from "./caja/VentasTurno";
import Movimientos from "./caja/Movimientos";
import CierreCaja from "./caja/CierreCaja";
import Historial from "./caja/Historial";
import Favoritos from "./caja/Favoritos";
import BuscarVentas from "./caja/BuscarVentas";
import Promos from "./caja/Promos";
import ConfigPos from "./caja/ConfigPos";
import { reconectarImpresora } from "@/lib/pos/impresora";

type Seccion = "venta" | "ventas" | "buscar" | "movimientos" | "cierre" | "favoritos" | "promos" | "historial" | "config";
// Lo de todos los días a la vista; lo ocasional queda en "Más".
const PRINCIPALES: [Seccion, string][] = [["venta", "Vender"], ["ventas", "Ventas de hoy"], ["movimientos", "Plata"], ["cierre", "Cerrar caja"]];
const EN_MAS: [Seccion, string][] = [["buscar", "Buscar una venta"], ["favoritos", "Atajos"], ["promos", "Ofertas"], ["historial", "Cajas anteriores"], ["config", "Impresora y ajustes"]];

const aTurno = (t: Turno): Turno => ({
  ...t, monto_inicial: Number(t.monto_inicial),
  monto_final_declarado: t.monto_final_declarado == null ? null : Number(t.monto_final_declarado),
  monto_final_calculado: t.monto_final_calculado == null ? null : Number(t.monto_final_calculado),
  diferencia: t.diferencia == null ? null : Number(t.diferencia),
});

// Caja = punto de venta completo: apertura de caja, venta con cobro mixto, movimientos, cierre y reporte Z.
export default function Caja({ kiosco }: { kiosco: Kiosco }) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [productos, setProductos] = useState<ProductoPos[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [config, setConfig] = useState<PosConfig>(CONFIG_POR_DEFECTO);
  const [seccion, setSeccion] = useState<Seccion>("venta");
  const [fondo, setFondo] = useState("");
  const [msg, setMsg] = useState("");
  const [aviso, setAviso] = useState("");
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [refresco, setRefresco] = useState(0);
  const [masAbierto, setMasAbierto] = useState(false);

  const turno = useMemo(() => turnos.find((t) => t.estado === "abierto") ?? null, [turnos]);

  const cargarTurnos = useCallback(async () => {
    const { data, error } = await supabase.from("turnos_caja").select("*").eq("kiosco_id", kiosco.id).order("abierto_at", { ascending: false }).limit(30);
    if (error) { setMsg("No pudimos cargar la caja."); return; }
    setTurnos((data ?? []).map((t) => aTurno(t as Turno)));
    setCargando(false);
  }, [kiosco.id]);

  const cargarCatalogo = useCallback(async () => {
    const [p, c, f, pm, cf] = await Promise.all([
      supabase.from("productos").select("id,nombre,categoria,precio,barcode,stock,stock_controlado,disponible,vendido_por_peso,plu,permite_sin_stock").eq("kiosco_id", kiosco.id).order("nombre"),
      supabase.from("clientes_saldo").select("id,nombre,telefono,saldo").eq("kiosco_id", kiosco.id).order("nombre"),
      supabase.from("pos_favoritos").select("producto_id,orden").eq("kiosco_id", kiosco.id).order("orden"),
      supabase.from("pos_promos").select("id,nombre,tipo,producto_id,categoria,lleva,paga,pct,desde,hasta,activa").eq("kiosco_id", kiosco.id).eq("activa", true),
      supabase.from("pos_config").select("sonido,imprimir_auto,abrir_cajon,ticket_encabezado,ticket_pie,ticket_ancho,tiene_pin,pin_anular,pin_devolucion").eq("kiosco_id", kiosco.id).maybeSingle(),
    ]);
    if (pm.data) setPromos(pm.data.map((x) => ({ ...x, pct: x.pct == null ? null : Number(x.pct) })) as Promo[]);
    if (cf.data) setConfig({ ...CONFIG_POR_DEFECTO, ...(cf.data as Partial<PosConfig>) });
    if (p.data) setProductos(p.data.map((x) => ({ ...x, precio: Number(x.precio), stock: Number(x.stock ?? 0), stock_controlado: !!x.stock_controlado, vendido_por_peso: !!x.vendido_por_peso, permite_sin_stock: !!x.permite_sin_stock, plu: x.plu ?? null })) as ProductoPos[]);
    if (c.data) setClientes(c.data.map((x) => ({ ...x, saldo: Number(x.saldo) })) as Cliente[]);
    if (f.data) setFavoritos(f.data.map((x) => x.producto_id as string));
  }, [kiosco.id]);

  const cargarResumen = useCallback(async () => {
    if (!turno) { setResumen(null); return; }
    const { data, error } = await supabase.rpc("caja_resumen", { p_turno: turno.id });
    if (!error && data) setResumen(normalizarResumen(data as Resumen));
    setRefresco((n) => n + 1);
  }, [turno]);

  useEffect(() => { void cargarTurnos(); void cargarCatalogo(); }, [cargarTurnos, cargarCatalogo]);
  useEffect(() => { void cargarResumen(); }, [cargarResumen]);
  useEffect(() => { void reconectarImpresora(); }, []);

  const alCambio = useCallback(async () => { await Promise.all([cargarResumen(), cargarCatalogo()]); }, [cargarResumen, cargarCatalogo]);
  const irA = useCallback((d: Destino) => setSeccion(d === "z" ? "cierre" : d), []);

  async function abrir() {
    setMsg(""); setAviso("");
    const m = num(fondo);
    if (fondo.trim() === "" || m < 0) return setMsg("Indicá el efectivo con el que arrancás (puede ser 0).");
    setOcupado(true);
    const { error } = await supabase.rpc("caja_abrir_turno", { p_kiosco: kiosco.id, p_monto_inicial: m });
    setOcupado(false);
    if (error) return setMsg(mensajeError(error.message));
    setFondo(""); setSeccion("venta"); await cargarTurnos();
  }

  async function alCerrar() {
    const t = turno;
    await cargarTurnos();
    const { data } = await supabase.from("turnos_caja").select("*").eq("id", t?.id ?? "").maybeSingle();
    const c = data ? aTurno(data as Turno) : null;
    setAviso(c ? `Caja cerrada. Esperado ${peso(c.monto_final_calculado ?? 0)}, contado ${peso(c.monto_final_declarado ?? 0)}: ${(c.diferencia ?? 0) === 0 ? "cuadra." : (c.diferencia ?? 0) > 0 ? `sobran ${peso(c.diferencia ?? 0)}.` : `faltan ${peso(Math.abs(c.diferencia ?? 0))}.`}` : "Caja cerrada.");
    setSeccion("venta");
  }

  if (cargando) return <p>Cargando caja…</p>;

  // ───────── Sin caja abierta: pantalla de apertura ─────────
  if (!turno) {
    return (
      <div className="caja-apertura">
        <div className="card">
          <h2 className="pos-titulo">Abrir caja</h2>
          <p className="mut">Indicá el efectivo con el que empezás para arrancar a vender.</p>
          {aviso && <p className="pos-aviso" role="status">{aviso}</p>}
          <label>Plata con la que arrancás (efectivo en caja)
            <input type="number" inputMode="decimal" min={0} step={1} autoFocus value={fondo} onChange={(e) => setFondo(e.target.value)} placeholder="0"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void abrir(); } }} />
          </label>
          {msg && <p className="pos-error" role="alert">{msg}</p>}
          <button onClick={abrir} disabled={ocupado}>{ocupado ? "Abriendo…" : "Abrir caja y empezar a vender"}</button>
        </div>
        <h3 className="pos-sub">Cajas anteriores</h3>
        <Historial kiosco={kiosco} turnos={turnos} />
      </div>
    );
  }

  // ───────── Con caja abierta ─────────
  return (
    <div className="caja">
      <div className="caja-barra">
        <span className="caja-estado"><i aria-hidden="true" /> Caja abierta · desde {fecha(turno.abierto_at)} · arrancaste con {peso(turno.monto_inicial)}</span>
        <nav className="pos-tabs" aria-label="Secciones de la caja">
          {PRINCIPALES.map(([k, label]) => (<button key={k} className={seccion === k ? "on" : ""} aria-current={seccion === k ? "page" : undefined} onClick={() => { setSeccion(k); setMasAbierto(false); }}>{label}</button>))}
          <button type="button" className={EN_MAS.some(([k]) => k === seccion) || masAbierto ? "on" : ""} aria-expanded={masAbierto} onClick={() => setMasAbierto((v) => !v)}>Más ▾</button>
        </nav>
        {masAbierto && (
          <div className="pos-mas" role="group" aria-label="Más opciones de la caja">
            {EN_MAS.map(([k, label]) => (<button key={k} type="button" className={seccion === k ? "on" : "sec"} onClick={() => { setSeccion(k); setMasAbierto(false); }}>{label}</button>))}
          </div>
        )}
      </div>
      {msg && <p className="pos-error" role="alert">{msg}</p>}
      {/* El POS queda montado (oculto) para no perder el carrito al cambiar de sección. */}
      <div hidden={seccion !== "venta"}>
        {aviso && <p className="pos-aviso" role="status">{aviso}</p>}
        <PosVenta kiosco={kiosco} turno={turno} productos={productos} favoritos={favoritos} clientes={clientes} promos={promos} config={config}
          activo={seccion === "venta"} onVendida={alCambio} onIr={irA} />
      </div>
      {seccion === "ventas" && resumen && <VentasTurno kiosco={kiosco} resumen={resumen} abierto config={config} onCambio={alCambio} />}
      {seccion === "buscar" && <BuscarVentas kiosco={kiosco} config={config} turnoAbierto onCambio={alCambio} />}
      {seccion === "movimientos" && resumen && <Movimientos resumen={resumen} turnoId={turno.id} abierto onCambio={alCambio} />}
      {seccion === "cierre" && <CierreCaja kiosco={kiosco} turnoId={turno.id} refresco={refresco} onCerrada={alCerrar} />}
      {seccion === "favoritos" && <Favoritos kiosco={kiosco} productos={productos} favoritos={favoritos} onCambio={cargarCatalogo} />}
      {seccion === "promos" && <Promos kiosco={kiosco} productos={productos} promos={promos} onCambio={cargarCatalogo} />}
      {seccion === "historial" && <Historial kiosco={kiosco} turnos={turnos} />}
      {seccion === "config" && <ConfigPos kiosco={kiosco} config={config} onCambio={cargarCatalogo} />}
    </div>
  );
}
