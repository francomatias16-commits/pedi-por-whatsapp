import { useId } from "react";
import type { InputHTMLAttributes } from "react";

// Campo de formulario: etiqueta visible, ejemplo/ayuda opcional y error junto al campo (conectado para lectores de pantalla).
export default function Campo({ etiqueta, ayuda, error, ...input }: { etiqueta: string; ayuda?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const desc = [ayuda ? `${id}-a` : "", error ? `${id}-e` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <input id={id} aria-describedby={desc} aria-invalid={error ? true : undefined} {...input} />
      {ayuda && <p id={`${id}-a`} className="mut campo-ayuda">{ayuda}</p>}
      {error && <p id={`${id}-e`} role="alert" className="error">{error}</p>}
    </div>
  );
}
