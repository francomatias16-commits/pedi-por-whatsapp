"use client";
import Link from "next/link";
import { destinosPara, rutaDeTab, type Destino, type Rol } from "@/lib/navegacion";
import { ICONO_DESTINO, Icono } from "./iconos";
import Cuenta from "./Insignias";

// Menú de la computadora: 7 destinos con una línea que explica cada uno.
export default function NavLateral({ actual, pendientes, porComprar, rol = "dueno" }: { actual: Destino; pendientes: number; porComprar: number; rol?: Rol }) {
  return (
    <nav className="nav-lat" aria-label="Menú del kiosco">
      {destinosPara(rol).map((d) => (
        <Link key={d.id} href={rutaDeTab(d.subs[0].tab)} className={`nav-item${actual === d.id ? " on" : ""}`} aria-current={actual === d.id ? "page" : undefined}>
          <Icono d={ICONO_DESTINO[d.id]} />
          <span className="nav-txt"><b>{d.titulo}</b><small>{d.detalle}</small></span>
          {d.id === "pedidos" && <Cuenta n={pendientes} que="pedidos por confirmar" />}
          {d.id === "compras" && <Cuenta n={porComprar} que="productos para reponer" />}
        </Link>
      ))}
    </nav>
  );
}
