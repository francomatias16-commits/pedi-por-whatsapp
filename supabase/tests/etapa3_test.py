# Verifica 0001..0004 en Postgres embebido. Uso: pip install pgserver psycopg2-binary && python3 supabase/tests/etapa3_test.py
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
""")
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco"]:
    cur.execute(open(f"supabase/migrations/{m}.sql").read())
A, B = str(uuid.uuid4()), str(uuid.uuid4())
cur.execute("insert into auth.users values (%s),(%s)", (A, B)); cur.execute("begin")
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
PEDIR = "select crear_pedido(%s,%s,%s,%s::modalidad_pedido,%s,%s,%s::jsonb,%s)"
def pedir(slug, nombre, tel, mod, dir_, items, medio="efectivo"):
    import json
    return one(PEDIR, (slug, nombre, tel, mod, dir_, "", json.dumps(items), medio))

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco A','kiosco-a','5493415551234') returning id", (A,))
p1 = one("insert into productos(kiosco_id,nombre,precio) values (%s,'Gaseosa',1000) returning id", (ka,))
p2 = one("insert into productos(kiosco_id,nombre,precio) values (%s,'Alfajor',500) returning id", (ka,))
as_("anon")
it = lambda p, n: [{"producto_id": p, "cantidad": n}]

# --- defaults y compatibilidad ---
r = pedir("kiosco-a", "Ana", "341 555 0001", "retiro", "", it(p1, 2))
ok(float(r["total"]) == 2000 and r["numero"] >= 1, f"pedido simple: total={r['total']} numero={r['numero']}")
old = one("select crear_pedido(%s,%s,%s,%s::modalidad_pedido,%s,%s,%s::jsonb)", ("kiosco-a", "Ana", "341 555 0001", "retiro", "", "", '[{"producto_id":"%s","cantidad":1}]' % p1))
ok(float(old["total"]) == 1000, "llamada vieja (7 args) sigue funcionando")
ok(one("select count(*) from pg_proc where proname='crear_pedido'") == 1, "hay una sola versión de crear_pedido")

# --- envío, mínimo, medios de pago, cerrado ---
as_("authenticated", A)
cur.execute("update kioscos set costo_envio=300, pedido_minimo=800, medios_pago=array['efectivo','transferencia'] where id=%s", (ka,))
as_("anon")
r = pedir("kiosco-a", "Beto", "341 555 0002", "envio", "Mitre 123", it(p1, 1), "transferencia")
ok(float(r["costo_envio"]) == 300 and float(r["total"]) == 1300, f"envío suma costo: {r['total']}")
r = pedir("kiosco-a", "Beto", "341 555 0002", "retiro", "", it(p1, 1))
ok(float(r["costo_envio"]) == 0 and float(r["total"]) == 1000, "retiro no paga envío")
e = fails(PEDIR, ("kiosco-a", "Cami", "341 555 0003", "retiro", "", "", '[{"producto_id":"%s","cantidad":1}]' % p2, "efectivo"))
ok(e and "minimo_no_alcanzado" in e, "bajo el mínimo (500 < 800) se rechaza")
ok(one("select count(*) from clientes where telefono like '%5550003'") == 0, "rechazo por mínimo no deja cliente huérfano")
e = fails(PEDIR, ("kiosco-a", "Cami", "341 555 0003", "retiro", "", "", '[{"producto_id":"%s","cantidad":1}]' % p1, "mercadopago"))
ok(e and "medio_pago_invalido" in e, "medio de pago no habilitado se rechaza")
as_("authenticated", A)
cur.execute("update kioscos set abierto=false where id=%s", (ka,))
as_("anon")
e = fails(PEDIR, ("kiosco-a", "Cami", "341 555 0003", "retiro", "", "", '[{"producto_id":"%s","cantidad":1}]' % p1, "efectivo"))
ok(e and "local_cerrado" in e, "local cerrado no recibe pedidos")
as_("authenticated", A)
cur.execute("update kioscos set abierto=true, pedido_minimo=0 where id=%s", (ka,))

# --- anti-spam por teléfono ---
as_("anon")
for i in range(3): pedir("kiosco-a", "Spam", "341 555 0009", "retiro", "", it(p2, 1))
e = fails(PEDIR, ("kiosco-a", "Spam", "341 555 0009", "retiro", "", "", '[{"producto_id":"%s","cantidad":1}]' % p2, "efectivo"))
ok(e and "demasiados_pedidos" in e, "4º pedido del mismo teléfono en 10 min se rechaza")
ok(pedir("kiosco-a", "Otro", "341 555 0010", "retiro", "", it(p2, 1))["numero"] > 0, "otro teléfono sigue pudiendo pedir")
# --- tope por local ---
as_("authenticated", A)
cur.execute("reset role")
cur.execute("insert into pedidos(kiosco_id,cliente_nombre,cliente_telefono,modalidad,total) select %s,'x','549341600'||g,'retiro',1 from generate_series(1,40) g", (ka,))
as_("anon")
e = fails(PEDIR, ("kiosco-a", "Nuevo", "341 555 0077", "retiro", "", "", '[{"producto_id":"%s","cantidad":1}]' % p2, "efectivo"))
ok(e and "local_saturado" in e, "tope de pedidos por local en 10 min")

# --- permisos ---
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco B','kiosco-b','5493415550000') returning id", (B,))
ok(fails("update kioscos set abierto=false, costo_envio=0 where id=%s", (ka,)) is False and one("select abierto from kioscos where id=%s", (ka,)) is True, "B no puede modificar la config de A")
as_("anon")
ok(fails("update kioscos set abierto=false where id=%s", (ka,)) is False and one("select abierto from kioscos where id=%s", (ka,)) is True, "anon no modifica el local")
ok(fails("select crear_pedido('kiosco-b','Z','3415550000','retiro','', '', '[]'::jsonb)") is not False, "items vacíos siguen rechazados")
print("\nFALLARON:", bad)
