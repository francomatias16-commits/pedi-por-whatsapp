# Verifica la demo en vivo (0059): el kiosco demo se arma solo, la persona de la demo puede mirar todo y no puede cambiar nada
# (ni directo ni por funciones), el resto de las personas no se ve afectado y el reseteo deja todo como al principio.
# Uso: python3 supabase/tests/demo_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json, glob
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "demo_" + uuid.uuid4().hex[:8]
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

D, B = (str(uuid.uuid4()) for _ in range(2))
for u, n in ((D, "demo"), (B, "real")): cur.execute("insert into auth.users(id,email) values (%s,%s)", (u, n + "@test.com"))
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
def has(err, texto): return texto in (err or "")

# Un kiosco real, para comprobar que no se ve afectado.
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco Real','kiosco-real','5493415551234') returning id", (B,))

# --- Armado
as_("authenticated", D); ok(has(fails("select demo_reiniciar(%s)", (D,)), "permission denied"), "una persona logueada no puede reiniciar la demo")
as_("anon"); ok(has(fails("select demo_reiniciar(%s)", (D,)), "permission denied"), "anon no puede reiniciar la demo")
as_("authenticated", D); ok(has(fails("select demo_sembrar(%s)", (kb,)), "permission denied"), "nadie puede sembrar datos desde el navegador")
as_("service_role"); ok(has(fails("select demo_reiniciar(%s)", (str(uuid.uuid4()),)), "demo_sin_usuario"), "sin usuario existente no arma nada")
ok(has(fails("select demo_reiniciar(%s)", (B,)), "demo_usuario_con_kiosco"), "no se usa a alguien que ya tiene un kiosco real como demo")
as_("postgres")
kd = one("select demo_reiniciar(%s)", (D,))
ok(one("select slug from kioscos where id=%s", (kd,)) == "kiosco-demo" and one("select es_demo from kioscos where id=%s", (kd,)), "arma el kiosco demo con su slug")
ok(one("select 'mercadopago' = any(medios_pago) from kioscos where id=%s", (kd,)), "la demo cobra con Mercado Pago en la tienda")
ok(one("select count(*) from productos where kiosco_id=%s", (kd,)) == 12, "carga 12 productos")
ok(one("select count(*) from pedidos where kiosco_id=%s", (kd,)) == 4, "carga 4 pedidos de la tienda")
ok(one("select count(*) from pedidos where kiosco_id=%s and medio_pago='mercadopago'", (kd,)) == 2, "hay pedidos de la tienda pagados con Mercado Pago")
ok(one("select count(*) from ventas_mostrador_pagos pg join ventas_mostrador v on v.id=pg.venta_id where v.kiosco_id=%s and pg.medio='mercadopago'", (kd,)) > 0, "hay ventas del mostrador con Mercado Pago")
ok(one("select count(*) from sellos where kiosco_id=%s and cantidad>0", (kd,)) > 0, "los clientes tienen puntos (mostrador y tienda)")
ok(one("select count(*) from kiosco_miembros where kiosco_id=%s and user_id=%s and rol='dueno'", (kd, D)) == 1, "la persona de la demo es dueña del kiosco demo")
ok(has(fails("insert into kioscos(owner_id,nombre,slug,whatsapp,es_demo) values (%s,'Otra','otra-demo','5493415551234',true)", (B,)), "kioscos_un_demo"), "no puede haber dos kioscos demo")
ok(has(fails("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Demo','demo','5493415551234')", (B,)), "kioscos_slug_reservado_demo"), "el slug 'demo' está reservado")

# --- La persona de la demo mira todo
as_("authenticated", D)
ok(one("select count(*) from productos where kiosco_id=%s", (kd,)) == 12, "la demo ve los productos")
ok(one("select count(*) from kioscos where owner_id=%s", (D,)) == 1, "la demo ve su kiosco")
lecturas = [
    ("select reposicion_resumen(%s)", (kd,)), ("select resumen_semana(%s)", (kd,)), ("select mp_estado_conexion(%s)", (kd,)),
    ("select qr_estado_config(%s)", (kd,)), ("select equipo_listar(%s)", (kd,)), ("select promo_panel(%s)", (kd,)),
    ("select fidelidad_resumen(%s, 30)", (kd,)), ("select fiado_vencido(%s, 30)", (kd,)), ("select clientes_en_fuga(%s, 45, 2)", (kd,)),
    ("select club_actividad(%s, 24)", (kd,)), ("select sorteo_listar(%s)", (kd,)), ("select pos_config_publica(%s)", (kd,)),
]
for sql, args in lecturas:
    e = fails(sql, args); ok(not e, f"la demo puede abrir {sql.split('(')[0].replace('select ', '')}" + (f" ({e})" if e else ""))

# --- La persona de la demo no cambia nada
ok(has(fails("insert into productos(kiosco_id,nombre,precio) values (%s,'Nuevo',100)", (kd,)), "demo_solo_lectura"), "no puede crear productos")
ok(has(fails("update productos set precio = precio + 1 where kiosco_id=%s", (kd,)), "demo_solo_lectura"), "no puede cambiar precios")
ok(has(fails("delete from clientes where kiosco_id=%s", (kd,)), "demo_solo_lectura"), "no puede borrar clientes")
ok(has(fails("update kioscos set nombre='Hackeado' where id=%s", (kd,)), "demo_solo_lectura"), "no puede cambiar el kiosco")
e = fails("truncate push_suscripciones"); ok(has(e, "demo_solo_lectura") or has(e, "permission denied"), "no puede vaciar tablas")
ok(has(fails("select ajustar_precios(%s, 10, null, 'ninguno')", (kd,)), "demo_solo_lectura") or has(fails("select ajustar_precios(%s, 10, null, null)", (kd,)), "demo_solo_lectura"), "no puede ajustar precios por función")
as_("postgres"); turno = one("select id from turnos_caja where kiosco_id=%s and estado='abierto'", (kd,)); prod = one("select id from productos where kiosco_id=%s and nombre='Leche 1 L'", (kd,))
as_("authenticated", D)
ok(has(fails("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0, gen_random_uuid(), null, 0)", (turno, json.dumps([{"producto_id": prod, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 1500}]))), "demo_solo_lectura"), "no puede cobrar una venta del mostrador")
ok(has(fails("select caja_registrar_movimiento(%s, 'sangria', 100, 'x')", (turno,)), "demo_solo_lectura"), "no puede mover la caja")
ok(has(fails("select equipo_invitar(%s, 'cajero')", (kd,)), "demo_solo_lectura"), "no puede invitar gente al equipo")
ok(has(fails("select kiosco_pedir_baja(%s, 'Kiosco Demo')", (kd,)), "demo_solo_lectura"), "no puede pedir la baja del kiosco")
ok(has(fails("insert into storage.objects(bucket_id,name) values ('productos', %s)", (f"{kd}/x.jpg",)), "row-level security"), "no puede subir archivos")
cur.execute("reset role")
ok(one("select count(*) from pg_policies where schemaname='storage' and policyname like 'demo_sin_%%' and permissive='RESTRICTIVE'") == 3, "las 3 políticas de storage restrictivas existen")

# --- El resto de la gente no se ve afectada
as_("authenticated", B)
ok(not fails("insert into productos(kiosco_id,nombre,precio) values (%s,'Alfajor',500)", (kb,)), "un kiosco real sigue escribiendo")
ok(not fails("update productos set precio = 600 where kiosco_id=%s", (kb,)), "un kiosco real sigue cambiando precios")
ok(one("select count(*) from productos where kiosco_id=%s", (kd,)) == 12, "la demo es pública de lectura como cualquier tienda")
as_("anon")
ok(one("select count(*) from kioscos where slug='kiosco-demo'") == 1, "la tienda de la demo es pública")
pr = [json.dumps([{"producto_id": prod, "cantidad": 1}])]
e = fails("select crear_pedido('kiosco-demo','Visita','5493415559999','retiro',null,null,%s::jsonb,null,'efectivo')", (pr[0],))
ok(not e, "una visita puede hacer un pedido en la tienda demo" + (f" ({e})" if e else ""))

# --- Cobertura: toda tabla de public tiene la protección
as_("postgres")
sin = [r[0] for r in (cur.execute("select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind in ('r','p') and not exists (select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='demo_solo_lectura')") or cur.fetchall())]
ok(not sin, f"todas las tablas tienen la protección de la demo{(' (faltan: ' + ', '.join(sin) + ')') if sin else ''}")

# --- Reseteo
as_("postgres")
cur.execute("delete from productos where kiosco_id=%s", (kd,)); cur.execute("update kioscos set nombre='Roto' where id=%s", (kd,))
as_("service_role")
kd2 = one("select demo_reiniciar()")
as_("postgres")
ok(kd2 != kd and one("select count(*) from kioscos where es_demo") == 1, "el reseteo deja un solo kiosco demo")
ok(one("select count(*) from productos where kiosco_id=%s", (kd2,)) == 12 and one("select nombre from kioscos where id=%s", (kd2,)) == "Kiosco Demo", "el reseteo restaura los datos")
ok(one("select owner_id from kioscos where id=%s", (kd2,)) == D, "el reseteo conserva a la persona de la demo")
ok(one("select count(*) from productos where kiosco_id=%s", (kb,)) == 1 and one("select count(*) from kioscos where id=%s", (kb,)) == 1, "el reseteo no toca otros kioscos")
ok(one("select count(*) from pedidos where kiosco_id=%s", (kd2,)) == 4, "el reseteo borra el pedido que dejó la visita y rearma los 4 de la demo")
as_("authenticated", D); ok(has(fails("update productos set precio = 1 where kiosco_id=%s", (kd2,)), "demo_solo_lectura"), "después del reseteo la demo sigue siendo de solo lectura")

print("TODO OK" if not bad else f"{bad} FALLAS"); sys.exit(1 if bad else 0)
