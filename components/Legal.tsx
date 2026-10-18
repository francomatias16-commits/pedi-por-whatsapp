import Link from "next/link";

// Mientras NEXT_PUBLIC_LEGAL_REVISADO no sea "1" (variable de Vercel), las páginas legales muestran el aviso de borrador.
export const LEGAL_REVISADO = process.env.NEXT_PUBLIC_LEGAL_REVISADO === "1";
export const FECHA_LEGAL = "16 de octubre de 2026";
const EMAIL = process.env.NEXT_PUBLIC_CONTACTO_EMAIL;

export function AvisoBorrador() {
  if (LEGAL_REVISADO) return null;
  return (
    <div className="card" role="note">
      <b>Borrador</b>
      <p className="mut" style={{ margin: "4px 0 0" }}>Este texto es preliminar y todavía no fue revisado por un abogado. Puede cambiar antes del lanzamiento.</p>
    </div>
  );
}

export function Contacto() {
  return EMAIL ? <a href={`mailto:${EMAIL}`}>{EMAIL}</a> : <span>[completar el email de contacto]</span>;
}

export function Pie() {
  return <p className="mut"><Link href="/">← Volver al inicio</Link></p>;
}
