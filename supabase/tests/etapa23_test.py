# Verifica 0027 (pedidos a proveedor con estados y recepción estricta). Uso: python3 supabase/tests/etapa23_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
from datetime import timedelta
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa23_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras", "0016_etiquetas", "0017_fidelidad", "0018_reposicion", "0019_motivos_mermas", "0020_historial_stock", "0021_conteo_planilla", "0022_margen_precios", "0023_fase3_abc_fiado", "0024_endurecer_funciones", "0025_fuga_reglas_lotes", "0026_fuga_semanal", "0027_pedidos_proveedor", "0028_cierre_base"]:
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
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto,horario_auto) values (%s,'Kiosco A','kiosco-a','5493415551234',true,true) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))

# datos de A
as_("authenticated", A)
cur.execute("insert into productos(kiosco_id,nombre,precio) values (%s,'Alfajor',500),(%s,'Gaseosa',1500)", (ka, ka))
cur.execute("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Ana','5493415550001')", (ka,))
as_("authenticated", B)
cur.execute("insert into productos(kiosco_id,nombre,precio) values (%s,'Producto de B',999)", (kb,))

# --- exportación
as_("authenticated", A)
ok(one("select jsonb_array_length(kiosco_exportar_seccion(%s,'productos'))", (ka,)) == 2, "exportar productos: trae los 2 del kiosco A")
ok("Producto de B" not in str(one("select kiosco_exportar_seccion(%s,'productos')", (ka,))), "exportar productos: no mezcla datos de B")
k = one("select kiosco_exportar_seccion(%s,'kiosco')", (ka,))
ok(k["nombre"] == "Kiosco A" and "owner_id" not in k, "exportar kiosco: datos del local sin owner_id")
ok(one("select jsonb_array_length(kiosco_exportar_seccion(%s,'pedido_items'))", (ka,)) == 0, "exportar sección hija vacía devuelve []")
for s in ["pedidos","pedido_items","ventas_mostrador_items","ventas_mostrador_pagos","compra_items","devoluciones_mostrador_items","pedido_proveedor_items","stock_movimientos","lotes_stock","historial_precios"]:
    ok(fails("select kiosco_exportar_seccion(%s,%s)", (ka, s)) is False, f"exportar {s}: la sección existe y corre")
ok(has(fails("select kiosco_exportar_seccion(%s,'pos_config')", (ka,)), "seccion_invalida"), "exportar: pos_config (con el hash del PIN) no es exportable")
ok(has(fails("select kiosco_exportar_seccion(%s,'push_suscripciones')", (ka,)), "seccion_invalida"), "exportar: las claves push no son exportables")
ok(has(fails("select kiosco_exportar_seccion(%s,'productos; drop table productos')", (ka,)), "seccion_invalida"), "exportar: nombre de sección malicioso rechazado")
ok(has(fails("select kiosco_exportar_seccion(%s,'productos')", (kb,)), "no_autorizado"), "exportar: A no puede exportar el kiosco de B")
as_("anon")
ok(fails("select kiosco_exportar_seccion(%s,'productos')", (ka,)) is not False, "exportar: anon no puede")

# --- baja
as_("authenticated", A)
ok(has(fails("select kiosco_pedir_baja(%s,'otro nombre')", (ka,)), "confirmacion_invalida"), "baja: pide el nombre del local y rechaza otro")
as_("authenticated", B)
ok(has(fails("select kiosco_pedir_baja(%s,'Kiosco A')", (ka,)), "no_autorizado"), "baja: B no puede dar de baja a A")
as_("authenticated", A)
r = one("select kiosco_pedir_baja(%s,'  kiosco a ')", (ka,))
ok(r["baja_solicitada_at"] is not None, "baja: acepta el nombre sin importar mayúsculas ni espacios")
cur.execute("select abierto, horario_auto, baja_solicitada_at from kioscos where id=%s", (ka,))
ab, ha, bs = cur.fetchone()
ok(ab is False and ha is False and bs is not None, "baja: cierra la tienda, apaga el horario automático y marca la fecha")
ok(one("select count(*) from productos where kiosco_id=%s", (ka,)) == 2, "baja: los datos se conservan")
f1 = one("select baja_solicitada_at from kioscos where id=%s", (ka,))
one("select kiosco_pedir_baja(%s,'Kiosco A')", (ka,))
ok(one("select baja_solicitada_at from kioscos where id=%s", (ka,)) == f1, "baja: pedirla de nuevo no cambia la fecha original")
as_("authenticated", B)
ok(has(fails("select kiosco_cancelar_baja(%s)", (ka,)), "no_autorizado"), "cancelar baja: B no puede")
as_("authenticated", A)
one("select kiosco_cancelar_baja(%s)", (ka,))
cur.execute("select abierto, baja_solicitada_at from kioscos where id=%s", (ka,))
ab, bs = cur.fetchone()
ok(bs is None and ab is False, "cancelar baja: quita la marca y la tienda sigue cerrada hasta que el dueño la reabra")

# --- purga
ok(fails("select kioscos_purgar_bajas(30)") is not False, "purga: el dueño (authenticated) no puede correrla")
as_("anon")
ok(fails("select kioscos_purgar_bajas(30)") is not False, "purga: anon no puede")
as_("authenticated", A)
one("select kiosco_pedir_baja(%s,'Kiosco A')", (ka,))
as_("postgres")
ok(has(fails("select kioscos_purgar_bajas(7)"), "dias_invalidos"), "purga: no acepta menos de 30 días")
ok(one("select kioscos_purgar_bajas(30)") == 0, "purga: una baja reciente no se borra")
cur.execute("update kioscos set baja_solicitada_at = now() - interval '31 days' where id=%s", (ka,))
ok(one("select kioscos_purgar_bajas(30)") == 1, "purga: borra la baja de más de 30 días")
ok(one("select count(*) from kioscos where id=%s", (ka,)) == 0, "purga: el kiosco ya no existe")
ok(one("select count(*) from productos where kiosco_id=%s", (ka,)) == 0 and one("select count(*) from clientes where kiosco_id=%s", (ka,)) == 0, "purga: sus datos caen en cascada")
ok(one("select count(*) from kioscos where id=%s", (kb,)) == 1 and one("select count(*) from productos where kiosco_id=%s", (kb,)) == 1, "purga: el kiosco B queda intacto")
ok(one("select count(*) from auth.users where id=%s", (A,)) == 1, "purga: la cuenta de acceso no se toca")

cur.execute("rollback")
print(f"\n{'OK' if bad == 0 else 'HAY FALLAS'}: {bad} falla(s)")
sys.exit(1 if bad else 0)
