"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { mensajeErrorSql } from "@/lib/errores";

type Resumen = { generados: number; usados: number; sin_usar: number };

/** Talonario de papelitos (0044): el local genera lotes, los imprime y decide si el efectivo pide código. */
export default function PapelitosClub({ kiosco }: { kiosco: Kiosco }) {
  const [exige, setExige] = useState<boolean | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [sinUsar, setSinUsar] = useState<string[]>([]);
  const [nuevos, setNuevos] = useState<string[]>([]);
  const [paraImprimir, setParaImprimir] = useState<string[]>([]);
  const [cantidad, setCantidad] = useState("50");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const { data: k } = await supabase.from("kioscos").select("club_exigir_codigo").eq("id", kiosco.id).maybeSingle();
    setExige(Boolean((k as { club_exigir_codigo?: boolean } | null)?.club_exigir_codigo));
    const { data, error } = await supabase.rpc("club_codigos_resumen", { p_kiosco: kiosco.id });
    if (!error) setResumen(data as Resumen);
    const { data: sin, error: errSin } = await supabase.rpc("club_codigos_sin_usar", { p_kiosco: kiosco.id });
    if (!errSin) setSinUsar((sin as string[]) ?? []);
  }, [kiosco.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const errorSql = (m: string) => (m.includes("no_autorizado") ? "Solo el dueño puede cambiar esto." : mensajeErrorSql(m, "club"));

  async function cambiarExige(valor: boolean) {
    setMsg(""); setOcupado(true);
    const { error } = await supabase.rpc("club_configurar_codigos", { p_kiosco: kiosco.id, p_exige: valor });
    setOcupado(false);
    if (error) return setMsg(errorSql(error.message));
    setExige(valor);
    setMsg(valor ? "Ahora el efectivo pide el papelito." : "El efectivo ya no pide papelito.");
  }

  async function generar() {
    setMsg("");
    const n = Number(cantidad);
    if (!Number.isInteger(n) || n < 1 || n > 200) return setMsg("Elegí entre 1 y 200 papelitos por vez.");
    setOcupado(true);
    const { data, error } = await supabase.rpc("club_generar_codigos", { p_kiosco: kiosco.id, p_cantidad: n });
    setOcupado(false);
    if (error) return setMsg(errorSql(error.message));
    const codigos = ((data as { codigos: string[] }).codigos) ?? [];
    setNuevos(codigos);
    setMsg(`Listo: ${codigos.length} papelitos nuevos. Imprimilos antes de dárselos a los clientes.`);
    await cargar();
  }

  async function traerSinUsar(): Promise<string[]> {
    const { data, error } = await supabase.rpc("club_codigos_sin_usar", { p_kiosco: kiosco.id });
    if (error) { setMsg(errorSql(error.message)); return []; }
    const lista = (data as string[]) ?? [];
    setSinUsar(lista);
    return lista;
  }

  async function imprimir() {
    // Imprime los recién generados si hay; si no, todos los que quedan sin usar.
    const lista = nuevos.length ? nuevos : await traerSinUsar();
    if (!lista.length) return setMsg("No hay papelitos sin usar para imprimir.");
    setParaImprimir(lista);
    setTimeout(() => window.print(), 50);
  }

  return (
    <div className="card">
      <style>{`
        .papelitos-print { display: none; }
        @media print {
          body * { visibility: hidden !important; }
          .papelitos-print, .papelitos-print * { visibility: visible !important; } /* globals.css oculta todo en impresión con !important */
          .papelitos-print { display: grid; position: absolute; left: 0; top: 0; width: 100%; box-sizing: border-box; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 12px; }
          .papelitos-print div { box-sizing: border-box; min-width: 0; border: 1.5px dashed var(--ink); border-radius: 3px; padding: 10px 4px; text-align: center; font: 700 18px var(--f-mono); letter-spacing: 2px; color: var(--ink); break-inside: avoid; }
        }
      `}</style>

      <h3>Papelitos para el efectivo</h3>
      <p className="mut" style={{ marginTop: 0 }}>Cada papelito suma un sello en efectivo y se usa una sola vez. Imprimilos y entregalos al cliente al cobrar.</p>

      <label>
        <input type="checkbox" checked={exige === true} disabled={exige === null || ocupado} onChange={(e) => void cambiarExige(e.target.checked)} />
        {" "}Pedir papelito para pagos en efectivo
      </label>
      <p className="mut">Transferencia y Mercado Pago no piden papelito.</p>

      {resumen && (
        <p className="mut">Generados: {resumen.generados} · usados: {resumen.usados} · sin usar: {resumen.sin_usar}</p>
      )}

      <label>Cuántos generar (1 a 200)
        <input inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
      </label>
      <button type="button" onClick={generar} disabled={ocupado}>Generar papelitos</button>
      <button type="button" className="sec" onClick={imprimir} disabled={ocupado}>Imprimir papelitos</button>

      {msg && <p role="status" className="mut">{msg}</p>}

      {sinUsar.length > 0 && (
        <details>
          <summary>Ver los que quedan sin usar ({sinUsar.length})</summary>
          <p className="mut mono" style={{ wordSpacing: 6 }}>{sinUsar.join("  ")}</p>
        </details>
      )}

      <div className="papelitos-print" aria-hidden="true">
        {paraImprimir.map((c) => <div key={c}>{c}</div>)}
      </div>
    </div>
  );
}
