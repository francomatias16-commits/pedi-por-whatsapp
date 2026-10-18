# Verifica 0001..0012 en Postgres embebido (mostrador + caja + POS completo). Uso: python3 supabase/tests/etapa10_test.py
import os, psycopg2, uuid, tempfile, sys
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida).
# Sin eso: Postgres embebido con pgserver (instancia nueva por corrida).
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa10_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos"]:
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

# Productos (el dueño A carga; con stock controlado el P1 y sin control el P2)
as_("authenticated", A)
p1 = one("insert into productos(kiosco_id,nombre,categoria,precio,stock_controlado,stock) values (%s,'Gaseosa','Bebidas',1000,true,5) returning id", (ka,))
p2 = one("insert into productos(kiosco_id,nombre,categoria,precio) values (%s,'Chicle','Golosinas',300) returning id", (ka,))

# Venta sin turno abierto: no se puede
as_("authenticated", A)
ok(bool(fails("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb)", (str(uuid.uuid4()), json.dumps([{"producto_id": p2, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 300}])))), "no vende con un turno inexistente")

as_("anon")
ok(bool(fails("select registrar_venta_mostrador(%s, '[]'::jsonb, '[]'::jsonb)", (str(uuid.uuid4()),))), "anon no puede vender")

as_("authenticated", A)
t = one("select (caja_abrir_turno(%s, 1000)->>'turno_id')::uuid", (ka,))
ok(t is not None, "el dueño abre caja con fondo 1000")

def venta(items, pagos, turno=None):
    return str(fails("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb)", (turno or t, json.dumps(items), json.dumps(pagos))))
def vender(items, pagos):
    return one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb)", (t, json.dumps(items), json.dumps(pagos)))

# Venta 1: 2 gaseosas (2000), paga 2500 en efectivo -> vuelto 500
v1 = vender([{"producto_id": p1, "cantidad": 2}], [{"medio": "efectivo", "monto": 2500}])
ok(float(v1["total"]) == 2000 and float(v1["vuelto"]) == 500, "venta 1: total 2000, vuelto 500 (2500 en efectivo)")
as_("authenticated", A)
ok(one("select stock from productos where id=%s", (p1,)) == 3, "venta 1 descuenta 2 del stock (5 -> 3)")

# Venta 2: chicle (300) por transferencia exacta, sin vuelto
v2 = vender([{"producto_id": p2, "cantidad": 1}], [{"medio": "transferencia", "monto": 300}])
ok(float(v2["vuelto"]) == 0, "venta 2: pago exacto por transferencia, sin vuelto")

# Venta 3: pago mixto 1000 = 400 transferencia + 600 efectivo
v3 = vender([{"producto_id": p1, "cantidad": 1}], [{"medio": "transferencia", "monto": 400}, {"medio": "efectivo", "monto": 600}])
ok(float(v3["vuelto"]) == 0, "venta 3: pago mixto 400 transf + 600 efectivo, sin vuelto")

# Rechazos
ok("sin_stock" in venta([{"producto_id": p1, "cantidad": 3}], [{"medio": "efectivo", "monto": 3000}]), "no vende más de lo que hay en stock (quedan 2)")
ok("pago_insuficiente" in venta([{"producto_id": p2, "cantidad": 1}], [{"medio": "efectivo", "monto": 100}]), "pago menor al total se rechaza")
ok("pago_excede_total" in venta([{"producto_id": p2, "cantidad": 1}], [{"medio": "transferencia", "monto": 500}, {"medio": "efectivo", "monto": 100}]), "transferencia mayor al total se rechaza (el vuelto es solo efectivo)")
ok("medio_pago_invalido" in venta([{"producto_id": p2, "cantidad": 1}], [{"medio": "bitcoin", "monto": 300}]), "medio de pago inválido se rechaza")
ok("cantidad_invalida" in venta([{"producto_id": p2, "cantidad": 0}], [{"medio": "efectivo", "monto": 300}]), "cantidad 0 se rechaza")
ok("producto_no_encontrado" in venta([{"producto_id": str(uuid.uuid4()), "cantidad": 1}], [{"medio": "efectivo", "monto": 300}]), "producto inexistente se rechaza")
as_("authenticated", A)
ok(one("select stock from productos where id=%s", (p1,)) == 2, "los rechazos no tocan el stock (sigue en 2)")

# Un dueño ajeno no vende en la caja de A
as_("authenticated", B)
ok("no_autorizado" in venta([{"producto_id": p2, "cantidad": 1}], [{"medio": "efectivo", "monto": 300}]), "otro dueño no vende en la caja ajena")

# Agotar la gaseosa: al llegar a 0 deja de estar disponible
as_("authenticated", A)
vender([{"producto_id": p1, "cantidad": 2}], [{"medio": "efectivo", "monto": 2000}])
as_("authenticated", A)
ok(one("select stock from productos where id=%s", (p1,)) == 0, "stock de la gaseosa llega a 0")
ok(one("select disponible from productos where id=%s", (p1,)) is False, "al agotarse la gaseosa deja de estar disponible")

# Resumen y arqueo
r = root("select caja_resumen(%s)", (t,))
medios = r["ventas_por_medio"]
ok(float(medios["efectivo"]) == 4600, "efectivo por medio: venta1 2500-500 vuelto + venta3 600 + agotar 2000 = 4600")
ok(float(medios["transferencia"]) == 700, "transferencia por medio: 300 + 400 = 700")
ok(len(r["ventas"]) == 4, "resumen lista las 4 ventas del turno")
ok(float(r["ventas_efectivo"]) == 4600, "ventas_efectivo (arqueo) = 4600, ya neto de vuelto")
ok(float(r["monto_calculado"]) == 5600, "monto calculado = fondo 1000 + efectivo 4600 = 5600")

# Un pedido en efectivo entregado durante el turno también suma al efectivo
cur.execute("reset role")
cur.execute("insert into pedidos(kiosco_id,cliente_nombre,cliente_telefono,modalidad,total,medio_pago,estado) values (%s,'Cli','5493415550001','retiro',500,'efectivo','pendiente') returning id", (ka,))
pid = cur.fetchone()[0]
cur.execute("update pedidos set estado='entregado' where id=%s", (pid,))
as_("authenticated", A)
r = root("select caja_resumen(%s)", (t,))
ok(float(r["ventas_por_medio"]["efectivo"]) == 5100, "un pedido entregado en efectivo de 500 suma a la caja (5100)")

# Anular la venta 1 (2 gaseosas, efectivo 2500 con vuelto 500): vuelve el stock y sale de la caja
as_("authenticated", A)
ok(one("select stock from productos where id=%s", (p1,)) == 0, "antes de anular: la gaseosa sigue en 0")
as_("authenticated", A)
one("select anular_venta_mostrador(%s, 'Error de carga')", (v1["venta_id"],))
ok(one("select stock from productos where id=%s", (p1,)) == 2, "anular devuelve 2 gaseosas al stock")
ok(one("select disponible from productos where id=%s", (p1,)) is True, "al reponer, la gaseosa vuelve a estar disponible")
r = root("select caja_resumen(%s)", (t,))
ok(float(r["ventas_por_medio"]["efectivo"]) == 5100 - 2000, "anular saca la venta de la caja: 5100 - 2000 (neto de venta1) = 3100")
ok(sum(1 for v in r["ventas"] if v["anulada"]) == 1, "la venta anulada queda marcada en el resumen")
as_("authenticated", A)
ok("ya_anulada" in fails("select anular_venta_mostrador(%s, 'Error de carga')", (v1["venta_id"],)), "no se puede anular dos veces")
as_("authenticated", B)
ok("no_autorizado" in fails("select anular_venta_mostrador(%s, 'Error de carga')", (v2["venta_id"],)), "otro dueño no puede anular ventas ajenas")

# Arqueo: fondo 1000 + efectivo neto 3100 = 4100 esperado. Declarado 4000 -> diferencia -100
as_("authenticated", A)
c = one("select caja_cerrar_turno(%s, 4000)", (t,))
ok(float(c["monto_calculado"]) == 4100 and float(c["diferencia"]) == -100, "arqueo: esperado 4100 (fondo + efectivo neto 3100), contado 4000, diferencia -100")

# Turno cerrado: no vende ni anula
ok("turno_cerrado" in venta([{"producto_id": p2, "cantidad": 1}], [{"medio": "efectivo", "monto": 300}]), "no se vende con la caja cerrada")
ok("turno_cerrado" in fails("select anular_venta_mostrador(%s, 'Error de carga')", (v2["venta_id"],)), "no se anula una venta con la caja cerrada")
r = root("select caja_resumen(%s)", (t,))
ok(float(r["ventas_efectivo"]) == 3100, "el turno cerrado no cambia tras el cierre")

# ───────── POS completo (0012): turno 2 con descuento, tarjeta, cuenta corriente, anulación con motivo ─────────
as_("authenticated", A)
cli = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Marta','5493415550777') returning id", (ka,))
t2 = one("select (caja_abrir_turno(%s, 500)->>'turno_id')::uuid", (ka,))
def v2f(items, pagos, cliente=None, pct=0):
    return str(fails("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, %s, %s)", (t2, json.dumps(items), json.dumps(pagos), cliente, pct)))
def v2(items, pagos, cliente=None, pct=0):
    return one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, %s, %s)", (t2, json.dumps(items), json.dumps(pagos), cliente, pct))

# Descuento global 10% sobre 2 chicles (600) -> total 540
d = v2([{"producto_id": p2, "cantidad": 2}], [{"medio": "tarjeta", "monto": 540}], None, 10)
ok(float(d["subtotal"]) == 600 and float(d["descuento"]) == 60 and float(d["total"]) == 540, "descuento global 10%: subtotal 600, descuento 60, total 540")
ok("descuento_invalido" in v2f([{"producto_id": p2, "cantidad": 1}], [{"medio": "efectivo", "monto": 300}], None, 101), "descuento mayor a 100% se rechaza")
d2 = v2([{"producto_id": p2, "cantidad": 2}], [{"medio": "efectivo", "monto": 600}], None, 10)
ok(float(d2["total"]) == 540 and float(d2["vuelto"]) == 60, "con descuento 10% pagando 600 en efectivo: vuelto 60")

# Cuenta corriente
ok("cuenta_corriente_sin_cliente" in v2f([{"producto_id": p2, "cantidad": 1}], [{"medio": "cuenta_corriente", "monto": 300}]), "cuenta corriente sin cliente se rechaza")
ok("cliente_no_encontrado" in v2f([{"producto_id": p2, "cantidad": 1}], [{"medio": "efectivo", "monto": 300}], str(uuid.uuid4())), "cliente inexistente se rechaza")
cc = v2([{"producto_id": p2, "cantidad": 2}], [{"medio": "cuenta_corriente", "monto": 600}], cli)
ok(float(one("select saldo from clientes_saldo where id=%s", (cli,))) == 600, "venta a cuenta corriente suma 600 al saldo del cliente")
mix = v2([{"producto_id": p2, "cantidad": 4}], [{"medio": "cuenta_corriente", "monto": 700}, {"medio": "efectivo", "monto": 500}], cli)
ok(float(one("select saldo from clientes_saldo where id=%s", (cli,))) == 1300, "pago mixto: solo la parte en cuenta corriente (700) suma al saldo")
ok(float(mix["vuelto"]) == 0, "mixto cuenta corriente 700 + efectivo 500 sobre 1200 -> sin vuelto")
ok("pago_excede_total" in v2f([{"producto_id": p2, "cantidad": 1}], [{"medio": "cuenta_corriente", "monto": 400}], cli), "cuenta corriente mayor al total se rechaza")

# Reporte Z antes de anular
z = one("select caja_reporte_z(%s)", (t2,))
ok(float(z["cobros_por_medio"]["tarjeta"]) == 540, "reporte Z: tarjeta 540")
ok(float(z["cobros_por_medio"]["cuenta_corriente"]) == 1300, "reporte Z: cuenta corriente 1300 (informativo)")
ok(float(z["cobros_por_medio"]["efectivo"]) == 540 + 500, "reporte Z: efectivo = 540 (venta 600 - vuelto 60) + 500 = 1040")
ok(z["ventas"] == 4 and z["anuladas"] == 0 and float(z["descuentos"]) == 120, "reporte Z: 4 ventas, 0 anuladas, descuentos 120")
ok(float(z["efectivo_esperado"]) == 500 + 1040, "reporte Z: efectivo esperado = fondo 500 + efectivo 1040")

# Anulación: motivo obligatorio y reversa de cuenta corriente
ok("motivo_requerido" in fails("select anular_venta_mostrador(%s, '')", (cc["venta_id"],)), "anular sin motivo se rechaza")
one("select anular_venta_mostrador(%s, 'Cliente se arrepintió')", (cc["venta_id"],))
ok(float(one("select saldo from clientes_saldo where id=%s", (cli,))) == 700, "anular una venta a cuenta corriente revierte su saldo (1300 - 600 = 700)")
r = root("select caja_resumen(%s)", (t2,))
an = [v for v in r["ventas"] if v["anulada"]][0]
ok(an["anulada_motivo"] == "Cliente se arrepintió" and an["cliente_nombre"] == "Marta", "el resumen guarda motivo y cliente de la venta anulada")

# Sangrías: no pueden superar el efectivo disponible (500 + 1040 = 1540)
as_("authenticated", A)
ok("sangria_excede_efectivo" in fails("select caja_registrar_movimiento(%s,'sangria',1600,'banco')", (t2,)), "sangría mayor al efectivo disponible se rechaza")
one("select caja_registrar_movimiento(%s,'sangria',1000,'banco')", (t2,))
ok("sangria_excede_efectivo" in fails("select caja_registrar_movimiento(%s,'retiro_final',600,null)", (t2,)), "tras sangrar 1000 quedan 540: retiro de 600 se rechaza")
one("select caja_registrar_movimiento(%s,'refuerzo',200,'cambio')", (t2,))
z = one("select caja_reporte_z(%s)", (t2,))
ok(float(z["sangrias_y_retiros"]) == 1000 and float(z["refuerzos"]) == 200 and float(z["efectivo_esperado"]) == 740, "reporte Z con movimientos: esperado 1540 - 1000 + 200 = 740")
ok(z["anuladas"] == 1 and z["ventas"] == 3, "reporte Z tras anular: 3 ventas, 1 anulada")

# Favoritos: solo el dueño
one("insert into pos_favoritos(kiosco_id, producto_id, orden) values (%s,%s,1) returning id", (ka, p2))
as_("authenticated", B)
ok(one("select count(*) from pos_favoritos") == 0, "otro dueño no ve los favoritos ajenos")
ok(bool(fails("insert into pos_favoritos(kiosco_id, producto_id) values (%s,%s)", (ka, p2))), "otro dueño no puede cargar favoritos en el kiosco ajeno")
as_("anon")
ok(bool(fails("select caja_reporte_z(%s)", (t2,))), "anon no puede pedir el reporte Z")
as_("authenticated", A)
c2 = one("select caja_cerrar_turno(%s, 740)", (t2,))
ok(float(c2["diferencia"]) == 0, "cierre del turno 2: contado 740 = esperado 740, diferencia 0")

print("\nRESULTADO:", "OK" if bad == 0 else f"{bad} FALLAS")
sys.exit(1 if bad else 0)
