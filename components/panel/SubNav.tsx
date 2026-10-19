"use client";
import Link from "next/link";
import { DESTINOS, puedeVer, rutaDeTab, type Destino, type Rol, type Tab } from "@/lib/navegacion";
import { pestanasVisibles, type Modo } from "@/lib/modo";

// Pestañas de las pantallas de un mismo destino (ej.: Productos · Precios · Etiquetas · Conteo). Solo aparece si hay más de una.
export default function SubNav({ destino, tab, modo, rol = "dueno" }: { destino: Destino; tab: Tab; modo: Modo; rol?: Rol }) {
  const d = DESTINOS.find((x) => x.id === destino)!;
  const subs = pestanasVisibles(d.subs.filter((s) => puedeVer(rol, s.tab)), modo, tab);
  if (subs.length < 2) return null;
  return (
    <nav className="subnav" aria-label={`Secciones de ${d.titulo}`}>
      {subs.map((s) => (
        <Link key={s.tab} href={rutaDeTab(s.tab)} className={tab === s.tab ? "on" : ""} aria-current={tab === s.tab ? "page" : undefined}>{s.titulo}</Link>
      ))}
    </nav>
  );
}
