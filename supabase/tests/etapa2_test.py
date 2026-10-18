# Verifica 0001 + 0002 en Postgres embebido. Uso: pip install pgserver psycopg2-binary && python3 supabase/tests/etapa2_test.py
import pgserver, psycopg2, uuid, json, tempfile
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
cur.execute(open("supabase/migrations/0001_init.sql").read())
cur.execute(open("supabase/migrations/0002_fiado_sellos_precios.sql").read())
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

# --- normalizador (casos reales AR) ---
for raw, exp in [("0341 15 555-9999","5493415559999"),("341 5559999","5493415559999"),("+54 9 341 555 9999","5493415559999"),
                 ("011 15 4444-5555","5491144445555"),("54 341 5559999","5493415559999"),("02954 15 123456","5492954123456")]:
    ok(one("select normalizar_tel_ar(%s)", (raw,)) == exp, f"normalizar {raw} -> {exp}")

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco A','kiosco-a','5493415551234') returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco B','kiosco-b','5493415550000') returning id", (B,))
as_("authenticated", A)
prods = {}
for n, c, pr in [("Gaseosa","Bebidas",1000),("Agua","Bebidas",505),("Alfajor","Golosinas",333.33)]:
    prods[n] = one("insert into productos(kiosco_id,nombre,categoria,precio) values (%s,%s,%s,%s) returning id", (ka, n, c, pr))
as_("authenticated", B)
pb = one("insert into productos(kiosco_id,nombre,precio) values (%s,'Pan',100) returning id", (kb,))

# --- pedido de un vecino: teléfono canónico + cliente único ---
as_("anon")
items = json.dumps([{"producto_id": str(prods["Gaseosa"]), "cantidad": 2}])
r1 = one("select crear_pedido('kiosco-a','Ana','0341 15 555-9999','retiro',null,null,%s::jsonb)", (items,))
r2 = one("select crear_pedido('kiosco-a','Ana P','+54 9 341 555 9999','retiro',null,null,%s::jsonb)", (items,))
as_("authenticated", A)
ok(one("select count(*) from clientes") == 1, "mismo vecino en 2 formatos = 1 cliente")
cli = one("select id from clientes")
ok(one("select telefono from clientes") == "5493415559999", "teléfono guardado en formato canónico")

# --- sello automático al entregar ---
cur.execute("update pedidos set estado='confirmado' where id=%s", (r1["pedido_id"],))
ok(one("select count(*) from sellos") == 0, "confirmar no da sello")
cur.execute("update pedidos set estado='entregado' where id=%s", (r1["pedido_id"],))
ok(one("select count(*) from sellos where origen='pedido'") == 1, "entregar da 1 sello")
cur.execute("update pedidos set estado='cancelado' where id=%s", (r1["pedido_id"],))
cur.execute("update pedidos set estado='entregado' where id=%s", (r1["pedido_id"],))
ok(one("select count(*) from sellos") == 1, "re-entregar el mismo pedido no duplica sello")
ok(one("select sellos_disponibles from clientes_sellos where id=%s", (cli,)) == 1, "saldo de sellos = 1")

# --- sellos: mostrador, anular, canje ---
cur.execute("update kioscos set sellos_por_premio=3, premio='Una gaseosa' where id=%s", (ka,))
for _ in range(2): cur.execute("insert into sellos(kiosco_id,cliente_id,origen) values (%s,%s,'mostrador')", (ka, cli))
ok(one("select sellos_disponibles from clientes_sellos where id=%s", (cli,)) == 3, "3 sellos (1 pedido + 2 mostrador)")
sid = one("select id from sellos where origen='mostrador' limit 1")
cur.execute("update sellos set anulado=true where id=%s", (sid,))
ok(one("select sellos_disponibles from clientes_sellos where id=%s", (cli,)) == 2, "anular un sello lo descuenta")
ok(fails("select canjear_premio(%s)", (cli,)) is not False, "canje con sellos insuficientes falla")
cur.execute("update sellos set anulado=false where id=%s", (sid,))
ok(one("select canjear_premio(%s)", (cli,)) == 0, "canje exitoso deja 0")
ok(one("select sellos_disponibles from clientes_sellos where id=%s", (cli,)) == 0, "sellos usados no cuentan")
ok(fails("insert into canjes(kiosco_id,cliente_id,sellos) values (%s,%s,1)", (ka, cli)) is not False, "dueño no puede insertar canjes directo")
as_("authenticated", B)
ok(fails("select canjear_premio(%s)", (cli,)) is not False, "otro dueño no puede canjear")
ok(fails("insert into sellos(kiosco_id,cliente_id,origen) values (%s,%s,'mostrador')", (kb, cli)) is not False, "FK compuesta: sello de B a cliente de A rechazado")

# --- fiado ---
as_("authenticated", A)
for t, m in [("fiado",1000),("fiado",500),("pago",400)]:
    cur.execute("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto) values (%s,%s,%s,%s)", (ka, cli, t, m))
ok(float(one("select saldo from clientes_saldo where id=%s", (cli,))) == 1100.0, "saldo fiado = 1000+500-400")
ok(fails("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto) values (%s,%s,'fiado',0)", (ka, cli)) is not False, "monto 0 rechazado")
as_("authenticated", B)
ok(one("select count(*) from clientes_saldo") == 0, "B no ve saldos de A")
ok(fails("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto) values (%s,%s,'fiado',10)", (kb, cli)) is not False, "B no puede cargar fiado a cliente de A")
as_("anon")
ok(fails("select * from clientes_saldo") is not False, "anon sin acceso a la libreta de fiado")

# --- ajuste de precios ---
as_("authenticated", A)
prev = cur.execute("select * from previsualizar_ajuste(%s,10,null,10)", (ka,)) or cur.fetchall()
got = {r[1]: float(r[4]) for r in prev}
ok(got == {"Gaseosa":1100.0,"Agua":560.0,"Alfajor":370.0}, f"preview +10% redondeo 10: {got}")
ok(one("select count(*) from previsualizar_ajuste(%s,10,'Bebidas',0)", (ka,)) == 2, "preview filtra por categoría")
as_("authenticated", B)
ok(fails("select ajustar_precios(%s,10,null,0)", (ka,)) is not False, "B no puede ajustar precios de A")
as_("authenticated", A)
for pct in (0, 500, -80):
    ok(fails("select ajustar_precios(%s,%s,null,0)", (ka, pct)) is not False, f"porcentaje {pct} rechazado")
ok(fails("select ajustar_precios(%s,10,null,7)", (ka,)) is not False, "redondeo inválido rechazado")
res = one("select ajustar_precios(%s,10,'Bebidas',10)", (ka,)); aj = res["ajuste_id"]
ok(res["cantidad"] == 2, "ajuste +10% a Bebidas toca 2 productos")
ok(float(one("select precio from productos where id=%s", (prods["Gaseosa"],))) == 1100.0, "Gaseosa 1000 -> 1100")
ok(float(one("select precio from productos where id=%s", (prods["Alfajor"],))) == 333.33, "Golosinas intactas")
ok(one("select count(*) from historial_precios where ajuste_id=%s", (aj,)) == 2, "historial guarda 2 filas")
cur.execute("update productos set precio=999 where id=%s", (prods["Agua"],))  # cambio manual posterior
rv = one("select revertir_ajuste(%s)", (aj,))
ok(rv == {"revertidos": 1, "omitidos": 1}, f"deshacer no pisa cambio manual: {rv}")
ok(float(one("select precio from productos where id=%s", (prods["Gaseosa"],))) == 1000.0, "Gaseosa vuelve a 1000")
ok(float(one("select precio from productos where id=%s", (prods["Agua"],))) == 999.0, "Agua conserva el cambio manual")
ok(fails("select revertir_ajuste(%s)", (aj,)) is not False, "no se revierte dos veces")
ok(fails("update ajustes_precios set cantidad=99") is not False, "dueño no edita ajustes directo")

# --- resumen semanal ---
rs = one("select resumen_semana(%s)", (ka,))
ok(rs["pedidos"] == 2, f"resumen pedidos={rs['pedidos']}")
ok(float(rs["fiado_pendiente"]) == 1100.0 and rs["deudores"] == 1, "resumen: fiado pendiente 1100, 1 deudor")
ok(rs["premios_semana"] == 1 and rs["sellos_semana"] == 3, f"resumen: sellos={rs['sellos_semana']} premios={rs['premios_semana']}")
as_("authenticated", B)
ok(fails("select resumen_semana(%s)", (ka,)) is not False, "B no puede ver el resumen de A")
print("\nFALLARON:", bad)
