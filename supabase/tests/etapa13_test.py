# Verifica 0015 (proveedores, compras y movimientos de stock). Uso: python3 supabase/tests/etapa13_test.py
import os, psycopg2, uuid, tempfile, sys
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida).
# Sin eso: Postgres embebido con pgserver (instancia nueva por corrida).
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa13_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras"]:
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
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','kiosco-a','5493415551234',true) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))
as_("authenticated", A)
coca = one("insert into productos(kiosco_id,nombre,precio,stock_controlado,stock) values (%s,'Coca 500',1000,true,10) returning id", (ka,))
queso = one("insert into productos(kiosco_id,nombre,precio,vendido_por_peso,stock_controlado,stock) values (%s,'Queso',8000,true,true,2000) returning id", (ka,))
libre = one("insert into productos(kiosco_id,nombre,precio) values (%s,'Alfajor suelto',500) returning id", (ka,))
stock = lambda p: one("select stock from productos where id=%s", (p,))
saldo = lambda pv: float(one("select saldo from proveedores_saldo where id=%s", (pv,)))

# Proveedores
pv = one("select (proveedor_guardar(%s, null, 'Distribuidora Sur', '3415550000', '30-1', 'lunes y jueves'))->>'id'", (ka,))
ok(bool(pv), "alta de proveedor")
ok("proveedor_duplicado" in (fails("select proveedor_guardar(%s, null, ' distribuidora sur ')", (ka,)) or ""), "nombre duplicado (sin importar mayúsculas) se rechaza")
ok("nombre_invalido" in (fails("select proveedor_guardar(%s, null, '   ')", (ka,)) or ""), "nombre vacío se rechaza")
one("select proveedor_guardar(%s, %s, 'Distribuidora Sur SA', '3415550000', null, null, true)", (ka, pv))
ok(one("select nombre from proveedores where id=%s", (pv,)) == "Distribuidora Sur SA", "edición de proveedor")
ok(bool(fails("insert into proveedores(kiosco_id,nombre) values (%s,'directo')", (ka,))), "no se escribe directo en proveedores")

# Compra: stock, costo, deuda
c1 = one("select registrar_compra(%s, %s, %s::jsonb, 5000, 'efectivo', 'A-0001', null)", (ka, pv, json.dumps([
    {"producto_id": coca, "cantidad": 12, "costo": 700}, {"producto_id": queso, "cantidad": 500, "costo": 6000}, {"producto_id": libre, "cantidad": 10, "costo": 300}])))
# 12*700=8400 + 0.5kg*6000=3000 + 10*300=3000 = 14400
ok(float(c1["total"]) == 14400 and float(c1["debe"]) == 9400, "compra: total 14400, pagó 5000, debe 9400")
ok(stock(coca) == 22, "suma stock por unidad (10+12)")
ok(stock(queso) == 2500, "suma stock por peso en gramos (2000+500)")
ok(float(one("select costo from productos where id=%s", (coca,))) == 700, "guarda el último costo")
ok(float(one("select costo from productos where id=%s", (libre,))) == 300 and stock(libre) == 0, "producto sin stock controlado: guarda costo y no toca stock")
ok(saldo(pv) == 9400, "saldo del proveedor = lo que se le debe")
ok(one("select count(*) from stock_movimientos where compra_id=%s", (c1["compra_id"],)) == 2, "2 movimientos de stock (el producto sin control no genera)")

# Validaciones
ok("pago_excede_total" in (fails("select registrar_compra(%s,%s,%s::jsonb,99999)", (ka, pv, json.dumps([{"producto_id": coca, "cantidad": 1, "costo": 100}]))) or ""), "pagar de más en la compra se rechaza")
ok("cantidad_invalida" in (fails("select registrar_compra(%s,%s,%s::jsonb)", (ka, pv, json.dumps([{"producto_id": coca, "cantidad": 0, "costo": 100}]))) or ""), "cantidad 0 se rechaza")
ok("costo_invalido" in (fails("select registrar_compra(%s,%s,%s::jsonb)", (ka, pv, json.dumps([{"producto_id": coca, "cantidad": 1}]))) or ""), "sin costo se rechaza")
ok("monto_invalido" in (fails("select registrar_compra(%s,%s,%s::jsonb)", (ka, pv, json.dumps([{"producto_id": coca, "cantidad": 1, "costo": 0}]))) or ""), "compra de total cero se rechaza")
ok(stock(coca) == 22, "los rechazos no dejaron stock a medias")
ok(one("select count(*) from compras where kiosco_id=%s", (ka,)) == 1, "los rechazos no dejaron compras a medias")

# Pagos
one("select pagar_proveedor(%s,%s,4000,'transferencia','parcial')", (ka, pv))
ok(saldo(pv) == 5400, "pago parcial baja la deuda")
ok("monto_invalido" in (fails("select pagar_proveedor(%s,%s,0)", (ka, pv)) or ""), "pago de 0 se rechaza")
ok("medio_pago_invalido" in (fails("select pagar_proveedor(%s,%s,10,'bitcoin')", (ka, pv)) or ""), "medio inválido se rechaza")

# Anular compra
c2 = one("select registrar_compra(%s,%s,%s::jsonb,0)", (ka, pv, json.dumps([{"producto_id": coca, "cantidad": 5, "costo": 800}])))
ok(stock(coca) == 27 and saldo(pv) == 9400, "segunda compra a cuenta: stock 27, deuda 9400")
cur.execute("reset role"); cur.execute("update productos set stock = 3 where id=%s", (coca,)); as_("authenticated", A)
ok("stock_insuficiente" in (fails("select anular_compra(%s)", (c2["compra_id"],)) or ""), "no se anula si ya se vendió parte de la mercadería")
ok(saldo(pv) == 9400 and stock(coca) == 3, "el rechazo no cambió nada")
cur.execute("reset role"); cur.execute("update productos set stock = 27 where id=%s", (coca,)); as_("authenticated", A)
one("select anular_compra(%s)", (c2["compra_id"],))
ok(stock(coca) == 22 and saldo(pv) == 5400, "anular repone stock y borra la deuda de esa compra")
ok("ya_anulada" in (fails("select anular_compra(%s)", (c2["compra_id"],)) or ""), "no se anula dos veces")
ok(one("select count(*) from stock_movimientos where tipo='anulacion_compra'") == 1, "la anulación queda en el historial de stock")

# Ajuste manual
ok(one("select ajustar_stock(%s, 20, 'rotura de 2 unidades')->>'stock'", (coca,)) == '20', "ajuste manual")
ok(one("select cantidad from stock_movimientos where tipo='ajuste' and producto_id=%s", (coca,)) == -2, "el ajuste registra la diferencia (-2)")
ok("motivo_requerido" in (fails("select ajustar_stock(%s, 5, '')", (coca,)) or ""), "ajuste sin motivo se rechaza")
ok("stock_no_controlado" in (fails("select ajustar_stock(%s, 5, 'prueba')", (libre,)) or ""), "ajuste en producto sin control de stock se rechaza")
ok("sin_cambios" in (fails("select ajustar_stock(%s, 20, 'igual')", (coca,)) or ""), "ajuste sin diferencia se rechaza")
ok(one("select ajustar_stock(%s, 0, 'vencidas')->>'stock'", (coca,)) == '0' and one("select disponible from productos where id=%s", (coca,)) is False, "stock 0 deja el producto no disponible")

# Aislamiento
as_("authenticated", B)
ok(one("select count(*) from proveedores") == 0 and one("select count(*) from compras") == 0 and one("select count(*) from stock_movimientos") == 0, "otro dueño no ve nada")
ok("no_autorizado" in (fails("select registrar_compra(%s,%s,%s::jsonb)", (ka, pv, json.dumps([{"producto_id": coca, "cantidad": 1, "costo": 1}]))) or ""), "otro dueño no puede comprar en mi kiosco")
ok("no_autorizado" in (fails("select pagar_proveedor(%s,%s,10)", (ka, pv)) or ""), "otro dueño no puede pagar a mi proveedor")
ok("no_autorizado" in (fails("select anular_compra(%s)", (c1["compra_id"],)) or ""), "otro dueño no puede anular mi compra")
ok("no_autorizado" in (fails("select ajustar_stock(%s, 1, 'intruso')", (coca,)) or ""), "otro dueño no puede ajustar mi stock")
as_("anon")
ok(bool(fails("select count(*) from proveedores")), "anon no lee proveedores")
ok(bool(fails("select registrar_compra(%s,%s,'[]')", (ka, pv))), "anon no ejecuta registrar_compra")
ok(bool(fails("select costo from productos limit 1")), "anon no ve el costo de los productos")

print("\nRESULTADO: " + ("OK" if not bad else f"{bad} FALLAS"))
sys.exit(1 if bad else 0)
