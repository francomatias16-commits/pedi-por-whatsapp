"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ATAJO_MEDIO, ETIQUETA_MEDIO, LETRA_MEDIO, MEDIOS, num, redondear, type Cliente, type Medio, type PagoVenta } from "@/lib/caja";
import { peso } from "@/lib/whatsapp";
import { QR_CONSULTA_MS, QR_CONSULTAS_MAX, QR_MONTO_MIN, cobroDisponible } from "@/lib/pagos/qr";
import { llamarQR, mensajeQR } from "@/lib/pagos/qr-cliente";
import type { CobroSinVenta } from "./useQrCaja";

type CobroQRFila = { id: string; estado: "esperando" | "cobrado" | "vencido" | "cancelado"; msg?: string };
type Fila = { id: number; medio: Medio; monto: string; cobro?: CobroQRFila };
export type QrCobro = { kioscoId: string; turnoId: string; activo: boolean; sinVenta: CobroSinVenta[]; onCambio: () => void };
let seq = 1;

// Modal de cobro: pagos mixtos, vuelto grande y operación por teclado
// (E/T/Q/K/C cambian el medio, A agrega línea, Supr la quita, Enter confirma, Esc cancela).
export default function CobroModal({ total, cliente, onCancelar, onConfirmar, qr }: {
  total: number; cliente: Cliente | null; onCancelar: () => void; onConfirmar: (pagos: PagoVenta[]) => Promise<string | null>; qr?: QrCobro | null;
}) {
  const [filas, setFilas] = useState<Fila[]>([{ id: seq++, medio: "efectivo", monto: String(total) }]);
  const [activa, setActiva] = useState(0);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const ref = useRef({ filas, activa, enviando });
  ref.current = { filas, activa, enviando };
  const [enLinea, setEnLinea] = useState(true);
  useEffect(() => {
    setEnLinea(navigator.onLine);
    const on = () => setEnLinea(true), off = () => setEnLinea(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // QR de Mercado Pago: con el QR encendido, una línea "QR / Mercado Pago" solo se confirma si el cobro está aprobado.
  // Un cobro ya aprobado que quedó sin venta (se cerró la pantalla, se cortó internet) cubre una línea del mismo monto.
  const qrActivo = !!qr?.activo;
  const esQR = (f: Fila) => qrActivo && f.medio === "mercadopago";
  const estadoQR = useMemo(() => {
    const usados: Record<string, number> = {};
    return filas.map((f) => {
      if (!qrActivo || f.medio !== "mercadopago") return null;
      if (f.cobro?.estado === "esperando") return "esperando" as const;
      if (f.cobro?.estado === "cobrado") return "cobrado" as const;
      const m = redondear(num(f.monto));
      const k = String(m);
      if (m >= QR_MONTO_MIN && cobroDisponible(qr?.sinVenta ?? [], m, usados[k] ?? 0)) { usados[k] = (usados[k] ?? 0) + 1; return "cobrado" as const; }
      return "falta" as const;
    });
  }, [filas, qrActivo, qr?.sinVenta]);

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
    if (fs[i]?.cobro?.estado === "esperando") return fs; // primero se cancela el cobro QR
    if (fs.length === 1) return [{ ...fs[0], monto: "" }];
    const nuevas = fs.filter((_, k) => k !== i);
    setActiva(Math.min(i, nuevas.length - 1));
    return nuevas;
  });

  // Cierra el modal. Un cobro QR que sigue esperando se cancela para liberar el QR del local; uno ya aprobado queda disponible para la próxima venta.
  async function cerrarModal() {
    const esperando = ref.current.filas.filter((f) => f.cobro?.estado === "esperando");
    await Promise.all(esperando.map((f) => llamarQR("/api/pagos/mp/qr/cancelar", { cobro: f.cobro!.id })));
    qr?.onCambio();
    onCancelar();
  }

  async function cobrarQR(i: number) {
    const f = ref.current.filas[i];
    const monto = redondear(num(f.monto));
    setError("");
    if (monto < QR_MONTO_MIN) return setError(`El cobro con QR tiene que ser de ${peso(QR_MONTO_MIN)} o más.`);
    if (!qr) return;
    const r = await llamarQR("/api/pagos/mp/qr/cobrar", { kiosco: qr.kioscoId, turno: qr.turnoId, monto });
    if (!r.ok) return setError(mensajeQR(r.j.error));
    setFila(i, { cobro: { id: String(r.j.cobro_id), estado: "esperando" } });
  }
  async function cancelarQR(i: number) {
    const c = ref.current.filas[i].cobro;
    if (!c) return;
    const r = await llamarQR("/api/pagos/mp/qr/cancelar", { cobro: c.id });
    const estado = String(r.j.estado ?? "");
    // Si justo se pagó, no se cancela: queda cobrado.
    setFila(i, { cobro: estado === "aprobado" ? { id: c.id, estado: "cobrado" } : undefined });
    qr?.onCambio();
  }

  // Mientras hay un cobro esperando, se consulta cada 3 segundos (el aviso de Mercado Pago llega antes casi siempre; esto es el respaldo).
  const claveEspera = filas.map((f) => (f.cobro?.estado === "esperando" ? f.cobro.id : "")).join("|");
  useEffect(() => {
    const pendientes = filas.map((f, i) => ({ i, c: f.cobro })).filter((x) => x.c?.estado === "esperando");
    if (!pendientes.length) return;
    let consultas = 0, activo = true;
    const iv = setInterval(async () => {
      consultas++;
      for (const { i, c } of pendientes) {
        const r = await llamarQR(`/api/pagos/mp/qr/estado?cobro=${c!.id}`);
        if (!activo) return;
        const est = String(r.j.estado ?? "");
        if (est === "aprobado") { setFila(i, { cobro: { id: c!.id, estado: "cobrado" } }); qr?.onCambio(); }
        else if (est === "vencido" || est === "cancelado") { setFila(i, { cobro: { id: c!.id, estado: est as "vencido" | "cancelado" } }); qr?.onCambio(); }
      }
      if (consultas >= QR_CONSULTAS_MAX) clearInterval(iv);
    }, QR_CONSULTA_MS);
    return () => { activo = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveEspera]);

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
    if (qrActivo) {
      if (fs.some((f, i) => esQR(f) && num(f.monto) > 0 && estadoQR[i] === "esperando")) return setError("Todavía se espera el pago del QR. Cuando se acredite, confirmá la venta.");
      if (fs.some((f, i) => esQR(f) && num(f.monto) > 0 && estadoQR[i] !== "cobrado")) return setError("Primero cobrá el QR: tocá \"Cobrar con QR\" y esperá que el cliente pague. Si no usa QR, elegí otro medio.");
    }
    setEnviando(true);
    const err = await onConfirmar(pagos);
    setEnviando(false);
    if (err) setError(err);
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const enInput = !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); void cerrarModal(); return; }
      if (e.key === "Enter") {
        if (t?.closest?.(".qr-panel")) return; // Enter sobre "Cobrar con QR" o "Cancelar este cobro" activa ese botón, no confirma la venta
        e.preventDefault(); e.stopPropagation(); void confirmar(); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "tab" || e.key.length !== 1 && e.key !== "Delete") return;
      const trabada = ref.current.filas[ref.current.activa]?.cobro?.estado === "esperando"; // con un cobro QR esperando no se cambia nada de esa línea
      if (e.key === "Delete") {
        if (trabada) return;
        const v = enInput ? (t as HTMLInputElement).value : "";
        if (!enInput || v === "") { e.preventDefault(); quitar(ref.current.activa); }
        return;
      }
      if (t?.tagName === "SELECT" || t?.tagName === "TEXTAREA") return;
      if (k === "a") { e.preventDefault(); agregar(); return; }
      const medio = ATAJO_MEDIO[k];
      if (medio) { e.preventDefault(); if (!trabada) setFila(ref.current.activa, { medio, cobro: medio === "mercadopago" ? ref.current.filas[ref.current.activa]?.cobro : undefined }); }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc, cliente, estadoQR]);

  const billetes = useMemo(() => {
    const base = [1000, 2000, 5000, 10000, 20000].filter((b) => b >= total).slice(0, 3);
    return base;
  }, [total]);

  return (
    <div className="pos-overlay" role="dialog" aria-modal="true" aria-labelledby="cobro-tit">
      <div className="pos-modal pos-modal--cobro">
        <div className="pos-modal-head">
          <div><p className="pos-eyebrow">Punto de venta</p><h2 id="cobro-tit">Cobrar</h2></div>
          <button className="sec pos-x" onClick={() => void cerrarModal()} aria-label="Cerrar">✕</button>
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
                    <button key={m} type="button" role="radio" aria-checked={f.medio === m} disabled={!!f.cobro && f.cobro.estado === "esperando"}
                      className={`pago-medio${f.medio === m ? " on" : ""}`} onClick={() => { setActiva(i); setFila(i, { medio: m, cobro: m === "mercadopago" ? f.cobro : undefined }); }}>
                      {ETIQUETA_MEDIO[m]} <kbd>{LETRA_MEDIO[m]}</kbd>
                    </button>
                  ))}
                </div>
                <div className="pago-monto">
                  <input type="number" inputMode="decimal" min={0} step={1} autoFocus={i === 0} placeholder="Monto" aria-label="Monto"
                    value={f.monto} disabled={f.cobro?.estado === "esperando" || f.cobro?.estado === "cobrado"} onFocus={() => setActiva(i)} onChange={(e) => setFila(i, { monto: e.target.value })} />
                  {f.medio === "efectivo" && (
                    <span className="pago-rapidos">
                      <button type="button" className="sec" onClick={() => setFila(i, { monto: String(Math.max(0, redondear(total - filas.filter((_, k) => k !== i).reduce((s, x) => s + num(x.monto), 0)))) })}>Exacto</button>
                      {billetes.map((b) => (<button type="button" className="sec" key={b} onClick={() => setFila(i, { monto: String(b) })}>{peso(b)}</button>))}
                    </span>
                  )}
                  <button type="button" className="sec pago-quitar" onClick={() => quitar(i)} aria-label="Quitar línea" disabled={f.cobro?.estado === "esperando"}>✕</button>
                </div>
                {esQR(f) && (
                  <div className="qr-panel" aria-live="polite">
                    {!enLinea ? (
                      <p className="mut">Sin internet: el QR necesita conexión. Cobrá con otro medio; el efectivo sigue funcionando.</p>
                    ) : estadoQR[i] === "esperando" ? (
                      <>
                        <p><b>Esperando el pago de {peso(redondear(num(f.monto)))}.</b> Pedile al cliente que escanee el QR del local con Mercado Pago.</p>
                        <button type="button" className="sec" onClick={() => void cancelarQR(i)}>Cancelar este cobro</button>
                      </>
                    ) : estadoQR[i] === "cobrado" ? (
                      <p className="ok"><b>Cobrado por QR: {peso(redondear(num(f.monto)))}.</b> Ya podés confirmar la venta.</p>
                    ) : (
                      <>
                        {f.cobro?.estado === "vencido" && <p className="pos-error" role="alert">El cobro venció sin pago. Podés generar uno nuevo.</p>}
                        {f.cobro?.estado === "cancelado" && <p className="mut">Cobro cancelado.</p>}
                        <button type="button" onClick={() => void cobrarQR(i)} disabled={redondear(num(f.monto)) < QR_MONTO_MIN}>Cobrar con QR</button>
                        <p className="mut">Mínimo {peso(QR_MONTO_MIN)}. Se genera el cobro y el cliente escanea el QR que está en el mostrador.</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            <button type="button" className="sec pago-agregar" onClick={agregar} disabled={filas.length >= 5}>+ Agregar medio de pago <kbd>A</kbd></button>
            {error && <p className="pos-error" role="alert">{error}</p>}
          </section>
        </div>
        <div className="cobro-keybar"><span><kbd>Tab</kbd> avanzar</span><span><kbd>Supr</kbd> quitar línea</span><span><kbd>Esc</kbd> cancelar</span></div>
        <div className="pos-modal-acciones">
          <button className="sec" onClick={() => void cerrarModal()}>Cancelar <kbd>Esc</kbd></button>
          <button onClick={confirmar} disabled={enviando}>{enviando ? "Registrando…" : <>Confirmar venta <kbd>Enter</kbd></>}</button>
        </div>
      </div>
    </div>
  );
}
