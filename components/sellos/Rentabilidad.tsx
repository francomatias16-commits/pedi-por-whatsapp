"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { CONFIRMACION, DONDE_SE_ARMA, FACTIBILIDAD_TEXTO, FAMILIAS, FASE_TEXTO, SEMAFORO, estadoPromo, validarAjustesPromos, type PromoCatalogo, type PromoEvaluacion, type PromoPanel } from "@/lib/promos";
import { mensajeErrorSql } from "@/lib/errores";
import Aviso from "@/components/ui/Aviso";
import Insignia from "@/components/ui/Insignia";
import { useConfirmar } from "@/components/ui/Confirmar";
import Liquidacion from "./Liquidacion";
import Etapas from "./Etapas";
import Sorteos from "./Sorteos";
import HistorialPromos from "./HistorialPromos";
import Sugeridas from "./Sugeridas";

const pesos = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("es-AR")}`);

/** Margen y tope, rentabilidad de los premios (calculada por la base) y catálogo de opciones para activar. */
export default function Rentabilidad({ kiosco, onCambio }: { kiosco: Kiosco; onCambio: () => void }) {
  const [ev, setEv] = useState<PromoEvaluacion | null>(null);
  const [catalogo, setCatalogo] = useState<PromoCatalogo[]>([]);
  const [panel, setPanel] = useState<PromoPanel | null>(null);
  const activas = panel?.activas.map((x) => x.clave) ?? [];
  const [margen, setMargen] = useState(String(kiosco.club_margen_minimo ?? 20));
  const [tope, setTope] = useState(String(kiosco.club_tope_promos_pct ?? 5));
  const [aviso, setAviso] = useState(String(kiosco.club_aviso_previo_dias ?? 1));
  const [msg, setMsg] = useState("");
  const [deshacer, setDeshacer] = useState<{ clave: string; nombre: string; sale: string | null } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ventana, confirmar] = useConfirmar();

  const cargar = useCallback(async () => {
    const [e, a] = await Promise.all([
      supabase.rpc("club_evaluar", { p_kiosco: kiosco.id }),
      supabase.rpc("promo_panel", { p_kiosco: kiosco.id }),
    ]);
    if (e.error) return setMsg(mensajeErrorSql(e.error.message, "club"));
    setEv(e.data as PromoEvaluacion);
    if (!a.error) setPanel(a.data as PromoPanel);
  }, [kiosco.id]);

  useEffect(() => {
    void cargar();
    void supabase.from("promo_catalogo").select("*").order("orden").then(({ data }) => setCatalogo((data as PromoCatalogo[]) ?? []));
  }, [cargar]);

  async function guardar() {
    setMsg("");
    const r = validarAjustesPromos(margen, tope, aviso);
    if (!r.ok) return setMsg(r.error);
    const { error } = await supabase.from("kioscos").update(r.datos).eq("id", kiosco.id);
    if (error) return setMsg("No se pudo guardar. Probá de nuevo.");
    await cargar();
    setMsg("Guardado.");
  }

  async function activar(c: PromoCatalogo) {
    setMsg(""); setDeshacer(null);
    if (!(await confirmar({ titulo: c.nombre, detalle: CONFIRMACION[c.clave] ?? "¿Lo activo?", confirmar: "Sí, activar", cancelar: "No, volver" }))) return;
    setOcupado(true);
    let r = await supabase.rpc("promo_activar", { p_kiosco: kiosco.id, p_clave: c.clave });
    // Si el premio principal deja un margen bajo el mínimo, se pide una segunda confirmación explícita.
    if (r.error?.message.includes("promo_reduce_margen")) {
      const sigue = await confirmar({ titulo: "Baja el margen", detalle: `${panel?.factibilidad.motivo ?? "El premio deja poco margen."} ¿Querés activarla igual?`, confirmar: "Sí, activar igual", cancelar: "No, volver", peligro: true });
      if (!sigue) { setOcupado(false); return; }
      r = await supabase.rpc("promo_activar", { p_kiosco: kiosco.id, p_clave: c.clave, p_confirmar_margen: true });
    }
    setOcupado(false);
    if (r.error) return setMsg(mensajeErrorSql(r.error.message, "club"));
    const sale = (r.data as { sale_el?: string | null } | null)?.sale_el;
    setDeshacer({ clave: c.clave, nombre: c.nombre, sale: sale ? sale.split("-").reverse().join("/") : null });
    await cargar(); onCambio();
  }

  async function pausar(clave: string, aviso: boolean) {
    setMsg("");
    setOcupado(true);
    const { error } = await supabase.rpc("promo_desactivar", { p_kiosco: kiosco.id, p_clave: clave });
    setOcupado(false);
    if (error) return setMsg(mensajeErrorSql(error.message, "club"));
    setDeshacer(null);
    if (aviso) setMsg("Listo, la promoción quedó pausada.");
    await cargar(); onCambio();
  }

  const disponibles = catalogo.filter((c) => estadoPromo(c, activas) === "disponible");
  // Solo se recomienda lo que se puede activar hoy: sin stock, con margen bajo o con el tope superado no se recomienda nada.
  const recomendadas = panel?.factibilidad.estado === "lista" ? disponibles.slice(0, 2) : [];

  return (
    <>
      {ventana}
      <Sugeridas kiosco={kiosco} onCambio={onCambio} />
      <div className="card">
        <h3>Margen y tope de promociones</h3>
        <p className="mut">Margen mínimo: lo menos que querés ganar en un producto con promo. Tope: lo máximo que gastás en promos en el mes, como % de las ventas.</p>
        <label>Margen mínimo (%)
          <input inputMode="decimal" value={margen} onChange={(e) => setMargen(e.target.value)} />
        </label>
        <label>Tope mensual de promociones (% de las ventas)
          <input inputMode="decimal" value={tope} onChange={(e) => setTope(e.target.value)} />
        </label>
        <label>Aviso previo de las promociones automáticas (días)
          <input inputMode="numeric" value={aviso} onChange={(e) => setAviso(e.target.value)} />
        </label>
        <p className="mut">Con 1 día, una promoción automática (como la bienvenida) empieza mañana y no hoy. Con 0 empieza al instante.</p>
        <button type="button" onClick={guardar}>Guardar</button>
      </div>

      {panel && (
        <div className="card">
          <h3>Lo que llevan las promociones este mes</h3>
          <p className="mut">
            {panel.costo_mes.costo_sello == null
              ? "Todavía no hay un premio con costo para calcular."
              : `Costo estimado: ${pesos(panel.costo_mes.costo_promos)} de un tope de ${pesos(panel.costo_mes.tope_pesos)} (${panel.costo_mes.tope_pct}% de las ventas del mes, ${pesos(panel.costo_mes.ventas_mes)}).`}
          </p>
          {panel.costo_mes.usado_pct != null && <progress max={100} value={Math.min(panel.costo_mes.usado_pct, 100)} aria-label="Porcentaje del tope usado" />}
          {panel.costo_mes.supera && <Aviso tipo="alerta">Se llegó al tope del mes: las promociones automáticas se pausaron solas. Podés subir el tope o esperar al mes que viene.</Aviso>}
          <p><Insignia tono={FACTIBILIDAD_TEXTO[panel.factibilidad.estado].tono}>{FACTIBILIDAD_TEXTO[panel.factibilidad.estado].texto}</Insignia> <span className="mut">{panel.factibilidad.motivo}</span></p>
        </div>
      )}

      <div className="card">
        <h3>Tus premios, con las cuentas</h3>
        {!ev && <p className="mut">Calculando…</p>}
        {ev && (
          <>
            <p className="mut">
              {ev.ticket_promedio == null
                ? "Todavía no hay ventas suficientes para calcular. Cuando haya compras de los últimos 90 días, acá aparecen las cuentas."
                : `Compra promedio de los últimos 90 días: ${pesos(ev.ticket_promedio)}.`}
            </p>
            {ev.premios.length === 0 && <p className="mut">Todavía no tenés premios cargados. Creá uno en “Tu premio”.</p>}
            {ev.premios.map((p) => (
              <div className="fila-sep" key={p.premio_id}>
                <div className="row">
                  <b>{p.nombre} · {p.costo_sellos} sellos</b>
                  <Insignia tono={SEMAFORO[p.semaforo].tono}>{SEMAFORO[p.semaforo].texto}</Insignia>
                </div>
                <p className="mut">{p.frase}</p>
              </div>
            ))}
          </>
        )}
      </div>

      {recomendadas.length > 0 && (
        <div className="card">
          <h3>Recomendado para vos</h3>
          <p className="mut">Opciones que podés activar hoy.</p>
          {recomendadas.map((c) => (
            <div className="row fila-sep" key={c.clave}>
              <span><b>{c.nombre}</b><span className="mut"> · {c.descripcion}</span></span>
              <button type="button" disabled={ocupado} onClick={() => activar(c)}>Activar</button>
            </div>
          ))}
        </div>
      )}

      {deshacer && (
        <Aviso tipo="ok">
          Activaste “{deshacer.nombre}”.{deshacer.sale ? ` Empieza el ${deshacer.sale}: hasta entonces la podés deshacer sin que nadie la vea.` : ""} <button type="button" className="sec" disabled={ocupado} onClick={() => pausar(deshacer.clave, true)}>Deshacer</button>
        </Aviso>
      )}
      {msg && <Aviso tipo={msg === "Guardado." || msg.startsWith("Listo") ? "ok" : "alerta"}>{msg}</Aviso>}

      <div className="card">
        <h3>Opciones para promocionar</h3>
        <p className="mut">Todas las opciones del plan. Las que se arman con productos, niveles o sorteos se configuran en las secciones de abajo.</p>
        {FAMILIAS.map((f) => {
          const items = catalogo.filter((c) => c.familia === f.clave);
          if (items.length === 0) return null;
          return (
            <section key={f.clave}>
              <h4>{f.titulo}</h4>
              {items.map((c) => {
                const est = estadoPromo(c, activas);
                return (
                  <div className="row fila-sep" key={c.clave}>
                    <span>
                      <b>{c.nombre}</b>{c.automatica && <span className="mut"> · automática</span>}
                      <span className="mut"> · {c.descripcion}</span>
                    </span>
                    {est === "activa" && <span className="row"><Insignia tono="ok" icono="✔">Activa</Insignia><button type="button" className="sec" disabled={ocupado} onClick={() => pausar(c.clave, true)}>Pausar</button></span>}
                    {est === "disponible" && <button type="button" disabled={ocupado} onClick={() => activar(c)}>Activar</button>}
                    {est === "configurable" && <Insignia tono="info">{DONDE_SE_ARMA[c.clave] ?? "Se arma más abajo."}</Insignia>}
                    {est === "proximamente" && <Insignia tono="neutro">{FASE_TEXTO[c.fase]}</Insignia>}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      <Liquidacion kiosco={kiosco} onCambio={() => { void cargar(); onCambio(); }} />
      <Etapas kiosco={kiosco} onCambio={() => { void cargar(); onCambio(); }} />
      <Sorteos kiosco={kiosco} />
      <HistorialPromos kiosco={kiosco} />
    </>
  );
}
