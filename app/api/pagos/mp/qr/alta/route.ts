// Alta única del QR del mostrador: crea la sucursal y la caja en Mercado Pago (con la cuenta ya conectada) y guarda el QR fijo.
// Solo el dueño. Se puede repetir sin duplicar: si la sucursal o la caja ya existen (mismo id externo), se reutilizan.
import { NextResponse } from "next/server";
import { ErrorMP, imagenQR, mpBuscarCaja, mpBuscarTienda, mpCrearCaja, mpCrearTienda, type CajaMP } from "@/lib/pagos/mp";
import { armarCaja, armarTienda, idExternoCaja, idExternoTienda, validarUbicacion, type Ubicacion } from "@/lib/pagos/qr";
import { credenciales, crearAdmin, esDueno, marcarTokenInvalido } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kiosco = String(body?.kiosco ?? "");
  const admin = crearAdmin();
  if (!(await esDueno(req, admin, kiosco))) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  const ubicacion: Partial<Ubicacion> = { calle: body?.calle, numero: String(body?.numero ?? ""), ciudad: body?.ciudad, provincia: body?.provincia, lat: Number(body?.lat), lng: Number(body?.lng) };
  const invalido = validarUbicacion(ubicacion);
  if (invalido) return NextResponse.json({ error: invalido }, { status: 400 });

  const cred = await credenciales(admin, kiosco).catch(() => null);
  if (!cred?.activa) return NextResponse.json({ error: "sin_conexion" }, { status: 409 });
  const { data: k } = await admin.from("kioscos").select("nombre").eq("id", kiosco).maybeSingle();
  if (!k) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });

  try {
    const extTienda = idExternoTienda(kiosco), extCaja = idExternoCaja(kiosco);
    const tienda = (await mpBuscarTienda(cred.token, cred.mpUserId, extTienda)) ?? (await mpCrearTienda(cred.token, cred.mpUserId, armarTienda({ kioscoId: kiosco, nombre: k.nombre, ubicacion: ubicacion as Ubicacion })));
    let caja: CajaMP | null = await mpBuscarCaja(cred.token, extCaja);
    if (!caja) caja = await mpCrearCaja(cred.token, armarCaja({ kioscoId: kiosco, tiendaId: tienda.id }), extCaja);
    const qr = imagenQR(caja);
    if (!qr?.image) return NextResponse.json({ error: "mp_sin_qr" }, { status: 502 });
    const { error } = await admin.from("pos_qr_config").upsert({
      kiosco_id: kiosco, mp_user_id: cred.mpUserId, mp_store_id: String(tienda.id), external_store_id: extTienda,
      mp_pos_id: String(caja.id), external_pos_id: extCaja, qr_imagen: qr.image, qr_plantilla: qr.template_document ?? qr.template_image ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "kiosco_id" });
    if (error) return NextResponse.json({ error: "db" }, { status: 500 });
    return NextResponse.json({ ok: true, qr_imagen: qr.image });
  } catch (e) {
    if (e instanceof ErrorMP && (e.status === 401 || e.status === 403)) { await marcarTokenInvalido(admin, kiosco); return NextResponse.json({ error: "token_rechazado" }, { status: 409 }); }
    if (e instanceof ErrorMP && e.status === 400) return NextResponse.json({ error: "mp_rechazo_datos" }, { status: 400 }); // dirección o datos que Mercado Pago no acepta
    return NextResponse.json({ error: "mp_no_responde" }, { status: 502 });
  }
}
