import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variante = "principal" | "secundario" | "peligro";
const CLASE: Record<Variante, string> = { principal: "", secundario: "sec", peligro: "peligro" };

// Botón con 3 variantes. Con `href` se dibuja como enlace (mismo aspecto). Alto mínimo 48 px (ver globals.css).
export default function Boton({ variante = "principal", href, grande, className = "", children, ...rest }:
  { variante?: Variante; href?: string; grande?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [href ? "btn" : "", CLASE[variante], grande ? "btn-grande" : "", className].filter(Boolean).join(" ");
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button type="button" className={cls || undefined} {...rest}>{children}</button>;
}
