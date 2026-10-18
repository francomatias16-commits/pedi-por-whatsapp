# Verifica 0017 (fidelidad: campañas, premios, sellos automáticos). Uso: python3 supabase/tests/etapa14_test.py
import os, psycopg2, uuid, tempfile, sys
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida).
# Sin eso: Postgres embebido con pgserver (instancia nueva por corrida).
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa14_" + uuid.uuid4().hex[:8]
    _admin.cursor().execute(f'create database "{_db}"')
    conn = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname=_db)
else:
    import pgserver
    conn = psycopg2.connect(pgserver.get_server(tempfile.mkdtemp()).get_uri())
conn.autocommit = True
cur = conn.cursor()
cur.execute("""
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid(), created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
create publication supabase_realtime;
""")
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras", "0016_etiquetas", "0017_fidelidad"]:
    cur.execute(open(f"supabase/migrations/{m}.sql").read())
A, B = str(uuid.uuid4()), str(uuid.uuid4())
cur.execute("insert into auth.users values (%s),(%s)", (A, B))
cur.execute("begin")

def as_(role, sub=None):
    cur.execute("reset role"); cur.execute(f"set role {role}")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (sub or '',))
def fails(sql, args=None):
    cur.execute("savepoint s")
    try: cur.execute(sql, args); cur.execute("release savepoint s"); return False
    except Exception as e: cur.execute("rollback to savepoint s"); return str(e).split("\n")[0]
bad = 0
def ok(c, m):
    global bad; bad += (not c); print(("PASS " if c else "FAIL ") + m)
def one(sql, args=None): cur.execute(sql, args); return cur.fetchone()[0]
def commit(): cur.execute("commit"); cur.execute("begin")  # los sellos de la Caja se otorgan al confirmar la transacción
import json

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','kiosco-a','5493415551234',true) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))
as_("authenticated", A)
coca = one("insert into productos(kiosco_id,nombre,precio,categoria) values (%s,'Coca 500',1000,'Bebidas') returning id", (ka,))
alf = one("insert into productos(kiosco_id,nombre,precio,categoria) values (%s,'Alfajor',500,'Golosinas') returning id", (ka,))
queso = one("insert into productos(kiosco_id,nombre,precio,vendido_por_peso,categoria) values (%s,'Queso',8000,true,'Fiambres') returning id", (ka,))
cli = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Ana','5493415550001') returning id", (ka,))
saldo = lambda c: one("select sellos_disponibles from clientes_sellos where id=%s", (c,))
camp = lambda sql, args=None: one(sql, args)
as_("authenticated", A)
commit()

# ── Arranque: cada kiosco nuevo trae una campaña y un premio ──
ok(one("select count(*) from fidelidad_campanas where kiosco_id=%s and tipo='visita' and activa", (ka,)) == 1, "kiosco nuevo: campaña 'por cada compra' creada")
ok(one("select count(*) from fidelidad_premios where kiosco_id=%s", (ka,)) == 1, "kiosco nuevo: premio inicial creado")
as_("authenticated", B)
ok(one("select count(*) from fidelidad_campanas") == 1, "el dueño B solo ve sus campañas")
as_("authenticated", A)
ok(one("select count(*) from fidelidad_campanas") == 1, "el dueño A solo ve sus campañas")

# ── Sin escritura directa en sellos ni canjes ──
ok(bool(fails("insert into sellos(kiosco_id,cliente_id,origen,cantidad) values (%s,%s,'manual',50)", (ka, cli))), "no se insertan sellos directo")
ok(bool(fails("update sellos set anulado=true")), "no se editan sellos directo")

# ── Dejo solo las campañas que quiero probar ──
cur.execute("update fidelidad_campanas set activa=false where kiosco_id=%s", (ka,))
visita = one("insert into fidelidad_campanas(kiosco_id,nombre,tipo,sellos,canales) values (%s,'Por compra','visita',1,'{pedido,mostrador}') returning id", (ka,))
monto = one("insert into fidelidad_campanas(kiosco_id,nombre,tipo,sellos,por_monto,monto_minimo) values (%s,'1 cada $1000','monto',1,1000,500) returning id", (ka,))
prod = one("insert into fidelidad_campanas(kiosco_id,nombre,tipo,sellos,producto_id) values (%s,'Coca +2','producto',2,%s) returning id", (ka, coca))
cat = one("insert into fidelidad_campanas(kiosco_id,nombre,tipo,sellos,categoria) values (%s,'Golosinas +1','categoria',1,'Golosinas') returning id", (ka,))
bien = one("insert into fidelidad_campanas(kiosco_id,nombre,tipo,sellos) values (%s,'Bienvenida','bienvenida',3) returning id", (ka,))
ok(bool(fails("insert into fidelidad_campanas(kiosco_id,nombre,tipo) values (%s,'sin monto','monto')", (ka,))), "campaña por monto sin monto se rechaza")
ok(bool(fails("insert into fidelidad_campanas(kiosco_id,nombre,tipo,sellos) values (%s,'ajena','visita',1)", (kb,))), "no se crean campañas en un kiosco ajeno")
ok(bool(fails("insert into fidelidad_campanas(kiosco_id,nombre,tipo,producto_id) values (%s,'x','producto',%s)", (ka, str(uuid.uuid4())))), "producto inexistente se rechaza")

# ── Simulador (martes 20/10/2026 15:00 hora Argentina) ──
MAR = "2026-10-20T18:00:00Z"
sim = lambda monto, prodid=None, uni=1, canal='mostrador', medio='efectivo', cuando=MAR, cliente=None: one("select fidelidad_simular(%s,%s,%s,%s,%s,%s,%s,%s)", (ka, monto, canal, medio, cuando, cliente, prodid, uni))
ok(sim(2500)["total"] == 1 + 2 + 3, "compra $2500: visita 1 + monto 2 + bienvenida 3 = 6")
ok(sim(400)["total"] == 1 + 3, "compra $400 (bajo el mínimo del monto): visita 1 + bienvenida 3")
ok(sim(1000, coca, 3)["total"] == 1 + 1 + 6 + 3, "3 cocas $1000: visita 1 + monto 1 + producto 6 + bienvenida 3")
ok(sim(500, alf, 4)["total"] == 1 + 0 + 4 + 3, "4 alfajores (categoría Golosinas): +4")
cur.execute("update fidelidad_campanas set activa=false where id=%s", (bien,))
dob = one("insert into fidelidad_campanas(kiosco_id,nombre,tipo,multiplicador,dias_semana) values (%s,'Martes dobles','multiplicador',2,'{2}') returning id", (ka,))
ok(sim(2500)["total"] == 3 * 2, "martes dobles: base 3 -> 6")
ok(sim(2500, cuando="2026-10-21T18:00:00Z")["total"] == 3, "miércoles: sin multiplicador")
cur.execute("update fidelidad_campanas set dias_semana=null, hora_desde='18:00', hora_hasta='20:00' where id=%s", (dob,))
ok(sim(2500, cuando="2026-10-20T18:00:00Z")["total"] == 3, "15:00 está fuera de 18 a 20: sin multiplicador")
ok(sim(2500, cuando="2026-10-20T21:30:00Z")["total"] == 6, "18:30 está dentro de 18 a 20: duplica")
cur.execute("update fidelidad_campanas set hora_desde='22:00', hora_hasta='02:00' where id=%s", (dob,))
ok(sim(2500, cuando="2026-10-21T02:00:00Z")["total"] == 6 and sim(2500, cuando="2026-10-20T18:00:00Z")["total"] == 3, "horario que cruza medianoche (22 a 02)")
cur.execute("update fidelidad_campanas set activa=false where id=%s", (dob,))
cur.execute("update fidelidad_campanas set medios='{transferencia}' where id=%s", (monto,))
ok(sim(2500, medio='efectivo')["total"] == 1 and sim(2500, medio='transferencia')["total"] == 3, "campaña solo para transferencia")
cur.execute("update fidelidad_campanas set medios=null, canales='{pedido}' where id=%s", (monto,))
ok(sim(2500, canal='mostrador')["total"] == 1 and sim(2500, canal='pedido')["total"] == 3, "campaña solo para pedidos")
cur.execute("update fidelidad_campanas set canales='{pedido,mostrador}', desde='2026-11-01' where id=%s", (monto,))
ok(sim(2500)["total"] == 1, "campaña que todavía no empezó")
cur.execute("update fidelidad_campanas set desde=null, hasta='2026-10-01' where id=%s", (monto,))
ok(sim(2500)["total"] == 1, "campaña vencida")
cur.execute("update fidelidad_campanas set hasta=null where id=%s", (monto,))
ok("no_autorizado" in (fails("select fidelidad_simular(%s,100)", (kb,)) or ""), "no se simula sobre un kiosco ajeno")

# ── Venta de la Caja con cliente: sellos automáticos, idempotencia, anulación ──
cur.execute("update fidelidad_campanas set activa=false where kiosco_id=%s and id not in (%s,%s)", (ka, visita, monto))
t = one("select (caja_abrir_turno(%s, 0)->>'turno_id')::uuid", (ka,))
v = one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, %s, 0)", (t, json.dumps([{"producto_id": coca, "cantidad": 3}]), json.dumps([{"medio": "efectivo", "monto": 3000}]), cli))
commit()
ok(saldo(cli) == 1 + 3, "venta de $3000 con cliente: visita 1 + monto 3 = 4 sellos")
ok(one("select count(*) from sellos where venta_id=%s", (v["venta_id"],)) == 2, "un sello por campaña, con su venta de origen")
v0 = one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0)", (t, json.dumps([{"producto_id": coca, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 1000}])))
commit()
ok(saldo(cli) == 4, "venta sin cliente: no suma sellos a nadie")
oid = str(uuid.uuid4())
args = (t, json.dumps([{"producto_id": coca, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 1000}]), cli, oid)
one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, %s, 0, %s)", args); commit()
one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, %s, 0, %s)", args); commit()
ok(saldo(cli) == 4 + 2, "reenvío offline con el mismo offline_id no duplica sellos (+2 una sola vez)")
one("select anular_venta_mostrador(%s, 'prueba de fidelidad')", (v["venta_id"],)); commit()
ok(saldo(cli) == 2, "anular la venta de $3000 anula sus 4 sellos")

# ── Pedido entregado (canal pedido) e idempotencia ──
as_("anon")
items = json.dumps([{"producto_id": coca, "cantidad": 2}])
r = one("select crear_pedido('kiosco-a','Ana','5493415550001','retiro',null,null,%s::jsonb)", (items,))
as_("authenticated", A)
cur.execute("update pedidos set estado='confirmado' where id=%s", (r["pedido_id"],))
cur.execute("update pedidos set estado='entregado' where id=%s", (r["pedido_id"],)); commit()
ok(saldo(cli) == 2 + 1 + 2, "pedido de $2000 entregado: visita 1 + monto 2 = 3 sellos")
cur.execute("update pedidos set estado='cancelado' where id=%s", (r["pedido_id"],))
cur.execute("update pedidos set estado='entregado' where id=%s", (r["pedido_id"],)); commit()
ok(saldo(cli) == 5, "volver a entregarlo no repite los sellos")

# ── Tope diario ──
cur.execute("update fidelidad_campanas set activa=false where id=%s", (monto,))
cur.execute("update fidelidad_campanas set tope_diario=1 where id=%s", (visita,))
cli2 = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Beto','5493415550002') returning id", (ka,))
for _ in range(3):
    one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, %s, 0)", (t, json.dumps([{"producto_id": coca, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 1000}]), cli2)); commit()
ok(saldo(cli2) == 1, "tope diario 1: tres compras el mismo día dan 1 solo sello")

# ── Acciones manuales y ajustes ──
resena = one("insert into fidelidad_campanas(kiosco_id,nombre,tipo,sellos,tope_diario) values (%s,'Reseña en Google','manual',5,5) returning id", (ka,))
ok(one("select fidelidad_dar_sellos(%s,%s)->>'saldo'", (cli2, resena)) == '6', "acción manual 'Reseña en Google': +5")
ok("tope_diario" in (fails("select fidelidad_dar_sellos(%s,%s)", (cli2, resena)) or ""), "la acción manual respeta el tope diario")
ok("campana_invalida" in (fails("select fidelidad_dar_sellos(%s,%s)", (cli2, visita)) or ""), "solo las campañas manuales se dan a mano")
ok(one("select fidelidad_dar_sellos(%s,null,2,'Regalo de cumpleaños')->>'saldo'", (cli2,)) == '8', "ajuste libre +2 con motivo")
ok("motivo_requerido" in (fails("select fidelidad_dar_sellos(%s,null,1,'')", (cli2,)) or ""), "el ajuste exige motivo")
ok("sellos_insuficientes" in (fails("select fidelidad_dar_sellos(%s,null,-50,'quitar de más')", (cli2,)) or ""), "no se quitan más sellos de los que hay")
ok(one("select fidelidad_dar_sellos(%s,null,-3,'Error de carga')->>'saldo'", (cli2,)) == '5', "ajuste libre −3")
sid = one("select id from sellos where cliente_id=%s and campana_id=%s", (cli2, resena))
ok(one("select fidelidad_anular_sello(%s)->>'saldo'", (sid,)) == '0', "anular un sello de 5 baja el saldo en 5")
ok(one("select fidelidad_anular_sello(%s,false)->>'saldo'", (sid,)) == '5', "restaurar el sello")
as_("authenticated", B)
ok("no_autorizado" in (fails("select fidelidad_dar_sellos(%s,null,1,'intruso')", (cli2,)) or ""), "otro dueño no da sellos a mi cliente")
ok("no_autorizado" in (fails("select fidelidad_anular_sello(%s)", (sid,)) or ""), "otro dueño no anula mis sellos")
as_("authenticated", A)

# ── Premios y canjes ──
cafe = one("insert into fidelidad_premios(kiosco_id,nombre,costo_sellos,tipo) values (%s,'Café con medialuna',4,'libre') returning id", (ka,))
dto = one("insert into fidelidad_premios(kiosco_id,nombre,costo_sellos,tipo,valor) values (%s,'10%% off',3,'pct',10) returning id", (ka,))
gratis = one("insert into fidelidad_premios(kiosco_id,nombre,costo_sellos,tipo,producto_id) values (%s,'Coca gratis',9,'producto',%s) returning id", (ka, coca))
ok(bool(fails("insert into fidelidad_premios(kiosco_id,nombre,costo_sellos,tipo) values (%s,'x',1,'pct')", (ka,))), "premio % sin valor se rechaza")
ok(bool(fails("insert into fidelidad_premios(kiosco_id,nombre,costo_sellos,tipo,valor) values (%s,'x',1,'pct',150)", (ka,))), "premio de más de 100% se rechaza")
ok("sellos_insuficientes" in (fails("select fidelidad_canjear(%s,%s)", (cli2, gratis)) or ""), "no se canjea un premio sin saldo suficiente")
c = one("select fidelidad_canjear(%s,%s)", (cli2, cafe))
ok(c["saldo"] == 1 and saldo(cli2) == 1, "canje de 4 sellos: saldo 5 -> 1")
ok("sellos_insuficientes" in (fails("select fidelidad_canjear(%s,%s)", (cli2, cafe)) or ""), "no se puede canjear dos veces con un solo saldo")
ok(one("select fidelidad_anular_canje(%s)->>'saldo'", (c["canje_id"],)) == '5', "anular el canje devuelve los sellos")
ok("ya_anulado" in (fails("select fidelidad_anular_canje(%s)", (c["canje_id"],)) or ""), "un canje se anula una sola vez")
cur.execute("update fidelidad_premios set activo=false where id=%s", (cafe,))
ok("premio_invalido" in (fails("select fidelidad_canjear(%s,%s)", (cli2, cafe)) or ""), "premio desactivado no se canjea")
as_("authenticated", B)
ok("no_autorizado" in (fails("select fidelidad_canjear(%s,%s)", (cli2, dto)) or ""), "otro dueño no canjea sobre mi cliente")
as_("authenticated", A)

# ── Canje ligado a una venta: anular la venta devuelve los sellos ──
cur.execute("update fidelidad_campanas set activa=false where kiosco_id=%s", (ka,))
cl3 = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Carla','5493415550003') returning id", (ka,))
one("select fidelidad_dar_sellos(%s,null,5,'Saldo inicial')", (cl3,))
vv = one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, %s, 0)", (t, json.dumps([{"producto_id": coca, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 1000}]), cl3)); commit()
ok("venta_invalida" in (fails("select fidelidad_canjear(%s,%s,%s)", (cl3, dto, str(uuid.uuid4()))) or ""), "canje con una venta que no existe se rechaza")
one("select fidelidad_canjear(%s,%s,%s)", (cl3, dto, vv["venta_id"]))
ok(saldo(cl3) == 2, "canje de '10% off' (3 sellos) en la venta: 5 -> 2")
one("select anular_venta_mostrador(%s, 'prueba de fidelidad')", (vv["venta_id"],)); commit()
ok(saldo(cl3) == 5, "anular la venta devuelve los sellos del canje")

# ── Vencimiento por inactividad ──
cur.execute("update kioscos set sellos_vencen_dias=60 where id=%s", (ka,))
ok(saldo(cl3) == 5, "con vencimiento de 60 días y sellos recientes: el saldo sigue")
cur.execute("reset role")
cur.execute("update sellos set created_at = now() - interval '90 days' where cliente_id=%s", (cl3,))
as_("authenticated", A)
ok(saldo(cl3) == 0, "sin actividad hace 90 días: el saldo venció")
ok(bool(fails("update kioscos set sellos_vencen_dias=5 where id=%s", (ka,))), "el vencimiento mínimo es 30 días")
cur.execute("update kioscos set sellos_vencen_dias=null where id=%s", (ka,))
ok(saldo(cl3) == 5, "sin vencimiento configurado el saldo vuelve")

# ── Reactivación ──
cur.execute("update fidelidad_campanas set activa=false where kiosco_id=%s", (ka,))
rea = one("insert into fidelidad_campanas(kiosco_id,nombre,tipo,sellos,dias_inactivo) values (%s,'Te extrañamos','reactivacion',4,30) returning id", (ka,))
cur.execute("reset role"); cur.execute("update sellos set created_at = now() - interval '90 days' where cliente_id=%s", (cli,)); as_("authenticated", A)
ok(sim(100, cliente=cli)["total"] == 4, "cliente que volvió tras 90 días: bono de reactivación")
ok(sim(100, cliente=cl3)["total"] == 0, "quien nunca compró con sellos no es 'reactivación'")
ok(sim(100, cliente=cli2)["total"] == 0, "cliente reciente: sin bono")
ok(sim(100)["total"] == 0, "sin cliente: no hay reactivación")

# ── Resúmenes ──
rs = one("select fidelidad_resumen(%s, 30)", (ka,))
ok(rs["sellos_dados"] > 0 and isinstance(rs["por_campana"], list) and isinstance(rs["top_clientes"], list), "resumen del programa")
rw = one("select resumen_semana(%s)", (ka,))
ok(int(rw["sellos_semana"]) > 0, "resumen semanal suma cantidades de sellos")
as_("authenticated", B)
ok("no_autorizado" in (fails("select fidelidad_resumen(%s)", (ka,)) or ""), "el resumen de otro kiosco no se ve")
as_("anon")
ok(bool(fails("select * from clientes_sellos")), "anon no ve saldos")
ok(bool(fails("select fidelidad_calcular(%s,null,'pedido',1,null,null,now())", (ka,))), "las funciones internas no se llaman desde afuera")

print(f"\n{'TODO OK' if not bad else str(bad) + ' FALLAS'}")
sys.exit(1 if bad else 0)
