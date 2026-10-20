# Promociones fases A, B y C (0045–0052): factibilidad, tope, aviso previo, liquidación, etapas, sorteos, cumpleaños, referidos e historial.
# Uso: python3 supabase/tests/promos_test.py
import os, psycopg2, uuid, tempfile, sys, json, glob
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "promos_" + uuid.uuid4().hex[:8]
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
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema auth; create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid(), created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated; grant all on storage.objects to anon, authenticated;
create publication supabase_realtime;
""")
for f in sorted(glob.glob("supabase/migrations/*.sql")): cur.execute(open(f).read())

A, CJ, EN, X = (str(uuid.uuid4()) for _ in range(4))
for u, n in ((A, "dueno"), (CJ, "cajero"), (EN, "encargado"), (X, "extrano")): cur.execute("insert into auth.users(id,email) values (%s,%s)", (u, n + "@test.com"))
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
def pg(sql, args=None, back=None):
    """Consulta como administrador (para mirar tablas que el rol de la app no lee) y vuelve al rol anterior."""
    cur.execute("select current_user"); rol = cur.fetchone()[0]; cur.execute("select current_setting('request.jwt.claim.sub', true)"); sub = cur.fetchone()[0]
    as_("postgres"); v = one(sql, args); as_(rol, sub); return v
def has(err, texto): return texto in (err or "")
import json, datetime

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','promo-a','5493415551234',true) returning id", (A,))
as_("postgres")
cur.execute("insert into kiosco_miembros(kiosco_id,user_id,rol) values (%s,%s,'cajero'), (%s,%s,'encargado')", (ka, CJ, ka, EN))
def prod(nombre, precio, costo=None, stock=None):
    return one("insert into productos(kiosco_id,nombre,precio,costo,stock_controlado,stock) values (%s,%s,%s,%s,%s,%s) returning id", (ka, nombre, precio, costo, stock is not None, stock or 0))
gaseosa = prod("Gaseosa", 1000, 600, 20)

# ===== 0050: panel, factibilidad, aviso previo, historial =====
as_("authenticated", A)
cur.execute("insert into fidelidad_premios(kiosco_id,nombre,costo_sellos,tipo,producto_id) values (%s,'Gaseosa gratis',10,'producto',%s)", (ka, gaseosa))
p = one("select promo_panel(%s)", (ka,))
ok(p["factibilidad"]["estado"] == "lista" and p["activas"] == [], "panel: sin ventas ni promociones queda lista y vacía")
ok(p["aviso_previo_dias"] == 1, "panel: aviso previo por defecto 1 día")
r = one("select promo_activar(%s,'bienvenida')", (ka,))
hoy = one("select (now() at time zone 'America/Argentina/Buenos_Aires')::date")
ok(r["sale_el"] == str(hoy + datetime.timedelta(days=1)), "activar una automática empieza mañana (aviso previo)")
r2 = one("select promo_activar(%s,'sellos_dobles_dias_flojos')", (ka,))
ok(r2["sale_el"] is None, "una promoción no automática empieza al instante")
ok(has(fails("select promo_activar(%s,'bienvenida')", (ka,)), "promo_ya_activa"), "no se duplica la misma promoción")
ok(has(fails("select promo_activar(%s,'premio_por_etapas')", (ka,)), "promo_no_disponible"), "las de niveles no se activan con un clic")
cur.execute("update kioscos set club_aviso_previo_dias = 0 where id = %s", (ka,))
cur.execute("select promo_desactivar(%s,'bienvenida')", (ka,))
r = one("select promo_activar(%s,'bienvenida')", (ka,))
ok(r["sale_el"] is None, "con aviso 0 empieza al instante")
as_("authenticated", EN)
ok(has(fails("select promo_activar(%s,'reactivacion')", (ka,)), "no_autorizado"), "el encargado no activa (solo el dueño)")
ok(one("select jsonb_array_length(promo_panel(%s)->'activas')", (ka,)) == 2, "el encargado sí ve el panel")
as_("authenticated", CJ)
ok(has(fails("select promo_panel(%s)", (ka,)), "no_autorizado"), "el cajero no ve el panel")
as_("authenticated", X)
ok(has(fails("select promo_panel(%s)", (ka,)), "no_autorizado"), "un extraño no ve el panel")
as_("anon")
ok(bool(fails("select promo_panel(%s)", (ka,))), "anon no ve el panel")
ok(bool(fails("select promo_costo_mes(%s)", (ka,))), "las funciones internas no se llaman desde afuera")

# Racha, cumpleaños y referido se activan con un clic
as_("authenticated", A)
for c in ("racha", "regalo_cumpleanos", "referido"): cur.execute("select promo_activar(%s,%s)", (ka, c))
ok(one("select count(*) from fidelidad_campanas where kiosco_id=%s and activa and tipo in ('racha','cumpleanos','referido')", (ka,)) == 3, "racha, cumpleaños y referido quedan activas")

# Factibilidad: margen bajo pide confirmación explícita
as_("postgres")
barata = prod("Chicle", 100, 95, 50)
cur.execute("update fidelidad_premios set producto_id=%s where kiosco_id=%s", (barata, ka))
as_("authenticated", A)
cur.execute("select promo_desactivar(%s,'reactivacion')", (ka,))
ok(one("select promo_panel(%s)->'factibilidad'->>'estado'", (ka,)) == "reduce_margen", "premio con poco margen: reduce_margen")
ok(has(fails("select promo_activar(%s,'reactivacion')", (ka,)), "promo_reduce_margen"), "sin confirmar, no se activa con margen bajo")
r = one("select promo_activar(%s,'reactivacion', true)", (ka,))
ok(r["clave"] == "reactivacion", "con confirmación explícita se activa")
ok(pg("select count(*) from promo_historial where kiosco_id=%s and accion='margen_confirmado'", (ka,)) == 1, "la confirmación de margen queda registrada")

# Falta stock
as_("postgres")
cur.execute("update productos set stock = 0 where id=%s", (barata,))
as_("authenticated", A)
ok(one("select promo_panel(%s)->'factibilidad'->>'estado'", (ka,)) == "falta_stock", "premio agotado: falta_stock")
cur.execute("select promo_desactivar(%s,'racha')", (ka,))
ok(has(fails("select promo_activar(%s,'racha')", (ka,)), "promo_falta_stock"), "con el premio agotado no se activa nada")
as_("postgres")
cur.execute("update productos set stock = 50 where id=%s", (barata,)); cur.execute("update fidelidad_premios set producto_id=%s where kiosco_id=%s", (gaseosa, ka))

# Tope mensual: ventas del mes, sellos de promociones y apagado automático
cli = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Ana','1155550001') returning id", (ka,))
as_("authenticated", A)
turno = one("select (caja_abrir_turno(%s, 0)->>'turno_id')::uuid", (ka,))
cur.execute("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null)", (turno, json.dumps([{"producto_id": gaseosa, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 1000}])))
as_("postgres")
camp_dobles = one("select id from fidelidad_campanas where kiosco_id=%s and promo_clave='sellos_dobles_dias_flojos'", (ka,))
cur.execute("insert into sellos(kiosco_id,cliente_id,origen,campana_id,cantidad) values (%s,%s,'manual',%s,1)", (ka, cli, camp_dobles))
as_("authenticated", A)
cm = one("select promo_panel(%s)->'costo_mes'", (ka,))
ok(float(cm["ventas_mes"]) == 1000 and cm["sellos_promo"] == 1, "costo del mes: ventas y sellos de promociones")
ok(float(cm["costo_sello"]) == 60.0 and float(cm["costo_promos"]) == 60.0, "costo por sello = costo del premio / sellos que pide")
ok(float(cm["tope_pesos"]) == 50.0 and cm["supera"] is True, "5% de $1.000 = $50: el costo de $60 supera el tope")
ok(one("select count(*) from fidelidad_campanas where kiosco_id=%s and activa and promo_clave in ('bienvenida','reactivacion','regalo_cumpleanos')", (ka,)) == 0, "al superar el tope se pausan las automáticas")
ok(one("select count(*) from fidelidad_campanas where kiosco_id=%s and activa and promo_clave='sellos_dobles_dias_flojos'", (ka,)) == 1, "las que no son automáticas siguen")
ok(pg("select count(*) from promo_historial where kiosco_id=%s and accion='apagado_tope'", (ka,)) >= 1, "el apagado por tope queda en el historial")
ok(has(fails("select promo_activar(%s,'bienvenida')", (ka,)), "promo_supera_tope"), "superado el tope no se activa otra")
cur.execute("update kioscos set club_tope_promos_pct = 10 where id=%s", (ka,))
ok(one("select promo_panel(%s)->'factibilidad'->>'estado'", (ka,)) == "lista", "subiendo el tope vuelve a estar lista (recalcula)")

# Historial: lo ve solo el dueño y todo cambio queda
h = one("select promo_historial(%s, 50)", (ka,))
acc = {x["accion"] for x in h}
ok({"alta", "pausar", "ajustes", "apagado_tope", "margen_confirmado"} <= acc, "el historial registra altas, pausas, ajustes, apagados y confirmaciones: " + ",".join(sorted(acc)))
as_("authenticated", EN)
ok(has(fails("select promo_historial(%s, 50)", (ka,)), "no_autorizado"), "el historial es solo del dueño")
as_("authenticated", A)
ok(bool(fails("select * from promo_historial")), "la tabla del historial no se lee directo")

# ===== 0051: liquidación de stock =====
as_("postgres")
turron = prod("Turrón", 1000, 500, 30)
reciente = prod("Alfajor nuevo", 800, 400, 5)
nosctl = one("insert into productos(kiosco_id,nombre,precio,costo) values (%s,'Sin control',500,200) returning id", (ka,))
cur.execute("update productos set created_at = now() - interval '60 days' where id=%s", (turron,))
as_("authenticated", A)
rot = one("select promo_sin_rotacion(%s, 30)", (ka,))
ok([x["nombre"] for x in rot] == ["Turrón"], "sin rotación 30 días: solo el producto viejo con stock controlado")
ok(rot[0]["capital"] == 15000.0 and rot[0]["dias_sin_venta"] >= 60 and rot[0]["margen_pct"] == 50.0 and rot[0]["liquidacion"] is None, "capital parado = stock por costo; días y margen calculados")
ok(one("select jsonb_array_length(promo_sin_rotacion(%s, 90))", (ka,)) == 0, "a 90 días todavía no está parado")
ok(has(fails("select promo_sin_rotacion(%s, 3)", (ka,)), "promo_valor_invalido"), "los días tienen que estar entre 7 y 365")
as_("authenticated", EN)
ok(len(one("select promo_sin_rotacion(%s, 30)", (ka,))) == 1, "el encargado ve los productos parados")
ok(has(fails("select promo_liquidar_activar(%s,'descuento_sin_movimiento',%s,20)", (ka, turron)), "no_autorizado"), "el encargado no activa liquidaciones")
as_("authenticated", CJ)
ok(has(fails("select promo_sin_rotacion(%s, 30)", (ka,)), "no_autorizado"), "el cajero no ve los parados")
as_("authenticated", A)

# Validaciones
ok(has(fails("select promo_liquidar_activar(%s,'descuento_sin_movimiento',%s,95)", (ka, turron)), "promo_valor_invalido"), "descuento mayor a 90% se rechaza")
ok(has(fails("select promo_liquidar_activar(%s,'liquidar_sin_rotacion',%s,2.5)", (ka, turron)), "promo_valor_invalido"), "los sellos del regalo tienen que ser enteros")
ok(has(fails("select promo_liquidar_activar(%s,'racha',%s,5)", (ka, turron)), "promo_no_disponible"), "solo las tres opciones de liquidación")
ok(has(fails("select promo_liquidar_activar(%s,'descuento_sin_movimiento',%s,20)", (ka, nosctl)), "promo_falta_stock"), "un producto sin stock controlado no se liquida")
ok(has(fails("select promo_liquidar_activar(%s,'descuento_sin_movimiento',%s,20, (now() at time zone 'America/Argentina/Buenos_Aires')::date - 3)", (ka, turron)), "promo_fecha_invalida"), "la fecha de fin ya pasó")
as_("authenticated", X)
ok(has(fails("select promo_liquidar_activar(%s,'descuento_sin_movimiento',%s,20)", (ka, turron)), "no_autorizado"), "un extraño no activa nada")
as_("authenticated", A)

# Descuento: queda como promoción de la caja y el cobro lo aplica
r = one("select promo_liquidar_activar(%s,'descuento_sin_movimiento',%s,20)", (ka, turron))
ok(r["tipo"] == "descuento", "descuento activado")
ok(pg("select pct from pos_promos where producto_id=%s and activa", (turron,)) == 20, "el descuento es una promoción de la caja")
v = one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null)", (turno, json.dumps([{"producto_id": turron, "cantidad": 2}]), json.dumps([{"medio": "efectivo", "monto": 5000}])))
ok(float(v["descuento"]) == 400.0 and float(v["total"]) == 1600.0, "al cobrar 2 turrones se descuenta el 20%: $1.600")
ok(has(fails("select promo_liquidar_activar(%s,'liquidar_sin_rotacion',%s,5)", (ka, turron)), "promo_producto_duplicada"), "una sola promoción por producto")
lst = one("select promo_liquidaciones(%s)", (ka,))
ok(len(lst) == 1 and lst[0]["producto"] == "Turrón" and lst[0]["tipo"] == "descuento", "la lista de activas muestra el descuento")

# Margen: un descuento que deja el producto bajo el mínimo pide confirmación
as_("postgres")
cur.execute("update productos set stock = 25 where id=%s", (turron,))
cur.execute("update pos_promos set activa=false where producto_id=%s", (turron,)); cur.execute("update promo_liquidacion set activa=false where producto_id=%s", (turron,))
cur.execute("update productos set created_at = now() - interval '60 days' where id=%s", (turron,))
as_("authenticated", A)
ok(has(fails("select promo_liquidar_activar(%s,'descuento_sin_movimiento',%s,50)", (ka, turron)), "promo_reduce_margen"), "50% deja margen 0%: pide confirmación")
r = one("select promo_liquidar_activar(%s,'descuento_sin_movimiento',%s,50,null,true)", (ka, turron))
ok(r["tipo"] == "descuento", "con confirmación explícita se activa")
ok(pg("select count(*) from promo_historial where kiosco_id=%s and accion='margen_confirmado' and tabla='promo_liquidacion'", (ka,)) == 1, "la confirmación del margen de la liquidación queda registrada")
one("select promo_liquidar_pausar(%s, %s)", (ka, r["id"]))
ok(pg("select activa from pos_promos where producto_id=%s order by created_at desc limit 1", (turron,)) is False, "pausar deshace el descuento de la caja")

# Regalo y llevá dos
r = one("select promo_liquidar_activar(%s,'liquidar_sin_rotacion',%s,8)", (ka, turron))
ok(pg("select costo_sellos from fidelidad_premios where producto_id=%s and activo", (turron,)) == 8, "el regalo es un premio de producto que cuesta 8 sellos")
one("select promo_liquidar_pausar(%s, %s)", (ka, r["id"]))
ok(pg("select count(*) from fidelidad_premios where producto_id=%s and activo", (turron,)) == 0, "pausar el regalo saca el premio")
r = one("select promo_liquidar_activar(%s,'llevá_dos_suma_mas',%s,3)", (ka, turron))
ok(pg("select count(*) from fidelidad_campanas where producto_id=%s and activa and tipo='dos_producto' and sellos=3", (turron,)) == 1, "llevá dos es una campaña de 3 sellos extra")
ok(pg("select count(*) from promo_historial where kiosco_id=%s and tabla='fidelidad_campanas' and nombre like 'Llevá dos%%'", (ka,)) == 0, "no se duplican los renglones del historial (queda uno solo, el de la liquidación)")

# Apagado automático al agotarse el stock
as_("postgres")
cur.execute("update productos set stock = 0 where id=%s", (turron,))
as_("authenticated", A)
ok(one("select jsonb_array_length(promo_liquidaciones(%s))", (ka,)) == 0, "al agotarse el stock la liquidación se pausó sola")
ok(pg("select count(*) from fidelidad_campanas where producto_id=%s and activa", (turron,)) == 0, "y la campaña asociada también")
ok(pg("select count(*) from promo_historial where kiosco_id=%s and accion='apagado_stock' and tabla='promo_liquidacion'", (ka,)) == 1, "el apagado por stock queda en el historial")

# Fecha de fin vencida: se pausa al abrir el panel
as_("postgres")
cur.execute("update productos set stock = 10 where id=%s", (turron,))
as_("authenticated", A)
r = one("select promo_liquidar_activar(%s,'descuento_sin_movimiento',%s,10, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 1)", (ka, turron))
as_("postgres")
cur.execute("update promo_liquidacion set hasta = (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1, desde = (now() at time zone 'America/Argentina/Buenos_Aires')::date - 5 where id=%s", (r["id"],))
as_("authenticated", A)
one("select promo_panel(%s)", (ka,))
ok(one("select jsonb_array_length(promo_liquidaciones(%s))", (ka,)) == 0, "con la fecha de fin vencida se pausa sola")

# Tope del mes: con el costo superado no se arman liquidaciones
as_("postgres")
cur.execute("update kioscos set club_tope_promos_pct = 0.5 where id=%s", (ka,))
as_("authenticated", A)
ok(has(fails("select promo_liquidar_activar(%s,'descuento_sin_movimiento',%s,10)", (ka, turron)), "promo_supera_tope"), "superado el tope del mes no se arma otra")
as_("postgres")
cur.execute("update kioscos set club_tope_promos_pct = 10 where id=%s", (ka,))
as_("authenticated", A)

# ===== 0052: etapas, sorteos, cumpleaños, referidos, racha y tarjeta =====
def pgx(sql, args=None):
    """Igual que pg() pero para sentencias sin resultado (update, insert)."""
    cur.execute("select current_user"); rol = cur.fetchone()[0]; cur.execute("select current_setting('request.jwt.claim.sub', true)"); sub = cur.fetchone()[0]
    as_("postgres"); cur.execute(sql, args); as_(rol, sub)
as_("authenticated", A)
hoy = one("select (now() at time zone 'America/Argentina/Buenos_Aires')::date")
dos_hoy = lambda d: str(hoy + datetime.timedelta(days=d))

# Etapas: validaciones
ok(has(fails("select promo_etapas_guardar(%s, %s::jsonb)", (ka, json.dumps([{"nombre": "Solo uno", "costo_sellos": 5, "tipo": "libre"}]))), "promo_etapas_cantidad"), "etapas: hacen falta al menos dos niveles")
ok(has(fails("select promo_etapas_guardar(%s, %s::jsonb)", (ka, json.dumps([{"nombre": "A", "costo_sellos": 8, "tipo": "libre"}, {"nombre": "B", "costo_sellos": 5, "tipo": "libre"}]))), "promo_etapas_invalidas"), "etapas: los sellos tienen que ser crecientes")
ok(has(fails("select promo_etapas_guardar(%s, %s::jsonb)", (ka, json.dumps([{"nombre": "A", "costo_sellos": 5, "tipo": "pct", "valor": 150}, {"nombre": "B", "costo_sellos": 9, "tipo": "libre"}]))), "promo_etapas_invalidas"), "etapas: el porcentaje no pasa de 100")
ok(has(fails("select promo_etapas_guardar(%s, %s::jsonb)", (ka, json.dumps([{"nombre": "A", "costo_sellos": 5, "tipo": "libre"}, {"nombre": "B", "costo_sellos": 9, "tipo": "producto", "producto_id": str(uuid.uuid4())}]))), "producto_invalido"), "etapas: un producto que no es del local no se usa")
ok(has(fails("select promo_etapas_guardar(%s, %s::jsonb)", (ka, json.dumps([{"nombre": "A", "costo_sellos": 5, "tipo": "libre"}, {"nombre": "B", "costo_sellos": 9, "tipo": "producto", "producto_id": str(barata)}]))), "promo_reduce_margen"), "etapas: un producto con margen bajo pide confirmación")
as_("authenticated", EN)
ok(has(fails("select promo_etapas_guardar(%s, %s::jsonb)", (ka, json.dumps([{"nombre": "A", "costo_sellos": 5, "tipo": "libre"}, {"nombre": "B", "costo_sellos": 9, "tipo": "libre"}]))), "no_autorizado"), "etapas: el encargado no las cambia")
as_("authenticated", A)
niveles = [
    {"nombre": "Café chico", "costo_sellos": 3, "tipo": "libre"},
    {"nombre": "Gaseosa gratis", "costo_sellos": 6, "tipo": "producto", "producto_id": str(gaseosa)},
    {"nombre": "10% en la compra", "costo_sellos": 10, "tipo": "pct", "valor": 10},
]
r = one("select promo_etapas_guardar(%s, %s::jsonb)", (ka, json.dumps(niveles)))
ok(r["niveles"] == 3, "etapas: se guardan tres niveles")
ok(pg("select count(*) from fidelidad_premios where kiosco_id=%s and activo", (ka,)) == 3, "etapas: quedan activos solo los tres niveles (los anteriores se pausan)")
ok(pg("select count(*) from promo_historial where kiosco_id=%s and tabla='fidelidad_premios' and promo_clave='premio_por_etapas' and accion='cambio'", (ka,)) >= 1, "etapas: el cambio queda en el historial")

# Cliente con tarjeta: referencia, cumpleaños y racha
lu = pg("insert into clientes(kiosco_id,nombre,telefono,club_token,club_alta_at,ref_codigo) values (%s,'Luis','1155550900',replace(gen_random_uuid()::text,'-',''),now(),'RFAA22') returning id", (ka,))
tok_lu = pg("select club_token from clientes where id=%s", (lu,))
t = pg("select club_armar_tarjeta(%s)", (lu,))
ok(len(t["niveles"]) == 3 and t["ref"] == "RFAA22", "tarjeta: muestra los niveles y el código para invitar")
ok(t["proximo"]["nombre"] == "Café chico" and t["proximo"]["faltan"] == 3, "tarjeta: el próximo premio y cuántos sellos faltan")
ok(t["hay_referido"] is True, "tarjeta: avisa que hay un referido activo")

# Racha: compras en tres semanas anteriores + esta = 4 semanas seguidas
if pg("select count(*) from fidelidad_campanas where kiosco_id=%s and activa and tipo='racha'", (ka,)) == 0:
    as_("authenticated", A); one("select promo_activar(%s,'racha')", (ka,))
pgx("update fidelidad_campanas set desde = null where kiosco_id=%s and tipo='racha'", (ka,))
for d in (7, 14, 21):
    pgx("insert into sellos(kiosco_id,cliente_id,origen,cantidad,motivo,created_at) values (%s,%s,'venta',1,'compra vieja', now() - make_interval(days => %s))", (ka, lu, d))
ok(pg("select count(*) from fidelidad_calcular(%s,%s,'mostrador',0,null,'[]'::jsonb,now()) r where r.motivo='Racha de compras'", (ka, lu)) == 1, "racha: cuatro semanas seguidas suman el sello")
camp_racha = pg("select (select id from fidelidad_campanas where kiosco_id=%s and tipo='racha' and activa limit 1)", (ka,))
pgx("insert into sellos(kiosco_id,cliente_id,origen,campana_id,cantidad,motivo) values (%s,%s,'venta',%s,1,'Racha de compras')", (ka, lu, camp_racha))
ok(pg("select count(*) from fidelidad_calcular(%s,%s,'mostrador',0,null,'[]'::jsonb,now()) r where r.motivo='Racha de compras'", (ka, lu)) == 0, "racha: ya dado esta semana, otra compra no lo vuelve a sumar")

# Cumpleaños: validación, carga y premio una vez por año
ok(has(fails("select club_guardar_cumple(%s, 31, 2)", (tok_lu,)), "club_cumple_invalido"), "cumpleaños: 31 de febrero no existe")
ok(has(fails("select club_guardar_cumple(%s, 1, 1)", ("0" * 32,)), "club_token_invalido"), "cumpleaños: token inválido se rechaza")
t = one("select club_guardar_cumple(%s, %s, %s)", (tok_lu, hoy.day, hoy.month))
ok(t["cumple_dia"] == hoy.day and t["cumple_mes"] == hoy.month, "cumpleaños: se guarda día y mes")
camp_cum = pg("select (select id from fidelidad_campanas where kiosco_id=%s and tipo='cumpleanos' and activa limit 1)", (ka,))
if camp_cum is None:
    one("select promo_activar(%s,'regalo_cumpleanos')", (ka,))
    camp_cum = pg("select (select id from fidelidad_campanas where kiosco_id=%s and tipo='cumpleanos' and activa limit 1)", (ka,))
pgx("update fidelidad_campanas set desde = null where id=%s", (camp_cum,))
ok(pg("select club_armar_tarjeta(%s)", (lu,))["hay_cumple"] is True, "tarjeta: avisa que hay regalo de cumpleaños activo")
ok(pg("select count(*) from fidelidad_calcular(%s,%s,'mostrador',0,null,'[]'::jsonb,now()) r where r.motivo='Regalo de cumpleaños'", (ka, lu)) == 1, "cumpleaños: el día del cumpleaños suma el regalo")
pgx("insert into sellos(kiosco_id,cliente_id,origen,campana_id,cantidad,motivo) values (%s,%s,'venta',%s,1,'Regalo de cumpleaños')", (ka, lu, camp_cum))
ok(pg("select count(*) from fidelidad_calcular(%s,%s,'mostrador',0,null,'[]'::jsonb,now()) r where r.motivo='Regalo de cumpleaños'", (ka, lu)) == 0, "cumpleaños: el regalo es una vez por año")

# Traé un amigo: el nuevo suma y quien invita suma; sin código válido no pasa nada; cada teléfono una sola vez
as_("authenticated", A)
ok(one("select promo_panel(%s)->'factibilidad'->>'estado'", (ka,)) in ("lista", "reduce_margen", "falta_stock", "supera_tope"), "panel: sigue dando un estado válido con las etapas nuevas")
as_("anon")
rr = one("select club_unirse(%s,%s,%s,%s)", ("promo-a", "Marta", "1155550901", "RFAA22"))
ok(rr["estado"] == "ok" and rr["_aviso"]["cantidad"] >= 2, "referido: el amigo que se registra con el código suma sellos")
as_("postgres")
ok(pg("select count(*) from sellos where motivo='Te invitó un amigo' and cliente_id=(select id from clientes where telefono='1155550901')") == 1, "referido: el amigo recibe su sello de bienvenida por invitación")
ok(pg("select count(*) from sellos where motivo='Invitaste a un amigo' and cliente_id=%s", (lu,)) == 1, "referido: quien invita también recibe su sello")
ok(pg("select referido_por from clientes where telefono='1155550901'") == lu, "referido: queda registrado quién invitó")
as_("anon")
one("select club_unirse(%s,%s,%s,%s)", ("promo-a", "Pablo", "1155550902", "ZZZZZZ"))
ok(pg("select count(*) from sellos where motivo='Te invitó un amigo' and cliente_id=(select id from clientes where telefono='1155550902')") == 0, "referido: un código que no existe no da sellos")
rr = one("select club_unirse(%s,%s,%s,%s)", ("promo-a", "Marta", "1155550901", "RFAA22"))
ok(rr["estado"] == "ya_registrado", "referido: el mismo teléfono no se registra dos veces")
as_("authenticated", A)
ok(pg("select count(*) from sellos where motivo='Invitaste a un amigo' and cliente_id=%s", (lu,)) == 1, "referido: el premio por invitar no se duplica")

# Sorteos: clientes con papelitos usados en el período
def club_cliente(nombre, tel, papelitos):
    """papelitos: (código, días desde que se usó, sello anulado?). Cada papelito tiene su sello con el mismo evento."""
    cli = pg("insert into clientes(kiosco_id,nombre,telefono,club_token,club_alta_at) values (%s,%s,%s,replace(gen_random_uuid()::text,'-',''),now()) returning id", (ka, nombre, tel))
    for codigo, dias, anulado in papelitos:
        ev = str(uuid.uuid4())
        pgx("insert into club_codigos(kiosco_id,codigo,lote,usado_at,cliente_id,club_evento) values (%s,%s,1,now() - make_interval(days => %s),%s,%s)", (ka, codigo, dias, cli, ev))
        pgx("insert into sellos(kiosco_id,cliente_id,origen,cantidad,motivo,club_evento,anulado) values (%s,%s,'club',1,'Papelito',%s,%s)", (ka, cli, ev, anulado))
    return cli
c1 = club_cliente("Sorteo Uno", "1155551001", [("SRTAAA", 5, False), ("SRTBBB", 4, False)])
c2 = club_cliente("Sorteo Dos", "1155551002", [("SRTCCC", 3, False)])
c3 = club_cliente("Sorteo Tres", "1155551003", [("SRTDDD", 2, False)])
club_cliente("Sorteo Cuatro", "1155551004", [("SRTEEE", 30, False)])
club_cliente("Sorteo Cinco", "1155551005", [("SRTFFF", 2, True)])

desde, hasta = dos_hoy(-10), dos_hoy(-1)
as_("authenticated", EN)
ok(has(fails("select sorteo_crear(%s,'X','[\"Premio\"]'::jsonb,%s,%s)", (ka, desde, hasta)), "no_autorizado"), "sorteo: el encargado no crea sorteos")
as_("authenticated", A)
ok(has(fails("select sorteo_crear(%s,'Vacío','[]'::jsonb,%s,%s)", (ka, desde, hasta)), "sorteo_premios_invalidos"), "sorteo: hace falta al menos un premio")
ok(has(fails("select sorteo_crear(%s,'Al revés','[\"Premio\"]'::jsonb,%s,%s)", (ka, hasta, desde)), "sorteo_fechas_invalidas"), "sorteo: el período tiene que tener fechas en orden")
ok(has(fails("select sorteo_crear(%s,'   ','[\"Premio\"]'::jsonb,%s,%s)", (ka, desde, hasta)), "sorteo_nombre_invalido"), "sorteo: el nombre no puede estar vacío")
s1 = one("select sorteo_crear(%s,'Sorteo de octubre','[\"Premio 1\",\"Premio 2\",\"Premio 3\"]'::jsonb,%s,%s)", (ka, desde, hasta))["id"]
ok(has(fails("select sorteo_realizar(%s,%s)", (ka, s1)), "sorteo_sin_permiso"), "sorteo: no se realiza sin confirmar el permiso legal")
as_("authenticated", EN)
ok(has(fails("select sorteo_confirmar_permiso(%s,%s,'ok')", (ka, s1)), "no_autorizado"), "sorteo: el encargado no confirma el permiso")
as_("authenticated", A)
ok(bool(fails("insert into sorteos(kiosco_id,nombre,desde,hasta) values (%s,'Directo',%s,%s)", (ka, desde, hasta))), "sorteo: no se inserta directo en la tabla")
one("select sorteo_confirmar_permiso(%s,%s,'Autorización municipal al día')", (ka, s1))
ok(one("select sorteo_chances_resumen(%s,%s,%s)", (ka, desde, hasta)) == {"chances": 4, "clientes": 3}, "sorteo: cuenta las chances (solo papelitos del período y con sello vigente)")
r = one("select sorteo_realizar(%s,%s)", (ka, s1))
ok(r["ok"] is True and len(r["semilla"]) == 64, "sorteo: se realiza y guarda la semilla")
g = [x for x in one("select sorteo_listar(%s)", (ka,)) if x["id"] == s1][0]
ganadores = [x["cliente_id"] for x in g["ganadores"]]
ok(g["estado"] == "realizado" and len(g["ganadores"]) == 3 and len(set(ganadores)) == 3, "sorteo: tres ganadores distintos")
ok(set(ganadores) == {str(c1), str(c2), str(c3)}, "sorteo: solo ganan los que tienen papelitos válidos del período")
ok(one("select sorteo_verificar(%s,%s)", (ka, s1)) == {"coincide": True, "chances": 4}, "sorteo: se puede verificar: repitiendo con la semilla sale lo mismo")
ok(has(fails("select sorteo_realizar(%s,%s)", (ka, s1)), "sorteo_no_disponible"), "sorteo: no se realiza dos veces")
ok(has(fails("select sorteo_cancelar(%s,%s)", (ka, s1)), "sorteo_no_disponible"), "sorteo: uno realizado no se cancela")

# Pocos participantes: 4 premios con 3 clientes
s2 = one("select sorteo_crear(%s,'Muchos premios','[\"A\",\"B\",\"C\",\"D\"]'::jsonb,%s,%s)", (ka, desde, hasta))["id"]
one("select sorteo_confirmar_permiso(%s,%s,null)", (ka, s2))
ok(has(fails("select sorteo_realizar(%s,%s)", (ka, s2)), "sorteo_pocos_participantes"), "sorteo: no alcanzan participantes para los premios")
one("select sorteo_cancelar(%s,%s)", (ka, s2))
ok([x for x in one("select sorteo_listar(%s)", (ka,)) if x["id"] == s2][0]["estado"] == "cancelado", "sorteo: se puede cancelar mientras es borrador")

# Sorteo abierto: aparece en la tarjeta del cliente y no se puede realizar todavía
s3 = one("select sorteo_crear(%s,'Sorteo abierto','[\"Premio único\"]'::jsonb,%s,%s)", (ka, dos_hoy(-10), str(hoy)))["id"]
one("select sorteo_confirmar_permiso(%s,%s,null)", (ka, s3))
ok(has(fails("select sorteo_realizar(%s,%s)", (ka, s3)), "sorteo_periodo_abierto"), "sorteo: no se realiza mientras el período sigue abierto")
t1 = pg("select club_armar_tarjeta(%s)", (c1,))
ok(t1["sorteo"] is not None and t1["sorteo"]["nombre"] == "Sorteo abierto" and t1["sorteo"]["mis_chances"] == 2, "sorteo: la tarjeta muestra el sorteo vigente y las chances del cliente")

# ===== 0053: descuento en % con tope en pesos y "Deshacer" de las etapas =====
as_("authenticated", A)
ok(has(fails("insert into fidelidad_premios(kiosco_id,nombre,costo_sellos,tipo,valor,tope_pesos) values (%s,'Tope en monto',5,'monto',100,300)", (ka,)), "fidelidad_premios_tope_check"), "tope: solo se pone en premios de porcentaje")
ok(has(fails("insert into fidelidad_premios(kiosco_id,nombre,costo_sellos,tipo,valor,tope_pesos) values (%s,'Tope cero',5,'pct',10,0)", (ka,)), "fidelidad_premios_tope_check"), "tope: tiene que ser mayor que cero")
pct_id = one("insert into fidelidad_premios(kiosco_id,nombre,costo_sellos,tipo,valor,tope_pesos) values (%s,'Descuento 10 con tope 300',4,'pct',10,300) returning id", (ka,))
ev = one("select club_evaluar(%s)", (ka,))
pc = [x for x in ev["premios"] if x["premio_id"] == pct_id][0]
t = ev["ticket_promedio"]
ok(pc["costo_local"] is not None and pc["costo_local"] <= 300 and (t is None or pc["costo_local"] == round(min(t * 0.10, 300), 2)), "tope: el costo del 10% se topa en $300 para la rentabilidad")

# Niveles por etapas con tope
niv = [{"nombre": "Café", "costo_sellos": 3, "tipo": "libre"}, {"nombre": "15% con tope", "costo_sellos": 6, "tipo": "pct", "valor": 15, "tope": "250"}]
ok(has(fails("select promo_etapas_guardar(%s,%s::jsonb)", (ka, json.dumps([niv[0], {**niv[1], "tope": "abc"}]))), "promo_etapas_invalidas"), "etapas: un tope que no es número se rechaza")
ok(has(fails("select promo_etapas_guardar(%s,%s::jsonb)", (ka, json.dumps([niv[0], {**niv[1], "tope": "-5"}]))), "promo_etapas_invalidas"), "etapas: un tope negativo se rechaza")
ok(one("select promo_etapas_guardar(%s,%s::jsonb)", (ka, json.dumps(niv)))["niveles"] == 2, "etapas: el nivel de % acepta tope")
ok(pg("select tope_pesos from fidelidad_premios where kiosco_id=%s and activo and tipo='pct'", (ka,)) == 250, "etapas: el tope queda guardado en el premio")
ok(pg("select count(*) from fidelidad_premios where kiosco_id=%s and activo and tipo='libre'", (ka,)) == 1 and pg("select tope_pesos from fidelidad_premios where kiosco_id=%s and activo and tipo='libre'", (ka,)) is None, "etapas: un nivel sin tope queda sin tope")

# Deshacer: volver a los niveles de antes, o quitar todos si no había ninguno
prev = niv
one("select promo_etapas_guardar(%s,%s::jsonb)", (ka, json.dumps([{"nombre": "Otro", "costo_sellos": 4, "tipo": "libre"}, {"nombre": "Otro 2", "costo_sellos": 8, "tipo": "libre"}, {"nombre": "Otro 3", "costo_sellos": 12, "tipo": "libre"}])))
ok(pg("select count(*) from fidelidad_premios where kiosco_id=%s and activo", (ka,)) == 3, "deshacer: se cambian los niveles")
one("select promo_etapas_guardar(%s,%s::jsonb)", (ka, json.dumps(prev)))
ok(pg("select count(*) from fidelidad_premios where kiosco_id=%s and activo", (ka,)) == 2 and pg("select tope_pesos from fidelidad_premios where kiosco_id=%s and activo and tipo='pct'", (ka,)) == 250, "deshacer: vuelven los niveles anteriores con su tope")
as_("authenticated", EN)
ok(has(fails("select promo_etapas_quitar(%s)", (ka,)), "no_autorizado"), "deshacer: el encargado no quita los niveles")
as_("authenticated", A)
one("select promo_etapas_quitar(%s)", (ka,))
ok(pg("select count(*) from fidelidad_premios where kiosco_id=%s and activo", (ka,)) == 0, "deshacer: sin niveles antes, quitar deja el club sin etapas")
ok(pg("select count(*) from promo_historial where kiosco_id=%s and accion='cambio' and detalle->>'niveles'='0'", (ka,)) >= 1, "deshacer: el quitar queda en el historial")
one("select promo_etapas_guardar(%s,%s::jsonb)", (ka, json.dumps(prev)))

# ===== 0054: sugeridas =====
as_("authenticated", X)
ok(has(fails("select promo_sugerencias(%s)", (ka,)), "no_autorizado"), "sugeridas: un extraño no las ve")
as_("authenticated", EN)
ok(isinstance(one("select promo_sugerencias(%s)", (ka,))["sugerencias"], list), "sugeridas: el encargado las ve")
as_("authenticated", A)
pgx("update fidelidad_campanas set activa=false where kiosco_id=%s and tipo='reactivacion'", (ka,))
for i in range(5):
    cli_in = pg("insert into clientes(kiosco_id,nombre,telefono,club_token,club_alta_at) values (%s,%s,%s,replace(gen_random_uuid()::text,'-',''),now()) returning id", (ka, f"Inactivo {i}", f"115556010{i}"))
    pgx("insert into sellos(kiosco_id,cliente_id,origen,cantidad,motivo,created_at) values (%s,%s,'venta',1,'vieja', now() - interval '40 days')", (ka, cli_in))
sug = one("select promo_sugerencias(%s)", (ka,))
claves = [x["clave"] for x in sug["sugerencias"]]
ok("reactivacion" in claves, "sugeridas: propone reactivar a los que no vienen (5 o más)")
cumple_activo = pg("select count(*) from fidelidad_campanas where kiosco_id=%s and activa and tipo='cumpleanos'", (ka,)) > 0
ok(("regalo_cumpleanos" in claves) == (not cumple_activo), "sugeridas: propone el regalo de cumpleaños solo si está apagado y hay cumpleañeros")
yerba = prod("Yerba parada", 1000, 500, 40)
pgx("update productos set created_at = now() - interval '60 days' where id=%s", (yerba,))
sug = one("select promo_sugerencias(%s)", (ka,))
parado = [x for x in sug["sugerencias"] if x["clave"] == "descuento_sin_movimiento"]
ok(len(parado) == 1 and parado[0]["producto_id"] == str(yerba) and parado[0]["valor"] == 20, "sugeridas: propone liquidar el producto parado con 20%")
ok(len(sug["sugerencias"]) <= 3, "sugeridas: como mucho tres propuestas")
one("select promo_liquidar_activar(%s,'descuento_sin_movimiento',%s,20)", (ka, yerba))
sug = one("select promo_sugerencias(%s)", (ka,))
ok(all(x.get("producto_id") != str(yerba) for x in sug["sugerencias"]), "sugeridas: una vez activada la liquidación, deja de sugerirse")

# ===== 0055: "No por ahora" en las sugeridas =====
as_("authenticated", X)
ok(has(fails("select promo_sugerencia_descartar(%s,'reactivacion',null,14)", (ka,)), "no_autorizado"), "descartar: un extraño no descarta")
as_("authenticated", EN)
ok(has(fails("select promo_sugerencia_descartar(%s,'reactivacion',null,0)", (ka,)), "promo_valor_invalido"), "descartar: los días tienen que estar entre 1 y 60")
ok(has(fails("select promo_sugerencia_descartar(%s,'racha',null,14)", (ka,)), "promo_no_disponible"), "descartar: solo las tres sugeridas")
ok(has(fails("select promo_sugerencia_descartar(%s,'descuento_sin_movimiento',null,14)", (ka,)), "producto_invalido"), "descartar: un producto parado necesita el producto")
before = [x["clave"] for x in one("select promo_sugerencias(%s)", (ka,))["sugerencias"]]
ok("reactivacion" in before, "descartar: antes de descartar, reactivación está sugerida")
one("select promo_sugerencia_descartar(%s,'reactivacion',null,14)", (ka,))
ok("reactivacion" not in [x["clave"] for x in one("select promo_sugerencias(%s)", (ka,))["sugerencias"]], "descartar: 'No por ahora' la oculta")
as_("authenticated", A)
mate = prod("Mate parado", 900, 400, 30)
pgx("update productos set created_at = now() - interval '60 days' where id=%s", (mate,))
ok(any(x.get("producto_id") == str(mate) for x in one("select promo_sugerencias(%s)", (ka,))["sugerencias"]), "descartar: el producto parado aparece")
one("select promo_sugerencia_descartar(%s,'descuento_sin_movimiento',%s,14)", (ka, mate))
ok(all(x.get("producto_id") != str(mate) for x in one("select promo_sugerencias(%s)", (ka,))["sugerencias"]), "descartar: se oculta solo ese producto")
pgx("update promo_sugerencias_descartadas set hasta = (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1 where kiosco_id=%s and clave='reactivacion'", (ka,))
ok("reactivacion" in [x["clave"] for x in one("select promo_sugerencias(%s)", (ka,))["sugerencias"]], "descartar: vencido el plazo, vuelve a sugerirse")

print("RESULTADO: " + ("OK" if bad == 0 else f"FALLARON {bad}"))
sys.exit(1 if bad else 0)
