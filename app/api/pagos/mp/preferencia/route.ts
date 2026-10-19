// Después de crear_pedido: arma el link de pago. El monto sale de la base, no del navegador.
// Si el pedido ya tiene un link vigente, lo reutiliza.
import { NextResponse } from "next/server";
import { ErrorMP, HORAS_VENCIMIENTO, UUID, armarPreferencia, mpCrearPreferencia } from "@/lib/pagos/mp";
import { credenciales, crearAdmin, marcarTokenInvalido } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const pedidoId = String(body?.pedido ?? "");
  if (!UUID.test(pedidoId)) return NextResponse.json({ error: "pedido_invalido" }, { status: 400 });
  const admin = crearAdmin();
  const { data: p } = await admin.from("pedidos").select("id,numero,total,kiosco_id,pago_estado,estado,kioscos(nombre,slug)").eq("id", pedidoId).maybeSingle();
  if (!p) return NextResponse.json({ error: "pedido_no_encontrado" }, { status: 404 });
  if (p.pago_estado !== "pendiente" || p.estado !== "pendiente") return NextResponse.json({ error: "pedido_no_pagable", pago_estado: p.pago_estado }, { status: 409 });

  // Un link vigente se reutiliza (queda un margen antes de que venza el de Mercado Pago).
  const { data: previa } = await admin.from("transacciones_pago").select("link_pago,created_at")
    .eq("pedido_id", pedidoId).eq("estado", "pendiente").not("link_pago", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (previa?.link_pago && Date.now() - new Date(previa.created_at).getTime() < (HORAS_VENCIMIENTO * 60 - 20) * 60 * 1000) {
    return NextResponse.json({ link: previa.link_pago, reutilizado: true });
  }

  const cred = await credenciales(admin, p.kiosco_id).catch(() => null);
  if (!cred?.activa) return NextResponse.json({ error: "pago_no_disponible" }, { status: 409 });
  const k = (Array.isArray(p.kioscos) ? p.kioscos[0] : p.kioscos) as { nombre: string; slug: string };
  const origen = process.env.APP_URL ?? new URL(req.url).origin;
  try {
    const pref = await mpCrearPreferencia(cred.token, armarPreferencia({ pedidoId, numero: p.numero, total: Number(p.total), kioscoId: p.kiosco_id, kioscoNombre: k.nombre, slug: k.slug, origen }));
    const { error } = await admin.from("transacciones_pago").insert({ kiosco_id: p.kiosco_id, pedido_id: pedidoId, preferencia_id: pref.id, estado: "pendiente", monto: p.total, link_pago: pref.init_point });
    if (error) return NextResponse.json({ error: "db" }, { status: 500 });
    return NextResponse.json({ link: pref.init_point });
  } catch (e) {
    if (e instanceof ErrorMP && (e.status === 401 || e.status === 403)) { await marcarTokenInvalido(admin, p.kiosco_id); return NextResponse.json({ error: "pago_no_disponible" }, { status: 409 }); }
    return NextResponse.json({ error: "mp_no_responde" }, { status: 502 });
  }
}
