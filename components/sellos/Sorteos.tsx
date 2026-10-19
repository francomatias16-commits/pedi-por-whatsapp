"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { AVISO_LEGAL_SORTEO, ESTADO_SORTEO_TEXTO, hoyArgentina, periodoMesAnterior, puedeSortear, validarSorteo, type Sorteo } from "@/lib/promos";
import { mensajeErrorSql } from "@/lib/errores";
import Aviso from "@/components/ui/Aviso";
import Insignia from "@/components/ui/Insignia";
import { useConfirmar } from "@/components/ui/Confirmar";

const fecha = (s: string) => s.split("-").reverse().join("/");
const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

/** Sorteos con papelitos usados como chances. Se hacen una sola vez, con semilla guardada y verificables (0052). El permiso legal lo confirma el dueño. */
export default function Sorteos({ kiosco }: { kiosco: Kiosco }) {
  const [lista, setLista] = useState<Sorteo[]>([]);
  const [nombre, setNombre] = useState("");
  const [premios, setPremios] = useState(["", "", ""]);
  const [desde, setDesde] = useState(() => periodoMesAnterior(hoyArgentina()).desde);
  const [hasta, setHasta] = useState(() => periodoMesAnterior(hoyArgentina()).hasta);
  const [nota, setNota] = useState("");
  const [chances, setChances] = useState<Record<string, { chances: number; clientes: number }>>({});
  const [verif, setVerif] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [ventana, confirmar] = useConfirmar();

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("sorteo_listar", { p_kiosco: kiosco.id });
    if (error) { setOk(false); return setMsg(mensajeErrorSql(error.message, "club")); }
    const l = (data as Sorteo[]) ?? [];
    setLista(l);
    for (const s of l.filter((x) => x.estado === "borrador")) {
      const r = await supabase.rpc("sorteo_chances_resumen", { p_kiosco: kiosco.id, p_desde: s.desde, p_hasta: s.hasta });
      if (!r.error) setChances((c) => ({ ...c, [s.id]: r.data as { chances: number; clientes: number } }));
    }
  }, [kiosco.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function llamar(fn: string, args: Record<string, unknown>, exito: string) {
    setOcupado(true); setMsg("");
    const { error } = await supabase.rpc(fn, { p_kiosco: kiosco.id, ...args });
    setOcupado(false);
    if (error) { setOk(false); setMsg(mensajeErrorSql(error.message, "club")); return false; }
    setOk(true); setMsg(exito); await cargar(); return true;
  }

  async function crear() {
    const v = validarSorteo(nombre, premios, desde, hasta);
    if (!v.ok) { setOk(false); return setMsg(v.error); }
    if (await llamar("sorteo_crear", { p_nombre: v.datos.nombre, p_premios: v.datos.premios, p_desde: v.datos.desde, p_hasta: v.datos.hasta }, "Listo, el sorteo quedó armado. Falta confirmar el permiso.")) {
      const mes = periodoMesAnterior(hoyArgentina());
      setNombre(""); setPremios(["", "", ""]); setDesde(mes.desde); setHasta(mes.hasta);
    }
  }

  async function confirmarPermiso(s: Sorteo) {
    if (!(await confirmar({ titulo: "Permiso del sorteo", detalle: "Confirmás que contás con el permiso que corresponde para hacer este sorteo. Queda registrado quién y cuándo. ¿Seguimos?", confirmar: "Sí, lo confirmo", cancelar: "No, volver" }))) return;
    await llamar("sorteo_confirmar_permiso", { p_sorteo: s.id, p_nota: nota || null }, "Permiso confirmado."); setNota("");
  }

  async function realizar(s: Sorteo) {
    if (!(await confirmar({ titulo: s.nombre, detalle: "El sorteo se hace una sola vez y no se puede repetir ni deshacer. ¿Lo realizo ahora?", confirmar: "Sí, sortear", cancelar: "No, volver", peligro: true }))) return;
    await llamar("sorteo_realizar", { p_sorteo: s.id }, "Listo, ya están los ganadores.");
  }

  async function cancelar(s: Sorteo) {
    if (!(await confirmar({ titulo: s.nombre, detalle: "Se cancela el sorteo y no se puede reactivar. ¿Lo cancelo?", confirmar: "Sí, cancelar", cancelar: "No, volver", peligro: true }))) return;
    await llamar("sorteo_cancelar", { p_sorteo: s.id }, "Sorteo cancelado.");
  }

  async function verificar(s: Sorteo) {
    const { data, error } = await supabase.rpc("sorteo_verificar", { p_kiosco: kiosco.id, p_sorteo: s.id });
    if (error) return setVerif((v) => ({ ...v, [s.id]: mensajeErrorSql(error.message, "club") }));
    const d = data as { coincide: boolean; chances: number };
    setVerif((v) => ({ ...v, [s.id]: d.coincide ? `Verificado: repetido con la semilla guardada y ${d.chances} chances, da los mismos ganadores.` : "No coincide. Guardá una captura y avisá a soporte." }));
  }

  const hoy = hoyAR();
  return (
    <div className="card">
      {ventana}
      <h3>Sorteos</h3>
      <p className="mut">Cada papelito usado en el período es una chance. Un cliente no puede ganar dos premios del mismo sorteo.</p>
      <Aviso tipo="info">{AVISO_LEGAL_SORTEO}</Aviso>
      {msg && <Aviso tipo={ok ? "ok" : "alerta"}>{msg}</Aviso>}

      <section>
        <h4>Armar un sorteo</h4>
        <label>Nombre<input value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} /></label>
        {premios.map((p, i) => <label key={i}>Premio {i + 1}{i > 0 ? " (opcional)" : ""}<input value={p} maxLength={80} onChange={(e) => setPremios((x) => x.map((y, j) => (j === i ? e.target.value : y)))} /></label>)}
        <label>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <button type="button" disabled={ocupado} onClick={crear}>Armar sorteo</button>
      </section>

      {lista.map((s) => (
        <div className="fila-sep" key={s.id}>
          <div className="row">
            <span><b>{s.nombre}</b><span className="mut"> · del {fecha(s.desde)} al {fecha(s.hasta)} · {s.etapas} premio{s.etapas === 1 ? "" : "s"}</span></span>
            <Insignia tono={ESTADO_SORTEO_TEXTO[s.estado].tono}>{ESTADO_SORTEO_TEXTO[s.estado].texto}</Insignia>
          </div>
          {s.estado === "borrador" && (
            <>
              <p className="mut">{chances[s.id] ? `Hasta ahora: ${chances[s.id].chances} chances de ${chances[s.id].clientes} clientes.` : "Contando chances…"}</p>
              {!s.permiso_confirmado
                ? (
                  <>
                    <label>Dato del permiso (opcional, por ejemplo el número de expediente)<input value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} /></label>
                    <button type="button" className="sec" disabled={ocupado} onClick={() => confirmarPermiso(s)}>Confirmar que tengo el permiso</button>
                  </>
                )
                : <p><Insignia tono="ok" icono="✔">Permiso confirmado</Insignia></p>}
              <div className="row">
                <button type="button" disabled={ocupado || !puedeSortear(s, hoy)} onClick={() => realizar(s)}>Realizar el sorteo</button>
                <button type="button" className="sec" disabled={ocupado} onClick={() => cancelar(s)}>Cancelar</button>
              </div>
              {s.permiso_confirmado && s.hasta >= hoy && <p className="mut">Se puede sortear a partir del {fecha(new Date(new Date(`${s.hasta}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10))}, cuando termina el período.</p>}
            </>
          )}
          {s.estado === "realizado" && (
            <>
              <ol>{s.ganadores.map((g) => <li key={g.etapa}><b>{g.premio}</b>: {g.cliente ?? "cliente borrado"}{g.codigo ? <span className="mut"> · papelito {g.codigo}</span> : null}</li>)}</ol>
              <p className="mut">Semilla guardada: {s.semilla}</p>
              <button type="button" className="sec" onClick={() => verificar(s)}>Verificar el resultado</button>
              {verif[s.id] && <Aviso tipo={verif[s.id].startsWith("Verificado") ? "ok" : "alerta"}>{verif[s.id]}</Aviso>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
