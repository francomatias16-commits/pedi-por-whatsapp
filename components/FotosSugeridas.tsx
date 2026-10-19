"use client";
import { useState } from "react";
import { supabase, type Kiosco, type Producto } from "@/lib/supabase";
import { BUCKET, comprimirImagen, rutaDeStorage, rutaFoto } from "@/lib/fotos";
import { mensajeErrorSql } from "@/lib/errores";
import { MENSAJES_FOTOS, buscarSugerencias, descargarFoto } from "@/lib/fotos-cliente";
import type { Sugerencia } from "@/lib/fotos-sugerencias";
import Aviso from "@/components/ui/Aviso";

const codigoDe = (e: unknown): string => (e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? "");
const texto = (e: unknown) => { const c = codigoDe(e); return MENSAJES_FOTOS[c] ?? mensajeErrorSql(c); };
const ORIGEN: Record<string, string> = {
  global: "Cargada por otro local",
  openfoodfacts: "Open Food Facts (licencia abierta)",
  busqueda: "De internet: puede tener derechos de autor",
};

// Fotos sugeridas para un producto. Nunca cambia nada sola: el encargado o el dueño elige una, y se puede deshacer.
export default function FotosSugeridas({ kiosco, producto, onCambio }: { kiosco: Kiosco; producto: Producto; onCambio: () => void }) {
  const [sug, setSug] = useState<Sugerencia[] | null>(null);
  const [nota, setNota] = useState("");
  const [elegida, setElegida] = useState<string | null>(null);
  const [derechos, setDerechos] = useState(false);
  const [trabajando, setTrabajando] = useState<"buscando" | "aplicando" | "deshaciendo" | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [ultima, setUltima] = useState<{ historial: string; ruta: string } | null>(null);

  async function buscar() {
    setTrabajando("buscando"); setMsg(null); setElegida(null); setDerechos(false); setNota("");
    try {
      const r = await buscarSugerencias(kiosco.id, producto.id);
      setSug(r.sugerencias);
      if (r.limite_alcanzado) setNota("Llegaste al tope de búsquedas en internet de hoy.");
      else if (r.sugerencias.length === 0) setNota("No encontramos fotos. Probá subir una vos.");
    } catch (e) { setSug(null); setMsg({ tipo: "error", texto: texto(e) }); }
    finally { setTrabajando(null); }
  }

  async function usar(s: Sugerencia) {
    if (trabajando) return;
    if (s.fuente === "busqueda" && !derechos) return;
    setTrabajando("aplicando"); setMsg(null);
    const ruta = rutaFoto(kiosco.id, producto.id);
    let subida = false;
    try {
      const bytes = await descargarFoto(kiosco.id, s.url);
      const blob = await comprimirImagen(new File([bytes], "foto", { type: bytes.type }));
      const { error } = await supabase.storage.from(BUCKET).upload(ruta, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (error) throw error;
      subida = true;
      const url = supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
      const { data, error: e2 } = await supabase.rpc("foto_aplicar", { p_kiosco: kiosco.id, p_producto: producto.id, p_url: url, p_fuente: s.fuente, p_derechos: s.fuente === "busqueda" ? derechos : false });
      if (e2) throw e2;
      setUltima({ historial: (data as { historial_id: string }).historial_id, ruta });
      setSug(null); setElegida(null); setDerechos(false);
      setMsg({ tipo: "ok", texto: "Listo, la foto ya está en el producto." });
      onCambio();
    } catch (e) {
      if (subida) await supabase.storage.from(BUCKET).remove([ruta]);   // no dejar la foto subida si no se pudo aplicar
      setMsg({ tipo: "error", texto: texto(e) });
    } finally { setTrabajando(null); }
  }

  async function deshacer() {
    if (!ultima || trabajando) return;
    setTrabajando("deshaciendo"); setMsg(null);
    const { data, error } = await supabase.rpc("foto_deshacer", { p_kiosco: kiosco.id, p_historial: ultima.historial });
    setTrabajando(null);
    if (error) { setMsg({ tipo: "error", texto: texto(error) }); return; }
    const quitada = rutaDeStorage((data as { quitada?: string } | null)?.quitada) ?? ultima.ruta;
    await supabase.storage.from(BUCKET).remove([quitada]);
    setUltima(null); setMsg({ tipo: "ok", texto: "Se volvió a la foto anterior." }); onCambio();
  }

  const sel = sug?.find((s) => s.url === elegida) ?? null;
  return (
    <div style={{ margin: "0 0 10px" }}>
      <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
        <button type="button" className="sec" onClick={buscar} disabled={trabajando !== null} aria-busy={trabajando === "buscando"}>
          {trabajando === "buscando" ? "Buscando…" : "Buscar foto automática"}
        </button>
        {ultima && <button type="button" className="sec" onClick={deshacer} disabled={trabajando !== null}>{trabajando === "deshaciendo" ? "Deshaciendo…" : "Deshacer el cambio"}</button>}
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {nota && <p role="status" className="mut">{nota}</p>}
      {sug && sug.length > 0 && (
        <>
          <p className="mut">Tocá la foto que quieras usar. Revisá que sea el mismo producto.</p>
          <div role="group" aria-label="Fotos sugeridas" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
            {sug.map((s) => (
              <button key={s.url} type="button" className={s.url === elegida ? "" : "sec"} aria-pressed={s.url === elegida} disabled={trabajando !== null}
                onClick={() => { setElegida(s.url); setDerechos(false); }} style={{ padding: 4, display: "block", textAlign: "left" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.miniatura} alt={s.titulo || "Foto sugerida"} loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", aspectRatio: "1", objectFit: "contain", background: "#fff", borderRadius: 6 }} />
                <span className="mut" style={{ fontSize: 12, display: "block" }}>{ORIGEN[s.fuente]}</span>
              </button>
            ))}
          </div>
          {sel && (
            <div style={{ marginTop: 8 }}>
              {sel.fuente === "busqueda" && (
                <label className="mut" style={{ display: "block", margin: "6px 0" }}>
                  <input type="checkbox" checked={derechos} onChange={(e) => setDerechos(e.target.checked)} style={{ width: "auto", marginRight: 8 }} />
                  Confirmo que puedo usar esta foto (es mía, tengo permiso del fabricante o del sitio, o es de uso libre).
                </label>
              )}
              <button type="button" onClick={() => usar(sel)} disabled={trabajando !== null || (sel.fuente === "busqueda" && !derechos)} aria-busy={trabajando === "aplicando"}>
                {trabajando === "aplicando" ? "Guardando foto…" : "Usar esta foto"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
