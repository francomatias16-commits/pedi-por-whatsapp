# Verifica 0029 (cobro online con Mercado Pago: reserva de stock, pago_confirmar idempotente, avisos, permisos).
# Uso: python3 supabase/tests/etapa24_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa24_" + uuid.uuid4().hex[:8]
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
import glob
for f in sorted(glob.glob("supabase/migrations/*.sql")):
    cur.execute(open(f).read())
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
def has(err, texto): return texto in (err or "")
def sin_flag(): cur.execute("select set_config('app.pagos_interno','',true)")  # en producción cada llamada es su propia transacción

# --- datos
as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto,medios_pago) values (%s,'Kiosco A','kiosco-a','5493415551234',true,array['efectivo','mercadopago']) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto,medios_pago) values (%s,'Kiosco B','kiosco-b','5493415559999',true,array['efectivo','mercadopago']) returning id", (B,))
as_("authenticated", A)
prod = {}
for nombre, precio, stock, ctl in [("Alfajor", 500, 10, True), ("Gaseosa", 1500, 5, True), ("Chicle", 100, 0, False), ("Raro", 300, 2, True)]:
    prod[nombre] = one("insert into productos(kiosco_id,nombre,precio,stock,stock_controlado) values (%s,%s,%s,%s,%s) returning id", (ka, nombre, precio, stock, ctl))
as_("postgres")
cur.execute("insert into integraciones_pago(kiosco_id,token_cifrado,webhook_secret_cifrado,token_ultimos4,mp_user_id) values (%s,'v1:a:b:c','v1:d:e:f','1234','999')", (ka,))

def stock(n): return one("select stock from productos where id=%s", (prod[n],))
def disp(n): return one("select disponible from productos where id=%s", (prod[n],))
def ped(pid):
    cur.execute("select estado, pago_estado, stock_reservado, total from pedidos where id=%s", (pid,))
    e, pe, r, t = cur.fetchone(); return {"estado": e, "pago": pe, "res": r, "total": float(t)}
n_tel = [0]
def crear(items, medio="mercadopago", slug="kiosco-a"):
    n_tel[0] += 1
    as_("anon")
    r = one("select crear_pedido(%s,'Ana',%s,'retiro',null,null,%s::jsonb,%s)", (slug, f"54934155520{n_tel[0]:02d}", json.dumps([{"producto_id": prod[k], "cantidad": c} for k, c in items]), medio))
    as_("postgres"); return r
def intento_crear(items, medio="mercadopago"):
    n_tel[0] += 1
    as_("anon")
    e = fails("select crear_pedido('kiosco-a','Ana',%s,'retiro',null,null,%s::jsonb,%s)", (f"54934155520{n_tel[0]:02d}", json.dumps([{"producto_id": prod[k], "cantidad": c} for k, c in items]), medio))
    as_("postgres"); return e
def confirmar(pid, pay, monto, estado="aprobado", moneda="ARS"):
    as_("postgres")
    return one("select pago_confirmar('mercadopago',%s,%s,%s,%s,%s)", (pay, pid, monto, moneda, estado))["resultado"]

# --- sin cobro online activo, mercadopago sigue siendo solo una opción informativa
r = crear([("Alfajor", 1)])
ok(r["pago_online"] is False and ped(r["pedido_id"])["pago"] == "no_aplica" and stock("Alfajor") == 10, "sin cobro online: pedido normal, sin reserva ni estado de pago")
as_("authenticated", A); cur.execute("update kioscos set cobro_online_activo = true where id=%s", (ka,))
as_("postgres")
r = crear([("Alfajor", 1)], "efectivo")
ok(r["pago_online"] is False and ped(r["pedido_id"])["pago"] == "no_aplica", "con cobro online activo: pagar en efectivo sigue siendo un pedido normal")
as_("authenticated", A)
cur.execute("update pedidos set estado='confirmado' where id=%s", (r["pedido_id"],))
ok(stock("Alfajor") == 9, "pedido normal: el stock se descuenta al confirmar (comportamiento anterior)")
cur.execute("update pedidos set estado='cancelado' where id=%s", (r["pedido_id"],))
ok(stock("Alfajor") == 10, "pedido normal: el stock se repone al cancelar")

# --- pedido online: reserva de stock
r1 = crear([("Alfajor", 2), ("Gaseosa", 1), ("Chicle", 3)])
P1 = r1["pedido_id"]
ok(r1["pago_online"] is True and r1["total"] == 2800, "pedido online: total calculado en el servidor")
ok(ped(P1) == {"estado": "pendiente", "pago": "pendiente", "res": True, "total": 2800.0}, "pedido online: nace pendiente, esperando pago y con stock reservado")
ok(stock("Alfajor") == 8 and stock("Gaseosa") == 4, "pedido online: reserva el stock al crearse")
ok(one("select count(*) from stock_movimientos where tipo='pedido' and producto_id=%s and cantidad=-2", (prod["Alfajor"],)) == 1, "pedido online: la reserva queda en el historial de stock")
e = intento_crear([("Alfajor", 9)])
ok(has(e, "sin_stock") and stock("Alfajor") == 8, "pedido online: si no alcanza el stock se rechaza y no queda nada reservado")
ok(one("select count(*) from pedidos where kiosco_id=%s", (ka,)) == 3, "pedido online rechazado: no deja pedido a medias")

# --- permisos
as_("anon")
for sql, args in [("select pago_confirmar('mercadopago','x',%s,1,'ARS','aprobado')", (P1,)), ("select pago_estado_pedido(%s)", (P1,)),
                  ("select webhook_registrar('mercadopago','e1',true,'payment',%s)", (ka,)), ("select webhook_marcar('mercadopago','e1','procesado','x')", None),
                  ("select pago_vencer_pendientes()", None), ("select pago_puede_consultar(%s,10)", (P1,)),
                  ("select * from integraciones_pago", None), ("select * from webhooks_recibidos", None), ("select * from transacciones_pago", None),
                  ("select mp_estado_conexion(%s)", (ka,)), ("select mp_desconectar(%s)", (ka,))]:
    ok(fails(sql, args) is not False, "anon no puede: " + sql.split("(")[0].replace("select * from ", "leer "))
as_("authenticated", A)
for sql, args in [("select pago_confirmar('mercadopago','x',%s,1,'ARS','aprobado')", (P1,)), ("select pago_estado_pedido(%s)", (P1,)),
                  ("select webhook_registrar('mercadopago','e1',true,'payment',%s)", (ka,)), ("select pago_vencer_pendientes()", None),
                  ("select * from integraciones_pago", None), ("select * from webhooks_recibidos", None),
                  ("insert into transacciones_pago(kiosco_id,pedido_id,monto) values (%s,%s,1)", (ka, P1))]:
    ok(fails(sql, args) is not False, "el dueño tampoco puede: " + sql.split("(")[0].replace("select * from ", "leer "))
sin_flag()
ok(has(fails("update pedidos set estado='confirmado' where id=%s", (P1,)), "pago_pendiente"), "el dueño no puede confirmar un pedido que espera su pago")
ok(has(fails("update pedidos set pago_estado='pagado' where id=%s", (P1,)), "pago_protegido"), "el dueño no puede marcar un pedido como pagado")
ok(has(fails("update pedidos set stock_reservado=false where id=%s", (P1,)), "pago_protegido"), "el dueño no puede tocar la reserva de stock")
ok(ped(P1)["pago"] == "pendiente" and stock("Alfajor") == 8, "los intentos del dueño no cambiaron nada")

# --- pago_confirmar
ok(confirmar(P1, "pay-1", 100) == "monto_invalido" and ped(P1)["estado"] == "pendiente", "monto distinto: se rechaza y el pedido sigue esperando")
ok(confirmar(P1, "pay-1", 2800, moneda="USD") == "monto_invalido", "moneda distinta: se rechaza")
ok(one("select detalle from transacciones_pago where payment_id='pay-1'") == "monto_distinto", "monto distinto: queda anotado en la transacción")
ok(confirmar(P1, "pay-1", 2800, "pendiente") == "pendiente" and ped(P1)["estado"] == "pendiente", "pago pendiente en Mercado Pago: el pedido espera")
m0 = one("select count(*) from stock_movimientos")
ok(confirmar(P1, "pay-1", 2800) == "confirmado", "pago aprobado: confirma el pedido")
ok(ped(P1) == {"estado": "confirmado", "pago": "pagado", "res": True, "total": 2800.0}, "pago aprobado: pedido confirmado y pagado")
ok(stock("Alfajor") == 8 and stock("Gaseosa") == 4, "pago aprobado: el stock no se descuenta dos veces")
ok(one("select count(*) from stock_movimientos") == m0, "pago aprobado: no agrega movimientos de stock (ya estaban reservados)")
ok(confirmar(P1, "pay-1", 2800) == "duplicado", "el mismo aviso otra vez: no hace nada (idempotente)")
ok(one("select count(*) from transacciones_pago where payment_id='pay-1'") == 1, "el mismo aviso otra vez: no duplica la transacción")
ok(confirmar(P1, "pay-1b", 2800) == "pago_duplicado", "un segundo pago aprobado del mismo pedido se marca como duplicado")
ok(has(fails("select pago_confirmar('mercadopago','pay-1',%s,2800,'ARS','aprobado')", (crear([("Chicle", 1)])["pedido_id"],)), "pago_invalido"), "un payment_id no puede aplicarse a otro pedido")
as_("postgres")
ok(has(fails("select pago_confirmar('mercadopago','zz',%s,1,'ARS','raro')", (P1,)), "estado_pago_invalido"), "estado de pago desconocido: error")
ok(has(fails("select pago_confirmar('mercadopago','zz',%s,1,'ARS','aprobado')", (str(uuid.uuid4()),)), "pedido_no_encontrado"), "pedido inexistente: error")
rn = crear([("Alfajor", 1)], "efectivo")
ok(confirmar(rn["pedido_id"], "pay-n", 500) == "no_aplica", "pedido que no es de pago online: no aplica")
ok(has(fails("select pago_estado_pedido(%s)", (str(uuid.uuid4()),)), "pedido_no_encontrado"), "estado de un pedido inexistente: error")

# --- rechazo, reintento y varios intentos
r2 = crear([("Gaseosa", 2)]); P2 = r2["pedido_id"]
ok(stock("Gaseosa") == 2, "pedido 2: reservó 2 gaseosas")
ok(confirmar(P2, "pay-2a", 3000, "rechazado") == "rechazado", "pago rechazado: el pedido se cancela")
ok(ped(P2)["estado"] == "cancelado" and ped(P2)["pago"] == "fallido" and stock("Gaseosa") == 4, "pago rechazado: libera el stock")
ok(confirmar(P2, "pay-2b", 3000) == "confirmado", "reintento aprobado después de un rechazo: reabre y confirma el pedido")
ok(ped(P2)["estado"] == "confirmado" and ped(P2)["pago"] == "pagado" and stock("Gaseosa") == 2, "reintento aprobado: vuelve a descontar el stock una sola vez")
r3 = crear([("Alfajor", 1)]); P3 = r3["pedido_id"]
confirmar(P3, "pay-3a", 500, "pendiente")
ok(confirmar(P3, "pay-3b", 500, "rechazado") == "ignorado" and ped(P3)["estado"] == "pendiente", "un intento rechazado con otro en curso: el pedido sigue esperando")
ok(confirmar(P3, "pay-3a", 500) == "confirmado", "el intento en curso se aprueba: pedido confirmado")

# --- reembolso
ok(confirmar(P1, "pay-1", 2800, "reembolsado") == "reembolsado", "reembolso: se registra")
ok(ped(P1)["pago"] == "reembolsado" and ped(P1)["estado"] == "confirmado", "reembolso: el pedido queda marcado como reembolsado y el dueño decide qué hacer")
ok(confirmar(P1, "pay-1", 2800) == "duplicado", "un aviso viejo de aprobado no pisa un reembolso")

# --- el dueño cancela un pedido que esperaba pago
r4 = crear([("Alfajor", 1)]); P4 = r4["pedido_id"]; s0 = stock("Alfajor")
as_("authenticated", A); sin_flag(); cur.execute("update pedidos set estado='cancelado' where id=%s", (P4,))
ok(stock("Alfajor") == s0 + 1, "el dueño cancela un pedido que espera pago: se libera el stock")
ok(confirmar(P4, "pay-4", 500) == "cancelado_con_pago", "pago aprobado de un pedido cancelado por el dueño: se avisa para reembolsar")
ok(ped(P4)["estado"] == "cancelado" and ped(P4)["pago"] == "pagado" and stock("Alfajor") == s0 + 1, "pedido cancelado y pagado: queda cancelado, marcado pagado y el stock sigue libre")

# --- vencimiento
r5 = crear([("Raro", 2)]); P5 = r5["pedido_id"]
ok(stock("Raro") == 0 and disp("Raro") is False, "pedido 5: reservó todo el stock del producto")
cur.execute("update pedidos set created_at = now() - interval '2 hours' where id=%s", (P5,))
ok(one("select pago_vencer_pendientes()")["vencidos"] == [], "vencimiento: un pedido de 2 horas todavía espera")
cur.execute("update pedidos set created_at = now() - interval '4 hours' where id=%s", (P5,))
v = one("select pago_vencer_pendientes()")["vencidos"]
ok(v == [P5], "vencimiento: vence el pedido de más de 3 horas")
ok(ped(P5)["estado"] == "cancelado" and ped(P5)["pago"] == "fallido" and stock("Raro") == 2 and disp("Raro") is True, "vencimiento: libera el stock y el producto vuelve a estar disponible")
ok(one("select count(*) from transacciones_pago where pedido_id=%s and estado='pendiente'", (P5,)) == 0, "vencimiento: no quedan transacciones pendientes")
r6 = crear([("Raro", 2)]); P6 = r6["pedido_id"]
ok(confirmar(P5, "pay-5", 600) == "cancelado_con_pago" and ped(P5)["pago"] == "pagado" and stock("Raro") == 0, "pago tardío sin stock: no se confirma, se avisa para reembolsar y no se pisa la reserva de otro")
ok(ped(P6)["estado"] == "pendiente" and ped(P6)["pago"] == "pendiente", "el otro pedido conserva su reserva")
r7 = crear([("Chicle", 1)]); P7 = r7["pedido_id"]
cur.execute("update pedidos set created_at = now() - interval '4 hours' where id=%s", (P7,))
r8 = crear([("Chicle", 1)])
ok(ped(P7)["estado"] == "cancelado" and ped(P7)["pago"] == "fallido", "al crear un pedido nuevo se vencen los viejos de ese local")
ok(confirmar(P7, "pay-7", 100) == "confirmado" and ped(P7)["estado"] == "confirmado", "pago tardío con stock disponible: reabre y confirma")

# --- avisos recibidos
ok(one("select webhook_registrar('mercadopago','ev-1',true,'payment',%s)", (ka,)) is True, "aviso nuevo: se procesa")
ok(one("select webhook_registrar('mercadopago','ev-1',true,'payment',%s)", (ka,)) is False, "aviso repetido mientras se procesa: no se procesa otra vez")
cur.execute("select webhook_marcar('mercadopago','ev-1','error','fallo')")
ok(one("select webhook_registrar('mercadopago','ev-1',true,'payment',%s)", (ka,)) is True, "aviso que había fallado: Mercado Pago lo reintenta y se procesa")
ok(one("select intentos from webhooks_recibidos where evento_id='ev-1'") == 2, "aviso reintentado: cuenta los intentos")
cur.execute("select webhook_marcar('mercadopago','ev-1','procesado','ok')")
ok(one("select webhook_registrar('mercadopago','ev-1',true,'payment',%s)", (ka,)) is False, "aviso ya procesado: se ignora")
ok(one("select webhook_registrar('mercadopago','ev-2',false,'payment',%s)", (ka,)) is False, "firma inválida: no se procesa")
ok(one("select estado from webhooks_recibidos where evento_id='ev-2'") == "rechazado", "firma inválida: queda registrada como rechazada")
ok(one("select webhook_registrar('mercadopago','ev-2',true,'payment',%s)", (ka,)) is True, "el mismo id con firma válida (el rechazo fue de un intruso): se procesa")
for i in range(210): cur.execute("select webhook_registrar('mercadopago',%s,false,'payment',%s)", (f"junk-{i}", ka))
ok(one("select count(*) from webhooks_recibidos where kiosco_id=%s and estado='rechazado'", (ka,)) <= 200, "firmas inválidas en masa: el registro tiene tope por hora")
ok(has(fails("select webhook_registrar('mercadopago','',true,'payment',%s)", (ka,)), "evento_invalido"), "aviso sin id: error")

# --- consulta de respaldo
r9 = crear([("Chicle", 1)]); P9 = r9["pedido_id"]
ok(one("select pago_puede_consultar(%s,10)", (P9,)) is True, "consulta de respaldo: la primera se permite")
ok(one("select pago_puede_consultar(%s,10)", (P9,)) is False, "consulta de respaldo: la siguiente espera 10 segundos")
ok(one("select pago_puede_consultar(%s,0)", (P9,)) is True, "consulta de respaldo: el cron la fuerza")
ok(one("select pago_puede_consultar(%s,0)", (P1,)) is False, "consulta de respaldo: un pedido ya pagado no se consulta")

# --- estado público
e9 = one("select pago_estado_pedido(%s)", (P9,))
ok(set(e9.keys()) == {"pago_estado", "estado", "numero", "total", "rechazado", "link"}, "estado público: solo campos sin datos personales")
cur.execute("insert into transacciones_pago(kiosco_id,pedido_id,preferencia_id,monto,link_pago) values (%s,%s,'pref-9',100,'https://mp.test/9')", (ka, P9))
ok(one("select pago_estado_pedido(%s)->>'link'", (P9,)) == "https://mp.test/9", "estado público: un pedido que espera pago devuelve su link para reintentar")
ok(one("select pago_estado_pedido(%s)->>'link'", (P1,)) is None, "estado público: un pedido pagado no devuelve link")
ok(confirmar(P9, "pay-9", 100) == "confirmado" and one("select count(*) from transacciones_pago where pedido_id=%s", (P9,)) == 1, "el pago se anota en la preferencia ya creada, sin duplicarla")

# --- lo que ve el dueño
as_("authenticated", A)
c = one("select mp_estado_conexion(%s)", (ka,))
ok(c["conectada"] is True and c["token_ultimos4"] == "1234" and c["activa"] is True and c["cobro_online_activo"] is True, "el dueño ve el estado de su conexión y el final del token")
ok("token_cifrado" not in json.dumps(c) and "v1:a:b:c" not in json.dumps(c) and "v1:d:e:f" not in json.dumps(c), "el dueño nunca recibe la credencial ni cifrada")
ok(has(fails("select mp_estado_conexion(%s)", (kb,)), "no_autorizado"), "el dueño de A no ve la conexión de B")
as_("authenticated", B)
ok(one("select mp_estado_conexion(%s)", (kb,))["conectada"] is False, "un local sin conexión figura como no conectado")
ok(has(fails("select mp_desconectar(%s)", (ka,)), "no_autorizado"), "B no puede desconectar a A")
ok(one("select count(*) from transacciones_pago") == 0, "B no ve transacciones de A")
as_("authenticated", A)
ok(one("select count(*) from transacciones_pago") > 0, "A ve las transacciones de sus pedidos")

# --- conexión inactiva o desconectada
as_("postgres"); cur.execute("update integraciones_pago set activa=false where kiosco_id=%s", (ka,))
ok(crear([("Chicle", 1)])["pago_online"] is False, "conexión inactiva (token revocado): el pedido no es de pago online")
cur.execute("update integraciones_pago set activa=true where kiosco_id=%s", (ka,))
as_("authenticated", A)
ok(one("select mp_desconectar(%s)", (ka,))["conectada"] is False, "desconectar: el dueño la borra")
as_("postgres"); ok(one("select count(*) from integraciones_pago") == 0, "desconectar: no queda ninguna credencial guardada"); as_("authenticated", A)
ok(one("select cobro_online_activo from kioscos where id=%s", (ka,)) is False, "desconectar: apaga el cobro online")
ok(crear([("Chicle", 1)])["pago_online"] is False, "desconectado: los pedidos vuelven a ser normales")

# --- otro local no se ve afectado
as_("authenticated", B)
cur.execute("insert into productos(kiosco_id,nombre,precio) values (%s,'Producto de B',999)", (kb,))
as_("postgres")
ok(one("select count(*) from pedidos where kiosco_id=%s", (kb,)) == 0, "el local B no recibió nada de los pedidos de A")

cur.execute("rollback")
print(f"\n{'OK' if bad == 0 else 'HAY FALLAS'}: {bad} falla(s)")
sys.exit(1 if bad else 0)
