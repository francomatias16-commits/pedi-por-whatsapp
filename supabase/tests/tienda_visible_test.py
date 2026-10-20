# Verifica la 0060: QR único (club_datos / tarjeta / tienda_disponible_slug avisan si hay tienda) y productos visibles en la tienda
# (la lectura pública y crear_pedido respetan visible_tienda; ocultar no depende del stock ni de la Caja; tienda apagada rechaza pedidos).
# Uso: python3 supabase/tests/tienda_visible_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json, glob
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "tienda_" + uuid.uuid4().hex[:8]
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


U = str(uuid.uuid4())
cur.execute("insert into auth.users(id,email) values (%s,%s)", (U, "dueno@test.com"))
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

as_("authenticated", U)
k = one("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Don Julio','don-julio','5493415551234') returning id", (U,))
def prod(n, precio=100, disp=True):
    return one("insert into productos(kiosco_id,nombre,precio,disponible) values (%s,%s,%s,%s) returning id", (k, n, precio, disp))
visible, oculto, agotado = prod("Alfajor"), prod("Gaseosa"), prod("Chicle", 50, False)
ok(one("select visible_tienda from productos where id=%s", (visible,)) is True, "un producto nuevo se ve en la tienda por defecto")
ok(one("select tienda_activa from kioscos where id=%s", (k,)) is True, "un local nuevo tiene tienda por defecto")
cur.execute("update productos set visible_tienda=false where id=%s", (oculto,))

items = lambda *ids: json.dumps([{"producto_id": i, "cantidad": 1} for i in ids])
pedir = lambda *ids: "select crear_pedido('don-julio','Ana','3415550001','retiro',null,null,%s::jsonb,null,'efectivo')"
# --- Lectura pública
as_("anon")
vistos = {r[0] for r in (cur.execute("select nombre from productos where kiosco_id=%s", (k,)) or cur.fetchall())}
ok(vistos == {"Alfajor"}, "la tienda pública solo ve lo disponible y visible (no ve el oculto ni el agotado)")
ok(not fails("select visible_tienda from productos where kiosco_id=%s", (k,)), "anon puede filtrar por visible_tienda")
ok(not fails("select tienda_activa from kioscos where slug='don-julio'"), "anon puede leer tienda_activa")

# --- Pedidos
ok(not fails(pedir(), (items(visible),)), "se puede pedir un producto visible")
ok(has(fails(pedir(), (items(oculto),)), "producto_no_disponible"), "no se puede pedir un producto oculto (ni llamando al RPC directo)")
ok(has(fails(pedir(), (items(visible, oculto),)), "producto_no_disponible"), "un pedido mixto con un oculto se rechaza entero")

# --- Ocultar no depende del stock, y el stock no revela lo oculto
as_("authenticated", U)
ok(one("select disponible from productos where id=%s", (oculto,)) is True, "el producto oculto sigue 'disponible': la Caja lo puede vender")
cur.execute("update productos set stock_controlado=true, stock=3 where id=%s", (oculto,))
cur.execute("select ajustar_stock(%s, 0, 'se vendió todo', 'manual')", (oculto,))
ok(one("select disponible from productos where id=%s", (oculto,)) is False, "al llegar a stock 0 deja de estar disponible")
pv = one("select (proveedor_guardar(%s, null, 'Distribuidora Sur', '3415550000', null, null))->>'id'", (k,))
cur.execute("select registrar_compra(%s, %s, %s::jsonb, 0, 'efectivo', 'A-1', null)", (k, pv, json.dumps([{"producto_id": oculto, "cantidad": 5, "costo": 50}])))
ok(one("select disponible from productos where id=%s", (oculto,)) is True and one("select visible_tienda from productos where id=%s", (oculto,)) is False,
   "al reponer con una compra vuelve a estar disponible (Caja) pero sigue oculto de la tienda")
as_("anon")
ok(has(fails(pedir(), (items(oculto),)), "producto_no_disponible"), "reponer stock no vuelve a mostrar un producto oculto")

# --- QR único: club + tienda
as_("anon")
d = one("select club_datos('don-julio')"); d = d if isinstance(d, dict) else json.loads(d)
ok(d.get("tienda") is True, "club_datos avisa que hay tienda")
ok(one("select tienda_disponible_slug('don-julio')") is True, "tienda_disponible_slug: hay tienda")
ok(one("select tienda_disponible_slug('no-existe')") is False, "tienda_disponible_slug: slug inexistente = no hay tienda")
ok(has(fails("select tienda_disponible(%s)", (k,)), "permission denied"), "la función interna tienda_disponible no se llama desde afuera")
as_("authenticated", U)
cur.execute("update productos set visible_tienda=false where id=%s", (visible,))
cur.execute("update productos set visible_tienda=false where id=%s", (oculto,))
as_("anon")
d = one("select club_datos('don-julio')"); d = d if isinstance(d, dict) else json.loads(d)
ok(d.get("tienda") is False and one("select tienda_disponible_slug('don-julio')") is False, "con todo oculto no se ofrece el catálogo")
as_("authenticated", U)
cur.execute("update productos set visible_tienda=true where id=%s", (visible,))
cur.execute("update kioscos set tienda_activa=false where id=%s", (k,))
as_("anon")
d = one("select club_datos('don-julio')"); d = d if isinstance(d, dict) else json.loads(d)
ok(d.get("tienda") is False and one("select tienda_disponible_slug('don-julio')") is False, "con la tienda apagada no se ofrece el catálogo")
ok(d.get("nombre") == "Don Julio", "el club sigue funcionando con la tienda apagada")
ok(has(fails(pedir(), (items(visible),)), "tienda_no_disponible"), "con la tienda apagada no se aceptan pedidos")

# --- La tarjeta del club también avisa
as_("authenticated", U)
cur.execute("update kioscos set tienda_activa=true where id=%s", (k,))
as_("anon")
u = one("select club_unirse('don-julio','Ana','3415550001')"); u = u if isinstance(u, dict) else json.loads(u)
t = one("select club_tarjeta(%s)", (u["token"],)); t = t if isinstance(t, dict) else json.loads(t)
ok(t.get("tienda") is True, "la tarjeta del club avisa que hay tienda")
as_("authenticated", U)
cur.execute("update kioscos set tienda_activa=false where id=%s", (k,))
as_("anon")
t = one("select club_tarjeta(%s)", (u["token"],)); t = t if isinstance(t, dict) else json.loads(t)
ok(t.get("tienda") is False, "la tarjeta deja de ofrecer el catálogo si la tienda se apaga")

print("TODO OK" if not bad else f"{bad} FALLA(S)")
sys.exit(1 if bad else 0)
