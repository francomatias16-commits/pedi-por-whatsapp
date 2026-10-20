"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CLUB_TOKEN_RE, claveTokenLocal, linkTienda, textoPromesa, validarRegistro, type DatosClub } from "@/lib/club";
import { mensajeErrorSql } from "@/lib/errores";
import { linkWhatsApp, normalizarTelefonoAR } from "@/lib/whatsapp";

// Pantalla del QR del mostrador. Se usa una sola vez: después, escanear de nuevo lleva directo a la tarjeta guardada en el celular.
export default function ClubUnirse({ slug, datos, refAmigo = "" }: { slug: string; datos: DatosClub | null; refAmigo?: string }) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [tel, setTel] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [yaTiene, setYaTiene] = useState(false);

  useEffect(() => {
    try {
      const t = localStorage.getItem(claveTokenLocal(slug));
      if (t && CLUB_TOKEN_RE.test(t)) router.replace(`/tarjeta/${t}`);
    } catch { /* sin almacenamiento: se registra de nuevo */ }
  }, [slug, router]);

  if (!datos) return (
    <main className="club">
      <h1>Este local no tiene club de sellos</h1>
      <p className="mut">Revisá que el QR sea el del mostrador o preguntale al local.</p>
    </main>
  );

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const err = validarRegistro(nombre, tel);
    if (err) return setMsg(err);
    setOcupado(true); setMsg("");
    try {
      const r = await fetch("/api/club/unirse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, nombre, telefono: tel, ref: refAmigo || undefined }) });
      const j = await r.json();
      if (!r.ok) return setMsg(mensajeErrorSql(j.error, "club"));
      if (j.estado === "ya_registrado") return setYaTiene(true);
      try { localStorage.setItem(claveTokenLocal(slug), j.token); } catch { /* igual funciona con el link */ }
      router.push(`/tarjeta/${j.token}`);
    } catch {
      setMsg("No pudimos conectar. Revisá tu internet y probá de nuevo.");
    } finally { setOcupado(false); }
  }

  if (yaTiene) return (
    <main className="club">
      <p className="mut">{datos.nombre}</p>
      <h1>Ya tenés tarjeta</h1>
      <p>Este número ya está registrado. Pedile al local que te reenvíe el link de tu tarjeta.</p>
      <a className="btn" href={linkWhatsApp(normalizarTelefonoAR(datos.whatsapp), `Hola! Ya me registré en el club de ${datos.nombre} pero no tengo mi tarjeta. ¿Me la reenvían?`)}>Pedir mi tarjeta por WhatsApp</a>
    </main>
  );

  return (
    <main className="club">
      <p className="mut">{datos.nombre}</p>
      <h1>Sumá sellos con cada compra</h1>
      {textoPromesa(datos) && <p>{textoPromesa(datos)}</p>}
      {refAmigo && <p className="mut">Te invitó un amigo: si el local tiene activa la opción “Traé un amigo”, los dos suman sellos al registrarte.</p>}
      <form onSubmit={enviar} className="card">
        <label>Tu nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="given-name" maxLength={60} /></label>
        <label>Tu teléfono<input value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="Con característica, ej: 11 5555 1234" /></label>
        <button className="btn-grande" disabled={ocupado}>{ocupado ? "Un segundo…" : "Crear mi tarjeta"}</button>
        {msg && <p role="alert" className="alerta">{msg}</p>}
      </form>
      {datos.tienda && <p><Link className="btn sec" href={linkTienda(slug)}>Solo quiero ver el catálogo</Link></p>}
      <p className="mut">Usamos tu nombre y teléfono solo para tu tarjeta en {datos.nombre}. Más en la <Link href="/privacidad">política de privacidad</Link>.</p>
    </main>
  );
}
