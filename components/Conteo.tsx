"use client";
import { useConfirmar } from "@/components/ui/Confirmar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { cantidadDesdeTexto, cantidadTexto } from "@/lib/compras";
import { cantidadAInput, mensajeReposicion } from "@/lib/reposicion";
import { peso } from "@/lib/whatsapp";
import { resolverLectura, sumarLectura, type ProdCodigo } from "@/lib/conteo";
import Escaner from "./Escaner";
import VincularCelular from "./caja/VincularCelular";
import { useVinculoCelular } from "./caja/useVinculoCelular";

type Item = { producto_id: string; nombre: string; categoria: string; por_peso: boolean; stock_al_armar: number; stock_actual: number; contado: number | null };
type Sesion = { id: string; criterio: "todos" | "bajo" | "categoria"; categoria: string | null; items: Item[] };
type Dif = { producto_id: string; nombre: string; por_peso: boolean; stock_actual: number; contado: number; diferencia: number; costo: number };

export default function Conteo({ kiosco }: { kiosco: Kiosco }) {
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const [sesion, setSesion] = useState<Sesion | null | undefined>(undefined);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [filtro, setFiltro] = useState("");
  const [unoPorUno, setUnoPorUno] = useState(false);
  const [indice, setIndice] = useState(0);
  const [dif, setDif] = useState<{ lista: Dif[]; sinContar: number } | null>(null);
  const [resultado, setResultado] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [criterio, setCriterio] = useState<"todos" | "bajo" | "categoria">("todos");
  const [categoria, setCategoria] = useState("");
  const [categorias, setCategorias] = useState<string[]>([]);
  const [codigos, setCodigos] = useState<ProdCodigo[]>([]);
  const [camara, setCamara] = useState(false);
  const [verVinculo, setVerVinculo] = useState(false);
  const [lectura, setLectura] = useState("");
  const editsRef = useRef(edits); editsRef.current = edits;
  const sesionRef = useRef(sesion); sesionRef.current = sesion;
  const codigosRef = useRef(codigos); codigosRef.current = codigos;

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("conteo_actual", { p_kiosco: kiosco.id });
    if (error) { setMsg(mensajeReposicion(error.message)); return; }
    const s = data && !Array.isArray(data) ? (data as Sesion) : null;
    setSesion(s);
    setEdits({});
    setDif(null);
    if (!s) {
      const { data: cats } = await supabase.from("productos").select("categoria").eq("kiosco_id", kiosco.id).eq("stock_controlado", true);
      setCategorias(Array.from(new Set((cats ?? []).map((c) => c.categoria as string))).sort((a, b) => a.localeCompare(b, "es")));
    }
  }, [kiosco.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  // Códigos de barras / PLU de los productos de la planilla (en tandas: el límite de filas de la API es 1000).
  const idsKey = sesion ? sesion.items.map((i) => i.producto_id).join(",") : "";
  useEffect(() => {
    if (!idsKey) { setCodigos([]); return; }
    const ids = idsKey.split(",");
    let vivo = true;
    (async () => {
      const acum: ProdCodigo[] = [];
      for (let k = 0; k < ids.length; k += 150) {
        const { data } = await supabase.from("productos").select("id,barcode,plu").eq("kiosco_id", kiosco.id).in("id", ids.slice(k, k + 150));
        for (const r of data ?? []) acum.push({ id: r.id as string, barcode: (r.barcode as string | null) ?? null, plu: (r.plu as string | null) ?? null });
      }
      // Productos de la planilla que no están en la lista de arriba (otro kiosco) no se pueden escanear: no pasa nada.
      if (vivo) setCodigos(acum);
    })();
    return () => { vivo = false; };
  }, [idsKey, kiosco.id]);

  // Un código leído (cámara o celular vinculado): suma 1 al producto, o los kilos de la etiqueta de balanza.
  const procesarCodigo = useCallback((codigo: string) => {
    const s = sesionRef.current;
    if (!s) return;
    const r = resolverLectura(codigo, codigosRef.current, s.items);
    if (r.tipo === "nada") { setLectura(`No encontré ningún producto con el código ${codigo.trim()}.`); return; }
    if (r.tipo === "fuera") { setLectura("Ese producto no está en esta planilla."); return; }
    const item = s.items.find((i) => i.producto_id === r.producto_id)!;
    const actual = editsRef.current[item.producto_id] ?? (item.contado === null ? "" : cantidadAInput(item.contado, item.por_peso));
    const nuevo = sumarLectura(actual, item.por_peso, r.gramos);
    setFiltro("");
    if (nuevo === null) {
      setLectura(item.por_peso && !r.gramos ? `${item.nombre} es por peso: pesalo y escribí los kilos (o escaneá la etiqueta de la balanza).` : `Revisá la cantidad de ${item.nombre}.`);
    } else {
      setEdits((prev) => ({ ...prev, [item.producto_id]: nuevo }));
      setLectura(`${item.nombre}: ${nuevo}${item.por_peso ? " kg" : ""}`);
    }
    setTimeout(() => document.getElementById(`conteo-${item.producto_id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  }, []);

  const camaraQuiere = useRef(false);
  const abrirCamara = (v: boolean) => { camaraQuiere.current = v; setCamara(v); };
  const alLeerCamara = (codigo: string) => {
    // La cámara se cierra sola tras cada lectura; se reabre con una pausa para no leer dos veces la misma etiqueta.
    setCamara(false); procesarCodigo(codigo);
    setTimeout(() => { if (camaraQuiere.current) setCamara(true); }, 900);
  };
  useEffect(() => () => { camaraQuiere.current = false; }, []);
  const vinculo = useVinculoCelular({ kioscoId: kiosco.id, onCodigo: procesarCodigo });

  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return (sesion?.items ?? []).filter((i) => !q || i.nombre.toLowerCase().includes(q));
  }, [sesion, filtro]);
  const contados = useMemo(() => (sesion?.items ?? []).filter((i) => (edits[i.producto_id] ?? (i.contado === null ? "" : cantidadAInput(i.contado, i.por_peso))) !== "").length, [sesion, edits]);

  const txtDe = (i: Item) => edits[i.producto_id] ?? (i.contado === null ? "" : cantidadAInput(i.contado, i.por_peso));

  // Guarda lo que se editó. Devuelve false si alguna cantidad no es válida.
  async function guardarEdiciones(): Promise<boolean> {
    if (!sesion) return false;
    const cambios = sesion.items.filter((i) => edits[i.producto_id] !== undefined);
    if (cambios.length === 0) return true;
    const payload: { producto_id: string; contado: number | null }[] = [];
    for (const i of cambios) {
      const t = edits[i.producto_id].trim();
      if (t === "") { payload.push({ producto_id: i.producto_id, contado: null }); continue; }
      const n = cantidadDesdeTexto(t, i.por_peso);
      if (n === null) { setMsg(`Revisá la cantidad de ${i.nombre}.`); return false; }
      payload.push({ producto_id: i.producto_id, contado: n });
    }
    const { error } = await supabase.rpc("conteo_guardar", { p_sesion: sesion.id, p_items: payload });
    if (error) { setMsg(mensajeReposicion(error.message)); return false; }
    return true;
  }

  async function empezar() {
    setOcupado(true); setMsg(""); setResultado("");
    const { error } = await supabase.rpc("conteo_crear", { p_kiosco: kiosco.id, p_criterio: criterio, p_categoria: criterio === "categoria" ? categoria : null });
    setOcupado(false);
    if (error) return setMsg(mensajeReposicion(error.message));
    await cargar();
  }

  async function guardarAvance() {
    setOcupado(true); setMsg("");
    const ok = await guardarEdiciones();
    setOcupado(false);
    if (ok) { setMsg("Avance guardado"); await cargar(); }
  }

  async function verDiferencias() {
    if (!sesion) return;
    setOcupado(true); setMsg("");
    const ok = await guardarEdiciones();
    if (!ok) { setOcupado(false); return; }
    const { data, error } = await supabase.rpc("conteo_diferencias", { p_sesion: sesion.id });
    setOcupado(false);
    if (error) return setMsg(mensajeReposicion(error.message));
    const r = data as { diferencias: Dif[]; sin_contar: number };
    setDif({ lista: r.diferencias.map((d) => ({ ...d, diferencia: Number(d.diferencia), costo: Number(d.costo) })), sinContar: r.sin_contar });
  }

  async function aplicar() {
    if (!sesion) return;
    if (!await confirmar({ titulo: "¿Guardar lo contado? El stock de los productos contados queda en lo que pusiste. Los que quedaron sin contar no cambian.", confirmar: "Sí, seguir", peligro: false })) return;
    setOcupado(true); setMsg("");
    const ok = await guardarEdiciones();
    if (!ok) { setOcupado(false); return; }
    const { data, error } = await supabase.rpc("conteo_aplicar", { p_sesion: sesion.id });
    setOcupado(false);
    if (error) return setMsg(mensajeReposicion(error.message));
    const r = data as { ajustados: number; sin_cambios: number; sin_contar: number };
    setResultado(`Stock actualizado: ${r.ajustados} ajustado${r.ajustados === 1 ? "" : "s"}, ${r.sin_cambios} sin cambios, ${r.sin_contar} sin contar.`);
    await cargar();
  }

  async function descartar() {
    if (!sesion || !await confirmar({ titulo: "¿Descartar el conteo? No se toca el stock.", confirmar: "Sí, seguir", peligro: true })) return;
    setOcupado(true);
    const { error } = await supabase.rpc("conteo_descartar", { p_sesion: sesion.id });
    setOcupado(false);
    if (error) return setMsg(mensajeReposicion(error.message));
    setResultado("Se descartó lo contado. El stock no cambió.");
    await cargar();
  }

  if (sesion === undefined) return <p className="mut">Cargando…</p>;
  if (sesion === null) {
    return (
      <>
      {ventanaConfirmar}
        <h2>Contar mercadería</h2>
        {resultado && <p role="status" className="ok">{resultado}</p>}
        <div className="card">
          <p className="mut" style={{ marginTop: 0 }}>Contá la mercadería en planilla y aplicá las diferencias de una sola vez. Mientras contás, las ventas siguen: cada diferencia se calcula contra el stock del momento de aplicar.</p>
          <label className="mut">¿Qué contás?
            <select value={criterio} onChange={(e) => setCriterio(e.target.value as typeof criterio)}>
              <option value="todos">Todos los productos con control de stock</option>
              <option value="bajo">Solo los que hay que reponer</option>
              <option value="categoria">Una categoría</option>
            </select>
          </label>
          {criterio === "categoria" && (
            <label className="mut">Categoría
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">Elegí una…</option>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          <button disabled={ocupado || (criterio === "categoria" && !categoria)} onClick={empezar}>Empezar a contar</button>
          {msg && <p role="alert" className="pos-error">{msg}</p>}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="row"><h2 style={{ margin: 0 }}>Contando mercadería</h2><span className="mut">{contados} de {sesion.items.length} contados</span></div>
      <p className="mut">Escribí lo que hay en el estante. Dejá en blanco lo que todavía no contaste. Por peso, en kilos.</p>
      {msg && <p role="alert" className="pos-error">{msg}</p>}
      {resultado && <p role="status" className="ok">{resultado}</p>}
      <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 8, margin: ".5rem 0" }}>
        <button className="sec" onClick={() => abrirCamara(!camaraQuiere.current)}>{camara ? "Cerrar cámara" : "Escanear con la cámara"}</button>
        <button className="sec" onClick={() => { vinculo.vincular(); setVerVinculo(true); }}>{vinculo.estado === "conectado" ? "Celular conectado" : "Usar el celular como lector"}</button>
      </div>
      {camara && <Escaner onCode={alLeerCamara} onClose={() => abrirCamara(false)} />}
      {lectura && <p role="status" className="mut"><b>{lectura}</b></p>}
      {verVinculo && <VincularCelular estado={vinculo.estado} url={vinculo.url} error={vinculo.error} ultimo={vinculo.ultimo} onCerrarVinculo={() => { vinculo.cerrar(); setVerVinculo(false); }} onOcultar={() => setVerVinculo(false)} />}
      <p className="mut" style={{ fontSize: 12 }}>Cada lectura suma 1 al producto. Si te pasás, corregí el número a mano.</p>
      <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 8, margin: ".5rem 0" }}>
        <button className={unoPorUno ? "" : "sec"} aria-pressed={unoPorUno} onClick={() => { setUnoPorUno(!unoPorUno); setIndice(0); }}>{unoPorUno ? "Ver la lista completa" : "Contar de a uno"}</button>
      </div>
      <input placeholder="Buscar producto…" value={filtro} onChange={(e) => { setFiltro(e.target.value); setIndice(0); }} />
      {unoPorUno && visibles.length > 0 && (
        <p className="mut" role="status" style={{ marginTop: 8 }}>Producto {Math.min(indice + 1, visibles.length)} de {visibles.length}</p>
      )}

      {(unoPorUno ? visibles.slice(Math.min(indice, Math.max(visibles.length - 1, 0)), Math.min(indice, Math.max(visibles.length - 1, 0)) + 1) : visibles).map((i) => {
        const txt = txtDe(i);
        const n = cantidadDesdeTexto(txt, i.por_peso);
        const cambio = n !== null && n !== i.stock_actual;
        return (
          <div className="card" id={`conteo-${i.producto_id}`} key={i.producto_id} style={{ margin: ".4rem 0" }}>
            <div className="row"><b>{i.nombre}</b><span className="mut">Sistema: {cantidadTexto(i.stock_actual, i.por_peso)}</span></div>
            <label style={{ display: "block", marginTop: 8 }}>Contado
              <input inputMode="decimal" placeholder="Ej: 12" value={txt} autoFocus={unoPorUno} onChange={(e) => setEdits({ ...edits, [i.producto_id]: e.target.value })}
                style={cambio ? { borderColor: "#e67e22" } : undefined} />
            </label>
          </div>
        );
      })}
      {unoPorUno && visibles.length > 0 && (
        <div className="acciones" style={{ marginTop: 8 }}>
          <button className="sec" disabled={indice === 0} onClick={() => setIndice((n) => Math.max(0, n - 1))}>← Anterior</button>
          <button className="principal" disabled={indice >= visibles.length - 1} onClick={() => setIndice((n) => Math.min(visibles.length - 1, n + 1))}>Siguiente →</button>
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button className="sec" disabled={ocupado} onClick={guardarAvance}>Guardar avance</button>
        <button className="sec" disabled={ocupado} onClick={verDiferencias}>Ver diferencias</button>
        <button disabled={ocupado || contados === 0} onClick={aplicar}>Guardar lo contado</button>
        <button className="sec" disabled={ocupado} onClick={descartar}>Descartar</button>
      </div>

      {dif && (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Diferencias</b>
          {dif.lista.length === 0 && <p className="mut">Lo contado coincide con el sistema.</p>}
          {dif.lista.map((d) => (
            <div className="row" key={d.producto_id}>
              <span>{d.nombre}: {cantidadTexto(d.stock_actual, d.por_peso)} → {cantidadTexto(d.contado, d.por_peso)}</span>
              <b style={{ color: d.diferencia < 0 ? "var(--danger)" : "var(--ok)" }}>{d.diferencia > 0 ? "+" : "−"}{cantidadTexto(Math.abs(d.diferencia), d.por_peso)} · {peso(Math.abs(d.costo))}</b>
            </div>
          ))}
          <p className="mut" style={{ fontSize: 12 }}>Sin contar: {dif.sinContar}. Los valores se calculan a costo; los que queden sin contar no cambian al aplicar.</p>
        </div>
      )}
    </>
  );
}
