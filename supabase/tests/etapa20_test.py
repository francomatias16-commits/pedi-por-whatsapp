# Verifica 0023 (curva ABC y fiado vencido). Uso: python3 supabase/tests/etapa20_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa20_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras", "0016_etiquetas", "0017_fidelidad", "0018_reposicion", "0019_motivos_mermas", "0020_historial_stock", "0021_conteo_planilla", "0022_margen_precios", "0023_fase3_abc_fiado"]:
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
def rows(sql, args=None):
    cur.execute(sql, args); cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]
def has(err, texto): return texto in (err or "")

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','kiosco-a','5493415551234',true) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))
as_("authenticated", A)

def prod(nombre, precio, controlado=True, stock=0, minimo=0, peso=False):
    return one("insert into productos(kiosco_id,nombre,precio,stock_controlado,stock,stock_minimo,vendido_por_peso) values (%s,%s,%s,%s,%s,%s,%s) returning id",
               (ka, nombre, precio, controlado, stock, minimo, peso))
coca = prod("Coca 500", 1000, stock=40)
pan = prod("Pan", 500, stock=3)
galle = prod("Galletitas", 800, stock=15, minimo=20)
agot = prod("Agotado con mínimo", 300, stock=0, minimo=5)
muerto = prod("Producto sin movimiento", 300, stock=0)
queso = prod("Queso", 8000, stock=2000, minimo=3000, peso=True)
sano = prod("Gaseosa con stock", 900, stock=100, minimo=5)
libre = prod("Alfajor suelto", 500, controlado=False)
stock = lambda p: one("select stock from productos where id=%s", (p,))

# El historial de ventas se mira contra productos "viejos": ventana completa de 30 días.
root("update productos set created_at = now() - interval '40 days' where kiosco_id=%s", (ka,))
as_("authenticated", A)

# ── Datos nuevos por producto ──
ok(bool(fails("update productos set stock_minimo=-1 where id=%s", (coca,))), "stock mínimo negativo se rechaza")
ok(bool(fails("update productos set stock_objetivo=-1 where id=%s", (coca,))), "stock objetivo negativo se rechaza")
ok(bool(fails("update productos set lead_time_dias=61 where id=%s", (coca,))), "días de entrega fuera de 0..60 se rechazan")
ok(one("select lead_time_dias from productos where id=%s", (coca,)) == 3, "días de entrega por defecto: 3")

pv = one("select (proveedor_guardar(%s, null, 'Distribuidora Sur', '3415550000', null, null))->>'id'", (ka,))
one("update productos set proveedor_id=%s where id=%s returning id", (pv, galle))
ok(str(one("select proveedor_id from productos where id=%s", (galle,))) == str(pv), "se asigna el proveedor habitual")
as_("authenticated", B)
pvb = one("select (proveedor_guardar(%s, null, 'Proveedor de B'))->>'id'", (kb,))
as_("authenticated", A)
ok(has(fails("update productos set proveedor_id=%s where id=%s", (pvb, coca)), "proveedor_no_encontrado"), "no se puede usar el proveedor de otro kiosco")
as_("anon")
ok(bool(fails("select stock_minimo from productos limit 1")), "anon no ve el stock mínimo")
ok(bool(fails("select proveedor_id from productos limit 1")), "anon no ve el proveedor del producto")
as_("authenticated", A)
# Si se borra el proveedor, el producto queda sin proveedor (no se borra).
tmp = root("insert into proveedores(kiosco_id,nombre) values (%s,'Temporal') returning id", (ka,))
root("update productos set proveedor_id=%s where id=%s", (tmp, agot))
root("delete from proveedores where id=%s", (tmp,))
ok(root("select proveedor_id from productos where id=%s", (agot,)) is None and root("select count(*) from productos where id=%s", (agot,)) == 1, "al borrar un proveedor el producto queda sin proveedor")
as_("authenticated", A)

# ── Ventana de días ──
ok(root("select reposicion_dias_ventana(now())") == 1, "producto de hoy: ventana de 1 día")
ok(root("select reposicion_dias_ventana(now() - interval '3 days')") == 3, "producto de 3 días: ventana de 3 días")
ok(root("select reposicion_dias_ventana(now() - interval '90 days')") == 30, "producto viejo: ventana tope de 30 días")
as_("authenticated", A)

t = one("select (caja_abrir_turno(%s, 1000)->>'turno_id')::uuid", (ka,))
def venta(items, pagos):
    return one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0)", (t, json.dumps(items), json.dumps(pagos)))
# Ingresos: coca 30×1000 = 30000; queso 500 g a $8000/kg = 4000; galletitas 1×800; pan 2×500 = 1000. Total 35800.
venta([{"producto_id": coca, "cantidad": 30}], [{"medio": "efectivo", "monto": 30000}])
venta([{"producto_id": queso, "cantidad": 500}], [{"medio": "efectivo", "monto": 4000}])
venta([{"producto_id": galle, "cantidad": 1}], [{"medio": "efectivo", "monto": 800}])
venta([{"producto_id": pan, "cantidad": 2}], [{"medio": "efectivo", "monto": 1000}])
abc = one("select curva_abc(%s, 90)", (ka,))
clases = {x["nombre"]: x["clase"] for x in abc}
ok(clases == {"Coca 500": "A", "Queso": "B", "Pan": "B", "Galletitas": "C"}, "curva ABC: coca A (84%); queso y pan B (hasta 95%); galletitas C")
ok(float(next(x for x in abc if x["nombre"] == "Queso")["ingreso"]) == 4000.0, "el queso se valoriza por kilo: 500 g a $8000/kg = $4000")
ok(has(fails("select curva_abc(%s, 3)", (ka,)), "dias_invalidos"), "una ventana menor a 7 días se rechaza")
ok(bool(fails("select curva_abc(%s, 90)", (kb,))), "otro dueño no ve la curva de mi kiosco")

# ── Fiado ──
cana = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Ana','5493415550001') returning id", (ka,))
cluis = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Luis','5493415550002') returning id", (ka,))
cmarta = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Marta','5493415550003') returning id", (ka,))
root("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto,created_at) values (%s,%s,'fiado',1000, now() - interval '40 days')", (ka, cana))
root("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto) values (%s,%s,'fiado',500)", (ka, cluis))
root("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto,created_at) values (%s,%s,'fiado',300, now() - interval '40 days')", (ka, cmarta))
root("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto) values (%s,%s,'pago',300)", (ka, cmarta))
fv = one("select fiado_vencido(%s, 30)", (ka,))
ok(fv["clientes"] == 1 and float(fv["monto"]) == 1000.0, "fiado vencido: solo Ana (1000, hace 40 días); Luis es reciente y Marta ya pagó")
ok(bool(fails("select fiado_vencido(%s, 30)", (kb,))), "otro dueño no ve el fiado de mi kiosco")

# Aviso semanal (lo corre el cron): una vez por kiosco y semana.
av = root("select count(*) from fiado_avisos_semanales(30) where kiosco = %s", (ka,))
ok(av == 1, "el cron avisa al dueño de Ana (1 kiosco con fiado vencido)")
ok(root("select count(*) from fiado_avisos_semanales(30) where kiosco = %s", (ka,)) == 0, "si el cron corre otra vez en la semana, no repite el aviso")

as_("authenticated", A)
print("\nRESULTADO: " + ("OK" if not bad else f"{bad} FALLAS"))
sys.exit(1 if bad else 0)
