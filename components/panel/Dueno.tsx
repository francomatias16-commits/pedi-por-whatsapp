"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase, type Kiosco } from "@/lib/supabase";
import { estadoTienda, textoApertura } from "@/lib/horario";
import { DESTINOS, destinoDeTab, rutaDeTab, segmentosDe, tabDeRuta, type Tab } from "@/lib/navegacion";
import type { LineaCompra } from "@/lib/compras";
import type { Seleccion } from "@/lib/etiquetas";
import { useConfirmar } from "@/components/ui/Confirmar";
import Productos from "@/components/Productos";
import Pedidos from "@/components/Pedidos";
import Fiado from "@/components/Fiado";
import Sellos from "@/components/Sellos";
import Precios from "@/components/Precios";
import Proveedores from "@/components/Proveedores";
import Reponer from "@/components/Reponer";
import Conteo from "@/components/Conteo";
import Etiquetas from "@/components/Etiquetas";
import Caja from "@/components/Caja";
import Resumen from "@/components/Resumen";
import Inicio from "@/components/Inicio";
import Radar from "@/components/Radar";
import MiKiosco from "@/components/MiKiosco";
import BarraSuperior from "./BarraSuperior";
import NavLateral from "./NavLateral";
import BarraInferior from "./BarraInferior";
import SubNav from "./SubNav";
import AyudaPanel from "./AyudaPanel";
import Bienvenida from "./Bienvenida";
import { leerModo, guardarModo, type Modo } from "@/lib/modo";

export default function Dueno({ kiosco, recargar }: { kiosco: Kiosco; recargar: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const tabRuta = tabDeRuta(segmentosDe(pathname));
  const tab: Tab = tabRuta ?? "resumen";
  const destino = destinoDeTab(tab);
  // Una dirección que no existe (/panel/loquesea) vuelve al inicio.
  useEffect(() => { if (!tabRuta) router.replace("/panel"); }, [tabRuta, router]);
  const irTab = (t: Tab) => router.push(rutaDeTab(t));

  const [precarga, setPrecarga] = useState<Seleccion[] | null>(null);
  const [precargaCompra, setPrecargaCompra] = useState<{ proveedorId: string; lineas: LineaCompra[] } | null>(null);
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const [modo, setModoState] = useState<Modo>("simple");
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [bienvenida, setBienvenida] = useState(false);
  useEffect(() => {
    setModoState(leerModo());
    let visto = false;
    try { visto = localStorage.getItem(`pdw-bienvenida-${kiosco.id}`) === "1"; } catch { visto = true; }
    if (!visto) setBienvenida(true);
  }, [kiosco.id]);
  const cerrarBienvenida = () => {
    setBienvenida(false);
    try { localStorage.setItem(`pdw-bienvenida-${kiosco.id}`, "1"); } catch { /* sin almacenamiento: vuelve a salir */ }
  };
  const cambiarModo = (m: Modo) => { guardarModo(m); setModoState(m); };
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setAhora(new Date()), 30000); return () => clearInterval(t); }, []);

  // Números del menú: pedidos por confirmar y productos agotados o por acabarse.
  const [pendientes, setPendientes] = useState(0);
  const [porComprar, setPorComprar] = useState(0);
  useEffect(() => {
    let vivo = true;
    const traer = async () => {
      const [p, r] = await Promise.all([
        supabase.from("pedidos").select("id", { count: "exact", head: true }).eq("kiosco_id", kiosco.id).eq("estado", "pendiente"),
        supabase.rpc("reposicion_resumen", { p_kiosco: kiosco.id }),
      ]);
      if (!vivo) return;
      if (!p.error) setPendientes(p.count ?? 0);
      const d = r.data as Record<string, number> | null;
      const n = d ? Number(d.agotados ?? 0) + Number(d.bajos ?? 0) : 0;
      setPorComprar(Number.isFinite(n) ? n : 0);
    };
    void traer();
    const t = setInterval(() => { if (document.visibilityState === "visible") void traer(); }, 30000);
    return () => { vivo = false; clearInterval(t); };
  }, [kiosco.id, tab]);

  const estado = estadoTienda(kiosco, ahora);
  const abierta = estado === "abierta";
  const detalle = estado === "fuera_de_horario" ? `Fuera de horario${textoApertura(kiosco.horarios ?? {}, ahora) ? ` · ${textoApertura(kiosco.horarios, ahora)}` : ""}`
    : estado === "pausada" ? (kiosco.horario_auto ? "Pausada: no recibe pedidos aunque esté en horario" : "Tus clientes no pueden pedir") : kiosco.horario_auto ? "Abierta según tu horario" : "Tus clientes pueden pedir";

  async function interruptor() {
    if (abierta && !(await confirmar({ titulo: "¿Cerrar la tienda?", detalle: "Tus clientes no van a poder hacer pedidos hasta que la vuelvas a abrir.", confirmar: "Sí, cerrar tienda", peligro: true }))) return;
    await supabase.from("kioscos").update({ abierto: !kiosco.abierto }).eq("id", kiosco.id);
    recargar();
  }

  return (
    <div className="panel-shell">
      {ventanaConfirmar}
      {bienvenida && <Bienvenida onTerminar={cerrarBienvenida} />}
      <AyudaPanel tab={tab} abierta={ayudaAbierta} onCerrar={() => setAyudaAbierta(false)} />
      <BarraSuperior kiosco={kiosco} abierta={abierta} bloqueado={estado === "fuera_de_horario"} detalle={detalle} onInterruptor={interruptor} onSalir={() => supabase.auth.signOut()} onAyuda={() => setAyudaAbierta(true)} />
      <NavLateral actual={destino} pendientes={pendientes} porComprar={porComprar} />
      <section className="panel-main">
        <SubNav destino={destino} tab={tab} modo={modo} />
        {tab === "pedidos" && <Pedidos kiosco={kiosco} />}
        {tab === "productos" && <Productos kiosco={kiosco} />}
        {tab === "fiado" && <Fiado kiosco={kiosco} />}
        {tab === "caja" && <Caja kiosco={kiosco} />}
        {tab === "sellos" && <Sellos kiosco={kiosco} />}
        {tab === "precios" && <Precios kiosco={kiosco} />}
        {tab === "conteo" && <Conteo kiosco={kiosco} />}
        {tab === "reponer" && <Reponer kiosco={kiosco} onComprar={(proveedorId, lineas) => { setPrecargaCompra({ proveedorId, lineas }); irTab("proveedores"); }} />}
        {tab === "proveedores" && <Proveedores kiosco={kiosco} precarga={precargaCompra} onPrecargaUsada={() => setPrecargaCompra(null)} onEtiquetas={(sel) => { setPrecarga(sel); irTab("etiquetas"); }} />}
        {tab === "etiquetas" && <Etiquetas kiosco={kiosco} precarga={precarga} onPrecargaUsada={() => setPrecarga(null)} />}
        {tab === "resumen" && <Inicio kiosco={kiosco} onIr={irTab} />}
        {tab === "radar" && <Radar kiosco={kiosco} />}
        {tab === "local" && <><MiKiosco kiosco={kiosco} onGuardado={recargar} modo={modo} onModo={cambiarModo} onVerBienvenida={() => setBienvenida(true)} /><h2>Cómo me fue</h2><Resumen kiosco={kiosco} onIr={irTab} /></>}
      </section>
      <BarraInferior actual={destino} pendientes={pendientes} porComprar={porComprar} onSalir={() => supabase.auth.signOut()} />
    </div>
  );
}
