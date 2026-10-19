# Verifica 0033 (envío por zonas: tabla, permisos, interruptor y crear_pedido con costo y mínimo desde la base).
# Uso: python3 supabase/tests/etapa28_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa28_" + uuid.uuid4().hex[:8]
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

# --- datos: local A (dueño A, encargado EN, cajero CJ) y local B (dueño B)
as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto,acepta_envio,costo_envio,pedido_minimo) values (%s,'Kiosco A','kiosco-a','5493415551234',true,true,300,0) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto,acepta_envio) values (%s,'Kiosco B','kiosco-b','5493415559999',true,true) returning id", (B,))
as_("authenticated", A)
p1 = one("insert into productos(kiosco_id,nombre,precio,stock,stock_controlado) values (%s,'Alfajor',500,500,true) returning id", (ka,))
as_("postgres")
cur.execute("insert into kiosco_miembros(kiosco_id,user_id,rol) values (%s,%s,'encargado'),(%s,%s,'cajero')", (ka, EN, ka, CJ))
n_tel = [0]
def zona(quien, k, nombre, costo=100, minimo=0, activa=True, zid=None, desc="Centro y alrededores"):
    as_("authenticated", quien)
    return jsn(one("select zona_guardar(%s,%s,%s,%s,%s,%s,%s)", (k, zid, nombre, desc, costo, minimo, activa)))["id"]
def pedir(modalidad="envio", zona_id=None, cant=1, slug="kiosco-a", ocho=False):
    n_tel[0] += 1; as_("anon")
    items = json.dumps([{"producto_id": p1, "cantidad": cant}]); tel = f"54934155540{n_tel[0]:02d}"
    d = "Calle 123" if modalidad == "envio" else None
    if ocho: return jsn(one("select crear_pedido(%s,'Ana',%s,%s,%s,null,%s::jsonb,'efectivo')", (slug, tel, modalidad, d, items)))
    return jsn(one("select crear_pedido(%s,'Ana',%s,%s,%s,null,%s::jsonb,%s,'efectivo')", (slug, tel, modalidad, d, items, zona_id)))
def pedir_falla(modalidad="envio", zona_id=None, cant=1, slug="kiosco-a", ocho=False):
    n_tel[0] += 1; as_("anon")
    items = json.dumps([{"producto_id": p1, "cantidad": cant}]); tel = f"54934155540{n_tel[0]:02d}"
    if ocho: return fails("select crear_pedido(%s,'Ana',%s,%s,'Calle 123',null,%s::jsonb,'efectivo')", (slug, tel, modalidad, items))
    return fails("select crear_pedido(%s,'Ana',%s,%s,'Calle 123',null,%s::jsonb,%s,'efectivo')", (slug, tel, modalidad, items, zona_id))

# ===== 1) Sin zonas todo sigue igual
as_("postgres"); ok(one("select zonas_envio_activo from kioscos where id=%s", (ka,)) is False, "el interruptor arranca apagado")
r = pedir("envio", None); ok(float(r["costo_envio"]) == 300 and float(r["total"]) == 800, "apagado: envío con el costo único del local")
r = pedir("envio", None, ocho=True); ok(float(r["costo_envio"]) == 300, "apagado: la versión de 8 argumentos sigue andando")
as_("authenticated", A); ok(has(fails("select zonas_configurar_activo(%s,true)", (ka,)), "sin_zonas"), "no se enciende sin zonas")

# ===== 2) Permisos
za = zona(A, ka, "Centro", 200, 1000)
zi = zona(EN, ka, "Barrio Norte", 400, 0)
zoff = zona(A, ka, "Afuera", 900, 0, activa=False)
as_("authenticated", CJ); ok(has(fails("select zona_guardar(%s,null,'X','',1,0,true)", (ka,)), "no_autorizado"), "el cajero no crea zonas")
as_("authenticated", X); ok(has(fails("select zona_guardar(%s,null,'X','',1,0,true)", (ka,)), "no_autorizado"), "un extraño no crea zonas")
as_("authenticated", B); ok(has(fails("select zona_guardar(%s,null,'X','',1,0,true)", (ka,)), "no_autorizado"), "otro dueño no crea zonas en mi local")
ok(has(fails("select zona_guardar(%s,%s,'Robada','',1,0,true)", (kb, za)), "zona_no_encontrada"), "no se edita una zona de otro local aunque se pase el id")
ok(has(fails("select zona_quitar(%s,%s)", (kb, za)), "zona_no_encontrada"), "no se quita una zona de otro local")
as_("anon"); ok(bool(fails("select zona_guardar(%s,null,'X','',1,0,true)", (ka,))), "anon no escribe zonas")
as_("authenticated", A); ok(bool(fails("insert into zonas_envio(kiosco_id,nombre) values (%s,'directa')", (ka,))), "no se inserta directo en la tabla")
ok(bool(fails("update zonas_envio set costo=0 where id=%s", (za,))) or rows("update zonas_envio set costo=0 where id=%s", (za,)) <= 0, "no se actualiza directo en la tabla")
as_("anon"); ok(rows("select 1 from zonas_envio where kiosco_id=%s", (ka,)) == 2, "anon ve solo las zonas activas")
as_("authenticated", CJ); ok(rows("select 1 from zonas_envio where kiosco_id=%s", (ka,)) == 2, "el cajero ve solo las activas")
as_("authenticated", EN); ok(rows("select 1 from zonas_envio where kiosco_id=%s", (ka,)) == 3, "el encargado ve todas, también las apagadas")
as_("authenticated", A)
ok(has(fails("select zona_guardar(%s,null,'centro','',1,0,true)", (ka,)), "zona_repetida"), "el nombre no se repite (sin mayúsculas)")
ok(has(fails("select zona_guardar(%s,null,'  ','',1,0,true)", (ka,)), "zona_nombre_invalido"), "nombre vacío")
ok(has(fails("select zona_guardar(%s,null,'Z','',-1,0,true)", (ka,)), "zona_costo_invalido"), "costo negativo")
ok(has(fails("select zona_guardar(%s,null,'Z','',1.555,0,true)", (ka,)), "zona_costo_invalido"), "costo con más de 2 decimales")
ok(has(fails("select zona_guardar(%s,null,'Z','',1,-5,true)", (ka,)), "zona_costo_invalido"), "mínimo negativo")
as_("authenticated", EN); ok(has(fails("select zonas_configurar_activo(%s,true)", (ka,)), "no_autorizado"), "el encargado no enciende el interruptor")
as_("authenticated", CJ); ok(has(fails("select zonas_configurar_activo(%s,true)", (ka,)), "no_autorizado"), "el cajero no enciende el interruptor")
as_("authenticated", B); ok(has(fails("select zonas_configurar_activo(%s,true)", (ka,)), "no_autorizado"), "otro dueño no enciende el interruptor")
as_("authenticated", A); ok(jsn(one("select zonas_configurar_activo(%s,true)", (ka,)))["activo"] is True, "el dueño lo enciende")

# ===== 3) Pedidos con zonas
ok(has(pedir_falla("envio", None), "zona_requerida"), "envío sin zona: zona_requerida")
ok(has(pedir_falla("envio", None, ocho=True), "zona_requerida"), "la versión de 8 argumentos también pide zona")
ok(has(pedir_falla("envio", zoff), "zona_invalida"), "una zona apagada no sirve")
zb = zona(B, kb, "Centro", 50, 0)
ok(has(pedir_falla("envio", zb), "zona_invalida"), "una zona de otro local no sirve")
ok(has(pedir_falla("envio", str(uuid.uuid4())), "zona_invalida"), "una zona inexistente no sirve")
ok(has(pedir_falla("envio", za, cant=1), "minimo_no_alcanzado"), "el mínimo de la zona se exige (500 < 1000)")
r = pedir("envio", za, cant=2)
ok(float(r["costo_envio"]) == 200 and float(r["total"]) == 1200 and r["zona"] == "Centro", "costo y zona de la base (200 + 1000)")
r2 = pedir("envio", zi, cant=1); ok(float(r2["costo_envio"]) == 400 and float(r2["total"]) == 900, "otra zona: otro costo")
r3 = pedir("retiro", za, cant=1); ok(float(r3["costo_envio"]) == 0 and r3["zona"] is None and float(r3["total"]) == 500, "retiro: sin costo, sin zona, sin mínimo de zona")
as_("postgres")
ok(one("select zona_nombre from pedidos where id=%s", (r["pedido_id"],)) == "Centro" and one("select zona_id from pedidos where id=%s", (r["pedido_id"],)) == za, "el pedido guarda la zona")

# ===== 4) El mínimo del local pesa si es mayor
as_("postgres"); cur.execute("update kioscos set pedido_minimo=1500 where id=%s", (ka,))
ok(has(pedir_falla("envio", za, cant=2), "minimo_no_alcanzado"), "gana el mínimo del local si es mayor (1000 < 1500)")
as_("postgres"); cur.execute("update kioscos set pedido_minimo=0 where id=%s", (ka,))

# ===== 5) Editar, renombrar y quitar
zona(A, ka, "Centro y plaza", 250, 1000, zid=za)
as_("postgres"); ok(one("select zona_nombre from pedidos where id=%s", (r["pedido_id"],)) == "Centro", "renombrar no cambia pedidos anteriores")
r4 = pedir("envio", za, cant=2); ok(float(r4["costo_envio"]) == 250, "el nuevo costo vale desde ya")
as_("authenticated", EN); ok(jsn(one("select zona_quitar(%s,%s)", (ka, zi)))["id"] == zi, "el encargado quita una zona")
as_("postgres"); ok(one("select zona_id from pedidos where id=%s", (r2["pedido_id"],)) is None and one("select zona_nombre from pedidos where id=%s", (r2["pedido_id"],)) == "Barrio Norte", "al quitarla, el pedido conserva el nombre")
ok(one("select zonas_envio_activo from kioscos where id=%s", (ka,)) is True, "queda encendido: sigue habiendo una zona activa")
zona(A, ka, "Centro y plaza", 250, 1000, activa=False, zid=za)
as_("postgres"); ok(one("select zonas_envio_activo from kioscos where id=%s", (ka,)) is False, "sin zonas activas el interruptor se apaga solo")
r5 = pedir("envio", None); ok(float(r5["costo_envio"]) == 300, "apagado de nuevo: vuelve el costo único")

# ===== 6) Tope
as_("authenticated", A)
for n in range(30 - one("select count(*) from zonas_envio where kiosco_id=%s", (ka,))): zona(A, ka, f"Z{n}", 1, 0)
ok(has(fails("select zona_guardar(%s,null,'una más','',1,0,true)", (ka,)), "zonas_maximas"), "máximo 30 zonas por local")

print("RESULTADO: " + ("OK" if bad == 0 else f"FALLARON {bad}"))
sys.exit(1 if bad else 0)
