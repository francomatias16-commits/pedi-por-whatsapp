"use client";
import { useConfirmar } from "@/components/ui/Confirmar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { linkWhatsApp, normalizarTelefonoAR } from "@/lib/whatsapp";
import { describirPremio, mensajeFidelidad, type Campana, type Premio } from "@/lib/fidelidad";

type Cli = { id: string; nombre: string; telefono: string; sellos_disponibles: number; vence_at: string | null };
type Mov = { clave: string; fecha: string; texto: string; sello_id?: string; anulado: boolean; canje_id?: string };
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const fecha = (s: string) => new Date(s).toLocaleDateString("es-AR");

export default function ClientesSellos({ kiosco, campanas, premios }: { kiosco: Kiosco; campanas: Campana[]; premios: Premio[] }) {
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const [lista, setLista] = useState<Cli[]>([]);
  const [busca, setBusca] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [msg, setMsg] = useState("");
  const [tel, setTel] = useState(""); const [nombre, setNombre] = useState(""); const [accion, setAccion] = useState("");
  const [ajuste, setAjuste] = useState<{ id: string; cant: string; motivo: string } | null>(null);

  const manuales = useMemo(() => campanas.filter((c) => c.tipo === "manual" && c.activa), [campanas]);
  const activos = useMemo(() => premios.filter((p) => p.activo).sort((a, b) => a.costo_sellos - b.costo_sellos), [premios]);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from("clientes_sellos").select("id,nombre,telefono,sellos_disponibles,vence_at").eq("kiosco_id", kiosco.id).order("sellos_disponibles", { ascending: false }).order("nombre").limit(500);
    setLista(((data ?? []) as Cli[]).map((c) => ({ ...c, sellos_disponibles: Number(c.sellos_disponibles) })));
  }, [kiosco.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const q = norm(busca.trim());
    return lista.filter((c) => (q ? norm(c.nombre).includes(q) || c.telefono.includes(q) : c.sellos_disponibles > 0)).slice(0, 60);
  }, [lista, busca]);

  async function historial(id: string) {
    const [s, c] = await Promise.all([
      supabase.from("sellos").select("id,origen,cantidad,motivo,anulado,created_at,fidelidad_campanas(nombre)").eq("cliente_id", id).order("created_at", { ascending: false }).limit(20),
      supabase.from("canjes").select("id,premio_nombre,sellos,anulado,created_at").eq("cliente_id", id).order("created_at", { ascending: false }).limit(10),
    ]);
    const filas: Mov[] = [
      ...((s.data ?? []) as unknown as { id: string; origen: string; cantidad: number; motivo: string | null; anulado: boolean; created_at: string; fidelidad_campanas: { nombre: string } | null }[]).map((x) => ({
        clave: "s" + x.id, fecha: x.created_at, sello_id: x.id, anulado: x.anulado,
        texto: `${x.cantidad > 0 ? "+" : ""}${x.cantidad} · ${x.fidelidad_campanas?.nombre ?? x.motivo ?? (x.origen === "pedido" ? "Pedido" : "Mostrador")}${x.motivo && x.fidelidad_campanas ? ` (${x.motivo})` : ""}`,
      })),
      ...((c.data ?? []) as { id: string; premio_nombre: string | null; sellos: number; anulado: boolean; created_at: string }[]).map((x) => ({
        clave: "c" + x.id, fecha: x.created_at, canje_id: x.id, anulado: x.anulado, texto: `Canje −${x.sellos} · ${x.premio_nombre ?? "Premio"}`,
      })),
    ].sort((a, b) => b.fecha.localeCompare(a.fecha));
    setMovs(filas);
  }
  async function abrir(id: string) {
    if (abierto === id) { setAbierto(null); return; }
    setAbierto(id); setAjuste(null); await historial(id);
  }
  async function refrescar(id?: string) { await cargar(); if (id && abierto === id) await historial(id); }

  async function dar(c: Cli, campana: string | null, cant?: number, motivo?: string) {
    setMsg("");
    const { error } = await supabase.rpc("fidelidad_dar_sellos", { p_cliente: c.id, p_campana: campana, p_cantidad: cant ?? null, p_motivo: motivo ?? null });
    if (error) { setMsg(mensajeFidelidad(error.message)); return false; }
    setMsg("Puntos actualizados"); await refrescar(c.id); return true;
  }
  async function sumarPorTelefono() {
    setMsg("");
    const t = normalizarTelefonoAR(tel);
    let { data: c } = await supabase.from("clientes").select("id,nombre,telefono").eq("kiosco_id", kiosco.id).eq("telefono", t).maybeSingle();
    if (!c) {
      const ins = await supabase.from("clientes").insert({ kiosco_id: kiosco.id, nombre: nombre.trim() || "Cliente", telefono: t }).select("id,nombre,telefono").single();
      if (ins.error) return setMsg("No se pudo crear el cliente.");
      c = ins.data;
    }
    const { error } = await supabase.rpc("fidelidad_dar_sellos", accion
      ? { p_cliente: c!.id, p_campana: accion, p_cantidad: null, p_motivo: null }
      : { p_cliente: c!.id, p_campana: null, p_cantidad: 1, p_motivo: "Sello en mostrador" });
    if (error) return setMsg(mensajeFidelidad(error.message));
    setTel(""); setNombre(""); setMsg("Punto sumado"); void cargar();
  }
  async function canjear(c: Cli, p: Premio) {
    if (!await confirmar({ titulo: `¿Canjear "${p.nombre}" para ${c.nombre}? Se descuentan ${p.costo_sellos} puntos.${p.tipo === "libre" ? "" : " El descuento o producto lo aplicás vos en la venta (o canjealo directo desde la Caja)."}`, confirmar: "Sí, seguir", peligro: false })) return;
    const { error } = await supabase.rpc("fidelidad_canjear", { p_cliente: c.id, p_premio: p.id });
    setMsg(error ? mensajeFidelidad(error.message) : "Premio canjeado"); await refrescar(c.id);
  }
  async function alternarSello(c: Cli, m: Mov) {
    const { error } = await supabase.rpc("fidelidad_anular_sello", { p_sello: m.sello_id, p_anular: !m.anulado });
    if (error) setMsg(mensajeFidelidad(error.message)); await refrescar(c.id);
  }
  async function anularCanje(c: Cli, m: Mov) {
    if (!await confirmar({ titulo: "¿Anular este canje? Los puntos vuelven al cliente.", confirmar: "Sí, seguir", peligro: true })) return;
    const { error } = await supabase.rpc("fidelidad_anular_canje", { p_canje: m.canje_id });
    setMsg(error ? mensajeFidelidad(error.message) : "Canje anulado"); await refrescar(c.id);
  }
  async function aplicarAjuste(c: Cli) {
    if (!ajuste) return;
    const n = Number(ajuste.cant.replace(",", "."));
    if (!Number.isInteger(n) || n === 0) return setMsg("Poné una cantidad entera (negativa para quitar).");
    if (await dar(c, null, n, ajuste.motivo)) setAjuste(null);
  }

  return (
    <>
      {ventanaConfirmar}
      <div className="card">
        <h3>Sumar puntos en el mostrador</h3>
        <input placeholder="WhatsApp del cliente" aria-label="WhatsApp del cliente" value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" />
        <input placeholder="Nombre (si es nuevo)" aria-label="Nombre del cliente (si es nuevo)" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <select value={accion} onChange={(e) => setAccion(e.target.value)} aria-label="Qué sumar">
          <option value="">+1 sello</option>
          {manuales.map((m) => <option key={m.id} value={m.id}>{m.nombre} (+{m.sellos})</option>)}
        </select>
        <button disabled={tel.replace(/\D/g, "").length < 8} onClick={sumarPorTelefono}>Sumar</button>
        <p className="mut">Las compras de pedidos y de la Caja (con cliente elegido) suman solas según tus campañas activas.</p>
      </div>
      {msg && <p role="status" className="mut">{msg}</p>}
      <input type="search" aria-label="Buscar cliente por nombre o teléfono" placeholder="Buscar cliente por nombre o teléfono" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <h3>{busca ? "Resultados" : `Clientes con puntos (${visibles.length})`}</h3>
      {visibles.length === 0 && <p className="mut">{busca ? "No encontramos ese cliente." : "Todavía nadie tiene sellos. Llegan solos con cada compra, o los sumás acá."}</p>}
      {visibles.map((c) => {
        const canjeables = activos.filter((p) => c.sellos_disponibles >= p.costo_sellos);
        const proximo = activos.find((p) => c.sellos_disponibles < p.costo_sellos);
        return (
          <div className="card" key={c.id}>
            <div className="row" onClick={() => abrir(c.id)} style={{ cursor: "pointer" }}>
              <b>{c.nombre}</b><b>{c.sellos_disponibles} sello{c.sellos_disponibles === 1 ? "" : "s"}{canjeables.length ? " · premio listo" : ""}</b>
            </div>
            {proximo && <p className="mut" style={{ margin: ".3rem 0 0" }}>Le faltan {proximo.costo_sellos - c.sellos_disponibles} para “{proximo.nombre}”.</p>}
            {c.vence_at && c.sellos_disponibles > 0 && <p className="mut" style={{ margin: ".2rem 0 0" }}>Vencen el {fecha(c.vence_at)} si no vuelve a sumar.</p>}
            <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", marginTop: 8, gap: 6 }}>
              {canjeables.map((p) => <button key={p.id} onClick={() => canjear(c, p)}>Canjear: {p.nombre} ({p.costo_sellos})</button>)}
              {manuales.map((m) => <button key={m.id} className="sec" onClick={() => dar(c, m.id)}>+{m.sellos} {m.nombre}</button>)}
              <button className="sec" onClick={() => setAjuste(ajuste?.id === c.id ? null : { id: c.id, cant: "1", motivo: "" })}>Ajustar</button>
              {canjeables.length > 0 && (
                <a className="btn sec" href={linkWhatsApp(normalizarTelefonoAR(c.telefono), `Hola ${c.nombre}! Tenés ${c.sellos_disponibles} sellos en ${kiosco.nombre} y ya podés canjear: ${canjeables.map((p) => p.nombre).join(", ")}. ¡Pasá cuando quieras!`)}>Avisar por WhatsApp</a>
              )}
            </div>
            {ajuste?.id === c.id && (
              <div style={{ marginTop: 8 }}>
                <label>Sellos (negativo para quitar)<input inputMode="numeric" value={ajuste.cant} onChange={(e) => setAjuste({ ...ajuste, cant: e.target.value })} /></label>
                <label>Motivo<input value={ajuste.motivo} maxLength={120} placeholder="Ej: regalo de cumpleaños, error de carga" onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} /></label>
                <button onClick={() => aplicarAjuste(c)}>Aplicar ajuste</button>
              </div>
            )}
            {abierto === c.id && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 20 }} className="mut">
                {movs.length === 0 && <li>Sin movimientos.</li>}
                {movs.map((m) => (
                  <li key={m.clave} style={{ textDecoration: m.anulado ? "line-through" : undefined }}>
                    {fecha(m.fecha)} · {m.texto}{" "}
                    <a href="#" onClick={(e) => { e.preventDefault(); if (m.sello_id) void alternarSello(c, m); else if (!m.anulado) void anularCanje(c, m); }}>
                      {m.sello_id ? (m.anulado ? "restaurar" : "anular") : m.anulado ? "" : "anular canje"}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {activos.length > 0 && <p className="mut">Premios: {activos.map((p) => `${p.nombre} (${describirPremio(p)})`).join(" · ")}</p>}
    </>
  );
}
