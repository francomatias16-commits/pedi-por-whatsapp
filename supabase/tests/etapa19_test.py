# Verifica 0022 (margen y precio por costo). Uso: python3 supabase/tests/etapa19_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa19_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras", "0016_etiquetas", "0017_fidelidad", "0018_reposicion", "0019_motivos_mermas", "0020_historial_stock", "0021_conteo_planilla", "0022_margen_precios"]:
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

# ── Costos: coca 700 (precio 1000), pan 400 (500), galletitas 500 (800), queso 6000/kg (8000). Gaseosa sin costo. ──
root("update productos set costo=700 where id=%s", (coca,))
root("update productos set costo=400 where id=%s", (pan,))
root("update productos set costo=500 where id=%s", (galle,))
root("update productos set costo=6000 where id=%s", (queso,))
as_("authenticated", A)

ok(has(fails("select ajustar_precios_por_margen(%s, 100, null, 10)", (ka,)), "margen_invalido"), "un margen de 100% se rechaza")
ok(has(fails("select ajustar_precios_por_margen(%s, 35, null, 7)", (ka,)), "redondeo_invalido"), "redondeo fuera de la lista se rechaza")

# Margen 35% sobre precio de venta, redondeo a $10 hacia arriba:
# coca 700/0.65 = 1076,9 → 1080 (sube); pan 615,4 → 620 (sube); galletitas 769,2 → 770 (ya está en 800: no toca);
# queso 9230,8 → 9240 (sube); gaseosa sin costo: no entra.
prev = rows("select * from previsualizar_margen(%s, 35, null, 10)", (ka,))
precios = {x["nombre"]: float(x["precio_nuevo"]) for x in prev}
ok(precios == {"Coca 500": 1080.0, "Pan": 620.0, "Queso": 9240.0}, "vista previa: sube coca a 1080, pan a 620 y queso a 9240; galletitas (ya tiene más margen) y gaseosa (sin costo) no")
ok(next(x for x in prev if x["nombre"] == "Pan")["margen_actual"] == 20.0, "la vista previa muestra el margen actual (pan: 20%)")

r = one("select ajustar_precios_por_margen(%s, 35, null, 10)", (ka,))
ok(r["cantidad"] == 3, "el ajuste cambia 3 productos")
ok(one("select precio from productos where id=%s", (coca,)) == 1080 and one("select precio from productos where id=%s", (galle,)) == 800, "coca queda en 1080 y galletitas no cambia")
ok(one("select tipo from ajustes_precios where id=%s", (r["ajuste_id"],)) == "margen", "el ajuste queda marcado como ajuste por margen")
ok(one("select count(*) from historial_precios where ajuste_id=%s", (r["ajuste_id"],)) == 3, "el historial guarda los 3 precios anteriores y nuevos")

# Un precio cambiado a mano después no se pisa al deshacer.
root("update productos set precio=700 where id=%s", (pan,))
rv = one("select revertir_ajuste(%s)", (r["ajuste_id"],))
ok(rv["revertidos"] == 2 and rv["omitidos"] == 1, "deshacer: restaura coca y queso; pan se deja porque lo cambiaste a mano")
ok(one("select precio from productos where id=%s", (coca,)) == 1000 and one("select precio from productos where id=%s", (queso,)) == 8000, "coca vuelve a 1000 y queso a 8000")

# Permisos
as_("authenticated", B)
ok(len(rows("select * from previsualizar_margen(%s, 35, null, 10)", (ka,))) == 0, "otro dueño no ve la vista previa de mi kiosco")
ok(has(fails("select ajustar_precios_por_margen(%s, 35, null, 10)", (ka,)), "no_autorizado"), "otro dueño no cambia mis precios")
as_("anon")
ok(bool(fails("select ajustar_precios_por_margen(%s, 35, null, 10)", (ka,))), "anon no ejecuta el ajuste")
as_("authenticated", A)

print("\nRESULTADO: " + ("OK" if not bad else f"{bad} FALLAS"))
sys.exit(1 if bad else 0)
