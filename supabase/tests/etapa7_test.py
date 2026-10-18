# Verifica 0001..0008 en Postgres embebido (suscripciones push). Uso: python3 supabase/tests/etapa7_test.py
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push"]:
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
def root(sql, args=None): cur.execute("reset role"); cur.execute(sql, args); return cur.fetchone()[0] if cur.description else None

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco A','kiosco-a','5493415551234') returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco B','kiosco-b','5493415559999') returning id", (B,))

as_("authenticated", A)
ok(not fails("insert into push_suscripciones(kiosco_id,endpoint,p256dh,auth_secret) values (%s,'https://push.ejemplo/a','p','s')", (ka,)), "el dueño guarda una suscripción de su kiosco")
ok(bool(fails("insert into push_suscripciones(kiosco_id,endpoint,p256dh,auth_secret) values (%s,'https://push.ejemplo/x','p','s')", (kb,))), "no puede suscribir un dispositivo al kiosco de otro")
as_("authenticated", B)
ok(root("select count(*) from push_suscripciones") == 1, "root ve la fila (control)")
cur.execute("reset role"); cur.execute("set role authenticated"); cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (B,))
cur.execute("select count(*) from push_suscripciones"); ok(cur.fetchone()[0] == 0, "otro dueño no ve las suscripciones ajenas")
as_("anon")
ok(bool(fails("select * from push_suscripciones")), "anon no puede leer suscripciones")
as_("authenticated", A)
cur.execute("select count(*) from push_suscripciones"); ok(cur.fetchone()[0] == 1, "el dueño ve sus suscripciones")
ok(not fails("delete from push_suscripciones where endpoint='https://push.ejemplo/a'"), "el dueño puede borrar su suscripción")
print(f"\nFALLOS: {bad}")
