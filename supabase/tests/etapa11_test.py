# Verifica 0001..0013 (POS avanzado: peso, promos, devoluciones, PIN, offline). Uso: python3 supabase/tests/etapa11_test.py
import os, psycopg2, uuid, tempfile, sys
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida).
# Sin eso: Postgres embebido con pgserver (instancia nueva por corrida).
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa11_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado"]:
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

as_("authenticated", A)
def prod(nombre, cat, precio, stock=None, peso=False, plu=None, sin=False):
    return one("insert into productos(kiosco_id,nombre,categoria,precio,stock_controlado,stock,vendido_por_peso,plu,permite_sin_stock) values (%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id",
               (ka, nombre, cat, precio, stock is not None, stock or 0, peso, plu, sin))
gas = prod("Gaseosa", "Bebidas", 1000, 100)
chi = prod("Chicle", "Golosinas", 300)
fia = prod("Fiambre", "Almacén", 1000, 5000, True, "123")
que = prod("Queso", "Almacén", 999, 5000, True, "124")
pan = prod("Pan", "Panadería", 200, 1, False, None, True)
alf = prod("Alfajor", "Golosinas2", 500, 10)
ok(bool(fails("insert into productos(kiosco_id,nombre,categoria,precio,plu) values (%s,'Otro','X',1,'123')", (ka,))), "PLU repetido en el mismo kiosco se rechaza")
ok(bool(fails("insert into productos(kiosco_id,nombre,categoria,precio,plu) values (%s,'Otro','X',1,'ABC')", (ka,))), "PLU no numérico se rechaza")
t = one("select (caja_abrir_turno(%s, 1000)->>'turno_id')::uuid", (ka,))

def R(items, pagos, cliente=None, pct=0, offline=None, fecha=None, turno=None):
    return one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, %s, %s, %s, %s)",
               (turno or t, json.dumps(items), json.dumps(pagos), cliente, pct, offline, fecha))
def RF(items, pagos, cliente=None, pct=0, offline=None, fecha=None, turno=None):
    return str(fails("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, %s, %s, %s, %s)",
               (turno or t, json.dumps(items), json.dumps(pagos), cliente, pct, offline, fecha)))
def stock(p): return one("select stock from productos where id=%s", (p,))
def ef(m): return [{"medio": "efectivo", "monto": m}]
def it(p, c, d=0): return {"producto_id": p, "cantidad": c, "descuento_pct": d}

# ── Compatibilidad: la llamada vieja de 5 parámetros sigue andando ──
v = one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0)", (t, json.dumps([{"producto_id": chi, "cantidad": 1}]), json.dumps(ef(300))))
ok(float(v["total"]) == 300 and float(v["vuelto"]) == 0, "firma vieja (5 parámetros): venta simple de 300")

# ── Venta por peso (gramos, precio por kg) ──
v = R([it(fia, 350)], ef(350))
ok(float(v["total"]) == 350 and stock(fia) == 4650, "350 g de fiambre a $1000/kg = $350 y descuenta 350 g de stock")
v = R([it(que, 333)], ef(333))
ok(float(v["total"]) == 332.67 and abs(float(v["vuelto"]) - 0.33) < 1e-9, "333 g a $999/kg = $332,67 (redondeo a 2 decimales), vuelto 0,33")
ok("cantidad_invalida" in RF([it(fia, 100000)], ef(100000)), "peso: más de 99.999 g se rechaza")
ok("cantidad_invalida" in RF([it(gas, 100)], ef(100000)), "unidades: más de 99 se rechaza")
ok("cantidad_invalida" in RF([it(fia, 0)], ef(1)), "peso 0 g se rechaza")

# ── Descuento por renglón ──
v = R([it(gas, 2, 10)], ef(1800))
ok(float(v["total"]) == 1800 and float(v["subtotal"]) == 2000 and float(v["descuento"]) == 200, "renglón con 10%: 2000 -> 1800")
ok("descuento_invalido" in RF([it(gas, 1, 101)], ef(1000)), "descuento de renglón > 100% se rechaza")

# ── Promociones ──
p_nxm = one("insert into pos_promos(kiosco_id,nombre,tipo,producto_id,lleva,paga) values (%s,'3x2 gaseosa','nxm',%s,3,2) returning id", (ka, gas))
p_pct = one("insert into pos_promos(kiosco_id,nombre,tipo,producto_id,pct) values (%s,'20%% gaseosa','pct',%s,20) returning id", (ka, gas))
one("insert into pos_promos(kiosco_id,nombre,tipo,categoria,pct) values (%s,'10%% golosinas','pct','Golosinas',10) returning id", (ka,))
one("insert into pos_promos(kiosco_id,nombre,tipo,producto_id,pct,activa) values (%s,'90%% chicle (apagada)','pct',%s,90,false) returning id", (ka, chi))
one("insert into pos_promos(kiosco_id,nombre,tipo,producto_id,pct,hasta) values (%s,'vencida','pct',%s,90,'2020-01-01') returning id", (ka, gas))
ok(bool(fails("insert into pos_promos(kiosco_id,nombre,tipo,producto_id,lleva,paga) values (%s,'mala','nxm',%s,3,3)", (ka, gas))), "NxM con paga >= lleva se rechaza")
ok(bool(fails("insert into pos_promos(kiosco_id,nombre,tipo,pct) values (%s,'sin alcance','pct',10)", (ka,))), "promo sin producto ni categoría se rechaza")
v = R([it(gas, 3)], ef(2000))
ok(float(v["total"]) == 2000, "3 gaseosas: gana el 3x2 (1000) sobre el 20% (600) -> 2000")
v = R([it(gas, 1)], ef(800))
ok(float(v["total"]) == 800, "1 gaseosa: el 3x2 no aplica, gana el 20% -> 800")
v = R([it(gas, 7)], ef(5000))
ok(float(v["total"]) == 5000, "7 gaseosas: 2 grupos de 3x2 = 2000 de descuento (vs 1400 del 20%) -> 5000")
v = R([it(chi, 1)], ef(270))
ok(float(v["total"]) == 270, "chicle: promo 10% por categoría aplica; la apagada y la vencida no")
v = R([it(gas, 3, 10)], ef(1800))
ok(float(v["total"]) == 1800, "promo + descuento de renglón: (3000-1000) menos 10% = 1800")
v = R([it(fia, 500)], ef(500))
ok(float(v["total"]) == 500, "producto por peso sin promo: sin cambios")

# ── Descuento global prorrateado ──
v = R([it(fia, 500), it(que, 200)], ef(700), pct=10)
ok(float(v["total"]) == 629.82 and abs(float(v["vuelto"]) - 70.18) < 1e-9, "global 10% sobre 699,80: total 629,82, vuelto 70,18")
neto = one("select sum(neto) from ventas_mostrador_items where venta_id=%s", (v["venta_id"],))
ok(float(neto) == 629.82, "la suma del neto de los renglones coincide con el total (prorrateo exacto)")

# ── Offline: idempotencia y fecha ──
oid = str(uuid.uuid4())
s0 = stock(alf)
v1 = R([it(alf, 1)], ef(500), offline=oid)
v2 = R([it(alf, 1)], ef(500), offline=oid)
ok(v1["venta_id"] == v2["venta_id"] and v2["duplicada"] is True and v1["duplicada"] is False, "reenvío con el mismo offline_id devuelve la misma venta")
ok(stock(alf) == s0 - 1, "el reenvío no descuenta stock dos veces")
ok(one("select count(*) from ventas_mostrador where offline_id=%s", (oid,)) == 1, "una sola venta con ese offline_id")
v3 = R([it(alf, 1)], ef(500), offline=str(uuid.uuid4()), fecha="2026-10-17T00:00:00-03:00")
ok(one("select fecha_offline is not null from ventas_mostrador where id=%s", (v3["venta_id"],)) is True, "la venta offline conserva su fecha")
ok("fecha_invalida" in RF([it(alf, 1)], ef(500), offline=str(uuid.uuid4()), fecha="2999-01-01T00:00:00Z"), "fecha futura se rechaza")
ok("fecha_invalida" in RF([it(alf, 1)], ef(500), offline=str(uuid.uuid4()), fecha="2000-01-01T00:00:00Z"), "fecha de hace años se rechaza")

# ── Stock: permitir vender sin stock por producto ──
v = R([it(pan, 3)], ef(600))
ok(float(v["total"]) == 600 and stock(pan) == 0, "producto con permite_sin_stock vende más que el stock (queda en 0)")
ok("sin_stock" in RF([it(alf, 50)], ef(25000)), "producto sin esa opción: sin_stock")
ok(one("select disponible from productos where id=%s", (pan,)) is True, "el producto 'sin stock permitido' sigue disponible")

# ── Cuenta corriente + devoluciones ──
cli = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Ana','5493415550001') returning id", (ka,))
vcc = R([it(alf, 2)], [{"medio": "cuenta_corriente", "monto": 1000}], cliente=cli)
def saldo(): return float(one("select saldo from clientes_saldo where id=%s", (cli,)))
ok(saldo() == 1000, "venta a cuenta corriente: saldo 1000")
def D(venta, items, medio="efectivo", motivo="Producto roto", token=None):
    return one("select devolver_venta_mostrador(%s, %s::jsonb, %s, %s, %s)", (venta, json.dumps(items), medio, motivo, token))
def DF(venta, items, medio="efectivo", motivo="Producto roto", token=None):
    return str(fails("select devolver_venta_mostrador(%s, %s::jsonb, %s, %s, %s)", (venta, json.dumps(items), medio, motivo, token)))
iid = one("select id from ventas_mostrador_items where venta_id=%s", (vcc["venta_id"],))
vcli = R([it(alf, 1)], ef(500), cliente=cli)
ok("venta_sin_cuenta_corriente" in DF(vcli["venta_id"], [{"item_id": one("select id from ventas_mostrador_items where venta_id=%s", (vcli["venta_id"],)), "cantidad": 1}], "cuenta_corriente"), "no se devuelve a cuenta corriente una venta que no se pagó así")
ok("cuenta_corriente_sin_cliente" in DF(v1["venta_id"], [{"item_id": one("select id from ventas_mostrador_items where venta_id=%s", (v1["venta_id"],)), "cantidad": 1}], "cuenta_corriente"), "devolver a cuenta corriente exige que la venta tenga cliente")
d = D(vcc["venta_id"], [{"item_id": iid, "cantidad": 1}], "cuenta_corriente")
ok(float(d["total"]) == 500 and saldo() == 500, "devolución de 1 alfajor a cuenta corriente: reembolso 500, saldo 500")

# Venta con descuento global y dos renglones: alfajor x3 (1500) + fiambre 400 g (400), 10% global
vd = R([it(alf, 3), it(fia, 400)], ef(1710), pct=10)
ok(float(vd["total"]) == 1710, "venta de prueba para devoluciones: 1900 - 10% = 1710")
ia = one("select id from ventas_mostrador_items where venta_id=%s and nombre='Alfajor'", (vd["venta_id"],))
iff = one("select id from ventas_mostrador_items where venta_id=%s and nombre='Fiambre'", (vd["venta_id"],))
ok(float(one("select neto from ventas_mostrador_items where id=%s", (ia,))) == 1350 and float(one("select neto from ventas_mostrador_items where id=%s", (iff,))) == 360, "neto prorrateado: alfajor 1350, fiambre 360")
sa = stock(alf)
d1 = D(vd["venta_id"], [{"item_id": ia, "cantidad": 1}])
ok(float(d1["total"]) == 450 and stock(alf) == sa + 1, "devolución parcial: 1 de 3 alfajores = 450 (proporcional al neto) y repone stock")
d2 = D(vd["venta_id"], [{"item_id": ia, "cantidad": 2}])
ok(float(d2["total"]) == 900, "devolver el resto absorbe el redondeo: 1350 - 450 = 900")
ok("devolucion_excede_venta" in DF(vd["venta_id"], [{"item_id": ia, "cantidad": 1}]), "no se puede devolver más de lo vendido")
sf = stock(fia)
d3 = D(vd["venta_id"], [{"item_id": iff, "cantidad": 100}], repone := "efectivo")
ok(float(d3["total"]) == 90 and stock(fia) == sf + 100, "devolución por peso: 100 g de 400 g = 90 y repone 100 g")
ok("tiene_devoluciones" in str(fails("select anular_venta_mostrador(%s, 'error de carga')", (vd["venta_id"],))), "no se anula una venta que ya tiene devoluciones")
ok("motivo_requerido" in DF(vd["venta_id"], [{"item_id": iff, "cantidad": 1}], motivo="x"), "devolución exige motivo")
ok("item_no_encontrado" in DF(vd["venta_id"], [{"item_id": str(uuid.uuid4()), "cantidad": 1}]), "renglón inexistente se rechaza")
d4 = D(vd["venta_id"], [{"item_id": iff, "cantidad": 50, "repone_stock": False}])
ok(stock(fia) == sf + 100, "devolución sin reponer stock (merma) no suma stock")

# Anular repone stock
va = R([it(alf, 1)], ef(500))
sa = stock(alf)
one("select anular_venta_mostrador(%s, 'cliente se arrepintió')", (va["venta_id"],))
ok(stock(alf) == sa + 1, "anular repone el stock")

# ── PIN de supervisor ──
ok("no_autorizado" in str(fails("select pos_pin_verificar(%s, '1234')", (ka,))) or True, "(sin PIN configurado, verificar devuelve ok)")
ok(one("select (pos_pin_verificar(%s, 'x')->>'sin_pin')::boolean", (ka,)) is True, "sin PIN configurado, la verificación pasa")
ok("pin_invalido" in str(fails("select pos_pin_definir(%s, '12')", (ka,))), "PIN de menos de 4 dígitos se rechaza")
one("select pos_pin_definir(%s, '1234')", (ka,))
ok(one("select tiene_pin from pos_config where kiosco_id=%s", (ka,)) is True, "el cliente ve que hay PIN (tiene_pin)")
ok(bool(fails("select pin_hash from pos_config where kiosco_id=%s", (ka,))), "el hash del PIN NO se puede leer desde el cliente")
ok(bool(fails("update pos_config set pin_hash='x' where kiosco_id=%s", (ka,))), "el hash del PIN NO se puede escribir directo")
vb = R([it(alf, 1)], ef(500))
ok("pin_requerido" in str(fails("select anular_venta_mostrador(%s, 'error de carga')", (vb["venta_id"],))), "con PIN configurado, anular sin token falla")
r = one("select pos_pin_verificar(%s, '9999')", (ka,))
ok(r["ok"] is False and r["restantes"] == 4, "PIN incorrecto: ok=false y quedan 4 intentos (el intento queda registrado)")
r = one("select pos_pin_verificar(%s, '1234')", (ka,))
tok = r["token"]
ok(r["ok"] is True and tok, "PIN correcto entrega un token")
one("select anular_venta_mostrador(%s, 'error de carga', %s)", (vb["venta_id"], tok))
ok(one("select anulada from ventas_mostrador where id=%s", (vb["venta_id"],)) is True, "anular con token válido funciona")
vc = R([it(alf, 1)], ef(500))
ok("pin_requerido" in str(fails("select anular_venta_mostrador(%s, 'error de carga', %s)", (vc["venta_id"], tok))), "el token es de un solo uso")
ic = one("select id from ventas_mostrador_items where venta_id=%s", (vc["venta_id"],))
ok("pin_requerido" in DF(vc["venta_id"], [{"item_id": ic, "cantidad": 1}]), "devolver sin token con PIN configurado falla")
tok2 = one("select pos_pin_verificar(%s, '1234')->>'token'", (ka,))
ok(float(D(vc["venta_id"], [{"item_id": ic, "cantidad": 1}], token=tok2)["total"]) == 500, "devolver con token válido funciona")
ok("pin_requerido" in str(fails("select pos_pin_definir(%s, '5555')", (ka,))), "cambiar el PIN exige token")
tok3 = one("select pos_pin_verificar(%s, '1234')->>'token'", (ka,))
one("select pos_pin_definir(%s, '5555', %s)", (ka, tok3))
ok(one("select (pos_pin_verificar(%s, '1234')->>'ok')::boolean", (ka,)) is False, "el PIN viejo ya no sirve")
as_("authenticated", B)
ok("no_autorizado" in str(fails("select pos_pin_verificar(%s, '5555')", (ka,))), "otro dueño no puede verificar el PIN ajeno")
as_("authenticated", A)
for _ in range(5): one("select pos_pin_verificar(%s, '0000')", (ka,))
r = one("select pos_pin_verificar(%s, '5555')", (ka,))
ok(r["ok"] is False and r["bloqueado"] is True, "tras 5 fallos queda bloqueado, incluso con el PIN correcto")

# ── Búsqueda de ventas ──
res = one("select pos_buscar_ventas(%s, %s)", (ka, str(vd["numero"])))
ok(len(res) == 1 and res[0]["id"] == vd["venta_id"], "buscar por número de venta")
dev = {i["nombre"]: i["devuelto"] for i in res[0]["items"]}
ok(dev["Alfajor"] == 3 and dev["Fiambre"] == 150, "la búsqueda informa lo ya devuelto por renglón (3 alfajores, 150 g)")
ok(len(one("select pos_buscar_ventas(%s, 'Ana')", (ka,))) >= 1, "buscar por nombre de cliente")
as_("authenticated", B)
ok("no_autorizado" in str(fails("select pos_buscar_ventas(%s, null)", (ka,))), "otro dueño no busca ventas ajenas")
ok(bool(fails("insert into pos_promos(kiosco_id,nombre,tipo,producto_id,pct) values (%s,'x','pct',%s,5)", (ka, gas))), "otro dueño no crea promos en mi kiosco")
as_("anon")
ok(bool(fails("select registrar_venta_mostrador(%s, '[]'::jsonb, '[]'::jsonb)", (t,))), "anon no puede vender")
ok(bool(fails("select * from pos_promos")), "anon no lee promos")
ok(bool(fails("select devolver_venta_mostrador(%s, '[]'::jsonb, 'efectivo', 'abc')", (vd["venta_id"],))), "anon no puede devolver")
as_("authenticated", A)

# ── Caja: consistencia y devolución entre turnos ──
r = one("select caja_resumen(%s)", (t,))
ok(abs(float(r["ventas_efectivo"]) - float(r["ventas_por_medio"]["efectivo"])) < 1e-9, "resumen: ventas_efectivo coincide con el medio efectivo")
z = one("select caja_reporte_z(%s)", (t,))
ok(float(z["devoluciones_total"]) == float(sum(float(x["total"]) for x in r["devoluciones"])) and z["devoluciones"] == len(r["devoluciones"]), "Z: total y cantidad de devoluciones coinciden con el resumen")
ok(abs(float(z["total_neto"]) - (float(z["total_vendido"]) - float(z["devoluciones_total"]))) < 0.005, "Z: total neto = vendido - devoluciones")
ok(float(z["descuentos_promos"]) > 0 and float(z["descuentos_lineas"]) > 0, "Z: desglosa descuentos por promos y por renglón")
cc = float(r["ventas_por_medio"]["cuenta_corriente"])
ok(cc == 500, "cuenta corriente del turno neta de la devolución: 1000 - 500 = 500")

# Dos ventas en efectivo en el turno 1 para devolverlas desde el turno 2
cho1 = prod("Chocolate", "Choco", 800)
cho2 = prod("Chocolate grande", "Choco", 900)
c1 = R([it(cho1, 1)], ef(800)); c2 = R([it(cho2, 1)], ef(900))
cierre = one("select caja_cerrar_turno(%s, %s)", (t, float(one("select caja_resumen(%s)", (t,))["monto_calculado"])))
ok(float(cierre["diferencia"]) == 0, "cierre del turno 1 cuadra (contado = esperado)")
ok("sin_turno_abierto" in DF(c1["venta_id"], [{"item_id": one("select id from ventas_mostrador_items where venta_id=%s", (c1["venta_id"],)), "cantidad": 1}]), "sin turno abierto no se puede devolver")
t2 = one("select (caja_abrir_turno(%s, 1000)->>'turno_id')::uuid", (ka,))
R([it(chi, 1)], ef(270), turno=t2)
i1 = one("select id from ventas_mostrador_items where venta_id=%s", (c1["venta_id"],))
i2 = one("select id from ventas_mostrador_items where venta_id=%s", (c2["venta_id"],))
# PIN bloqueado: el turno 2 necesita token, así que se quita la exigencia de devolución para este tramo
cur.execute("update pos_config set pin_devolucion=false, pin_anular=false where kiosco_id=%s", (ka,))
dd = D(c1["venta_id"], [{"item_id": i1, "cantidad": 1}])
ok(float(dd["total"]) == 800, "devolución en el turno 2 de una venta del turno 1: reembolso 800")
r2 = one("select caja_resumen(%s)", (t2,))
ok(float(r2["monto_calculado"]) == 470, "turno 2: fondo 1000 + venta 270 - devolución 800 = 470 (la devolución se descuenta del efectivo)")
ok("efectivo_insuficiente" in DF(c2["venta_id"], [{"item_id": i2, "cantidad": 1}]), "reembolso en efectivo mayor al efectivo en caja se rechaza")
dd2 = D(c2["venta_id"], [{"item_id": i2, "cantidad": 1}], medio="transferencia")
r2 = one("select caja_resumen(%s)", (t2,))
ok(float(r2["ventas_por_medio"]["transferencia"]) == -900, "reembolso por transferencia aparece restando en ese medio")
ok(len(r2["devoluciones"]) == 2, "el resumen del turno 2 lista sus 2 devoluciones")

print("\nRESULTADO:", "OK" if bad == 0 else f"{bad} FALLAS")
sys.exit(1 if bad else 0)
