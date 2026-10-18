"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ATAJO_MEDIO, ETIQUETA_MEDIO, LETRA_MEDIO, MEDIOS, num, redondear, type Cliente, type Medio, type PagoVenta } from "@/lib/caja";
import { peso } from "@/lib/whatsapp";

type Fila = { id: number; medio: Medio; monto: string };
let seq = 1;

// Modal de cobro: pagos mixtos, vuelto grande y operación por teclado
// (E/T/Q/K/C cambian el medio, A agrega línea, Supr la quita, Enter confirma, Esc cancela).
export default function CobroModal({ total, cliente, onCancelar, onConfirmar }: {
  total: number; cliente: Cliente | null; onCancelar: () => void; onConfirmar: (pagos: PagoVenta[]) => Promise<string | null>;
}) {
  const [filas, setFilas] = useState<Fila[]>([{ id: seq++, medio: "efectivo", monto: String(total) }]);
  const [activa, setActiva] = useState(0);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const ref = useRef({ filas, activa, enviando });
  ref.current = { filas, activa, enviando };

  const calc = useMemo(() => {
    const pagos = filas.map((f) => ({ medio: f.medio, monto: redondear(num(f.monto)) })).filter((p) => p.monto > 0);
    const soloCC = filas.length === 1 && filas[0].medio === "cuenta_corriente";
    const pagado = soloCC ? total : redondear(pagos.reduce((s, p) => s + p.monto, 0));
    const noEfectivo = soloCC ? total : redondear(pagos.filter((p) => p.medio !== "efectivo").reduce((s, p) => s + p.monto, 0));
    const dif = redondear(total - pagado);
    const hayEfectivo = pagos.some((p) => p.medio === "efectivo");
    return { pagos, soloCC, pagado, noEfectivo, dif, vuelto: hayEfectivo && dif < 0 ? -dif : 0 };
  }, [filas, total]);

  const setFila = (i: number, cambios: Partial<Fila>) => setFilas((fs) => fs.map((f, k) => (k === i ? { ...f, ...cambios } : f)));
  const agregar = () => setFilas((fs) => {
    if (fs.length >= 5) return fs;
    const resto = Math.max(0, redondear(total - fs.reduce((s, f) => s + num(f.monto), 0)));
    const usados = new Set(fs.map((f) => f.medio));
    const medio = (MEDIOS.find((m) => !usados.has(m)) ?? "efectivo") as Medio;
    setActiva(fs.length);
    return [...fs, { id: seq++, medio, monto: resto > 0 ? String(resto) : "" }];
  });
  const quitar = (i: number) => setFilas((fs) => {
    if (fs.length === 1) return [{ ...fs[0], monto: "" }];
    const nuevas = fs.filter((_, k) => k !== i);
    setActiva(Math.min(i, nuevas.length - 1));
    return nuevas;
  });

  async function confirmar() {
    if (ref.current.enviando) return;
    const { filas: fs } = ref.current;
    setError("");
    if (!calc.pagos.length) return setError("Agregá al menos un medio de pago.");
    let pagos = calc.pagos;
    if (calc.soloCC) pagos = [{ medio: "cuenta_corriente", monto: total }];
    else if (calc.pagado < total) return setError("El monto pagado no alcanza el total.");
    if (pagos.some((p) => p.medio === "cuenta_corriente") && !cliente) return setError("Para cobrar a cuenta corriente primero elegí un cliente.");
    if (calc.noEfectivo > total) return setError("Lo que no es efectivo no puede pasar el total. El vuelto sale solo de efectivo.");
    void fs;
    setEnviando(true);
    const err = await onConfirmar(pagos);
    setEnviando(false);
    if (err) setError(err);
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const enInput = !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancelar(); return; }
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void confirmar(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "tab" || e.key.length !== 1 && e.key !== "Delete") return;
      if (e.key === "Delete") {
        const v = enInput ? (t as HTMLInputElement).value : "";
        if (!enInput || v === "") { e.preventDefault(); quitar(ref.current.activa); }
        return;
      }
      if (t?.tagName === "SELECT" || t?.tagName === "TEXTAREA") return;
      if (k === "a") { e.preventDefault(); agregar(); return; }
      const medio = ATAJO_MEDIO[k];
      if (medio) { e.preventDefault(); setFila(ref.current.activa, { medio }); }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc, cliente]);

  const billetes = useMemo(() => {
    const base = [1000, 2000, 5000, 10000, 20000].filter((b) => b >= total).slice(0, 3);
    return base;
  }, [total]);

  return (
    <div className="pos-overlay" role="dialog" aria-modal="true" aria-labelledby="cobro-tit">
      <div className="pos-modal pos-modal--cobro">
        <div className="pos-modal-head">
          <div><p className="pos-eyebrow">Punto de venta</p><h2 id="cobro-tit">Cobrar</h2></div>
          <button className="sec pos-x" onClick={onCancelar} aria-label="Cerrar">✕</button>
        </div>
        <div className="cobro-grid">
          <aside className="cobro-resumen">
            <div className="cobro-total"><span>Total a cobrar</span><b>{peso(total)}</b></div>
            <div className="cobro-caja">
              <div className="row"><span>Pagado</span><b>{peso(calc.pagado)}</b></div>
              <div className="row"><span>{calc.dif > 0 ? "Falta" : "Diferencia"}</span><b className={calc.dif > 0 ? "neg" : "ok"}>{peso(Math.abs(calc.dif))}</b></div>
            </div>
            {calc.vuelto > 0 && (<div className="cobro-vuelto"><span>Vuelto para entregar</span><b>{peso(calc.vuelto)}</b></div>)}
            <p className="mut cobro-nota">Los pagos se pueden dividir entre varios medios.</p>
            {cliente && <p className="mut cobro-nota">Cliente: <b>{cliente.nombre}</b></p>}
          </aside>
          <section className="cobro-pagos" aria-label="Medios de pago">
            <p className="pos-kicker">Medios de pago</p>
            <p className="mut">Elegí una opción con el mouse o con su tecla.</p>
            {filas.map((f, i) => (
              <div key={f.id} className={`pago-fila${i === activa ? " activa" : ""}`} onClick={() => setActiva(i)}>
                <div className="pago-medios" role="radiogroup" aria-label="Medio de pago">
                  {MEDIOS.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={f.medio === m}
                      className={`pago-medio${f.medio === m ? " on" : ""}`} onClick={() => { setActiva(i); setFila(i, { medio: m }); }}>
                      {ETIQUETA_MEDIO[m]} <kbd>{LETRA_MEDIO[m]}</kbd>
                    </button>
                  ))}
                </div>
                <div className="pago-monto">
                  <input type="number" inputMode="decimal" min={0} step={1} autoFocus={i === 0} placeholder="Monto" aria-label="Monto"
                    value={f.monto} onFocus={() => setActiva(i)} onChange={(e) => setFila(i, { monto: e.target.value })} />
                  {f.medio === "efectivo" && (
                    <span className="pago-rapidos">
                      <button type="button" className="sec" onClick={() => setFila(i, { monto: String(Math.max(0, redondear(total - filas.filter((_, k) => k !== i).reduce((s, x) => s + num(x.monto), 0)))) })}>Exacto</button>
                      {billetes.map((b) => (<button type="button" className="sec" key={b} onClick={() => setFila(i, { monto: String(b) })}>{peso(b)}</button>))}
                    </span>
                  )}
                  <button type="button" className="sec pago-quitar" onClick={() => quitar(i)} aria-label="Quitar línea">✕</button>
                </div>
              </div>
            ))}
            <button type="button" className="sec pago-agregar" onClick={agregar} disabled={filas.length >= 5}>+ Agregar medio de pago <kbd>A</kbd></button>
            {error && <p className="pos-error" role="alert">{error}</p>}
          </section>
        </div>
        <div className="cobro-keybar"><span><kbd>Tab</kbd> avanzar</span><span><kbd>Supr</kbd> quitar línea</span><span><kbd>Esc</kbd> cancelar</span></div>
        <div className="pos-modal-acciones">
          <button className="sec" onClick={onCancelar}>Cancelar <kbd>Esc</kbd></button>
          <button onClick={confirmar} disabled={enviando}>{enviando ? "Registrando…" : <>Confirmar venta <kbd>Enter</kbd></>}</button>
        </div>
      </div>
    </div>
  );
}
