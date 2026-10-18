# Verifica 0019 (motivos de ajuste y mermas). Uso: python3 supabase/tests/etapa16_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa16_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras", "0016_etiquetas", "0017_fidelidad", "0018_reposicion", "0019_motivos_mermas"]:
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

# ── Costos para valorizar (Pan $200, Galletitas $500, Queso $6000 por kg) ──
root("update productos set costo=200 where id=%s", (pan,))
root("update productos set costo=500 where id=%s", (galle,))
root("update productos set costo=6000 where id=%s", (queso,))
as_("authenticated", A)

# ── Ajustes con motivo ──
ok(one("select ajustar_stock(%s, 18, 'Conteo de góndola')", (galle,))["stock"] == 18, "ajuste de 3 argumentos sigue funcionando (stock 15 → 18)")
ok(root("select motivo_tipo from stock_movimientos where producto_id=%s order by created_at desc limit 1", (galle,)) == "manual", "sin tipo explícito, el ajuste queda como 'manual'")
ok(one("select ajustar_stock(%s, 15, 'Se mojaron tres paquetes', 'merma')", (galle,))["stock"] == 15, "merma de 3 galletitas: stock 18 → 15")
ok(has(fails("select ajustar_stock(%s, 10, 'Tipo que no existe', 'robo')", (galle,)), "tipo_ajuste_invalido"), "un tipo de motivo desconocido se rechaza")
ok(one("select ajustar_stock(%s, 1500, 'Se cayó la bolsa', 'rotura')", (queso,))["stock"] == 1500, "rotura de 500 g de queso")
ok(one("select ajustar_stock(%s, 1, 'Vencido el lunes', 'vencimiento')", (pan,))["stock"] == 1, "vencimiento de 2 panes")
ok(one("select ajustar_stock(%s, 25, 'Conteo de estante', 'conteo_fisico')", (galle,))["stock"] == 25, "conteo físico: 15 → 25")

# ── Reporte: merma 3×500 + rotura 500g×6000/kg + vencimiento 2×200 = 4900 (el conteo no es pérdida) ──
desde_hasta = "now() - interval '1 day', now() + interval '1 day'"
r = one(f"select reporte_mermas(%s, {desde_hasta})", (ka,))
ok(float(r["total_perdida"]) == 4900.0, "total perdido: merma 1500 + rotura 3000 + vencimiento 400 = 4900")
ok({x["motivo"] for x in r["por_motivo"]} == {"merma", "rotura", "vencimiento"}, "el reporte separa por motivo y no suma el conteo ni las cargas")
ok(r["top"][0]["nombre"] == "Queso" and float(r["top"][0]["costo"]) == 3000.0, "top de pérdida: primero el queso (3000)")
ok(next(x for x in r["por_motivo"] if x["motivo"] == "merma")["unidades"] == 3, "merma: 3 unidades")

# ── Período: un movimiento de hace 60 días sale del reporte ──
root("update stock_movimientos set created_at = now() - interval '60 days' where motivo_tipo='rotura'")
r2 = one(f"select reporte_mermas(%s, {desde_hasta})", (ka,))
ok(float(r2["total_perdida"]) == 1900.0, "fuera del período no suma: total 1900 sin la rotura")

# ── Permisos ──
as_("authenticated", B)
ok(has(fails(f"select reporte_mermas(%s, {desde_hasta})", (ka,)), "no_autorizado"), "otro dueño no ve las mermas de mi kiosco")
ok(has(fails("select ajustar_stock(%s, 1, 'Intento de otro dueño', 'merma')", (galle,)), "no_autorizado"), "otro dueño no puede ajustar mi stock")
as_("anon")
ok(bool(fails(f"select reporte_mermas(%s, {desde_hasta})", (ka,))), "anon no ejecuta el reporte")
as_("authenticated", A)

print("\nRESULTADO: " + ("OK" if not bad else f"{bad} FALLAS"))
sys.exit(1 if bad else 0)
