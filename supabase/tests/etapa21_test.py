# Verifica 0024, 0025 y 0026 (clientes en fuga, avisos "avisame cuando", lotes FEFO y aviso semanal de fuga). Uso: python3 supabase/tests/etapa21_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
from datetime import timedelta
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa21_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras", "0016_etiquetas", "0017_fidelidad", "0018_reposicion", "0019_motivos_mermas", "0020_historial_stock", "0021_conteo_planilla", "0022_margen_precios", "0023_fase3_abc_fiado", "0024_endurecer_funciones", "0025_fuga_reglas_lotes", "0026_fuga_semanal"]:
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
t = one("select (caja_abrir_turno(%s, 1000)->>'turno_id')::uuid", (ka,))
def prod(nombre, precio, controlado=True, stock=0):
    return one("insert into productos(kiosco_id,nombre,precio,stock_controlado,stock) values (%s,%s,%s,%s,%s) returning id", (ka, nombre, precio, controlado, stock))
def venta(cliente, total, dias_atras=0, hora=12):
    """Venta a mostrador del kiosco A, fechada 'dias_atras' días atrás a las 'hora' (hora local)."""
    items = [{"producto_id": str(prod_fuga), "cantidad": 1}]
    v = one("select (registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, %s, 0)->>'venta_id')::uuid",
            (t, json.dumps(items), json.dumps([{"medio": "efectivo", "monto": total}]), cliente))
    root("update ventas_mostrador set created_at = (((now() at time zone 'America/Argentina/Buenos_Aires')::date - %s)::timestamp + make_interval(hours => %s)) at time zone 'America/Argentina/Buenos_Aires' where id = %s", (dias_atras, hora, v))
    return v

prod_fuga = prod("Producto de venta", 1000, stock=500)
pedro = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Pedro Sosa','5493415550001') returning id", (ka,))
rosa = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Rosa Benitez','5493415550002') returning id", (ka,))
julian = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Julian Torres','5493415550003') returning id", (ka,))
for _ in range(4): venta(pedro, 1000, dias_atras=60)
venta(rosa, 1000, dias_atras=60)
for _ in range(3): venta(julian, 1000, dias_atras=10)
venta(None, 1000, dias_atras=60)

# ---- 1) Clientes en fuga
fuga = [r["nombre"] for r in rows("select * from clientes_en_fuga(%s, 45, 3)", (ka,))]
ok(fuga == ["Pedro Sosa"], f"clientes en fuga: solo Pedro (3+ compras, 45+ días sin comprar): {fuga}")
ok(fails("select * from clientes_en_fuga(%s)", (ka,)) is False, "el dueño puede consultar sus clientes en fuga")
as_("authenticated", B)
ok(has(fails("select * from clientes_en_fuga(%s)", (ka,)), "no_autorizado"), "otro kiosco no puede ver clientes en fuga ajenos")
ok(has(fails("select * from clientes_en_fuga(%s, 2)", (kb,)), "dias_invalidos"), "días fuera de rango se rechazan")
as_("authenticated", A)
ok(has(fails("select * from clientes_en_fuga(%s, 45, 0)", (ka,)), "minimo_compras_invalido"), "mínimo de compras inválido se rechaza")

# ---- 1b) Aviso semanal de fuga (0026): solo el cron, una vez por kiosco y semana
as_("authenticated", A)
ok(has(fails("select * from fuga_conteo_semanal()"), "permission denied"), "el dueño no puede ejecutar el conteo semanal (solo el cron)")
ok(has(fails("select * from fuga_avisos_semanales()"), "permission denied"), "el dueño no puede ejecutar los avisos semanales (solo el cron)")
cur.execute("reset role")
cont = {str(r["kiosco"]): r["clientes"] for r in rows("select * from fuga_conteo_semanal()")}
ok(cont.get(str(ka)) == 1 and str(kb) not in cont, f"el conteo semanal cuenta 1 cliente en fuga en A y nada en B: {cont}")
av1 = [r for r in rows("select * from fuga_avisos_semanales()") if str(r["kiosco"]) == str(ka)]
av2 = [r for r in rows("select * from fuga_avisos_semanales()") if str(r["kiosco"]) == str(ka)]
ok(len(av1) == 1 and av1[0]["clientes"] == 1 and av2 == [], f"el aviso de fuga no se repite en la misma semana (idempotente): {av1} / {av2}")
as_("authenticated", A)

# ---- 2) Avisos "avisame cuando"
r_venta = one("select regla_crear(%s, 'venta_supera', 3000)", (ka,))
ok(r_venta is not None, "regla venta_supera creada")
ok(has(fails("select regla_crear(%s, 'otro_tipo', 10)", (ka,)), "tipo_regla_invalido"), "tipo de regla desconocido se rechaza")
ok(has(fails("select regla_crear(%s, 'stock_bajo_de', 0)", (ka,)), "umbral_invalido"), "umbral 0 se rechaza")
as_("authenticated", B)
ok(rows("select id from avisos_reglas where kiosco_id = %s", (ka,)) == [], "otro kiosco no ve reglas ajenas")
as_("authenticated", A)
# Ayer: 4 ventas de 1000 = 4000 > 3000 -> dispara
for _ in range(3): venta(None, 1000, dias_atras=1, hora=10)
venta(None, 1000, dias_atras=1, hora=18)
disparos = rows("select * from reglas_avisos_diarios()")
mios = [d for d in disparos if str(d["kiosco"]) == str(ka)]
ok(len(mios) == 1 and "Ayer vendiste" in mios[0]["mensaje"], f"venta de ayer por encima del umbral dispara un aviso: {mios}")
repetido = [d for d in rows("select * from reglas_avisos_diarios()") if str(d["kiosco"]) == str(ka) and "Ayer vendiste" in d["mensaje"]]
ok(repetido == [], "el aviso de venta no se repite el mismo día (idempotente)")

# Fiado por encima del umbral: dispara una vez por semana
r_fiado = one("select regla_crear(%s, 'fiado_supera', 500)", (ka,))
root("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto) values (%s,%s,'fiado',800)", (ka, rosa))
root("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto) values (%s,%s,'pago',100)", (ka, rosa))
fiado_1 = [d for d in rows("select * from reglas_avisos_diarios()") if str(d["kiosco"]) == str(ka) and "fiado" in d["mensaje"]]
ok(len(fiado_1) == 1, f"fiado adeudado (700) por encima de 500 dispara: {fiado_1}")
fiado_2 = [d for d in rows("select * from reglas_avisos_diarios()") if str(d["kiosco"]) == str(ka) and "fiado" in d["mensaje"]]
ok(fiado_2 == [], "el aviso de fiado no se repite en la semana")
ok(has(fails("insert into avisos_reglas(kiosco_id,tipo,umbral) values (%s,'cualquiera',5)", (ka,)), "check"), "la base rechaza tipos de regla no previstos")

# ---- 3) Lotes con vencimiento (FEFO virtual)
yog = prod("Yogur", 1200, stock=30)
hoy = root("select (now() at time zone 'America/Argentina/Buenos_Aires')::date")
l_pronto = one("select lote_registrar(%s, 10, %s)", (yog, hoy + timedelta(days=3)))
l_luego = one("select lote_registrar(%s, 15, %s)", (yog, hoy + timedelta(days=60)))
rep = rows("select * from lotes_repartir(%s) order by vence nulls last", (yog,))
por_id = {str(r["lote_id"]): r for r in rep if r["lote_id"]}
ok(por_id[str(l_luego)]["en_stock"] == 15 and por_id[str(l_luego)]["estado"] == "vigente", "FEFO: el lote que vence más tarde absorbe primero el stock")
ok(por_id[str(l_pronto)]["en_stock"] == 10 and por_id[str(l_pronto)]["estado"] == "por_vencer", "lote a 3 días figura como por vencer")
sin_fecha = [r for r in rep if r["lote_id"] is None]
ok(len(sin_fecha) == 1 and sin_fecha[0]["en_stock"] == 5, f"el stock sin lote queda como 'sin fecha': {sin_fecha}")
ok(has(fails("select lote_registrar(%s, 40, %s)", (yog, hoy + timedelta(days=5))), "lote_mayor_al_stock"), "un lote mayor al stock se rechaza")
sin_control = prod("Sin control", 100, controlado=False)
ok(has(fails("select lote_registrar(%s, 5, %s)", (sin_control, hoy + timedelta(days=5))), "stock_no_controlado"), "lote en producto sin control de stock se rechaza")
ok(has(fails("select lote_dar_de_baja(%s, 2)", (l_luego,)), "baja_fuera_de_orden"), "no se puede dar de baja un lote que no vence primero")
# Ajuste de stock a 12 unidades: el lote de 3 días ya no tiene nada en stock
root("select ajustar_stock(%s, 12, 'Conteo de prueba', 'conteo_fisico')", (yog,))
rep2 = {str(r["lote_id"]): r for r in rows("select * from lotes_repartir(%s)", (yog,)) if r["lote_id"]}
ok(rep2[str(l_pronto)]["en_stock"] == 0 and rep2[str(l_pronto)]["estado"] == "consumido", "con menos stock, el lote que vence primero figura como consumido")
ok(has(fails("select lote_dar_de_baja(%s, 2)", (l_pronto,)), "baja_fuera_de_orden"), "no se puede dar de baja un lote sin unidades en stock")
antes = one("select precio from productos where id=%s", (yog,))
res = one("select lote_dar_de_baja(%s, 4)", (l_luego,))
ok(res["dado_de_baja"] == 4 and res["stock"] == 8, f"baja por vencimiento descuenta del stock: {res}")
mov = rows("select tipo, motivo_tipo, cantidad from stock_movimientos where producto_id=%s order by created_at desc limit 1", (yog,))[0]
ok(mov["motivo_tipo"] == "vencimiento" and mov["cantidad"] == -4, f"la baja queda registrada como ajuste con motivo vencimiento: {mov}")
ok(one("select precio from productos where id=%s", (yog,)) == antes, "ninguna operación de lotes cambia el precio")
as_("authenticated", B)
ok(rows("select id from lotes_stock where kiosco_id=%s", (ka,)) == [], "otro kiosco no ve lotes ajenos")
ok(has(fails("select lote_dar_de_baja(%s, 1)", (l_luego,)), "no_autorizado"), "otro kiosco no puede dar de baja lotes ajenos")
as_("authenticated", A)
as_("authenticated", A)
ok(fails("select lote_cerrar(%s)", (l_pronto,)) is False, "el dueño puede cerrar un lote")
rep3 = [r for r in rows("select * from lotes_repartir(%s)", (yog,)) if r["lote_id"] == l_pronto]
ok(rep3 == [], "un lote cerrado deja de aparecer en el reparto")

cur.execute("rollback")
print("TODO OK" if bad == 0 else f"{bad} FALLAS")
