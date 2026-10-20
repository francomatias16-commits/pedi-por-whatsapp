"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Pantalla de /demo: entra sola a la demo en vivo. Si ya hay una sesión abierta, pregunta antes de cerrarla.
export default function EntrarDemo() {
  const router = useRouter();
  const [estado, setEstado] = useState<"mirando" | "entrando" | "sesion" | "error">("mirando");
  const arrancó = useRef(false);

  const entrar = useCallback(async () => {
    setEstado("entrando");
    try {
      const r = await fetch("/api/demo", { method: "POST", cache: "no-store" });
      if (!r.ok) throw new Error("demo");
      const { access_token, refresh_token } = (await r.json()) as { access_token: string; refresh_token: string };
      await supabase.auth.signOut();
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      router.replace("/panel");
    } catch {
      setEstado("error");
    }
  }, [router]);

  useEffect(() => {
    if (arrancó.current) return;
    arrancó.current = true;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setEstado("sesion"); // alguien ya entró en este celular: no se le cierra la sesión sin avisar
      else entrar();
    });
  }, [entrar]);

  return (
    <div className="login-wrap">
      <Link href="/" className="volver">← Volver al inicio</Link>
      <div className="card login-card" aria-live="polite">
        {estado === "sesion" ? (
          <>
            <h1>Ya tenés una sesión abierta</h1>
            <p className="mut login-sub">Para ver la demo tenemos que cerrar tu sesión en este dispositivo. Tus datos no se tocan: después entrás de nuevo como siempre.</p>
            <button type="button" onClick={entrar}>Cerrar mi sesión y ver la demo</button>
            <p><Link href="/panel">Volver a mi panel</Link></p>
          </>
        ) : estado === "error" ? (
          <>
            <h1>La demo no está disponible</h1>
            <p role="alert" className="error">No pudimos abrir la demo en este momento. Probá de nuevo en unos minutos.</p>
            <button type="button" onClick={entrar}>Probar de nuevo</button>
          </>
        ) : (
          <>
            <h1>Entrando a la demo…</h1>
            <p className="mut login-sub" role="status">Es un kiosco de ejemplo con datos ficticios. Podés mirar todo; no se guarda nada.</p>
            <div className="esq esq-t" /><div className="esq" /><div className="esq esq-b" />
          </>
        )}
      </div>
    </div>
  );
}
