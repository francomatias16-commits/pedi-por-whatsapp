# Verifica 0034 (fotos automáticas: interruptor, cupo diario, aplicar con derechos, historial y deshacer).
# Uso: python3 supabase/tests/etapa29_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa29_" + uuid.uuid4().hex[:8]
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
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
create publication supabase_realtime;
""")
import glob
for f in sorted(glob.glob("supabase/migrations/*.sql")):
    cur.execute(open(f).read())
A, B, EN, CJ, X, Y = (str(uuid.uuid4()) for _ in range(6))
for u, n in ((A, "dueno"), (B, "otro"), (EN, "encargado"), (CJ, "cajero"), (X, "extrano"), (Y, "nuevo")): cur.execute("insert into auth.users(id,email) values (%s,%s)", (u, n + "@test.com"))
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
    """Filas afectadas / devueltas; si la política lo rechaza con error, devuelve -1."""
    cur.execute("savepoint s")
    try:
        cur.execute(sql, args); n = cur.rowcount; cur.execute("release savepoint s"); return n
    except Exception: cur.execute("rollback to savepoint s"); return -1
def has(err, texto): return texto in (err or "")
def jsn(v): return v if isinstance(v, (dict, list)) else json.loads(v)

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','kiosco-a','5493415551234',true) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))
as_("authenticated", A)
p1 = one("insert into productos(kiosco_id,nombre,precio) values (%s,'Alfajor',500) returning id", (ka,))
as_("authenticated", B)
pb = one("insert into productos(kiosco_id,nombre,precio) values (%s,'Galleta',300) returning id", (kb,))
as_("postgres")
cur.execute("insert into kiosco_miembros(kiosco_id,user_id,rol) values (%s,%s,'encargado'),(%s,%s,'cajero')", (ka, EN, ka, CJ))
BASE = "https://x.supabase.co/storage/v1/object/public/productos/"
def u(k, n): return f"{BASE}{k}/{n}.jpg"
def img(pid):
    as_("postgres"); return one("select imagen_url from productos where id=%s", (pid,))
def aplicar(quien, k, pid, url, fuente="openfoodfacts", der=False):
    as_("authenticated", quien); return jsn(one("select foto_aplicar(%s,%s,%s,%s,%s)", (k, pid, url, fuente, der)))
def aplicar_falla(quien, k, pid, url, fuente="openfoodfacts", der=False):
    as_("authenticated", quien); return fails("select foto_aplicar(%s,%s,%s,%s,%s)", (k, pid, url, fuente, der))

# ===== 1) Interruptor
as_("postgres"); ok(one("select fotos_auto_activo from kioscos where id=%s", (ka,)) is False, "el interruptor arranca apagado")
for q, nom in ((CJ, "cajero"), (EN, "encargado"), (B, "otro dueño")):
    as_("authenticated", q); ok(has(fails("select fotos_configurar_activo(%s,true)", (ka,)), "no_autorizado"), f"el {nom} no lo enciende")
as_("anon"); ok(bool(fails("select fotos_configurar_activo(%s,true)", (ka,))), "anon no lo enciende")
as_("authenticated", A); ok(jsn(one("select fotos_configurar_activo(%s,true)", (ka,)))["activo"] is True, "el dueño lo enciende")

# ===== 2) Cupo diario: solo el servidor
as_("anon"); ok(bool(fails("select fotos_usar_cupo(%s,'busqueda',5)", (ka,))), "anon no puede usar fotos_usar_cupo")
as_("authenticated", A); ok(bool(fails("select fotos_usar_cupo(%s,'busqueda',5)", (ka,))), "authenticated no puede usar fotos_usar_cupo")
as_("authenticated", A); ok(rows("select 1 from fotos_uso") <= 0, "nadie lee fotos_uso desde el navegador")
as_("postgres")
for n in range(1, 4): ok(jsn(one("select fotos_usar_cupo(%s,'busqueda',3)", (ka,)))["usadas"] == n, f"consulta {n} de 3")
ok(has(fails("select fotos_usar_cupo(%s,'busqueda',3)", (ka,)), "limite_fotos"), "la cuarta supera el tope diario")
ok(one("select consultas from fotos_uso where kiosco_id=%s and fuente='busqueda'", (ka,)) == 3, "la rechazada no se cuenta")
ok(jsn(one("select fotos_usar_cupo(%s,'openfoodfacts',null)", (ka,)))["usadas"] == 1, "otra fuente sin tope cuenta aparte")
ok(jsn(one("select fotos_usar_cupo(%s,'busqueda',3)", (kb,)))["usadas"] == 1, "el tope es por local")
ok(has(fails("select fotos_usar_cupo(%s,'google',3)", (ka,)), "foto_invalida"), "fuente desconocida")

# ===== 3) Aplicar
ua = u(ka, "p1-1")
ok(has(aplicar_falla(CJ, ka, p1, ua), "no_autorizado"), "el cajero no aplica fotos")
ok(has(aplicar_falla(X, ka, p1, ua), "no_autorizado"), "un extraño no aplica fotos")
ok(has(aplicar_falla(B, ka, p1, ua), "no_autorizado"), "otro dueño no aplica fotos en mi local")
as_("anon"); ok(bool(fails("select foto_aplicar(%s,%s,%s,'openfoodfacts',false)", (ka, p1, ua))), "anon no aplica fotos")
ok(has(aplicar_falla(EN, ka, p1, "http://x/object/public/productos/%s/a.jpg" % ka), "foto_invalida"), "solo https")
ok(has(aplicar_falla(EN, ka, p1, u(kb, "a")), "foto_invalida"), "la imagen tiene que estar en la carpeta del propio local")
ok(has(aplicar_falla(EN, ka, p1, "https://externo.com/a.jpg"), "foto_invalida"), "una URL externa no se aplica directo")
ok(has(aplicar_falla(EN, ka, p1, u(ka, "x" * 1000)), "foto_invalida"), "URL demasiado larga")
ok(has(aplicar_falla(EN, ka, p1, ua, "otra"), "foto_invalida"), "fuente inválida")
ok(has(aplicar_falla(EN, ka, p1, ua, "busqueda", False), "derechos_requeridos"), "una foto de internet exige confirmar derechos")
ok(has(aplicar_falla(A, ka, pb, ua), "foto_producto_invalido"), "no se aplica a un producto de otro local")
ok(img(p1) is None, "los intentos rechazados no cambiaron nada")
r1 = aplicar(EN, ka, p1, ua)
ok(img(p1) == ua and r1["anterior"] is None, "el encargado aplica una foto de Open Food Facts")
as_("postgres"); ok(one("select count(*) from fotos_historial where kiosco_id=%s", (ka,)) == 1 and one("select usuario from fotos_historial where id=%s", (r1["historial_id"],)) == EN, "queda registrada con quién la puso")
ub = u(ka, "p1-2"); r2 = aplicar(A, ka, p1, ub, "busqueda", True)
ok(img(p1) == ub and r2["anterior"] == ua, "el dueño aplica una de internet con derechos confirmados")
as_("postgres"); ok(one("select derechos_confirmados from fotos_historial where id=%s", (r2["historial_id"],)) is True, "se registra la confirmación de derechos")

# ===== 4) Historial: quién lo ve
as_("authenticated", EN); ok(rows("select 1 from fotos_historial where kiosco_id=%s", (ka,)) == 2, "el encargado ve el historial")
as_("authenticated", CJ); ok(rows("select 1 from fotos_historial where kiosco_id=%s", (ka,)) == 0, "el cajero no ve el historial")
as_("authenticated", B); ok(rows("select 1 from fotos_historial where kiosco_id=%s", (ka,)) == 0, "otro dueño no ve mi historial")
as_("authenticated", A); ok(bool(fails("insert into fotos_historial(kiosco_id,url_nueva,fuente) values (%s,'x','global')", (ka,))), "no se escribe el historial a mano")

# ===== 5) Deshacer
as_("authenticated", CJ); ok(has(fails("select foto_deshacer(%s,%s)", (ka, r2["historial_id"])), "no_autorizado"), "el cajero no deshace")
as_("authenticated", B); ok(has(fails("select foto_deshacer(%s,%s)", (kb, r2["historial_id"])), "foto_no_encontrada"), "con el id de otro local no encuentra nada")
as_("authenticated", EN); d = jsn(one("select foto_deshacer(%s,%s)", (ka, r2["historial_id"])))
ok(img(p1) == ua and d["anterior"] == ua and d["quitada"] == ub, "deshacer vuelve a la foto anterior")
as_("authenticated", EN); ok(has(fails("select foto_deshacer(%s,%s)", (ka, r2["historial_id"])), "foto_no_encontrada"), "no se deshace dos veces")
as_("authenticated", EN); d1 = jsn(one("select foto_deshacer(%s,%s)", (ka, r1["historial_id"])))
ok(img(p1) is None and d1["anterior"] is None, "deshacer la primera deja el producto sin foto")
r3 = aplicar(EN, ka, p1, u(ka, "p1-3")); as_("postgres"); cur.execute("update productos set imagen_url=%s where id=%s", (u(ka, "manual"), p1))
as_("authenticated", EN); ok(has(fails("select foto_deshacer(%s,%s)", (ka, r3["historial_id"])), "foto_cambio_posterior"), "si la foto cambió después, no se pisa")
ok(img(p1) == u(ka, "manual"), "la foto cambiada a mano sigue ahí")

# ===== 6) Apagar no borra nada
as_("authenticated", A); cur.execute("select fotos_configurar_activo(%s,false)", (ka,))
as_("postgres"); ok(one("select count(*) from fotos_historial where kiosco_id=%s", (ka,)) == 3, "apagar el interruptor no borra el historial")

print("RESULTADO: " + ("OK" if bad == 0 else f"FALLARON {bad}"))
sys.exit(1 if bad else 0)
