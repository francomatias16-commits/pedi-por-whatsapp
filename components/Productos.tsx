"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, type Kiosco, type Producto } from "@/lib/supabase";
import { aportarAGlobal, buscarPorBarcode, esCodigoValido } from "@/lib/barcode";
import { peso } from "@/lib/whatsapp";
import { margenPct } from "@/lib/margen";
import Escaner from "./Escaner";
import { useConfirmar } from "@/components/ui/Confirmar";
import CargaMasiva from "./CargaMasiva";
import { BUCKET, comprimirImagen, rutaDeStorage, rutaFoto } from "@/lib/fotos";

const num = (s: string) => Number(s.replace(",", "."));
const capitalizar = (s: string) => { const t = s.trim().replace(/\s+/g, " "); return t ? t[0].toUpperCase() + t.slice(1) : t; };
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// Categorías de un toque: las de un kiosco típico, más las que el dueño ya usó.
const CATS_BASE = ["Bebidas", "Golosinas", "Galletitas y snacks", "Cigarrillos", "Almacén", "Limpieza", "Higiene", "General"];
const PAGINA = 40;

export default function Productos({ kiosco }: { kiosco: Kiosco }) {
  const [lista, setLista] = useState<Producto[]>([]);
  const [barcode, setBarcode] = useState("");
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const [cat, setCat] = useState("General");
  const [fuente, setFuente] = useState<"global" | "openfoodfacts" | "kiosco">("kiosco");
  const [escaneando, setEscaneando] = useState(false);
  const [rafaga, setRafaga] = useState(true);
  const [aviso, setAviso] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [masiva, setMasiva] = useState(false);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  // catálogo
  const [q, setQ] = useState("");
  const [filtroCat, setFiltroCat] = useState("Todas");
  const [soloSinStock, setSoloSinStock] = useState(false);
  const [limite, setLimite] = useState(PAGINA);
  const [editId, setEditId] = useState<string | null>(null);
  const [ed, setEd] = useState({ nombre: "", cat: "", precio: "", controla: false, stock: "", peso: false, plu: "", sinStock: false, minimo: "", objetivo: "", entrega: "3", prov: "" });
  const [provs, setProvs] = useState<{ id: string; nombre: string }[]>([]);
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const refNombre = useRef<HTMLInputElement>(null);
  const refPrecio = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from("productos").select("*").eq("kiosco_id", kiosco.id).order("categoria").order("nombre").limit(2000);
    if (error) setAviso("No pudimos cargar el catálogo. Revisá la conexión."); else setLista((data ?? []) as Producto[]);
  }, [kiosco.id]);
  useEffect(() => { cargar(); }, [cargar]);
  // Proveedores activos, para elegir el habitual de cada producto (reposición).
  useEffect(() => {
    supabase.from("proveedores").select("id,nombre").eq("kiosco_id", kiosco.id).eq("activo", true).order("nombre")
      .then(({ data }) => setProvs((data ?? []) as { id: string; nombre: string }[]));
  }, [kiosco.id]);

  const categorias = useMemo(() => Array.from(new Set([...CATS_BASE, ...lista.map((p) => p.categoria)])), [lista]);
  const catsUsadas = useMemo(() => Array.from(new Set(lista.map((p) => p.categoria))), [lista]);
  const sinStock = useMemo(() => lista.filter((p) => !p.disponible).length, [lista]);
  const visibles = useMemo(() => {
    const nq = norm(q.trim());
    return lista.filter((p) =>
      (filtroCat === "Todas" || p.categoria === filtroCat) &&
      (!soloSinStock || !p.disponible) &&
      (!nq || norm(p.nombre).includes(nq) || (p.barcode ?? "").includes(nq)));
  }, [lista, q, filtroCat, soloSinStock]);
  useEffect(() => { setLimite(PAGINA); }, [q, filtroCat, soloSinStock]);

  // La categoría se conserva entre productos: cargar 20 gaseosas seguidas no pide elegirla 20 veces.
  const limpiar = () => { setBarcode(""); setNombre(""); setPrecio(""); setFuente("kiosco"); };
  const enfocar = (r: React.RefObject<HTMLInputElement>) => setTimeout(() => r.current?.focus(), 60);

  async function buscarCodigo(code: string) {
    setBarcode(code); setAviso(""); setBuscando(true);
    const propio = lista.find((p) => p.barcode === code);
    if (propio) {
      setBuscando(false);
      setAviso(`Ya lo tenés cargado: ${propio.nombre} (${peso(Number(propio.precio))}).`);
      limpiar();
      if (rafaga) setEscaneando(true);
      return;
    }
    const hallado = await buscarPorBarcode(code);
    setBuscando(false);
    if (hallado) {
      setNombre(hallado.nombre); setFuente(hallado.fuente);
      setAviso(hallado.fuente === "global" ? "Lo encontramos en la base de la red. Poné el precio." : "Lo encontramos. Revisá el nombre y poné el precio.");
      enfocar(refPrecio);
    } else {
      setNombre(""); setFuente("kiosco");
      setAviso("No lo encontramos: escribí el nombre y el precio, queda guardado para la red.");
      enfocar(refNombre);
    }
  }

  async function alLeerCodigo(raw: string) {
    setEscaneando(false);
    const code = raw.replace(/\D/g, "");
    if (code) await buscarCodigo(code);
  }

  function alTipearCodigo(v: string) {
    const code = v.replace(/\D/g, "");
    setBarcode(code);
    if ([8, 12, 13].includes(code.length) && esCodigoValido(code)) buscarCodigo(code);
  }

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    const nombreOk = capitalizar(nombre);
    const { error } = await supabase.from("productos").insert({
      kiosco_id: kiosco.id, barcode: barcode || null, nombre: nombreOk, precio: num(precio), categoria: capitalizar(cat) || "General",
    });
    setGuardando(false);
    if (error) { setAviso(error.code === "23505" ? "Ese código ya está en tu catálogo." : "No se pudo guardar, probá de nuevo."); return; }
    if (barcode) await aportarAGlobal(barcode, nombreOk);
    limpiar(); setAviso(`Guardado. ${nombreOk}`); await cargar();
    if (rafaga) setEscaneando(true); else enfocar(refNombre);
  }

  async function toggle(p: Producto) {
    const { error } = await supabase.from("productos").update({ disponible: !p.disponible }).eq("id", p.id);
    if (error) setAviso("No se pudo cambiar el stock."); else cargar();
  }
  // El precio se cambia en el formulario de edición (antes era un prompt del navegador).
  function cambiarPrecio(p: Producto) { abrirEdicion(p); }
  function abrirEdicion(p: Producto) { setEditId(editId === p.id ? null : p.id); setEd({ nombre: p.nombre, cat: p.categoria, precio: String(p.precio), controla: !!p.stock_controlado, stock: String(p.stock ?? 0), peso: !!p.vendido_por_peso, plu: p.plu ?? "", sinStock: !!p.permite_sin_stock, minimo: String(p.stock_minimo ?? 0), objetivo: p.stock_objetivo == null ? "" : String(p.stock_objetivo), entrega: String(p.lead_time_dias ?? 3), prov: p.proveedor_id ?? "" }); }
  async function guardarEdicion(p: Producto) {
    const n = capitalizar(ed.nombre); const pr = num(ed.precio);
    if (n.length < 2 || isNaN(pr) || pr < 0) { setAviso("Revisá el nombre y el precio."); return; }
    const st = Math.floor(num(ed.stock));
    if (ed.controla && (isNaN(st) || st < 0)) { setAviso("El stock tiene que ser un número igual o mayor a cero."); return; }
    const plu = ed.plu.trim();
    if (plu && !/^\d{1,6}$/.test(plu)) { setAviso("El PLU tiene que tener de 1 a 6 números."); return; }
    // Reposición: mínimo y objetivo en las mismas unidades que el stock (gramos si se vende por peso).
    const mini = ed.minimo.trim() === "" ? 0 : Math.floor(num(ed.minimo));
    const obj = ed.objetivo.trim() === "" ? null : Math.floor(num(ed.objetivo));
    const ent = ed.entrega.trim() === "" ? 3 : Math.floor(num(ed.entrega));
    if (ed.controla && (isNaN(mini) || mini < 0 || (obj !== null && (isNaN(obj) || obj < 0)))) { setAviso("El stock mínimo y el objetivo tienen que ser números iguales o mayores a cero."); return; }
    if (ed.controla && (isNaN(ent) || ent < 0 || ent > 60)) { setAviso("Los días de entrega van de 0 a 60."); return; }
    if (ed.peso && !!p.vendido_por_peso !== ed.peso && p.stock_controlado && !(await confirmar({ titulo: "¿Cambiar a venta por peso?", detalle: "Al pasar a venta por peso el stock se cuenta en GRAMOS. ¿Ya cargaste el stock en gramos?", confirmar: "Sí, ya está en gramos", peligro: false }))) return;
    const { error } = await supabase.from("productos").update({ nombre: n, categoria: capitalizar(ed.cat) || "General", precio: pr, stock_controlado: ed.controla, vendido_por_peso: ed.peso, plu: plu || null, permite_sin_stock: ed.sinStock, ...(ed.controla ? { stock: st, disponible: st > 0 ? true : p.disponible, stock_minimo: mini, stock_objetivo: obj, lead_time_dias: ent, proveedor_id: ed.prov || null } : {}) }).eq("id", p.id);
    if (error) { setAviso("No se pudo guardar el cambio."); return; }
    setEditId(null); setAviso(`Actualizado. ${n}`); cargar();
  }
  async function eliminar(p: Producto) {
    if (!(await confirmar({ titulo: `¿Eliminar "${p.nombre}"?`, detalle: "Sale del catálogo. Los pedidos anteriores no se borran.", confirmar: "Sí, eliminar", peligro: true }))) return;
    const { error } = await supabase.from("productos").delete().eq("id", p.id);
    if (error) { setAviso("No se pudo eliminar."); return; }
    const ruta = rutaDeStorage(p.imagen_url); if (ruta) await supabase.storage.from(BUCKET).remove([ruta]);   // no dejar fotos huérfanas
    setEditId(null); setAviso("Eliminado"); cargar();
  }

  async function subirFoto(p: Producto, file: File | undefined) {
    if (!file || subiendo) return;
    setSubiendo(p.id); setAviso("");
    const ruta = rutaFoto(kiosco.id, p.id);
    try {
      const blob = await comprimirImagen(file);
      const { error } = await supabase.storage.from(BUCKET).upload(ruta, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (error) throw error;
      const url = supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
      const { error: e2 } = await supabase.from("productos").update({ imagen_url: url }).eq("id", p.id);
      if (e2) { await supabase.storage.from(BUCKET).remove([ruta]); throw e2; }
      const vieja = rutaDeStorage(p.imagen_url); if (vieja) await supabase.storage.from(BUCKET).remove([vieja]);
      setAviso(`Foto guardada. ${p.nombre}`); cargar();
    } catch (e) {
      setAviso(e instanceof Error && e.message === "imagen_muy_grande" ? "La foto es demasiado pesada. Probá con otra." : "No se pudo subir la foto. Probá de nuevo.");
    } finally { setSubiendo(null); }
  }
  async function quitarFoto(p: Producto) {
    const { error } = await supabase.from("productos").update({ imagen_url: null }).eq("id", p.id);
    if (error) { setAviso("No se pudo quitar la foto."); return; }
    const ruta = rutaDeStorage(p.imagen_url); if (ruta) await supabase.storage.from(BUCKET).remove([ruta]);
    setAviso("Foto quitada"); cargar();
  }

  const puede = nombre.trim().length >= 2 && precio !== "" && !isNaN(num(precio)) && num(precio) >= 0 && !buscando && !guardando;
  return (
    <>
      {ventanaConfirmar}
      <h2>Cargar producto</h2>
      {escaneando
        ? <Escaner onCode={alLeerCodigo} onClose={() => setEscaneando(false)} />
        : <button onClick={() => { setAviso(""); setEscaneando(true); }}>Escanear código</button>}
      <button className="sec" style={{ marginLeft: 8 }} onClick={() => setMasiva(!masiva)}>Carga masiva</button>
      {masiva && <CargaMasiva kiosco={kiosco} existentes={lista} onListo={() => { cargar(); setAviso("Carga masiva lista"); }} onCerrar={() => setMasiva(false)} />}
      <label className="mut" style={{ display: "block", margin: "10px 0" }}>
        <input type="checkbox" checked={rafaga} onChange={(e) => setRafaga(e.target.checked)} style={{ width: "auto", marginRight: 8 }} />
        Seguir escaneando después de guardar
      </label>
      {aviso && <p role="status" className="mut">{aviso}</p>}
      {buscando && <p className="mut">Buscando…</p>}
      <input placeholder="Código de barras (opcional)" aria-label="Código de barras" value={barcode} onChange={(e) => alTipearCodigo(e.target.value)} inputMode="numeric" />
      <input ref={refNombre} placeholder="Nombre" aria-label="Nombre del producto" value={nombre} onChange={(e) => setNombre(e.target.value)} enterKeyHint="next"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); refPrecio.current?.focus(); } }} />
      <input ref={refPrecio} placeholder="Precio" aria-label="Precio" value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" enterKeyHint="done"
        onKeyDown={(e) => { if (e.key === "Enter" && puede) { e.preventDefault(); guardar(); } }} />
      <div className="chips" role="group" aria-label="Categoría">
        {categorias.map((c) => (<button key={c} type="button" className={c === cat ? "" : "sec"} onClick={() => setCat(c)}>{c}</button>))}
      </div>
      <input placeholder="Otra categoría" aria-label="Otra categoría" value={cat} onChange={(e) => setCat(e.target.value)} />
      <button disabled={!puede} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>

      <h2>Catálogo ({lista.length}{sinStock > 0 ? ` · ${sinStock} sin stock` : ""})</h2>
      <div className="buscador-fijo">
        <label className="sr-only" htmlFor="buscar-productos">Buscar producto</label>
        <input id="buscar-productos" type="search" placeholder="Buscar por nombre o código" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips" role="group" aria-label="Filtrar por categoría">
          {["Todas", ...catsUsadas].map((c) => (<button key={c} type="button" className={c === filtroCat ? "" : "sec"} aria-pressed={c === filtroCat} onClick={() => setFiltroCat(c)}>{c}</button>))}
        </div>
      </div>
      {sinStock > 0 && (
        <label className="mut" style={{ display: "block", margin: "6px 0" }}>
          <input type="checkbox" checked={soloSinStock} onChange={(e) => setSoloSinStock(e.target.checked)} style={{ width: "auto", marginRight: 8 }} />Mostrar solo sin stock
        </label>
      )}
      {lista.length > 0 && visibles.length === 0 && <p className="mut">Nada coincide con ese filtro.</p>}
      {visibles.slice(0, limite).map((p) => (
        <div className="card" key={p.id} style={p.disponible ? undefined : { opacity: 0.7 }}>
          <div className="row">
            <div onClick={() => abrirEdicion(p)} style={{ cursor: "pointer", minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
              {p.imagen_url && <img src={p.imagen_url} alt="" width={44} height={44} loading="lazy" style={{ objectFit: "cover", borderRadius: 8, flex: "none", background: "var(--bd)" }} />}
              <div style={{ minWidth: 0 }}><div>{p.nombre} <span className="mut">✎</span></div><span className="mut">{p.categoria}{p.stock_controlado ? ` · quedan ${p.stock ?? 0}` : ""}</span></div>
            </div>
            <div className="qty">
              <button className="sec" onClick={() => cambiarPrecio(p)}>{peso(Number(p.precio))}</button>
              <button className={p.disponible ? "" : "sec"} onClick={() => toggle(p)}>{p.disponible ? "Hay" : "Sin stock"}</button>
            </div>
          </div>
          {editId === p.id && (
            <div style={{ marginTop: 10 }}>
              <input value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} placeholder="Nombre" aria-label="Nombre del producto" />
              <input value={ed.cat} onChange={(e) => setEd({ ...ed, cat: e.target.value })} placeholder="Categoría" list="cats-edit" />
              <datalist id="cats-edit">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
              <input value={ed.precio} onChange={(e) => setEd({ ...ed, precio: e.target.value })} placeholder="Precio" aria-label="Precio" inputMode="decimal" />
              {p.costo != null && (
                <p className="mut" style={{ margin: ".2rem 0 .6rem" }}>
                  Último costo {peso(Number(p.costo))}{margenPct(num(ed.precio), Number(p.costo)) !== null ? ` · margen ${margenPct(num(ed.precio), Number(p.costo))}%` : ""}
                </p>
              )}
              <label className="mut" style={{ display: "block", margin: "8px 0" }}>
                <input type="checkbox" checked={ed.controla} onChange={(e) => setEd({ ...ed, controla: e.target.checked })} style={{ width: "auto", marginRight: 8 }} />Controlar stock por cantidad
              </label>
              {ed.controla && <input value={ed.stock} onChange={(e) => setEd({ ...ed, stock: e.target.value })} placeholder={ed.peso ? "Stock en gramos (ej. 5000 = 5 kg)" : "Cantidad disponible"} inputMode="numeric" />}
              <label className="mut" style={{ display: "block", margin: "8px 0" }}>
                <input type="checkbox" checked={ed.peso} onChange={(e) => setEd({ ...ed, peso: e.target.checked })} style={{ width: "auto", marginRight: 8 }} />Se vende por peso (el precio es por kg)
              </label>
              {ed.peso && <input value={ed.plu} onChange={(e) => setEd({ ...ed, plu: e.target.value })} placeholder="PLU de la balanza (1 a 6 números)" inputMode="numeric" />}
              {ed.controla && (
                <div className="card" style={{ margin: "8px 0" }}>
                  <b>Reposición</b>
                  <p className="mut" style={{ margin: ".2rem 0 .5rem" }}>Con esto la app te avisa cuándo pedir y cuánto{ed.peso ? " (en gramos, igual que el stock)" : ""}.</p>
                  <label className="mut">Stock mínimo (avisar cuando baje de acá)
                    <input value={ed.minimo} onChange={(e) => setEd({ ...ed, minimo: e.target.value })} inputMode="numeric" placeholder="0 = sin mínimo" />
                  </label>
                  <label className="mut">Stock objetivo (cuánto querés tener al reponer, opcional)
                    <input value={ed.objetivo} onChange={(e) => setEd({ ...ed, objetivo: e.target.value })} inputMode="numeric" placeholder="Vacío = lo que se vende en 30 días" />
                  </label>
                  <label className="mut">Días que tarda en llegar el pedido
                    <input value={ed.entrega} onChange={(e) => setEd({ ...ed, entrega: e.target.value })} inputMode="numeric" placeholder="3" />
                  </label>
                  <label className="mut">Proveedor habitual
                    <select value={ed.prov} onChange={(e) => setEd({ ...ed, prov: e.target.value })}>
                      <option value="">Sin proveedor</option>
                      {provs.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                    </select>
                  </label>
                </div>
              )}
              {ed.controla && (
                <label className="mut" style={{ display: "block", margin: "8px 0" }}>
                  <input type="checkbox" checked={ed.sinStock} onChange={(e) => setEd({ ...ed, sinStock: e.target.checked })} style={{ width: "auto", marginRight: 8 }} />Permitir vender aunque no haya stock en el sistema (en el mostrador)
                </label>
              )}
              <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", margin: "0 0 10px" }}>
                <label className="btn sec" aria-busy={subiendo === p.id}>
                  {subiendo === p.id ? "Subiendo…" : p.imagen_url ? "Cambiar foto" : "Agregar foto"}
                  <input type="file" accept="image/*" style={{ display: "none" }} disabled={subiendo !== null}
                    onChange={(e) => { subirFoto(p, e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {p.imagen_url && <button className="sec" onClick={() => quitarFoto(p)}>Quitar foto</button>}
              </div>
              <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                <button onClick={() => guardarEdicion(p)}>Guardar cambios</button>
                <button className="sec" onClick={() => setEditId(null)}>Cancelar</button>
                <button className="sec" onClick={() => eliminar(p)} style={{ color: "var(--danger)" }}>Eliminar</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {visibles.length > limite && <button className="sec" onClick={() => setLimite(limite + PAGINA)}>Ver más ({visibles.length - limite})</button>}
    </>
  );
}
