# Verifica 0001..0009 en Postgres embebido (stock numérico). Uso: python3 supabase/tests/etapa8_test.py
import pgserver, psycopg2, uuid, tempfile, json
srv = pgserver.get_server(tempfile.mkdtemp())
conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True
cur = conn.cursor()
cur.execute("""
create role anon nologin; create role authenticated nologin;
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock"]:
    cur.execute(open(f"supabase/migrations/{m}.sql").read())
A = str(uuid.uuid4())
cur.execute("insert into auth.users values (%s)", (A,))
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
def root(sql, args=None): cur.execute("reset role"); cur.execute(sql, args); return cur.fetchone()[0] if cur.description else None

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','kiosco-a','5493415551234',true) returning id", (A,))
p = one("insert into productos(kiosco_id,nombre,precio,stock_controlado,stock) values (%s,'Gaseosa 1.5L',2000,true,5) returning id", (ka,))
q = one("insert into productos(kiosco_id,nombre,precio) values (%s,'Pan (sin control)',500) returning id", (ka,))
items = lambda c: json.dumps([{"producto_id": str(p), "cantidad": c}])

as_("anon")
ok(bool(fails("select stock from productos")), "la tienda pública no puede leer la columna stock")
ok(not fails("select id, nombre, precio, disponible from productos"), "la tienda pública sí puede leer nombre, precio y disponibilidad")

as_("anon")
r = one("select crear_pedido('kiosco-a','Ana','2615551234','retiro',null,null,%s::jsonb,'efectivo')", (items(3),))
cur.execute("reset role"); cur.execute("select id, numero from pedidos order by numero desc limit 1"); pid, num = cur.fetchone()
ok(root("select stock from productos where id=%s", (p,)) == 5, "pedir no descuenta stock (solo al confirmar)")

as_("anon")
ok("sin_stock" in fails("select crear_pedido('kiosco-a','Luis','2615559999','retiro',null,null,%s::jsonb,'efectivo')", (items(9),)), "la tienda rechaza pedir 9 con stock 5 (sin_stock)")

as_("authenticated", A)
ok(not fails("update pedidos set estado='confirmado' where id=%s", (pid,)), "el dueño confirma el pedido")
ok(root("select stock from productos where id=%s", (p,)) == 2, "confirmar descuenta 3 unidades (5 → 2)")
ok(not fails("update pedidos set estado='cancelado' where id=%s", (pid,)), "cancelar el pedido confirmado")
ok(root("select stock from productos where id=%s", (p,)) == 5, "cancelar repone las unidades (2 → 5)")

ok(not fails("update pedidos set estado='confirmado' where id=%s", (pid,)), "vuelve a confirmar")
ok(root("select stock from productos where id=%s", (p,)) == 2, "confirmar de nuevo descuenta otra vez")
ok(not fails("update pedidos set estado='entregado' where id=%s", (pid,)), "entregar no descuenta dos veces")
ok(root("select stock from productos where id=%s", (p,)) == 2, "entregado no vuelve a descontar")

# segundo pedido de 3 unidades: hay 2, no debe poder confirmarse
cur.execute("reset role")
cur.execute("insert into pedidos(kiosco_id,cliente_nombre,cliente_telefono,modalidad,total,medio_pago,estado) values (%s,'Mora','5493415550003','retiro',1500,'efectivo','pendiente') returning id", (ka,))
pid2 = cur.fetchone()[0]
cur.execute("insert into pedido_items(pedido_id,producto_id,nombre,precio_unit,cantidad) values (%s,%s,'Gaseosa 1.5L',2000,3)", (pid2, p))
as_("authenticated", A)
ok(bool(fails("update pedidos set estado='confirmado' where id=%s", (pid2,))), "no se puede confirmar un pedido sin stock suficiente")
cur.execute("reset role"); cur.execute("select estado from pedidos where id=%s", (pid2,))
ok(cur.fetchone()[0] == "pendiente", "el pedido sin stock queda pendiente")

# llegar a 0: el producto deja de estar disponible
cur.execute("reset role")
cur.execute("insert into pedidos(kiosco_id,cliente_nombre,cliente_telefono,modalidad,total,medio_pago,estado) values (%s,'Eva','5493415550004','retiro',4000,'efectivo','pendiente') returning id", (ka,))
pid3 = cur.fetchone()[0]
cur.execute("insert into pedido_items(pedido_id,producto_id,nombre,precio_unit,cantidad) values (%s,%s,'Gaseosa 1.5L',2000,2)", (pid3, p))
as_("authenticated", A)
ok(not fails("update pedidos set estado='confirmado' where id=%s", (pid3,)), "confirma las últimas 2 unidades")
ok(root("select stock from productos where id=%s", (p,)) == 0, "el stock llega a 0")
ok(root("select disponible from productos where id=%s", (p,)) is False, "con stock 0 el producto deja de estar disponible")

# productos sin control no cambian
ok(root("select stock from productos where id=%s", (q,)) == 0, "un producto sin control no tiene stock descontado")
print(f"\nFALLOS: {bad}")
