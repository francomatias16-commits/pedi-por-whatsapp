# Verifica 0014 (opciones de PIN protegidas). Uso: python3 supabase/tests/etapa12_test.py
import os, psycopg2, uuid, tempfile, sys
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida).
# Sin eso: Postgres embebido con pgserver (instancia nueva por corrida).
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa12_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones"]:
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
import json

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto,medios_pago) values (%s,'Kiosco A','kiosco-a','5493415551234',true,array['efectivo','transferencia','mercadopago']) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))

as_("authenticated", A)
cfg = lambda: one("select jsonb_build_object('a', pin_anular, 'd', pin_devolucion, 'pin', tiene_pin) from pos_config where kiosco_id=%s", (ka,))

# Sin PIN: se pueden cambiar las opciones libremente (y crea la fila de configuración).
ok(one("select pos_pin_opciones(%s, false, true)->>'ok'", (ka,)) == 'true', "sin PIN: se cambian las opciones sin token")
ok(cfg() == {'a': False, 'd': True, 'pin': False}, "quedaron anular=no, devolver=sí")
ok(one("select pos_pin_opciones(%s, true, true)->>'ok'", (ka,)) == 'true', "sin PIN: se puede volver a activar")

# El UPDATE directo ya no está permitido para esas columnas.
ok(bool(fails("update pos_config set pin_anular = false where kiosco_id = %s", (ka,))), "UPDATE directo de pin_anular rechazado")
ok(bool(fails("update pos_config set pin_devolucion = false where kiosco_id = %s", (ka,))), "UPDATE directo de pin_devolucion rechazado")
ok(fails("update pos_config set ticket_ancho = 80, sonido = false where kiosco_id = %s", (ka,)) is False, "las demás opciones se siguen editando directo")
ok(cfg()['a'] is True and cfg()['d'] is True, "las opciones de PIN no cambiaron por el intento directo")

# Con PIN definido.
one("select pos_pin_definir(%s, '4321')->>'ok'", (ka,))
ok(cfg()['pin'] is True, "PIN definido")
ok("pin_requerido" in (fails("select pos_pin_opciones(%s, false, true)", (ka,)) or ""), "con PIN: apagar 'anular' sin token se rechaza")
ok("pin_requerido" in (fails("select pos_pin_opciones(%s, true, false, %s)", (ka, str(uuid.uuid4()))) or ""), "con PIN: token inventado se rechaza")
ok(cfg()['a'] is True and cfg()['d'] is True, "nada cambió tras los rechazos")
tok = one("select pos_pin_verificar(%s, '4321')->>'token'", (ka,))
ok(one("select pos_pin_opciones(%s, false, true, %s)->>'ok'", (ka, tok)) == 'true', "con token válido se apaga 'anular'")
ok(cfg() == {'a': False, 'd': True, 'pin': True}, "quedó anular=no, devolver=sí")
ok("pin_requerido" in (fails("select pos_pin_opciones(%s, false, false, %s)", (ka, tok)) or ""), "el token es de un solo uso")
ok(one("select pos_pin_opciones(%s, true, true)->>'ok'", (ka,)) == 'true', "endurecer (false a true) no pide token")
ok(cfg() == {'a': True, 'd': True, 'pin': True}, "volvió a exigir PIN en ambas")
ok(one("select pos_pin_opciones(%s, true, true)->>'ok'", (ka,)) == 'true', "dejar igual no pide token")

# El servidor respeta las opciones: con 'anular' apagado ya no exige PIN, con 'devolucion' encendido sí.
tok = one("select pos_pin_verificar(%s, '4321')->>'token'", (ka,))
one("select pos_pin_opciones(%s, false, true, %s)->>'ok'", (ka, tok))
as_("postgres")
cur.execute("select public.pos_exigir_pin(%s, 'anular', null)", (ka,))
ok(True, "con anular=no, anular no exige token")
cur.execute("savepoint s2")
try:
    cur.execute("select public.pos_exigir_pin(%s, 'devolucion', null)", (ka,)); exigio = False
except Exception as e:
    cur.execute("rollback to savepoint s2"); exigio = 'pin_requerido' in str(e)
ok(exigio, "con devolucion=sí, devolver sin token se rechaza")

# Aislamiento entre kioscos.
as_("authenticated", B)
ok("no_autorizado" in (fails("select pos_pin_opciones(%s, false, false)", (ka,)) or ""), "otro dueño no puede tocar las opciones de mi kiosco")
ok(one("select pos_pin_opciones(%s, false, false)->>'ok'", (kb,)) == 'true', "cada uno maneja las de su kiosco")
as_("anon")
ok(bool(fails("select pos_pin_opciones(%s, false, false)", (ka,))), "anon no puede ejecutar la función")

print("\nRESULTADO: " + ("OK" if not bad else f"{bad} FALLAS"))
sys.exit(1 if bad else 0)
