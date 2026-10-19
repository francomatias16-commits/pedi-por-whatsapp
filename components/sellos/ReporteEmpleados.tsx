"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { fechaCorta, rangoDias, resumirPorEmpleado, type FilaEmpleado } from "@/lib/auditoria";

/** Quién dio sellos y quién canjeó premios, por persona y por día. Solo lo ve el dueño de la cuenta. */
export default function ReporteEmpleados({ kiosco }: { kiosco: Kiosco }) {
  const [dias, setDias] = useState(7);
  const [filas, setFilas] = useState<FilaEmpleado[] | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setError(""); setFilas(null);
    const { desde, hasta } = rangoDias(dias);
    const { data, error: e } = await supabase.rpc("sellos_por_empleado", { p_kiosco: kiosco.id, p_desde: desde, p_hasta: hasta });
    if (e) return setError(e.message.includes("no_autorizado") ? "Este reporte lo ve solo el dueño de la cuenta." : "No se pudo cargar el reporte.");
    setFilas(((data ?? []) as FilaEmpleado[]).map((f) => ({ ...f, sellos: Number(f.sellos), manuales: Number(f.manuales), anulados: Number(f.anulados), canjes: Number(f.canjes) })));
  }, [kiosco.id, dias]);
  useEffect(() => { void cargar(); }, [cargar]);

  const resumen = useMemo(() => resumirPorEmpleado(filas ?? []), [filas]);
  return (
    <div className="card">
      <h3>Sellos por empleado</h3>
      <p className="mut" style={{ marginTop: 0 }}>Quién cargó cada sello y cada canje desde la caja y el panel. Los sellos del club y de los pedidos los suma el cliente y no figuran acá. Lo anterior a esta función aparece como “Sin registrar”.</p>
      <div className="row" style={{ justifyContent: "flex-start", gap: 6 }}>
        {[7, 30].map((n) => <button key={n} type="button" className={dias === n ? "" : "sec"} aria-pressed={dias === n} onClick={() => setDias(n)}>Últimos {n} días</button>)}
      </div>
      {error && <p role="alert" className="mut">{error}</p>}
      {!error && filas === null && <p className="mut">Cargando…</p>}
      {!error && filas && resumen.length === 0 && <p className="mut">No hay sellos ni canjes cargados por el equipo en este período.</p>}
      {resumen.map((e) => (
        <details key={e.clave} className="card" style={{ margin: "8px 0" }}>
          <summary>
            <b>{e.nombre}</b> · {e.sellos} sello{e.sellos === 1 ? "" : "s"}{e.manuales ? ` (${e.manuales} manual${e.manuales === 1 ? "" : "es"})` : ""} · {e.canjes} canje{e.canjes === 1 ? "" : "s"}{e.anulados ? ` · ${e.anulados} anulado${e.anulados === 1 ? "" : "s"}` : ""}
            {e.senales.map((s) => <span key={s} role="status" style={{ marginLeft: 8 }}>⚠ {s}</span>)}
          </summary>
          {e.dias.map((d) => (
            <div className="row fila-sep" key={d.dia}>
              <span>{fechaCorta(d.dia)}</span>
              <span>{d.sellos} sello{d.sellos === 1 ? "" : "s"}{d.manuales ? ` · ${d.manuales} manual${d.manuales === 1 ? "" : "es"}` : ""}{d.canjes ? ` · ${d.canjes} canje${d.canjes === 1 ? "" : "s"}` : ""}{d.anulados ? ` · ${d.anulados} anulado${d.anulados === 1 ? "" : "s"}` : ""}</span>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}
