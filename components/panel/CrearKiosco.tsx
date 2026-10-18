"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { normalizarTelefonoAR } from "@/lib/whatsapp";

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// Alta del kiosco en 3 pasos cortos: nombre → WhatsApp → dirección y términos.
export default function CrearKiosco({ userId, onListo }: { userId: string; onListo: () => void }) {
  const [paso, setPaso] = useState(1);
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [editarLink, setEditarLink] = useState(false);
  const [wa, setWa] = useState("");
  const [dir, setDir] = useState("");
  const [acepto, setAcepto] = useState(false);
  const [intento, setIntento] = useState(false);
  const [err, setErr] = useState("");
  const [guardando, setGuardando] = useState(false);

  const digitos = wa.replace(/\D/g, "").length;
  const errNombre = nombre.trim().length < 2 ? "Escribí el nombre de tu kiosco." : "";
  const errWa = digitos < 10 ? "Escribilo con el código de área, sin 0 ni 15. Por ejemplo: 11 5555-5555." : "";
  const errSlug = slug.length < 3 ? "La dirección necesita al menos 3 letras o números." : "";
  const errAcepto = acepto ? "" : "Para seguir, tenés que aceptar los términos.";
  const host = typeof location !== "undefined" ? location.host : "";

  function cambiarNombre(v: string) { setNombre(v); if (!slugManual) setSlug(slugify(v)); }
  function seguir() {
    setIntento(true);
    if (paso === 1 && errNombre) return;
    if (paso === 2 && errWa) return;
    setIntento(false); setPaso(paso + 1);
  }
  async function crear() {
    setIntento(true);
    if (errSlug || errAcepto) return;
    setGuardando(true); setErr("");
    const { error } = await supabase.from("kioscos").insert({ owner_id: userId, nombre: nombre.trim(), slug, whatsapp: normalizarTelefonoAR(wa), direccion: dir.trim() || null });
    setGuardando(false);
    if (error) {
      setEditarLink(true);
      setErr(error.code === "23505" ? "Esa dirección ya la usa otro kiosco. Probá agregarle tu barrio o un número." : "No pudimos crear tu kiosco. Revisá los datos y probá de nuevo.");
      return;
    }
    onListo();
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <p className="paso-txt">Paso {paso} de 3</p>
        <div className="progreso" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={paso}><span style={{ width: `${(paso / 3) * 100}%` }} /></div>
        <form onSubmit={(e) => { e.preventDefault(); if (paso < 3) seguir(); else void crear(); }} noValidate>
          {paso === 1 && (
            <>
              <h1>¿Cómo se llama tu kiosco?</h1>
              <label>Nombre del kiosco
                <input value={nombre} autoFocus autoComplete="organization" placeholder="Ej: Kiosco Don Pepe" onChange={(e) => cambiarNombre(e.target.value)} aria-invalid={intento && !!errNombre} />
              </label>
              {intento && errNombre && <p role="alert" className="error">{errNombre}</p>}
            </>
          )}
          {paso === 2 && (
            <>
              <h1>¿A qué WhatsApp te llegan los pedidos?</h1>
              <label>Tu número de WhatsApp
                <input value={wa} autoFocus inputMode="tel" autoComplete="tel" placeholder="Ej: 11 5555-5555" onChange={(e) => setWa(e.target.value)} aria-invalid={intento && !!errWa} />
              </label>
              <p className="mut">Es el número del celular donde vas a recibir los pedidos de tus clientes.</p>
              {intento && errWa && <p role="alert" className="error">{errWa}</p>}
            </>
          )}
          {paso === 3 && (
            <>
              <h1>Último paso</h1>
              <label>Dirección del local (opcional)
                <input value={dir} autoFocus autoComplete="street-address" placeholder="Ej: Av. San Martín 123" onChange={(e) => setDir(e.target.value)} />
              </label>
              <div className="preview-link">
                <span className="mut">Tu tienda va a estar en:</span>
                <b>{host}/{slug || "tu-kiosco"}</b>
                {!editarLink && <button type="button" className="sec" onClick={() => setEditarLink(true)}>Cambiar</button>}
              </div>
              {editarLink && (
                <label>Dirección de tu tienda
                  <input value={slug} onChange={(e) => { setSlugManual(true); setSlug(slugify(e.target.value)); }} aria-invalid={intento && !!errSlug} />
                </label>
              )}
              {intento && errSlug && <p role="alert" className="error">{errSlug}</p>}
              <label className="acepto">
                <input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} />
                <span>Acepto los <Link href="/terminos" target="_blank">Términos y condiciones</Link> y la <Link href="/privacidad" target="_blank">Política de privacidad</Link>.</span>
              </label>
              {intento && errAcepto && <p role="alert" className="error">{errAcepto}</p>}
              {err && <p role="alert" className="error">{err}</p>}
            </>
          )}
          <div className="wiz-botones">
            {paso > 1 && <button type="button" className="sec" onClick={() => { setIntento(false); setErr(""); setPaso(paso - 1); }}>Atrás</button>}
            <button type="submit" disabled={guardando}>{paso < 3 ? "Seguir" : guardando ? "Creando…" : "Crear mi kiosco"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
