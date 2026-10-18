# Verifica 0027 (pedidos a proveedor con estados y recepción estricta). Uso: python3 supabase/tests/etapa22_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
from datetime import timedelta
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa22_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras", "0016_etiquetas", "0017_fidelidad", "0018_reposicion", "0019_motivos_mermas", "0020_historial_stock", "0021_conteo_planilla", "0022_margen_precios", "0023_fase3_abc_fiado", "0024_endurecer_funciones", "0025_fuga_reglas_lotes", "0026_fuga_semanal", "0027_pedidos_proveedor"]:
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
def rows(sql, args=None):
    cur.execute(sql, args); cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]
def has(err, texto): return texto in (err or "")

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','kiosco-a','5493415551234',true) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))
as_("authenticated", A)
prov = one("select (proveedor_guardar(%s, null, 'Distribuidora Sur', '5493415550000'))->>'id'", (ka,))
def prod(nombre, por_peso=False):
    return one("insert into productos(kiosco_id,nombre,precio,stock_controlado,stock,vendido_por_peso) values (%s,%s,100,true,0,%s) returning id", (ka, nombre, por_peso))
p1, p2 = prod("Alfajor"), prod("Queso", por_peso=True)
items = json.dumps([{"producto_id": str(p1), "cantidad": 10}, {"producto_id": str(p2), "cantidad": 2500}])

# ---- 1) Crear
r = one("select pedido_proveedor_crear(%s, %s, %s::jsonb)", (ka, prov, items))
ped = r["id"]
ok(one("select estado from pedidos_proveedor where id=%s", (ped,)) == "borrador", "sin p_enviar queda en borrador")
its = rows("select id, nombre, por_peso, cantidad, recibida from pedido_proveedor_items where pedido_id=%s order by nombre", (ped,))
ok([(i["nombre"], i["por_peso"], i["cantidad"], i["recibida"]) for i in its] == [("Alfajor", False, 10, 0), ("Queso", True, 2500, 0)], "las líneas guardan nombre, peso y cantidad")
ped2 = one("select pedido_proveedor_crear(%s, %s, %s::jsonb, true)", (ka, prov, items))["id"]
ok(one("select estado from pedidos_proveedor where id=%s", (ped2,)) == "enviada", "con p_enviar queda enviada")
ok(has(fails("select pedido_proveedor_crear(%s, %s, '[]'::jsonb)", (ka, prov)), "items_invalidos"), "pedido sin líneas se rechaza")
ok(has(fails("select pedido_proveedor_crear(%s, %s, %s::jsonb)", (ka, prov, json.dumps([{"producto_id": str(p1), "cantidad": 1}, {"producto_id": str(p1), "cantidad": 2}]))), "items_invalidos"), "producto repetido se rechaza")
ok(has(fails("select pedido_proveedor_crear(%s, %s, %s::jsonb)", (ka, prov, json.dumps([{"producto_id": str(p1), "cantidad": 0}]))), "cantidad_invalida"), "cantidad 0 se rechaza")
ok(has(fails("select pedido_proveedor_crear(%s, %s, %s::jsonb)", (ka, str(uuid.uuid4()), items)), "proveedor_no_encontrado"), "proveedor inexistente se rechaza")

# ---- 2) Aislamiento entre kioscos
as_("authenticated", B)
ok(has(fails("select pedido_proveedor_crear(%s, %s, %s::jsonb)", (ka, prov, items)), "no_autorizado"), "otro usuario no crea pedidos en mi kiosco")
ok(has(fails("select pedido_proveedor_enviar(%s)", (ped,)), "pedido_no_encontrado"), "otro usuario no envía mi pedido")
ok(has(fails("select pedido_proveedor_cancelar(%s)", (ped,)), "pedido_no_encontrado"), "otro usuario no cancela mi pedido")
ok(has(fails("select pedido_proveedor_recibir(%s, %s::jsonb)", (ped2, json.dumps([{"item_id": its[0]["id"], "cantidad": 1}]))), "pedido_no_encontrado"), "otro usuario no recibe mi pedido")
ok(one("select count(*) from pedidos_proveedor") == 0 and one("select count(*) from pedido_proveedor_items") == 0, "otro usuario no ve mis pedidos ni sus líneas")
ok(fails("insert into pedidos_proveedor(kiosco_id, proveedor_id) values (%s, %s)", (kb, prov)) is not False, "no se escribe directo en la tabla")
as_("anon")
ok(fails("select * from pedidos_proveedor") is not False, "anon no lee pedidos")
ok(fails("select pedido_proveedor_cerrar(%s)", (ped,)) is not False, "anon no ejecuta las funciones")
as_("authenticated", A)

# ---- 3) Enviar / cancelar
ok(fails("select pedido_proveedor_enviar(%s)", (ped,)) is False and one("select estado from pedidos_proveedor where id=%s", (ped,)) == "enviada", "borrador → enviada")
ok(has(fails("select pedido_proveedor_enviar(%s)", (ped,)), "pedido_estado_invalido"), "no se envía dos veces")
ok(fails("select pedido_proveedor_recibir(%s, %s::jsonb)", (ped, json.dumps([{"item_id": its[0]["id"], "cantidad": 1}]))) is False and one("select estado from pedidos_proveedor where id=%s", (ped,)) == "recibida_parcial", "un pedido enviado puede recibir y queda recibida_parcial")
ped3 = one("select pedido_proveedor_crear(%s, %s, %s::jsonb)", (ka, prov, items))["id"]
ok(fails("select pedido_proveedor_cancelar(%s)", (ped3,)) is False and one("select estado from pedidos_proveedor where id=%s", (ped3,)) == "cancelada", "borrador → cancelada")
ok(has(fails("select pedido_proveedor_recibir(%s, %s::jsonb)", (ped3, json.dumps([{"item_id": its[0]["id"], "cantidad": 1}]))), "pedido_estado_invalido"), "un pedido cancelado no recibe")

# ---- 4) Recepción estricta
its2 = rows("select id, nombre from pedido_proveedor_items where pedido_id=%s order by nombre", (ped2,))
alf, que = its2[0]["id"], its2[1]["id"]
ok(has(fails("select pedido_proveedor_recibir(%s, %s::jsonb)", (ped2, json.dumps([{"item_id": alf, "cantidad": 11}]))), "recepcion_excede_pendiente"), "no se puede recibir más de lo pedido")
ok(one("select recibida from pedido_proveedor_items where id=%s", (alf,)) == 0, "un rechazo no deja nada recibido")
ok(has(fails("select pedido_proveedor_recibir(%s, %s::jsonb)", (ped2, json.dumps([{"item_id": its[0]["id"], "cantidad": 1}]))), "items_invalidos"), "una línea de otro pedido se rechaza")
ok(has(fails("select pedido_proveedor_recibir(%s, %s::jsonb)", (ped2, json.dumps([{"item_id": alf, "cantidad": 3}, {"item_id": que, "cantidad": 999999999}]))), "cantidad_invalida"), "cantidad fuera de rango se rechaza")
ok(one("select recibida from pedido_proveedor_items where id=%s", (alf,)) == 0, "recepción atómica: si una línea falla no se aplica ninguna")
r = one("select pedido_proveedor_recibir(%s, %s::jsonb)", (ped2, json.dumps([{"item_id": alf, "cantidad": 6}])))
ok(r["estado"] == "recibida_parcial", "recepción parcial → recibida_parcial")
ok(has(fails("select pedido_proveedor_recibir(%s, %s::jsonb)", (ped2, json.dumps([{"item_id": alf, "cantidad": 5}]))), "recepcion_excede_pendiente"), "el pendiente se calcula sobre lo ya recibido (6+5>10)")
ok(has(fails("select pedido_proveedor_cancelar(%s)", (ped2,)), "pedido_estado_invalido"), "con recepción parcial ya no se cancela")
r = one("select pedido_proveedor_recibir(%s, %s::jsonb)", (ped2, json.dumps([{"item_id": alf, "cantidad": 4}, {"item_id": que, "cantidad": 2500}])))
ok(r["estado"] == "recibida" and one("select cerrada_at is not null from pedidos_proveedor where id=%s", (ped2,)), "todo recibido → recibida con fecha de cierre")
ok(has(fails("select pedido_proveedor_recibir(%s, %s::jsonb)", (ped2, json.dumps([{"item_id": alf, "cantidad": 1}]))), "pedido_estado_invalido"), "un pedido recibido no recibe más")

# ---- 5) Cerrar con faltantes
ok(fails("select pedido_proveedor_cerrar(%s)", (ped,)) is False and one("select estado from pedidos_proveedor where id=%s", (ped,)) == "recibida", "recibida_parcial → recibida (se da por cerrado lo que falta)")
ok(has(fails("select pedido_proveedor_cerrar(%s)", (ped,)), "pedido_estado_invalido"), "cerrar solo sirve desde recibida_parcial")

# ---- 6) El pedido no mueve stock
ok(one("select stock from productos where id=%s", (p1,)) == 0, "recibir un pedido no cambia el stock (eso lo hace registrar_compra)")

cur.execute("rollback")
print("TODO OK" if bad == 0 else f"{bad} FALLAS")
sys.exit(1 if bad else 0)
