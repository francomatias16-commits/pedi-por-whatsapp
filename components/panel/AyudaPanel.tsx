"use client";
import { useEffect, useRef } from "react";
import { hayAyuda, linkAyuda } from "@/lib/ayuda";
import type { Tab } from "@/lib/navegacion";
import { GUIAS } from "@/lib/guias";

// "¿Cómo se usa?": guía corta de la pantalla actual y un botón para hablar por WhatsApp.
export default function AyudaPanel({ tab, abierta, onCerrar }: { tab: Tab; abierta: boolean; onCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (abierta && !d.open) d.showModal(); if (!abierta && d.open) d.close(); }, [abierta]);
  const g = GUIAS[tab];
  return (
    <dialog ref={ref} className="confirmar ayuda-panel" aria-labelledby="ayuda-t" onClose={onCerrar} onCancel={(e) => { e.preventDefault(); onCerrar(); }}>
      <h3 id="ayuda-t">{g.titulo}: ¿cómo se usa?</h3>
      <p>{g.texto}</p>
      <div className="wiz-botones">
        <button type="button" className="sec" onClick={onCerrar}>Cerrar</button>
        {hayAyuda && <a className="btn" href={linkAyuda(`Hola, necesito ayuda con la pantalla ${g.titulo} de Pedí por WhatsApp`)} target="_blank" rel="noopener noreferrer">Hablar por WhatsApp</a>}
      </div>
    </dialog>
  );
}
