"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DESTINOS, rutaDeTab, type Destino } from "@/lib/navegacion";
import { hayAyuda, linkAyuda } from "@/lib/ayuda";
import { ICONO_DESTINO, Icono } from "./iconos";
import Cuenta from "./Insignias";

const PRINCIPALES: Destino[] = ["inicio", "vender", "pedidos", "productos"];
const EN_MAS: Destino[] = ["clientes", "compras", "negocio"];
const info = (id: Destino) => DESTINOS.find((d) => d.id === id)!;

// Menú del celular: 4 botones grandes abajo + "Más". Es una barra fija: se alcanza con el pulgar.
export default function BarraInferior({ actual, pendientes, porComprar, onSalir }: { actual: Destino; pendientes: number; porComprar: number; onSalir: () => void }) {
  const [abierta, setAbierta] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (abierta && !d.open) d.showModal(); if (!abierta && d.open) d.close(); }, [abierta]);

  return (
    <>
      <nav className="nav-inf" aria-label="Menú del kiosco">
        {PRINCIPALES.map((id) => (
          <Link key={id} href={rutaDeTab(info(id).subs[0].tab)} className={`nav-inf-item${actual === id ? " on" : ""}`} aria-current={actual === id ? "page" : undefined}>
            <span className="nav-inf-ico"><Icono d={ICONO_DESTINO[id]} />{id === "pedidos" && <Cuenta n={pendientes} que="pedidos por confirmar" />}</span>
            <span>{info(id).titulo}</span>
          </Link>
        ))}
        <button type="button" className={`nav-inf-item${EN_MAS.includes(actual) ? " on" : ""}`} aria-haspopup="dialog" onClick={() => setAbierta(true)}>
          <span className="nav-inf-ico"><Icono d={ICONO_DESTINO.mas} /><Cuenta n={porComprar} que="productos para reponer" /></span>
          <span>Más</span>
        </button>
      </nav>
      <dialog ref={ref} className="hoja" aria-label="Más opciones" onClose={() => setAbierta(false)} onClick={(e) => { if (e.target === ref.current) setAbierta(false); }}>
        <div className="hoja-cab"><b>Más opciones</b><button type="button" className="sec" onClick={() => setAbierta(false)}>Cerrar</button></div>
        {EN_MAS.map((id) => (
          <Link key={id} href={rutaDeTab(info(id).subs[0].tab)} className={`hoja-item${actual === id ? " on" : ""}`} onClick={() => setAbierta(false)}>
            <Icono d={ICONO_DESTINO[id]} />
            <span className="nav-txt"><b>{info(id).titulo}</b><small>{info(id).detalle}</small></span>
            {id === "compras" && <Cuenta n={porComprar} que="productos para reponer" />}
          </Link>
        ))}
        {hayAyuda && <a className="hoja-item" href={linkAyuda()} target="_blank" rel="noopener noreferrer"><span className="nav-txt"><b>Ayuda por WhatsApp</b><small>Te respondemos nosotros</small></span></a>}
        <button type="button" className="sec hoja-salir" onClick={() => { setAbierta(false); onSalir(); }}>Salir</button>
      </dialog>
    </>
  );
}
