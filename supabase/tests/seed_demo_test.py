# Verifica supabase/seed_demo.sql (datos ficticios) sobre 0001-0025. Uso: python3 supabase/tests/seed_demo_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
from datetime import timedelta
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "seed_demo_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras", "0016_etiquetas", "0017_fidelidad", "0018_reposicion", "0019_motivos_mermas", "0020_historial_stock", "0021_conteo_planilla", "0022_margen_precios", "0023_fase3_abc_fiado", "0024_endurecer_funciones", "0025_fuga_reglas_lotes"]:
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
def root(sql, args=None):
    cur.execute("reset role"); cur.execute(sql, args); return cur.fetchone()[0] if cur.description else None
def rows(sql, args=None):
    cur.execute(sql, args); cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]
def has(err, texto): return texto in (err or "")

owner = str(uuid.uuid4())
cur.execute("insert into auth.users values (%s)", (owner,))
cur.execute("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco Demo','kiosco-demo','5493415551234',true)", (owner,))
cur.execute(open("supabase/seed_demo.sql", encoding="utf8").read())
def n(tabla): cur.execute(f"select count(*) from {tabla}"); return cur.fetchone()[0]
ok(n("productos") == 12, "el demo carga 12 productos")
ok(n("proveedores") == 3, "el demo carga 3 proveedores")
ok(n("clientes") == 6, "el demo carga 6 clientes")
ok(n("ventas_mostrador") >= 25, "el demo carga ventas de los últimos 60 días")
ok(n("fiado_movimientos") == 3, "el demo carga movimientos de fiado")
ok(n("lotes_stock") == 2 and n("avisos_reglas") == 3, "el demo carga lotes y reglas (0025)")
as_("authenticated", owner)
cur.execute("select nombre from clientes_en_fuga((select id from kioscos limit 1), 45, 3)")
fuga = [r[0] for r in cur.fetchall()]
cur.execute("reset role")
ok(fuga == ["Pedro Sosa"], f"el demo deja un cliente en fuga: {fuga}")
cur.execute("select count(*) from productos where stock_controlado and stock <= stock_minimo")
ok(cur.fetchone()[0] == 3, "el demo tiene 3 productos bajo mínimo para probar la reposición")
cur.execute("select count(*) from ventas_mostrador where created_at > now()")
ok(cur.fetchone()[0] == 0, "ninguna venta del demo queda en el futuro")
cur.execute("select count(*) from productos"); antes = cur.fetchone()[0]
cur.execute(open("supabase/seed_demo.sql", encoding="utf8").read())
cur.execute("select count(*) from productos")
ok(cur.fetchone()[0] == antes, "correrlo otra vez no duplica nada (no hace nada si ya hay productos)")
cur.execute("rollback")
print("TODO OK" if bad == 0 else f"{bad} FALLAS")
