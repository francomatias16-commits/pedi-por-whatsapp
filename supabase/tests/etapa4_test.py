# Verifica 0001..0005 en Postgres embebido. Uso: pip install pgserver psycopg2-binary && python3 supabase/tests/etapa4_test.py
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado"]:
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


import json
as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,costo_envio) values (%s,'Kiosco A','kiosco-a','5493415551234',300) returning id", (A,))
p1 = one("insert into productos(kiosco_id,nombre,precio) values (%s,'Gaseosa',1000) returning id", (ka,))
as_("anon")
def nuevo(nombre, tel, mod="retiro"):
    r = pedir("kiosco-a", nombre, tel, mod, "Mitre 123" if mod == "envio" else "", [{"producto_id": p1, "cantidad": 2}])
    return r["pedido_id"], r
def estado(pid, e):
    as_("authenticated", A); cur.execute("update pedidos set estado=%s where id=%s", (e, pid))
def fiar(pid):
    as_("authenticated", A); return one("select pasar_a_fiado(%s)", (pid,))
def saldo(tel):
    as_("authenticated", A); return float(one("select saldo from clientes_saldo where telefono=public.normalizar_tel_ar(%s) and kiosco_id=%s", (tel, ka)))

# --- camino feliz: confirmado -> entregado + fiado en un toque ---
pid, r = nuevo("Ana", "341 555 0001")
estado(pid, "confirmado")
res = fiar(pid)
ok(res["ya_estaba"] is False and float(res["saldo"]) == 2000, f"anota el total como fiado: saldo={res['saldo']}")
ok(one("select estado from pedidos where id=%s", (pid,)) == "entregado", "el pedido queda entregado")
ok(one("select count(*) from sellos where pedido_id=%s", (pid,)) == 1, "se suma el sello por la entrega")
ok(one("select nota from fiado_movimientos where pedido_id=%s", (pid,)).startswith("Pedido #"), "el movimiento dice de qué pedido viene")

# --- idempotente: tocar dos veces no duplica ---
res = fiar(pid)
ok(res["ya_estaba"] is True and float(res["saldo"]) == 2000, "segundo toque no duplica la deuda")
ok(one("select count(*) from fiado_movimientos where pedido_id=%s", (pid,)) == 1, "un solo movimiento por pedido")
ok(one("select count(*) from sellos where pedido_id=%s", (pid,)) == 1, "un solo sello por pedido")

# --- pedido ya entregado a mano (sin fiado) -> se puede pasar después ---
pid2, _ = nuevo("Beto", "341 555 0002"); estado(pid2, "confirmado"); estado(pid2, "entregado")
res = fiar(pid2)
ok(res["ya_estaba"] is False and float(res["saldo"]) == 2000, "pedido ya entregado también se pasa a fiado")
ok(one("select count(*) from sellos where pedido_id=%s", (pid2,)) == 1, "no se duplica el sello")

# --- envío: el fiado incluye el costo de envío ---
pid3, r3 = nuevo("Cami", "341 555 0003", "envio"); estado(pid3, "confirmado")
res = fiar(pid3)
ok(float(res["saldo"]) == 2300 and float(r3["total"]) == 2300, f"fiado incluye envío: {res['saldo']}")

# --- se acumula con deuda previa y un pago la baja ---
pid4, _ = nuevo("Ana", "341 555 0001"); estado(pid4, "confirmado")
res = fiar(pid4)
ok(float(res["saldo"]) == 4000, f"suma a la deuda previa de la misma clienta: {res['saldo']}")
cur.execute("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto) select kiosco_id,id,'pago',1500 from clientes where telefono=public.normalizar_tel_ar('341 555 0001') and kiosco_id=%s", (ka,))
ok(saldo("341 555 0001") == 2500, "un pago posterior baja el saldo")

# --- estados inválidos ---
pid5, _ = nuevo("Dani", "341 555 0004")
as_("authenticated", A); e = fails("select pasar_a_fiado(%s)", (pid5,))
ok(e and "estado_invalido" in e, "pedido pendiente (sin confirmar) no se pasa a fiado")
estado(pid5, "cancelado"); e = fails("select pasar_a_fiado(%s)", (pid5,))
ok(e and "estado_invalido" in e, "pedido cancelado no se pasa a fiado")
ok(saldo("341 555 0004") == 0, "los rechazados no dejan deuda")

# --- sin cliente asociado ---
pid6, _ = nuevo("Eli", "341 555 0005"); estado(pid6, "confirmado")
cur.execute("update pedidos set cliente_id=null where id=%s", (pid6,))
e = fails("select pasar_a_fiado(%s)", (pid6,))
ok(e and "sin_cliente" in e, "pedido sin cliente se rechaza con motivo claro")

# --- permisos ---
as_("authenticated", B); e = fails("select pasar_a_fiado(%s)", (pid6,))
ok(e and "no_autorizado" in e, "otro dueño no puede pasar a fiado pedidos ajenos")
as_("anon"); e = fails("select pasar_a_fiado(%s)", (pid6,))
ok(e and "permission denied" in e, "anónimo no puede ejecutar pasar_a_fiado")
as_("authenticated", B); e = fails("select pasar_a_fiado(%s)", ("00000000-0000-0000-0000-000000000000",))
ok(e and "no_autorizado" in e, "pedido inexistente: no_autorizado")

# --- quitar el fiado (deshacer) y volver a pasarlo ---
as_("authenticated", A)
cur.execute("delete from fiado_movimientos where pedido_id=%s", (pid4,))
ok(saldo("341 555 0001") == 500, "quitar el fiado de un pedido baja la deuda (sin el pago)")
res = fiar(pid4)
ok(res["ya_estaba"] is False, "después de quitarlo se puede volver a pasar")
ok(one("select count(*) from fiado_movimientos where pedido_id=%s", (pid4,)) == 1, "sigue habiendo un solo movimiento")

print("\nFALLOS:", bad); raise SystemExit(1 if bad else 0)
