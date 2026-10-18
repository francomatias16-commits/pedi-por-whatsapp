"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Opciones = { titulo: string; detalle?: string; confirmar?: string; cancelar?: string; peligro?: boolean };

// Reemplaza a window.confirm: ventana propia, grande, con el botón seguro enfocado por defecto.
// Uso: const [ventana, confirmar] = useConfirmar();  …  if (await confirmar({ titulo: "¿Cancelar el pedido?" })) {…}  …  <>{ventana}</>
export function useConfirmar(): [ReactNode, (o: Opciones) => Promise<boolean>] {
  const [op, setOp] = useState<Opciones | null>(null);
  const res = useRef<((v: boolean) => void) | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  const confirmar = useCallback((o: Opciones) => new Promise<boolean>((r) => { res.current = r; setOp(o); }), []);
  const cerrar = (v: boolean) => { res.current?.(v); res.current = null; setOp(null); };

  useEffect(() => { const d = ref.current; if (op && d && !d.open) d.showModal(); }, [op]);

  const ventana = op && (
    <dialog ref={ref} className="confirmar" aria-labelledby="conf-t" onCancel={(e) => { e.preventDefault(); cerrar(false); }}>
      <h3 id="conf-t">{op.titulo}</h3>
      {op.detalle && <p className="mut">{op.detalle}</p>}
      <div className="wiz-botones">
        <button type="button" className="sec" autoFocus onClick={() => cerrar(false)}>{op.cancelar ?? "No, volver"}</button>
        <button type="button" className={op.peligro ? "peligro" : undefined} onClick={() => cerrar(true)}>{op.confirmar ?? "Sí, seguir"}</button>
      </div>
    </dialog>
  );
  return [ventana, confirmar];
}
