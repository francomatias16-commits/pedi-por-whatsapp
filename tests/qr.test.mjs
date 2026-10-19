// Prueba de lib/pagos/qr (validaciones, ids, armado de lo que se le manda a Mercado Pago), del aviso de cobros QR y chequeos estáticos
// de la migración 0031 y de las rutas. Uso: node tests/qr.test.mjs
import ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
const leer = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const cargar = async (ruta) => {
  const js = ts.transpileModule(leer(ruta), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const Q = await cargar("../lib/pagos/qr.ts");
const P = await cargar("../lib/push.ts");
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };

// --- constantes iguales en la app y en la base
const sql = leer("../supabase/migrations/0031_qr_caja.sql");
const sinCom = sql.replace(/--.*$/gm, "");
ok("QR_MINUTOS coincide con qr_minutos_vencimiento()", new RegExp(`qr_minutos_vencimiento\\(\\)[^;]*select ${Q.QR_MINUTOS} `).test(sinCom));
ok("el mínimo de la base es QR_MONTO_MIN", sinCom.includes(`monto >= ${Q.QR_MONTO_MIN} and monto <= ${Q.QR_MONTO_MAX}`));
ok("la función de crear valida el mismo mínimo", sinCom.includes(`p_monto < ${Q.QR_MONTO_MIN} or p_monto > ${Q.QR_MONTO_MAX}`));

// --- ids externos
const K = "123e4567-e89b-12d3-a456-426614174000";
eq("id de tienda", Q.idExternoTienda(K), "T123e4567e89b12d3a456426614174000");
eq("id de caja", Q.idExternoCaja(K), "C123e4567e89b12d3a456426614174000");
ok("ids alfanuméricos y de hasta 40", /^[A-Za-z0-9]{1,40}$/.test(Q.idExternoTienda(K)) && /^[A-Za-z0-9]{1,40}$/.test(Q.idExternoCaja(K)));
ok("tienda y caja no se pisan", Q.idExternoTienda(K) !== Q.idExternoCaja(K));

// --- ubicación
const U = { calle: "Belgrano", numero: "1234", ciudad: "Reconquista", provincia: "Santa Fe", lat: -29.15, lng: -59.65 };
eq("ubicación válida", Q.validarUbicacion(U), null);
eq("sin calle", Q.validarUbicacion({ ...U, calle: "  " }), "calle_invalida");
eq("sin número", Q.validarUbicacion({ ...U, numero: "" }), "numero_invalido");
eq("sin ciudad", Q.validarUbicacion({ ...U, ciudad: "" }), "ciudad_invalida");
eq("provincia inventada", Q.validarUbicacion({ ...U, provincia: "Narnia" }), "provincia_invalida");
eq("latitud fuera de Argentina", Q.validarUbicacion({ ...U, lat: 40.4 }), "coordenadas_invalidas");
eq("longitud fuera de Argentina", Q.validarUbicacion({ ...U, lng: 2.3 }), "coordenadas_invalidas");
eq("coordenadas no numéricas", Q.validarUbicacion({ ...U, lat: NaN }), "coordenadas_invalidas");
eq("calle demasiado larga", Q.validarUbicacion({ ...U, calle: "x".repeat(81) }), "calle_invalida");

// --- armado de tienda y caja
const t = Q.armarTienda({ kioscoId: K, nombre: "Kiosco Don Pepe", ubicacion: U });
eq("tienda: external_id", t.external_id, Q.idExternoTienda(K));
eq("tienda: ubicación", [t.location.street_name, t.location.street_number, t.location.city_name, t.location.state_name, t.location.latitude, t.location.longitude], ["Belgrano", "1234", "Reconquista", "Santa Fe", -29.15, -59.65]);
const c = Q.armarCaja({ kioscoId: K, tiendaId: "98765" });
eq("caja: vínculo con la tienda", [c.store_id, c.external_store_id, c.external_id], ["98765", Q.idExternoTienda(K), Q.idExternoCaja(K)]);
eq("caja: modo pdv (las órdenes las manda esta app)", c.config.qr.operating_mode, "pdv");
ok("caja: sin campos de la API vieja", !("fixed_amount" in c));

// --- orden de cobro (API de Orders, modo static)
const REF = "11111111-1111-4111-8111-111111111111";
const o = Q.armarOrdenQR({ cobroId: REF, monto: 1234.5, kioscoNombre: "Kiosco Don Pepe", externalPosId: Q.idExternoCaja(K) });
eq("orden: tipo qr", o.type, "qr");
eq("orden: referencia externa es el cobro", o.external_reference, REF);
ok("orden: referencia válida para Mercado Pago (hasta 64, letras, números, - y _)", /^[A-Za-z0-9_-]{1,64}$/.test(o.external_reference));
eq("orden: monto total como texto con dos decimales", o.total_amount, "1234.50");
eq("orden: un solo pago por el total", o.transactions.payments, [{ amount: "1234.50" }]);
eq("orden: un solo renglón con el total", [o.items.length, o.items[0].unit_price, o.items[0].quantity], [1, "1234.50", 1]);
eq("orden: duración ISO 8601 igual a la de la base", o.expiration_time, `PT${Q.QR_MINUTOS}M`);
eq("orden: sobre el QR fijo de la caja", o.config.qr, { external_pos_id: Q.idExternoCaja(K), mode: "static" });
ok("orden: sin notification_url (los avisos se configuran en Mercado Pago)", !("notification_url" in o));
ok("orden: título corto", Q.armarOrdenQR({ cobroId: REF, monto: 50, kioscoNombre: "N".repeat(200), externalPosId: "C1" }).description.length <= 60);
eq("orden: redondea a centavos", Q.armarOrdenQR({ cobroId: REF, monto: 10.005, kioscoNombre: "A", externalPosId: "C1" }).total_amount, "10.01");
eq("estado de la orden: created", Q.estadoDesdeOrden("created"), "pendiente");
eq("estado de la orden: processed es aprobado", Q.estadoDesdeOrden("processed"), "aprobado");
eq("estado de la orden: expired", Q.estadoDesdeOrden("expired"), "vencido");
eq("estado de la orden: refunded", Q.estadoDesdeOrden("refunded"), "reembolsado");
eq("estado de la orden: canceled no se traduce (cancela la caja)", Q.estadoDesdeOrden("canceled"), null);
eq("estado de la orden: desconocido no se aplica", Q.estadoDesdeOrden("algo_nuevo"), null);

// --- montos
ok("15 es válido", Q.montoQRValido(15));
ok("14,99 no", !Q.montoQRValido(14.99));
ok("tres decimales no", !Q.montoQRValido(100.123));
ok("texto no", !Q.montoQRValido("100"));
ok("tope", Q.montoQRValido(Q.QR_MONTO_MAX) && !Q.montoQRValido(Q.QR_MONTO_MAX + 1));
ok("NaN no", !Q.montoQRValido(NaN));

// --- vistas y cobros disponibles
eq("vista pendiente", Q.vistaQR("pendiente"), "esperando");
eq("vista aprobado", Q.vistaQR("aprobado"), "cobrado");
eq("vista vencido", Q.vistaQR("vencido"), "vencido");
eq("vista cancelado", Q.vistaQR("cancelado"), "cancelado");
eq("vista reembolsado", Q.vistaQR("reembolsado"), "reembolsado");
const sv = [{ id: "a", monto: 500 }, { id: "b", monto: 500 }, { id: "c", monto: 700, vigente: false }];
ok("cobro disponible por el mismo monto", Q.cobroDisponible(sv, 500));
ok("dos del mismo monto cubren dos líneas, no tres", Q.cobroDisponible(sv, 500, 1) && !Q.cobroDisponible(sv, 500, 2));
ok("un cobro viejo no cubre", !Q.cobroDisponible(sv, 700));
ok("otro monto no cubre", !Q.cobroDisponible(sv, 501));
ok("la consulta alcanza para toda la vida del QR", Q.QR_CONSULTAS_MAX * Q.QR_CONSULTA_MS >= Q.QR_MINUTOS * 60000);

// --- avisos al dueño
eq("cobro tardío avisa", P.armarAvisoQR("aprobado_tarde", 1500)?.title, "Cobro QR de $1.500 llegó tarde");
ok("monto distinto avisa", !!P.armarAvisoQR("monto_invalido", 1500));
ok("reembolso con venta avisa", !!P.armarAvisoQR("reembolsado_con_venta", 1500));
eq("lo normal no avisa", P.armarAvisoQR("confirmado", 1500), null);
eq("duplicado no avisa", P.armarAvisoQR("duplicado", 1500), null);
eq("sin resultado no avisa", P.armarAvisoQR(null, 1500), null);

// --- migración 0031 (estático)
ok("0031 existe y sigue a 0030", existsSync(new URL("../supabase/migrations/0030_equipo.sql", import.meta.url)));
for (const tabla of ["pos_qr_config", "cobros_qr_pos"]) {
  ok(`RLS en ${tabla}`, new RegExp(`alter table public\\.${tabla} enable row level security`).test(sinCom));
  ok(`${tabla}: nadie escribe desde el navegador`, new RegExp(`revoke all on public\\.${tabla} from anon, authenticated`).test(sinCom));
}
ok("pos_qr_config no se lee desde el navegador", !/grant select on public\.pos_qr_config/.test(sinCom));
ok("cobros_qr_pos se lee solo con es_miembro", /create policy cobros_qr_pos_miembros on public\.cobros_qr_pos for select to authenticated\s+using \(public\.es_miembro/.test(sinCom));
ok("un solo cobro pendiente por local", /create unique index cobros_qr_pos_uno_pendiente on public\.cobros_qr_pos \(kiosco_id\) where estado = 'pendiente'/.test(sinCom));
ok("un pago pertenece a un solo cobro", /create unique index cobros_qr_pos_payment on public\.cobros_qr_pos \(payment_id\)/.test(sinCom));
ok("el trigger existe", /create trigger ventas_pagos_exigir_qr after insert on public\.ventas_mostrador_pagos/.test(sinCom));
ok("el trigger solo actúa con el interruptor encendido", /cobro_qr_activo\) then return new/.test(sinCom));
ok("el trigger rechaza sin cobro", sinCom.includes("raise exception 'qr_sin_cobro'"));
ok("desconectar apaga el QR", /create or replace function public\.mp_desconectar[\s\S]*cobro_qr_activo = false/.test(sinCom));
ok("desconectar sigue siendo del dueño", /create or replace function public\.mp_desconectar[\s\S]*not public\.es_dueno\(p_kiosco\)/.test(sinCom));
for (const f of ["qr_vencer_pendientes(uuid)", "qr_crear_cobro(uuid, uuid, numeric, uuid)", "qr_estado_cobro(uuid)", "qr_cancelar_cobro(uuid)", "qr_puede_consultar(uuid, int)", "qr_confirmar(text, uuid, numeric, text, text)"])
  ok(`${f} es solo del servidor`, sinCom.includes(`revoke all on function public.${f} from public, anon, authenticated`) && !new RegExp(`grant execute on function public\\.${f.replace(/[()]/g, "\\$&")} to authenticated`).test(sinCom));
for (const f of ["qr_estado_config", "qr_cobros_sin_venta"]) ok(`${f} exige ser miembro del local`, new RegExp(`function public\\.${f}[\\s\\S]*?es_miembro\\(p_kiosco, array\\['cajero', 'encargado', 'dueno'\\]\\)`).test(sinCom));
ok("el interruptor es del dueño", /function public\.qr_configurar_activo[\s\S]*?es_dueno\(p_kiosco\)/.test(sinCom));
ok("el interruptor arranca apagado", /cobro_qr_activo boolean not null default false/.test(sinCom));
ok("sin DROP", !/\bdrop\b/i.test(sinCom));

// --- rutas (estático)
const ruta = (n) => leer(`../app/api/pagos/mp/qr/${n}/route.ts`);
ok("alta: solo el dueño", ruta("alta").includes("esDueno(") && !ruta("alta").includes("rolDe("));
ok("cobrar: cajero, encargado o dueño por rolDe", ruta("cobrar").includes("rolDe(") && !ruta("cobrar").includes("esDueno("));
ok("cobrar: el monto se valida en el servidor", ruta("cobrar").includes("montoQRValido(monto)"));
ok("estado y cancelar validan el rol", ruta("estado").includes("rolDe(") && ruta("cancelar").includes("rolDe("));
ok("las rutas del QR no exportan nada raro", ["alta", "cobrar", "estado", "cancelar"].every((n) => !/export (?!async function (GET|POST)|const (runtime|dynamic))/.test(ruta(n))));
const srv = leer("../lib/pagos/servidor.ts");
ok("la reconciliación consulta la orden, no los pagos", /reconciliarCobroQR[\s\S]*mpOrden\(/.test(srv) && !/reconciliarCobroQR[\s\S]*mpBuscarPagos/.test(srv.slice(srv.indexOf("reconciliarCobroQR"))));
const wh = leer("../app/api/pagos/mp/webhook/route.ts");
ok("el webhook atiende avisos de pagos (pedidos) y de órdenes (cobros QR)", wh.includes("aplicarOrdenQR(") && wh.includes("aplicarPago(") && wh.includes("esOrden"));
const mpts = leer("../lib/pagos/mp.ts");
ok("API de Orders: crea, consulta y cancela con clave de idempotencia", mpts.includes('"/v1/orders"') && mpts.includes("/v1/orders/${encodeURIComponent(id)}/cancel") && (mpts.match(/X-Idempotency-Key/g) ?? []).length >= 3);
ok("sin la API vieja de órdenes QR", !mpts.includes("instore/orders"));
ok("la caja se crea en /v2/pos", mpts.includes('"/v2/pos"'));
ok("el id de la orden se guarda en el cobro", ruta("cobrar").includes("mp_order_id") && sinCom.includes("mp_order_id text"));
ok("token revocado apaga también el QR", srv.includes("cobro_qr_activo: false"));
const modal = leer("../components/caja/CobroModal.tsx");
ok("la caja pide el cobro aprobado antes de confirmar", modal.includes("Primero cobrá el QR"));
ok("la caja cancela el cobro al cerrar el modal", modal.includes("async function cerrarModal"));
ok("Enter sobre los botones del QR no confirma la venta", modal.includes('closest?.(".qr-panel")'));
ok("PosVenta avisa de cobros sin venta", leer("../components/caja/PosVenta.tsx").includes("<QrSinVenta"));
ok("el cierre de caja avisa de cobros sin venta", leer("../components/caja/CierreCaja.tsx").includes("<QrSinVenta cobros={qr.sinVenta} enCierre />"));
ok("cron: reconcilia y vence cobros QR", leer("../app/api/cron/pagos/route.ts").includes("qr_vencer_pendientes"));

if (fallos) { console.log(`${fallos} fallas`); process.exit(1); }
console.log("qr: ok");
