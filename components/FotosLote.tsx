"use client";
import { useMemo, useRef, useState } from "react";
import type { Kiosco, Producto } from "@/lib/supabase";
import { mensajeErrorSql } from "@/lib/errores";
import { MENSAJES_FOTOS, aplicarFotoGratuita, buscarSugerencias } from "@/lib/fotos-cliente";
import { TANDA, faltantes, primeraGratuita, proximaTanda, tieneCodigo } from "@/lib/fotos-lote";
import type { Sugerencia } from "@/lib/fotos-sugerencias";
import Aviso from "@/components/ui/Aviso";

const codigoDe = (e: unknown): string => (e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? "");
const texto = (e: unknown) => { const c = codigoDe(e); return MENSAJES_FOTOS[c] ?? mensajeErrorSql(c); };
const ORIGEN: Record<string, string> = { global: "Cargada por otro local", openfoodfacts: "Open Food Facts (licencia abierta)" };
const FATALES = new Set(["no_autorizado", "fotos_inactivo", "sin_conexion"]);   // si pasan, no tiene sentido seguir con el resto de la tanda
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Propuesta = { producto: Producto; sug: Sugerencia; porCodigo: boolean };

// Completar las fotos que faltan, de a una tanda. Solo fuentes gratuitas. Nunca aplica sola: el encargado o el dueño tilda cuáles usar.
export default function FotosLote({ kiosco, lista, onCambio }: { kiosco: Kiosco; lista: Producto[]; onCambio: () => void }) {
  const [vistos, setVistos] = useState<Set<string>>(new Set());
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [tildadas, setTildadas] = useState<Set<string>>(new Set());
  const [fase, setFase] = useState<"quieto" | "buscando" | "aplicando">("quieto");
  const [progreso, setProgreso] = useState({ hechos: 0, total: 0 });
  const [sinFoto, setSinFoto] = useState(0);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const cancelar = useRef(false);

  const pendientes = useMemo(() => faltantes(lista), [lista]);
  const proximos = useMemo(() => proximaTanda(pendientes, vistos), [pendientes, vistos]);
  if (!kiosco.fotos_auto_activo || pendientes.length === 0) return null;
  const ocupado = fase !== "quieto";

  async function buscarTanda() {
    if (ocupado || proximos.length === 0) return;
    const tanda = proximos;
    cancelar.current = false; setFase("buscando"); setMsg(null); setSinFoto(0); setPropuestas([]); setTildadas(new Set());
    setProgreso({ hechos: 0, total: tanda.length });
    const nuevas: Propuesta[] = [], procesados: string[] = [];
    let sin = 0, fallo: string | null = null;
    for (const p of tanda) {
      if (cancelar.current) break;
      try {
        const r = await buscarSugerencias(kiosco.id, p.id, true);
        const s = primeraGratuita(r.sugerencias);
        if (s) nuevas.push({ producto: p, sug: s, porCodigo: tieneCodigo(p) }); else sin++;
        procesados.push(p.id);
      } catch (e) {
        const c = codigoDe(e);
        if (FATALES.has(c)) { fallo = texto(e); break; }
        procesados.push(p.id); sin++;   // un producto que falla no frena al resto
      }
      setProgreso((x) => ({ ...x, hechos: x.hechos + 1 }));
      await pausa(300);   // sin apuro: Open Food Facts es un servicio gratuito
    }
    setVistos((v) => new Set([...v, ...procesados]));
    setPropuestas(nuevas); setSinFoto(sin); setFase("quieto");
    if (fallo) setMsg({ tipo: "error", texto: fallo });
    else if (nuevas.length === 0) setMsg({ tipo: "ok", texto: "No encontramos fotos para esta tanda. Podés probar con la siguiente o subirlas a mano." });
  }

  async function aplicar() {
    const elegidas = propuestas.filter((x) => tildadas.has(x.producto.id));
    if (ocupado || elegidas.length === 0) return;
    cancelar.current = false; setFase("aplicando"); setMsg(null); setProgreso({ hechos: 0, total: elegidas.length });
    const hechas = new Set<string>(); let falladas = 0, ultimoError = "";
    for (const x of elegidas) {
      if (cancelar.current) break;
      try {
        if (x.sug.fuente !== "global" && x.sug.fuente !== "openfoodfacts") throw new Error("foto_invalida");
        await aplicarFotoGratuita(kiosco.id, x.producto.id, { url: x.sug.url, fuente: x.sug.fuente });
        hechas.add(x.producto.id);
      } catch (e) { falladas++; ultimoError = texto(e); if (FATALES.has(codigoDe(e))) break; }
      setProgreso((p) => ({ ...p, hechos: p.hechos + 1 }));
    }
    setPropuestas((ps) => ps.filter((x) => !hechas.has(x.producto.id))); setTildadas(new Set()); setFase("quieto");
    if (hechas.size > 0) onCambio();
    setMsg(falladas === 0
      ? { tipo: "ok", texto: `Listo: se pusieron ${hechas.size} fotos.` }
      : { tipo: "error", texto: `Se pusieron ${hechas.size} fotos y ${falladas} no se pudieron guardar. ${ultimoError}`.trim() });
  }

  const alternar = (id: string) => setTildadas((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const restantes = pendientes.filter((p) => !vistos.has(p.id)).length;

  return (
    <section aria-label="Completar fotos que faltan" style={{ margin: "12px 0" }}>
      <h3>Fotos que faltan ({pendientes.length})</h3>
      <p className="mut">Buscamos fotos gratis (de otros locales y de Open Food Facts) para {Math.min(TANDA, restantes)} productos a la vez. Vos revisás y tildás las que sirven: nada se cambia solo.</p>
      <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
        <button type="button" className="sec" onClick={buscarTanda} disabled={ocupado || proximos.length === 0} aria-busy={fase === "buscando"}>
          {fase === "buscando" ? `Buscando… ${progreso.hechos} de ${progreso.total}` : proximos.length === 0 ? "Ya revisaste todos" : vistos.size === 0 ? "Buscar fotos para los que faltan" : "Buscar la siguiente tanda"}
        </button>
        {ocupado && <button type="button" className="sec" onClick={() => { cancelar.current = true; }}>Parar</button>}
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {fase === "buscando" && <p role="status" className="mut">Esto puede tardar un rato. Podés parar cuando quieras.</p>}
      {fase === "quieto" && sinFoto > 0 && propuestas.length > 0 && <p role="status" className="mut">Para {sinFoto} productos no encontramos foto. Esos podés cargarlos a mano o con la búsqueda de a uno.</p>}

      {propuestas.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", margin: "8px 0" }}>
            <button type="button" className="sec" disabled={ocupado} onClick={() => setTildadas(new Set(propuestas.filter((x) => x.porCodigo).map((x) => x.producto.id)))}>Tildar las que coinciden por código</button>
            <button type="button" className="sec" disabled={ocupado || tildadas.size === 0} onClick={() => setTildadas(new Set())}>Destildar todas</button>
            <button type="button" disabled={ocupado || tildadas.size === 0} onClick={aplicar} aria-busy={fase === "aplicando"}>
              {fase === "aplicando" ? `Guardando… ${progreso.hechos} de ${progreso.total}` : `Usar ${tildadas.size} fotos tildadas`}
            </button>
            <button type="button" className="sec" disabled={ocupado} onClick={() => { setPropuestas([]); setTildadas(new Set()); }}>Descartar estas</button>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {propuestas.map((x) => {
              const id = `lote-${x.producto.id}`;
              return (
                <li key={x.producto.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input id={id} type="checkbox" checked={tildadas.has(x.producto.id)} onChange={() => alternar(x.producto.id)} disabled={ocupado} style={{ width: "auto" }} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={x.sug.miniatura} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: 72, height: 72, objectFit: "contain", background: "#fff", borderRadius: 6, flex: "none" }} />
                  <label htmlFor={id} style={{ display: "block" }}>
                    <strong>{x.producto.nombre}</strong>
                    <span className="mut" style={{ display: "block", fontSize: 13 }}>
                      {x.porCodigo ? "Coincide por código de barras" : "Encontrada por nombre: revisá que sea el mismo producto"} · {ORIGEN[x.sug.fuente]}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
