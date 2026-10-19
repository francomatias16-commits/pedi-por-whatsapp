# Verifica 0032 (seguimiento público del pedido: token, interruptor, etapa de entrega y función pública sin datos personales).
# Uso: python3 supabase/tests/etapa27_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa27_" + uuid.uuid4().hex[:8]
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

# --- datos: local A (dueño A, encargado EN, cajero CJ) y local B (dueño B)
as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto,acepta_envio) values (%s,'Kiosco A','kiosco-a','5493415551234',true,true) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))
as_("authenticated", A)
p1 = one("insert into productos(kiosco_id,nombre,precio,stock,stock_controlado) values (%s,'Alfajor',500,50,true) returning id", (ka,))
as_("postgres")
cur.execute("insert into kiosco_miembros(kiosco_id,user_id,rol) values (%s,%s,'encargado'),(%s,%s,'cajero')", (ka, EN, ka, CJ))
n_tel = [0]
def pedido(modalidad="retiro", slug="kiosco-a"):
    n_tel[0] += 1
    as_("anon")
    dire = "Calle 123" if modalidad == "envio" else None
    return jsn(one("select crear_pedido(%s,'Ana Pérez',%s,%s,%s,'sin sal',%s::jsonb,null::uuid,'efectivo')", (slug, f"54934155530{n_tel[0]:02d}", modalidad, dire, json.dumps([{"producto_id": p1, "cantidad": 1}]))))["pedido_id"]
def token(pid):
    as_("postgres"); return one("select token_seguimiento from pedidos where id=%s", (pid,))
def seg(tk):
    """Consulta como anónimo y vuelve al rol que estaba (para no cambiar quién ejecuta el resto del test)."""
    cur.execute("select current_user, current_setting('request.jwt.claim.sub', true)"); ru, rs = cur.fetchone()
    as_("anon"); r = one("select seguimiento_pedido(%s)", (tk,))
    as_(ru, rs); return None if r is None else jsn(r)

pr = pedido("retiro"); pe = pedido("envio")
tr, te = token(pr), token(pe)

# ===== 1) Token
ok(len(tr) == 64 and all(c in "0123456789abcdef" for c in tr), "el token tiene 64 caracteres hexadecimales")
ok(tr != te, "cada pedido tiene su propio token")
as_("authenticated", B); ok(rows("select 1 from pedidos where id=%s", (pr,)) == 0, "otro dueño no ve el pedido ni su token")
as_("anon"); ok(rows("select token_seguimiento from pedidos") <= 0, "anon no puede leer tokens")
as_("authenticated", CJ); ok(has(fails("update pedidos set token_seguimiento=%s where id=%s", ("b" * 64, pr)), "token_protegido"), "el token no se cambia desde el navegador")
as_("authenticated", A); ok(has(fails("update pedidos set token_seguimiento=%s where id=%s", ("b" * 64, pr)), "token_protegido"), "ni el dueño cambia el token")
as_("postgres"); ok(bool(fails("update pedidos set token_seguimiento='corto' where id=%s", (pr,))), "un token mal formado no entra")
ok(one("select count(*) from pedidos where token_seguimiento !~ '^[0-9a-f]{64}$'") == 0, "ningún pedido queda sin token válido")

# ===== 2) Interruptor
ok(one("select seguimiento_activo from kioscos where id=%s", (ka,)) is False, "el interruptor arranca apagado")
ok(seg(tr) is None, "apagado: el link no responde")
as_("authenticated", CJ); ok(has(fails("select seguimiento_configurar_activo(%s,true)", (ka,)), "no_autorizado"), "el cajero no lo enciende")
as_("authenticated", EN); ok(has(fails("select seguimiento_configurar_activo(%s,true)", (ka,)), "no_autorizado"), "el encargado no lo enciende")
as_("authenticated", B); ok(has(fails("select seguimiento_configurar_activo(%s,true)", (ka,)), "no_autorizado"), "otro dueño no lo enciende")
as_("anon"); ok(bool(fails("select seguimiento_configurar_activo(%s,true)", (ka,))), "anon no lo enciende")
as_("authenticated", A); ok(jsn(one("select seguimiento_configurar_activo(%s,true)", (ka,)))["activo"] is True, "el dueño lo enciende")

# ===== 3) Función pública
s = seg(tr)
ok(s is not None and s["etapa"] == "recibido" and s["modalidad"] == "retiro", "pedido nuevo: etapa recibido")
ok(set(s.keys()) == {"numero", "etapa", "modalidad", "creado", "local", "tienda", "whatsapp"}, "devuelve exactamente los campos permitidos")
ok("Ana" not in json.dumps(s) and "5493415530" not in json.dumps(s) and "Calle" not in json.dumps(s) and "sin sal" not in json.dumps(s) and "Alfajor" not in json.dumps(s), "no hay nombre, teléfono, dirección, notas ni productos")
ok(s["local"] == "Kiosco A" and s["tienda"] == "kiosco-a", "trae el local")
ok(seg("x" * 64) is None and seg("a" * 64) is None and seg("corto") is None and seg(None) is None and seg(tr.upper()) is None, "token mal formado o inexistente: la misma respuesta vacía")
as_("authenticated", B); ok(has(fails("select seguimiento_configurar_activo(%s,false)", (kb,)), "x") is False, "otro dueño apaga el suyo sin afectar a A")
ok(seg(tr) is not None, "el interruptor de B no afecta el seguimiento de A")

# ===== 4) Etapa de entrega
as_("authenticated", CJ)
ok(has(fails("update pedidos set entrega_estado='listo' where id=%s", (pr,)), "entrega_estado_invalido"), "no se marca listo con el pedido sin confirmar")
cur.execute("update pedidos set estado='confirmado' where id=%s", (pr,)); cur.execute("update pedidos set estado='confirmado' where id=%s", (pe,))
ok(seg(tr)["etapa"] == "confirmado", "confirmado")
ok(has(fails("update pedidos set entrega_estado='en_camino' where id=%s", (pr,)), "entrega_estado_invalido"), "un retiro no puede ir en camino")
ok(has(fails("update pedidos set entrega_estado='listo' where id=%s", (pe,)), "entrega_estado_invalido"), "un envío no puede estar listo")
ok(bool(fails("update pedidos set entrega_estado='volando' where id=%s", (pr,))), "valor inválido rechazado")
cur.execute("update pedidos set entrega_estado='listo' where id=%s", (pr,))
cur.execute("update pedidos set entrega_estado='en_camino' where id=%s", (pe,))
ok(seg(tr)["etapa"] == "listo" and seg(te)["etapa"] == "en_camino", "etapas listo y en camino")
as_("authenticated", X); ok(rows("update pedidos set entrega_estado=null where id=%s", (pr,)) == 0, "un extraño no cambia la etapa")
as_("authenticated", EN); cur.execute("update pedidos set estado='entregado' where id=%s", (pr,))
ok(seg(tr)["etapa"] == "entregado", "entregado")
cur.execute("update pedidos set estado='cancelado' where id=%s", (pe,))
ok(seg(te)["etapa"] == "cancelado", "cancelado pasa por encima de en camino")

# ===== 5) Pago online pendiente
pp = pedido("retiro"); as_("postgres")
cur.execute("select set_config('app.pagos_interno','1',false)"); cur.execute("update pedidos set pago_estado='pendiente' where id=%s", (pp,)); cur.execute("select set_config('app.pagos_interno','',false)")
ok(seg(token(pp))["etapa"] == "esperando_pago", "pago online pendiente: esperando pago")

# ===== 6) Interruptor apagado de nuevo
as_("authenticated", A); cur.execute("select seguimiento_configurar_activo(%s,false)", (ka,))
ok(seg(tr) is None, "al apagar, el link deja de responder")
ok(one("select count(*) from pedidos where kiosco_id=%s", (ka,)) >= 3, "apagar no borra datos")

print("RESULTADO: " + ("OK" if bad == 0 else f"FALLARON {bad}"))
sys.exit(1 if bad else 0)
