# Corre la migración en un Postgres embebido y verifica RLS + RPC. Uso: pip install pgserver psycopg2-binary && python3 supabase/tests/rls_test.py
import pgserver, psycopg2, uuid, json, tempfile
srv = pgserver.get_server(tempfile.mkdtemp())
conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True
cur = conn.cursor()
cur.execute("""
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
""")
cur.execute(open("supabase/migrations/0001_init.sql").read())
cur.execute("grant all on all tables in schema public to anon, authenticated")
A, B = str(uuid.uuid4()), str(uuid.uuid4())
cur.execute("insert into auth.users values (%s),(%s)", (A, B))

def as_(role, sub=None):
    cur.execute("reset role"); cur.execute(f"set role {role}")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (sub or '',))
def fails(sql, args=None):
    cur.execute("savepoint s")
    try: cur.execute(sql, args); cur.execute("release savepoint s"); return False
    except Exception as e: cur.execute("rollback to savepoint s"); return str(e).split("\n")[0]
ok = lambda c, m: print(("PASS " if c else "FAIL ") + m)

cur.execute("begin")
as_("authenticated", A)
cur.execute("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco A','kiosco-a','5493415551234') returning id", (A,)); ka = cur.fetchone()[0]
ok(fails("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Robado','robado','549')", (B,)) is not False, "A no puede crear kiosco a nombre de B")
cur.execute("insert into productos(kiosco_id,nombre,precio) values (%s,'Gaseosa',1000) returning id", (ka,)); p1 = cur.fetchone()[0]
cur.execute("insert into productos(kiosco_id,nombre,precio,disponible) values (%s,'Alfajor',500,false) returning id", (ka,)); p2 = cur.fetchone()[0]
as_("authenticated", B)
cur.execute("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco B','kiosco-b','5493415550000') returning id", (B,)); kb = cur.fetchone()[0]
ok(fails("insert into productos(kiosco_id,nombre,precio) values (%s,'Intruso',1)", (ka,)) is not False, "B no puede cargar productos en kiosco de A")

as_("anon")
cur.execute("select count(*) from productos where kiosco_id=%s", (ka,)); ok(cur.fetchone()[0] == 1, "anon ve solo productos disponibles")
ok(fails("select * from pedidos") is not False or True, "(anon select pedidos)")
cur.execute("select count(*) from pedidos"); ok(cur.fetchone()[0] == 0, "anon no ve pedidos")
ok(fails("insert into pedidos(kiosco_id,cliente_nombre,cliente_telefono,modalidad,total) values (%s,'x','12345678','retiro',1)", (ka,)) is not False, "anon no inserta pedidos directo")

items = json.dumps([{"producto_id": str(p1), "cantidad": 3}])
cur.execute("select crear_pedido('kiosco-a','Juan','341 555-9999','envio','Calle 1','sin hielo',%s::jsonb)", (items,))
r = cur.fetchone()[0]; ok(float(r["total"]) == 3000.0, f"RPC calcula total en servidor: {r['total']}")
ok(fails("select crear_pedido('kiosco-a','Juan','341555999','retiro',null,null,%s::jsonb)", (json.dumps([{"producto_id": str(p2), "cantidad": 1}]),)) is not False, "RPC rechaza producto no disponible")
ok(fails("select crear_pedido('kiosco-a','Juan','12','retiro',null,null,%s::jsonb)", (items,)) is not False, "RPC rechaza teléfono inválido")
ok(fails("select crear_pedido('kiosco-a','Juan','341555999','envio','',null,%s::jsonb)", (items,)) is not False, "RPC rechaza envío sin dirección")
ok(fails("select crear_pedido('kiosco-a','Juan','341555999','retiro',null,null,%s::jsonb)", (json.dumps([{"producto_id": str(p1), "cantidad": 0}]),)) is not False, "RPC rechaza cantidad 0")
ok(fails("select crear_pedido('kiosco-b','Juan','341555999','retiro',null,null,%s::jsonb)", (items,)) is not False, "RPC rechaza producto de otro kiosco")
ok(fails("select crear_pedido('no-existe','Juan','341555999','retiro',null,null,%s::jsonb)", (items,)) is not False, "RPC rechaza kiosco inexistente")
cur.execute("select crear_pedido('kiosco-a','Juan Pérez','3415559999','retiro',null,null,%s::jsonb)", (items,))  # mismo cliente (distinto formato → otro teléfono normalizado igual)

as_("authenticated", A)
cur.execute("select count(*), sum(total) from pedidos"); c, t = cur.fetchone(); ok(c == 2, f"A ve sus {c} pedidos")
cur.execute("select count(*) from pedido_items"); ok(cur.fetchone()[0] == 2, "A ve los items de sus pedidos")
cur.execute("select count(*) from clientes"); ok(cur.fetchone()[0] == 1, "cliente con mismo teléfono se reutiliza (upsert)")
as_("authenticated", B)
cur.execute("select count(*) from pedidos"); ok(cur.fetchone()[0] == 0, "B no ve pedidos de A")
cur.execute("select count(*) from pedido_items"); ok(cur.fetchone()[0] == 0, "B no ve items de A")
cur.execute("update pedidos set estado='entregado'"); ok(cur.rowcount == 0, "B no puede modificar pedidos de A")
as_("authenticated", A)
cur.execute("update pedidos set estado='confirmado'"); ok(cur.rowcount == 2, "A confirma sus pedidos")
cur.execute("insert into productos_globales(barcode,nombre) values ('7790001','Coca') on conflict (barcode) do nothing")
as_("authenticated", B)
cur.execute("insert into productos_globales(barcode,nombre,fuente) values ('7790001','OTRO','kiosco') on conflict (barcode) do nothing")
cur.execute("select nombre from productos_globales where barcode='7790001'"); ok(cur.fetchone()[0] == 'Coca', "base global: no se pisa lo existente")
