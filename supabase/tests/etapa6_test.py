# Verifica 0001..0007 en Postgres embebido. Uso: pip install pgserver psycopg2-binary && python3 supabase/tests/etapa6_test.py
import pgserver, psycopg2, uuid, tempfile
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente"]:
    cur.execute(open(f"supabase/migrations/{m}.sql").read())
A, B = str(uuid.uuid4()), str(uuid.uuid4())
cur.execute("insert into auth.users values (%s),(%s)", (A, B))

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

cur.execute("begin")
as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco A','kiosco-a','5493415551234') returning id", (A,))
cli = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Vecino','5493415550001') returning id", (ka,))
cli2 = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Otro','5493415550002') returning id", (ka,))
cur.execute("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto) values (%s,%s,'fiado',1500)", (ka, cli))
cur.execute("insert into sellos(kiosco_id,cliente_id,origen) values (%s,%s,'mostrador')", (ka, cli))
cur.execute("insert into pedidos(kiosco_id,cliente_id,cliente_nombre,cliente_telefono,modalidad,total) values (%s,%s,'Vecino','5493415550001','retiro',1500)", (ka, cli))

as_("authenticated", B)
ok(bool(fails("select borrar_cliente(%s)", (cli,))), "otro dueño no puede borrar un cliente ajeno")
as_("anon")
ok(bool(fails("select borrar_cliente(%s)", (cli,))), "anon no puede ejecutar borrar_cliente")

as_("authenticated", A)
ok(one("select borrar_cliente(%s)", (cli,)) is True, "el dueño borra su cliente")
ok(root("select count(*) from clientes where id=%s", (cli,)) == 0, "el cliente ya no existe")
ok(root("select count(*) from fiado_movimientos where cliente_id=%s", (cli,)) == 0, "su fiado se borró en cascada")
ok(root("select count(*) from sellos where cliente_id=%s", (cli,)) == 0, "sus sellos se borraron en cascada")
ok(root("select count(*) from pedidos where cliente_nombre='Vecino'") == 1, "el pedido se conserva")
ok(root("select cliente_id is null from pedidos where cliente_nombre='Vecino'") is True, "el pedido queda sin cliente")
ok(root("select count(*) from clientes where id=%s", (cli2,)) == 1, "otros clientes no se tocan")
ok(bool(fails("select borrar_cliente(%s)", (cli,))), "borrar un cliente inexistente falla")

print(f"\nFALLOS: {bad}")
