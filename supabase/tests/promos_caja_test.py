# Guardarraíles de promociones de la caja (0056): una promo por producto y margen mínimo con confirmación.
# Uso: python3 supabase/tests/promos_caja_test.py
import os, psycopg2, uuid, tempfile, sys, json, glob
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "promoscaja_" + uuid.uuid4().hex[:8]
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
hoy = datetime.date.today(); dia = lambda n: str(hoy + datetime.timedelta(days=n))

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','caja-a','5493415551234',true) returning id", (A,))
as_("postgres")
def prod(nombre, precio, costo=None, cat="General"):
    return one("insert into productos(kiosco_id,nombre,precio,costo,categoria) values (%s,%s,%s,%s,%s) returning id", (ka, nombre, precio, costo, cat))
gas = prod("Gaseosa", 1000, 700)          # margen actual 30%, mínimo del local 20%
choc = prod("Chocolate", 1000, 500, "Dulces")
chic = prod("Chicle", 100, 90, "Dulces")  # margen 10%: ya está por debajo
sin_costo = prod("Sin costo", 500, None)
mate = prod("Mate", 900, 450)            # 50% de margen base
as_("authenticated", A)
ins = "insert into pos_promos(kiosco_id,nombre,tipo,producto_id,pct,desde,hasta,activa,margen_confirmado) values (%s,%s,'pct',%s,%s,%s,%s,%s,%s) returning id"
def promo(nombre, p, pct, desde=None, hasta=None, activa=True, conf=False): return one(ins, (ka, nombre, p, pct, desde, hasta, activa, conf))

# ── Una sola promoción por producto ──
a = promo("10% gaseosa", gas, 10)
ok(True, "la primera promo de un producto se crea")
ok(has(fails(ins, (ka, "otra", gas, 5, None, None, True, False)), "promo_producto_duplicada"), "una segunda promo activa del mismo producto se rechaza")
ok(has(fails("insert into pos_promos(kiosco_id,nombre,tipo,producto_id,lleva,paga) values (%s,'3x2','nxm',%s,3,2)", (ka, gas)), "promo_producto_duplicada"), "tampoco un NxM sobre el mismo producto")
ok(not fails(ins, (ka, "pausada", gas, 5, None, None, False, False)), "una promo pausada no choca")
_e = fails("insert into pos_promos(kiosco_id,nombre,tipo,categoria,pct) values (%s,'10%% general','pct','General',10)", (ka,))
ok(not _e, f"una promo de categoría no choca con las de producto ({_e})")
_e = fails("insert into pos_promos(kiosco_id,nombre,tipo,categoria,pct) values (%s,'10%% dulces','pct','Dulces',10)", (ka,))
ok(has(_e, "promo_reduce_margen"), "una promo de categoría mira el peor producto de la categoría (el chicle ya está en 10%)")
ok(not fails(ins, (ka, "vencida", gas, 5, "2020-01-01", "2020-02-01", True, False)), "una promo ya vencida no choca")
_e = fails("update pos_promos set nombre='10%% gaseosa (nuevo nombre)' where id=%s", (a,))
ok(not _e, f"cambiar solo el nombre no vuelve a controlar ({_e})")
# Fechas que no se pisan
as_("postgres"); cur.execute("update pos_promos set hasta=%s where id=%s", (dia(30), a)); as_("authenticated", A)
b = promo("Futura gaseosa", gas, 5, dia(31), dia(60))
ok(b is not None, "dos promos del mismo producto en fechas distintas conviven")
ok(has(fails(ins, (ka, "pisa", gas, 5, dia(20), dia(35), True, False)), "promo_producto_duplicada"), "si las fechas se pisan, se rechaza")
cur.execute("update pos_promos set activa=false where id=%s", (b,))
ok(not fails("update pos_promos set activa=true where id=%s", (b,)), "reactivar sin choque funciona")
cur.execute("update pos_promos set activa=false where id=%s", (b,))
c = promo("Pisa a la primera", gas, 5, dia(10), dia(20), activa=False)
ok(has(fails("update pos_promos set activa=true where id=%s", (c,)), "promo_producto_duplicada"), "reactivar una que pisa a otra activa se rechaza")

# Liquidación activa del mismo producto (regalo o llevá dos)
as_("postgres")
cur.execute("insert into promo_liquidacion(kiosco_id,clave,tipo,producto_id,valor) values (%s,'liquidar_sin_rotacion','regalo',%s,5)", (ka, choc))
as_("authenticated", A)
ok(has(fails(ins, (ka, "choc", choc, 5, None, None, True, False)), "promo_producto_duplicada"), "no se arma una promo de caja sobre un producto en liquidación")

# ── Margen mínimo ──
as_("postgres"); cur.execute("update pos_promos set activa=false where kiosco_id=%s", (ka,)); as_("authenticated", A)
ok(not fails(ins, (ka, "10% gas", gas, 10, None, None, True, False)), "10% deja 22,2% de margen: pasa")
cur.execute("update pos_promos set activa=false where producto_id=%s", (gas,))
e = fails(ins, (ka, "30% gas", gas, 30, None, None, True, False))
ok(has(e, "promo_reduce_margen"), "30% deja margen 0%: pide confirmación")
cur.execute("savepoint d")
try: cur.execute(ins, (ka, "30% gas", gas, 30, None, None, True, False))
except Exception as ex: det = getattr(ex.diag, "message_detail", None)
cur.execute("rollback to savepoint d")
ok(det == "0.0|20.00", f"el detalle trae margen y mínimo ({det})")
g30 = promo("30% gas confirmada", gas, 30, conf=True)
ok(g30 is not None, "con confirmación explícita se guarda")
ok(pg("select count(*) from promo_historial where kiosco_id=%s and accion='margen_confirmado' and tabla='pos_promos'", (ka,)) == 1, "la confirmación queda en el historial")
cur.execute("update pos_promos set activa=false where id=%s", (g30,))
cur.execute("update pos_promos set margen_confirmado=false where id=%s", (g30,))
ok(has(fails("update pos_promos set activa=true where id=%s", (g30,)), "promo_reduce_margen"), "reactivar sin confirmar vuelve a pedirla")
ok(not fails("update pos_promos set activa=true, margen_confirmado=true where id=%s", (g30,)), "reactivar confirmando funciona")
cur.execute("update pos_promos set activa=false where producto_id=%s", (gas,))
ok(has(fails("insert into pos_promos(kiosco_id,nombre,tipo,producto_id,lleva,paga) values (%s,'2x1','nxm',%s,2,1)", (ka, gas)), "promo_reduce_margen"), "2x1 deja margen 0%: pide confirmación")
ok(has(fails("insert into pos_promos(kiosco_id,nombre,tipo,producto_id,lleva,paga) values (%s,'4x3','nxm',%s,4,3)", (ka, gas)), "promo_reduce_margen"), "4x3 deja 6,7%: pide confirmación")
ok(not fails("insert into pos_promos(kiosco_id,nombre,tipo,producto_id,lleva,paga) values (%s,'10x9','nxm',%s,10,9)", (ka, gas)), "10x9 deja 22,2%: pasa")
as_("postgres"); cur.execute("update pos_promos set activa=false where kiosco_id=%s", (ka,)); as_("authenticated", A)
ok(not fails("insert into pos_promos(kiosco_id,nombre,tipo,producto_id,lleva,paga) values (%s,'3x2 choc','nxm',%s,3,2)", (ka, mate)), "3x2 con 50% de margen base deja 25%: pasa")
ok(not fails(ins, (ka, "90% sin costo", sin_costo, 90, None, None, True, False)), "sin costo cargado no hay margen que controlar")
ok(not fails(ins, (ka, "vencida 90%", gas, 90, "2020-01-01", "2020-02-01", True, False)), "una promo vencida no se controla por margen")
ok(not fails(ins, (ka, "pausada 90%", gas, 90, None, None, False, False)), "una promo pausada no se controla por margen")

# Datos viejos: con el guardarraíl apagado quedan dos promos; seguir editándolas no se bloquea
as_("postgres")
cur.execute("update pos_promos set activa=false where kiosco_id=%s", (ka,))
cur.execute("alter table pos_promos disable trigger trg_pos_promos_guardarrailes")
v1 = one(ins, (ka, "vieja 1", gas, 10, None, None, True, False)); v2 = one(ins, (ka, "vieja 2", gas, 10, None, None, True, False))
cur.execute("alter table pos_promos enable trigger trg_pos_promos_guardarrailes")
as_("authenticated", A)
ok(not fails("update pos_promos set nombre='vieja 2 renombrada' where id=%s", (v2,)), "una promo vieja duplicada se puede renombrar")
ok(not fails("update pos_promos set activa=false where id=%s", (v2,)), "y se puede pausar")

# Permisos y registro
as_("authenticated", X)
ok(bool(fails(ins, (ka, "ajena", gas, 5, None, None, True, False))), "otro dueño no crea promos en mi kiosco")
as_("postgres")
ok(pg("select count(*) from pos_promos where kiosco_id=%s and margen_confirmado", (ka,)) >= 1, "la marca de confirmación se guarda")

print("RESULTADO: " + ("OK" if bad == 0 else f"FALLARON {bad}"))
sys.exit(1 if bad else 0)
