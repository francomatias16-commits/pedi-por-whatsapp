# Verifica 0001..0010 en Postgres embebido (caja diaria). Uso: python3 supabase/tests/etapa9_test.py
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
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid(), created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
create publication supabase_realtime;
""")
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja"]:
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
def root(sql, args=None): cur.execute("reset role"); cur.execute(sql, args); return cur.fetchone()[0] if cur.description else None

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','kiosco-a','5493415551234',true) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))

def pedido(kiosco, total, medio, estado="pendiente", fiado=False):
    cur.execute("reset role")
    cur.execute("insert into pedidos(kiosco_id,cliente_nombre,cliente_telefono,modalidad,total,medio_pago,estado) values (%s,'Cli','5493415550001','retiro',%s,%s,'pendiente') returning id", (kiosco, total, medio))
    pid = cur.fetchone()[0]
    if estado != "pendiente":
        cur.execute("update pedidos set estado=%s where id=%s", (estado, pid))
    return pid

# Pedido en efectivo entregado ANTES de abrir la caja: no debe contar
pre = pedido(ka, 900, "efectivo", "entregado")

as_("anon")
ok(bool(fails("select caja_abrir_turno(%s, 1000)", (ka,))), "anon no puede abrir caja")

as_("authenticated", B)
ok(bool(fails("select caja_abrir_turno(%s, 1000)", (ka,))), "otro dueño no puede abrir caja del kiosco ajeno")

as_("authenticated", A)
t = one("select (caja_abrir_turno(%s, 1000)->>'turno_id')::uuid", (ka,))
ok(t is not None, "el dueño abre la caja con fondo 1000")
ok(bool(fails("select caja_abrir_turno(%s, 500)", (ka,))), "no se puede abrir un segundo turno abierto")

# Cobros durante el turno
e1 = pedido(ka, 1500, "efectivo", "entregado")
pedido(ka, 2000, "transferencia", "entregado")            # no es efectivo
pedido(ka, 800, "efectivo", "pendiente")                  # no entregado
f1 = pedido(ka, 700, "efectivo", "entregado")             # se anota en fiado: no entra en caja
cur.execute("reset role")
cur.execute("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Fiador','5493415550009') returning id", (ka,))
cli = cur.fetchone()[0]
cur.execute("update pedidos set cliente_id=%s where id=%s", (cli, f1))
cur.execute("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto,pedido_id) values (%s,%s,'fiado',700,%s)", (ka, cli, f1))
as_("authenticated", A)

r = root("select caja_resumen(%s)", (t,))
ok(float(r["ventas_efectivo"]) == 1500.0, "solo cuenta el efectivo entregado durante el turno (1500)")
ok(float(r["monto_calculado"]) == 2500.0, "monto calculado = fondo + efectivo (2500)")

# Movimientos manuales
ok(not fails("select caja_registrar_movimiento(%s, 'refuerzo', 200, 'cambio')", (t,)), "refuerzo registrado")
ok(not fails("select caja_registrar_movimiento(%s, 'sangria', 50, 'compra limpieza')", (t,)), "sangría registrada")
ok(bool(fails("select caja_registrar_movimiento(%s, 'otra', 10, null)", (t,))), "tipo de movimiento inválido se rechaza")
ok(bool(fails("select caja_registrar_movimiento(%s, 'sangria', 0, null)", (t,))), "monto 0 se rechaza")
r = root("select caja_resumen(%s)", (t,))
ok(float(r["neto_movimientos"]) == 150.0, "neto de movimientos = refuerzo - sangría (150)")
ok(float(r["monto_calculado"]) == 2650.0, "monto calculado incluye movimientos (2650)")
ok(len(r["movimientos"]) == 2, "resumen lista los dos movimientos")

as_("authenticated", B)
ok(bool(fails("select caja_registrar_movimiento(%s, 'sangria', 10, null)", (t,))), "otro dueño no puede registrar movimientos en la caja ajena")

as_("authenticated", A)
c = one("select caja_cerrar_turno(%s, 2600)", (t,))
ok(float(c["diferencia"]) == -50.0, "arqueo: declarado 2600 vs calculado 2650 = diferencia -50")
ok(bool(fails("select caja_cerrar_turno(%s, 2650)", (t,))), "no se puede cerrar dos veces")
ok(bool(fails("select caja_registrar_movimiento(%s, 'sangria', 10, null)", (t,))), "no se puede cargar movimientos en un turno cerrado")
e2 = pedido(ka, 300, "efectivo", "entregado")
r = root("select caja_resumen(%s)", (t,))
ok(float(r["ventas_efectivo"]) == 1500.0, "una venta posterior al cierre no altera el turno cerrado")

# Se puede abrir un turno nuevo; el de antes no suma
t2 = one("select (caja_abrir_turno(%s, 500)->>'turno_id')::uuid", (ka,))
r2 = root("select caja_resumen(%s)", (t2,))
ok(float(r2["ventas_efectivo"]) == 0.0, "el turno nuevo arranca sin ventas previas (0)")
ok(float(r2["ventas_efectivo"]) == 0.0 and float(r2["monto_calculado"]) == 500.0, "turno nuevo: monto calculado = fondo (500)")
ok(bool(fails("select caja_resumen(%s)", (t2,))) is False, "el dueño ve su resumen")
as_("authenticated", B)
ok(bool(fails("select caja_resumen(%s)", (t2,))), "otro dueño no ve el resumen de la caja ajena")
as_("anon")
ok(bool(fails("select * from turnos_caja")), "anon no puede leer turnos")
print(f"\nFALLOS: {bad}")
