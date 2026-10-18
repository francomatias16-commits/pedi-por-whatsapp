"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { peso } from "@/lib/whatsapp";
import Pantalla from "@/components/ui/Pantalla";
import Aviso from "@/components/ui/Aviso";
import type { Tab } from "@/lib/navegacion";

type Atencion = { id: string; tono: "alerta" | "info"; icono: string; titulo: string; detalle: string; ir: Tab; boton: string };

const CLAVE_COMPARTIO = (id: string) => `pdw-compartio-${id}`;

// Pantalla de Inicio ("Hoy"): qué hacer ahora, números del día y primeros pasos.
export default function Inicio({ kiosco, onIr }: { kiosco: Kiosco; onIr: (t: Tab) => void }) {
  const [atencion, setAtencion] = useState<Atencion[] | null>(null);
  const [numeros, setNumeros] = useState<{ pedidos: number; plata: number; porCobrar: number } | null>(null);
  const [pasos, setPasos] = useState<{ productos: boolean; compartio: boolean; primerPedido: boolean } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    const id = kiosco.id;
    const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0);
    const [pend, reponer, vencido, semana, hoy, totalPed, prods] = await Promise.all([
      supabase.from("pedidos").select("id", { count: "exact", head: true }).eq("kiosco_id", id).eq("estado", "pendiente"),
      supabase.rpc("reposicion_resumen", { p_kiosco: id }),
      supabase.rpc("fiado_vencido", { p_kiosco: id, p_dias: 30 }),
      supabase.rpc("resumen_semana", { p_kiosco: id }),
      supabase.from("pedidos").select("total,estado").eq("kiosco_id", id).gte("created_at", inicioHoy.toISOString()),
      supabase.from("pedidos").select("id", { count: "exact", head: true }).eq("kiosco_id", id),
      supabase.from("productos").select("id", { count: "exact", head: true }).eq("kiosco_id", id),
    ]);
    if (pend.error || hoy.error || semana.error) { setError(true); return; }
    setError(false);

    const pendientes = pend.count ?? 0;
    const rep = (reponer.data ?? {}) as Record<string, number>;
    const agotados = Number(rep.agotados ?? 0), bajos = Number(rep.bajos ?? 0);
    const venc = (vencido.data ?? {}) as Record<string, number>;
    const clientesVenc = Number(venc.clientes ?? 0), montoVenc = Number(venc.monto ?? 0);
    const sem = (semana.data ?? {}) as { ultimo_ajuste: string | null; productos: number; fiado_pendiente: number };
    const dias = sem.ultimo_ajuste ? Math.floor((Date.now() - new Date(sem.ultimo_ajuste).getTime()) / 86400000) : null;

    // Lo más urgente primero; máximo 3 tarjetas.
    const lista: Atencion[] = [];
    if (pendientes > 0) lista.push({ id: "pedidos", tono: "alerta", icono: "", titulo: `${pendientes} pedido${pendientes === 1 ? "" : "s"} por confirmar`, detalle: "Te están esperando por WhatsApp.", ir: "pedidos", boton: "Ver pedidos" });
    if (agotados + bajos > 0) lista.push({ id: "reponer", tono: "alerta", icono: "", titulo: `Se acabó o queda poco: ${agotados + bajos}`, detalle: `${agotados} agotado${agotados === 1 ? "" : "s"} · ${bajos} por acabarse.`, ir: "reponer", boton: "Ver qué comprar" });
    if (clientesVenc > 0) lista.push({ id: "fiado", tono: "alerta", icono: "", titulo: `Fiado vencido: ${peso(montoVenc)}`, detalle: `${clientesVenc} cliente${clientesVenc === 1 ? "" : "s"} debe hace más de 30 días.`, ir: "fiado", boton: "Ver quién me debe" });
    if (sem.productos > 0 && (dias === null || dias >= 7)) lista.push({ id: "precios", tono: "info", icono: "", titulo: "Revisá tus precios", detalle: dias === null ? "Todavía no ajustaste precios." : `Hace ${dias} días que no los ajustás.`, ir: "precios", boton: "Cambiar precios" });
    setAtencion(lista.slice(0, 3));

    const plata = (hoy.data ?? []).filter((p) => p.estado !== "cancelado").reduce((s, p) => s + Number(p.total), 0);
    setNumeros({ pedidos: (hoy.data ?? []).length, plata, porCobrar: Number(sem.fiado_pendiente ?? 0) });

    setPasos({
      productos: (prods.count ?? 0) > 0,
      compartio: typeof localStorage !== "undefined" && localStorage.getItem(CLAVE_COMPARTIO(id)) === "1",
      primerPedido: (totalPed.count ?? 0) > 0,
    });
  }, [kiosco.id]);

  useEffect(() => {
    void cargar();
    const t = setInterval(() => { if (document.visibilityState === "visible") void cargar(); }, 60000);
    return () => clearInterval(t);
  }, [cargar]);

  async function copiarLink() {
    const url = `${location.origin}/${kiosco.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true); setTimeout(() => setCopiado(false), 2500);
      try { localStorage.setItem(CLAVE_COMPARTIO(kiosco.id), "1"); } catch { /* sin storage: no pasa nada */ }
      setPasos((p) => (p ? { ...p, compartio: true } : p));
    } catch { setCopiado(false); }
  }

  const completos = pasos ? [pasos.productos, pasos.compartio, pasos.primerPedido].filter(Boolean).length : 0;
  const mostrarPasos = pasos !== null && completos < 3;
  const sinNada = atencion !== null && atencion.length === 0;

  return (
    <Pantalla titulo={`Hola, ${kiosco.nombre}`}>
      <div className="card row">
        <span>Compartí tu tienda con tus clientes.</span>
        <button type="button" onClick={copiarLink}>{copiado ? "Link copiado" : "Compartir mi tienda"}</button>
      </div>

      {error && <Aviso tipo="error">No pudimos cargar lo de hoy. Revisá tu conexión y recargá la página.</Aviso>}

      <h3>Lo que necesita tu atención</h3>
      {atencion === null && !error && <div className="esq esq-t" aria-label="Cargando" />}
      {sinNada && <Aviso tipo="ok">Todo en orden. No hay nada urgente hoy.</Aviso>}
      {atencion?.map((a) => (
        <div key={a.id} className="card">
          <b>{a.titulo}</b>
          <p className="mut">{a.detalle}</p>
          <button type="button" onClick={() => onIr(a.ir)}>{a.boton}</button>
        </div>
      ))}

      <h3>Hoy</h3>
      {numeros === null ? <div className="esq" aria-label="Cargando" /> : (
        <div className="numeros-dia">
          <div className="card numero"><span>Pedidos de hoy</span><b>{numeros.pedidos}</b></div>
          <div className="card numero"><span>Plata de hoy</span><b>{peso(numeros.plata)}</b></div>
          <div className="card numero"><span>Por cobrar (fiado)</span><b>{peso(numeros.porCobrar)}</b></div>
        </div>
      )}
      <button type="button" className="sec" onClick={() => onIr("local")}>Ver cómo me fue</button>

      {mostrarPasos && pasos && (
        <div className="card primeros-pasos">
          <b>Primeros pasos</b>
          <p className="mut">{completos} de 3 listos</p>
          <div className="progreso" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={completos}><span style={{ width: `${(completos / 3) * 100}%` }} /></div>
          <ul className="lista-pasos">
            <li>{pasos.productos ? "✔" : "○"} Cargá tus productos</li>
            <li>{pasos.compartio ? "✔" : "○"} Compartí el link de tu tienda</li>
            <li>{pasos.primerPedido ? "✔" : "○"} Recibí tu primer pedido</li>
          </ul>
          {!pasos.productos && <button type="button" onClick={() => onIr("productos")}>Cargar productos</button>}
        </div>
      )}
    </Pantalla>
  );
}
