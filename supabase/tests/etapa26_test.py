# Verifica 0031 (cobro con QR de Mercado Pago en la caja: cobros, confirmación idempotente, trigger de ventas y permisos).
# Uso: python3 supabase/tests/etapa26_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa26_" + uuid.uuid4().hex[:8]
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
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema auth; create table auth.users(id uuid primary key, email text);
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
A, B, EN, CJ, X, Y = (str(uuid.uuid4()) for _ in range(6))
for u, n in ((A, "dueno"), (B, "otro"), (EN, "encargado"), (CJ, "cajero"), (X, "extrano"), (Y, "nuevo")): cur.execute("insert into auth.users(id,email) values (%s,%s)", (u, n + "@test.com"))
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
def rows(sql, args=None):
    """Filas afectadas / devueltas; si la política lo rechaza con error, devuelve -1."""
    cur.execute("savepoint s")
    try:
        cur.execute(sql, args); n = cur.rowcount; cur.execute("release savepoint s"); return n
    except Exception: cur.execute("rollback to savepoint s"); return -1
def has(err, texto): return texto in (err or "")
def jsn(v): return v if isinstance(v, (dict, list)) else json.loads(v)

# --- datos: local A (dueño A, encargado EN, cajero CJ) y local B (dueño B)
as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','kiosco-a','5493415551234',true) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))
as_("authenticated", A)
p1 = one("insert into productos(kiosco_id,nombre,precio,stock,stock_controlado) values (%s,'Alfajor',500,50,true) returning id", (ka,))
p777 = one("insert into productos(kiosco_id,nombre,precio,stock,stock_controlado) values (%s,'Pizza',777,50,true) returning id", (ka,))
p250 = one("insert into productos(kiosco_id,nombre,precio,stock,stock_controlado) values (%s,'Chicle',250,50,true) returning id", (ka,))
as_("postgres")
cur.execute("insert into kiosco_miembros(kiosco_id,user_id,rol) values (%s,%s,'encargado'),(%s,%s,'cajero')", (ka, EN, ka, CJ))
cur.execute("insert into integraciones_pago(kiosco_id,token_cifrado,webhook_secret_cifrado,token_ultimos4,mp_user_id) values (%s,'v1:a:b:c','v1:d:e:f','1234','999')", (ka,))
cur.execute("insert into integraciones_pago(kiosco_id,token_cifrado,webhook_secret_cifrado,token_ultimos4,mp_user_id) values (%s,'v1:a:b:c','v1:d:e:f','5678','888')", (kb,))
as_("authenticated", CJ)
turno = jsn(one("select caja_abrir_turno(%s, 1000)", (ka,)))["turno_id"]
as_("authenticated", B)
turno_b = jsn(one("select caja_abrir_turno(%s, 1000)", (kb,)))["turno_id"]

def venta(medio="mercadopago", monto=500, quien=CJ):
    as_("authenticated", quien)
    return jsn(one("select registrar_venta_mostrador(%s,%s::jsonb,%s::jsonb)", (turno, json.dumps([{"producto_id": p1, "cantidad": 1}]), json.dumps([{"medio": medio, "monto": monto}]))))
def crear(monto, k=None, t=None):
    as_("postgres")
    return jsn(one("select qr_crear_cobro(%s,%s,%s,%s)", (k or ka, t or turno, monto, CJ)))["cobro_id"]
def conf(cobro, estado="aprobado", monto=None, pid=None, moneda="ARS"):
    as_("postgres")
    c = jsn(one("select qr_estado_cobro(%s)", (cobro,)))
    return jsn(one("select qr_confirmar(%s,%s,%s,%s,%s)", (pid or "pay-" + cobro[:8], cobro, c["monto"] if monto is None else monto, moneda, estado)))["resultado"]
def estado(cobro):
    as_("postgres"); return jsn(one("select qr_estado_cobro(%s)", (cobro,)))

# ===== 1) El QR arranca apagado y sin configurar
as_("postgres")
ok(one("select cobro_qr_activo from kioscos where id=%s", (ka,)) is False, "el interruptor arranca apagado")
as_("authenticated", CJ)
c0 = jsn(one("select qr_estado_config(%s)", (ka,)))
ok(c0["configurado"] is False and c0["activo"] is False and c0["conexion"] is True, "sin alta: no configurado, no activo, con conexión")
as_("authenticated", X); ok(has(fails("select qr_estado_config(%s)", (ka,)), "no_autorizado"), "un extraño no ve el estado del QR")
as_("authenticated", B); ok(has(fails("select qr_estado_config(%s)", (ka,)), "no_autorizado"), "otro dueño no ve el estado del QR de mi local")
as_("anon"); ok(bool(fails("select qr_estado_config(%s)", (ka,))), "anon no puede llamar qr_estado_config")
as_("authenticated", A); ok(has(fails("select qr_configurar_activo(%s,true)", (ka,)), "qr_sin_config"), "no se enciende sin alta")
as_("authenticated", CJ); ok(has(fails("select qr_configurar_activo(%s,true)", (ka,)), "no_autorizado"), "el cajero no enciende el QR")
as_("authenticated", EN); ok(has(fails("select qr_configurar_activo(%s,true)", (ka,)), "no_autorizado"), "el encargado no enciende el QR")
as_("postgres")
cur.execute("insert into pos_qr_config(kiosco_id,mp_user_id,mp_store_id,external_store_id,mp_pos_id,external_pos_id,qr_imagen) values (%s,'999','1','T1','2','C1','https://mp.example/qr.png')", (ka,))

# ===== 2) Alta hecha: el dueño enciende
as_("authenticated", A)
ok(jsn(one("select qr_configurar_activo(%s,true)", (ka,)))["activo"] is True, "el dueño enciende el QR con el alta hecha")
as_("authenticated", CJ)
c1 = jsn(one("select qr_estado_config(%s)", (ka,)))
ok(c1["configurado"] and c1["activo"] and c1["qr_imagen"] == "https://mp.example/qr.png", "el cajero ve que el QR está listo y la imagen")
as_("postgres")
cur.execute("update integraciones_pago set mp_user_id='777' where kiosco_id=%s", (ka,))
as_("authenticated", CJ)
c2 = jsn(one("select qr_estado_config(%s)", (ka,)))
ok(c2["configurado"] is False and c2["cuenta_distinta"] is True and c2["activo"] is False, "con otra cuenta de Mercado Pago el QR viejo deja de estar activo")
as_("postgres"); ok(has(fails("select qr_crear_cobro(%s,%s,500,%s)", (ka, turno, CJ)), "qr_sin_config"), "con otra cuenta no se crea un cobro")
cur.execute("update integraciones_pago set mp_user_id='999' where kiosco_id=%s", (ka,))

# ===== 3) Crear cobros
as_("authenticated", CJ); ok(bool(fails("select qr_crear_cobro(%s,%s,500,%s)", (ka, turno, CJ))), "un cajero no llama qr_crear_cobro directo (es del servidor)")
as_("anon"); ok(bool(fails("select qr_crear_cobro(%s,%s,500,%s)", (ka, turno, CJ))), "anon tampoco")
as_("postgres")
ok(has(fails("select qr_crear_cobro(%s,%s,14.99,%s)", (ka, turno, CJ)), "qr_monto_invalido"), "menos de $15 no se cobra")
ok(has(fails("select qr_crear_cobro(%s,%s,100.123,%s)", (ka, turno, CJ)), "qr_monto_invalido"), "más de dos decimales no")
ok(has(fails("select qr_crear_cobro(%s,%s,5000001,%s)", (ka, turno, CJ)), "qr_monto_invalido"), "sobre el tope no")
ok(has(fails("select qr_crear_cobro(%s,%s,500,%s)", (ka, turno_b, CJ)), "turno_cerrado"), "el turno de otro local no sirve")
ok(has(fails("select qr_crear_cobro(%s,%s,500,%s)", (kb, turno_b, CJ)), "qr_inactivo"), "un local sin QR encendido no cobra por QR")
c_a = crear(500)
ok(estado(c_a)["estado"] == "pendiente", "el cobro nace pendiente")
ok(one("select expira_at - created_at from cobros_qr_pos where id=%s", (c_a,)).total_seconds() == 300, "vence a los 5 minutos")
ok(has(fails("select qr_crear_cobro(%s,%s,700,%s)", (ka, turno, CJ)), "qr_ocupado"), "un QR fijo atiende un solo cobro a la vez")
ok(bool(fails("insert into cobros_qr_pos(kiosco_id,turno_id,monto,expira_at) values (%s,%s,900,now()+interval '5 minutes')", (ka, turno))), "el índice impide dos pendientes aunque se salte la función")

# ===== 4) Confirmar: idempotencia y montos
ok(conf(c_a, "pendiente", pid="pay-1") == "pendiente", "pago en proceso: sigue pendiente")
ok(conf(c_a, "aprobado", monto=499, pid="pay-1") == "monto_invalido", "monto distinto: se rechaza")
ok(estado(c_a)["estado"] == "pendiente" and estado(c_a)["detalle"] == "monto_distinto", "con monto distinto el cobro no se aprueba y queda anotado")
ok(conf(c_a, "aprobado", moneda="USD", pid="pay-1") == "monto_invalido", "otra moneda: se rechaza")
ok(conf(c_a, "rechazado", pid="pay-0") == "rechazado" and estado(c_a)["estado"] == "pendiente", "un intento rechazado no cierra el cobro")
ok(conf(c_a, "aprobado", pid="pay-1") == "confirmado", "pago aprobado con el monto justo: confirmado")
ok(estado(c_a)["estado"] == "aprobado" and estado(c_a)["detalle"] is None, "el cobro quedó aprobado")
ok(conf(c_a, "aprobado", pid="pay-1") == "duplicado", "el mismo aviso dos veces no duplica nada")
ok(conf(c_a, "aprobado", pid="pay-otro") == "ignorado", "otro pago aprobado sobre un cobro ya aprobado no lo cambia")
ok(conf(c_a, "rechazado", pid="pay-2") == "ignorado", "un rechazo posterior no deshace un cobro aprobado")
ok(conf(c_a, "vencido", pid="pay-2") == "ignorado", "un vencimiento posterior tampoco")
ok(has(fails("select qr_confirmar('pay-x', gen_random_uuid(), 500, 'ARS', 'aprobado')"), "cobro_no_encontrado"), "un cobro inexistente falla")
ok(has(fails("select qr_confirmar('pay-x', %s, 500, 'ARS', 'raro')", (c_a,)), "estado_pago_invalido"), "estado inválido falla")
ok(has(fails("select qr_confirmar('', %s, 500, 'ARS', 'aprobado')", (c_a,)), "pago_invalido"), "pago sin id falla")
ok(one("select count(*) from cobros_qr_pos where payment_id='pay-1'") == 1, "el pago quedó en un solo cobro")

# ===== 5) Tarde, cancelado y vencido
c_b = crear(300)
as_("postgres"); ok(has(fails("select qr_confirmar('pay-1', %s, 300, 'ARS', 'aprobado')", (c_b,)), "pago_invalido"), "un pago no se puede usar en dos cobros")
ok(jsn(one("select qr_cancelar_cobro(%s)", (c_b,)))["estado"] == "cancelado", "cancelar un pendiente lo cancela")
ok(jsn(one("select qr_cancelar_cobro(%s)", (c_a,)))["estado"] == "aprobado", "cancelar uno ya aprobado no lo toca")
ok(conf(c_b, "aprobado", pid="pay-3") == "aprobado_tarde" and estado(c_b)["estado"] == "aprobado" and estado(c_b)["detalle"] == "aprobado_tarde", "si pagan justo al cancelar, la plata no se pierde")
c_c = crear(250)
cur.execute("update cobros_qr_pos set expira_at = now() - interval '1 minute' where id=%s", (c_c,))
ok(estado(c_c)["estado"] == "vencido", "al consultarlo, un cobro pasado de hora vence")
ok(conf(c_c, "aprobado", pid="pay-4") == "aprobado_tarde", "un pago después del vencimiento queda como aprobado tarde")
c_d = crear(260)
cur.execute("update cobros_qr_pos set expira_at = now() - interval '1 minute' where id=%s", (c_d,))
ok(one("select qr_vencer_pendientes(%s)", (ka,)) == 1 and estado(c_d)["estado"] == "vencido", "qr_vencer_pendientes cierra los vencidos")
ok(one("select qr_vencer_pendientes()") == 0, "sin vencidos devuelve cero")
c_e = crear(270)
ok(one("select qr_puede_consultar(%s)", (c_e,)) is True, "la primera consulta al respaldo va")
ok(one("select qr_puede_consultar(%s)", (c_e,)) is False, "la segunda inmediata se frena")
ok(one("select qr_puede_consultar(%s, 0)", (c_e,)) is True, "el cron fuerza la consulta")
ok(one("select qr_puede_consultar(%s, 0)", (c_a,)) is False, "un cobro aprobado no se consulta más")
ok(conf(c_e, "reembolsado", pid="pay-5") == "ignorado", "reembolso de algo no aprobado: se ignora")
ok(conf(c_e, "vencido", pid="pay-5") == "vencido" and estado(c_e)["estado"] == "vencido", "aviso de vencido cierra el cobro pendiente")

# ===== 6) Cobros sin venta
as_("authenticated", CJ)
sv = jsn(one("select qr_cobros_sin_venta(%s)", (ka,)))
ok(sorted(float(x["monto"]) for x in sv) == [250.0, 300.0, 500.0], "lista los cobros aprobados que no tienen venta")
ok(all(x["vigente"] for x in sv), "todos vigentes")
as_("authenticated", X); ok(has(fails("select qr_cobros_sin_venta(%s)", (ka,)), "no_autorizado"), "un extraño no ve cobros sin venta")
as_("authenticated", B); ok(has(fails("select qr_cobros_sin_venta(%s)", (ka,)), "no_autorizado"), "otro dueño tampoco")

# ===== 7) El trigger: con el QR encendido, una venta "mercadopago" necesita su cobro
as_("postgres"); cur.execute("update kioscos set cobro_qr_activo=false where id=%s", (ka,))
ventas0 = one("select count(*) from ventas_mostrador where kiosco_id=%s", (ka,))
v_libre = venta("mercadopago", 500)
ok(one("select count(*) from ventas_mostrador where kiosco_id=%s", (ka,)) == ventas0 + 1, "con el interruptor apagado, QR / Mercado Pago se registra como siempre")
ok(one("select count(*) from cobros_qr_pos where id=%s and venta_id is null", (c_a,)) == 1, "y no toca los cobros")
as_("postgres"); cur.execute("update kioscos set cobro_qr_activo=true where id=%s", (ka,))
n0 = one("select count(*) from ventas_mostrador where kiosco_id=%s", (ka,))
as_("authenticated", CJ)
ok(has(fails("select registrar_venta_mostrador(%s,%s::jsonb,%s::jsonb)", (turno, json.dumps([{"producto_id": p777, "cantidad": 1}]), json.dumps([{"medio": "mercadopago", "monto": 777}]))), "qr_sin_cobro"), "sin cobro aprobado por ese monto, la venta se rechaza")
as_("postgres"); ok(one("select count(*) from ventas_mostrador where kiosco_id=%s", (ka,)) == n0, "y no queda ninguna venta a medias")
stock0 = one("select stock from productos where id=%s", (p1,))
vq = venta("mercadopago", 500)
as_("postgres")
ok(one("select count(*) from cobros_qr_pos where venta_id=%s and estado='aprobado' and monto=500", (vq["venta_id"],)) == 1, "la venta quedó atada a un cobro aprobado del mismo monto")
ok(bool(fails("update cobros_qr_pos set venta_id=%s where id=%s", (v_libre["venta_id"], c_e))), "una venta no se ata a un cobro que no está aprobado")
ok(one("select stock from productos where id=%s", (p1,)) == stock0 - 1, "el stock se descontó una vez")
ok(one("select count(*) from cobros_qr_pos where venta_id is not null and estado='aprobado'") == 1, "se usó un solo cobro")
as_("authenticated", CJ)
ok(has(fails("select registrar_venta_mostrador(%s,%s::jsonb,%s::jsonb)", (turno, json.dumps([{"producto_id": p1, "cantidad": 1}]), json.dumps([{"medio": "mercadopago", "monto": 500}]))), "qr_sin_cobro"), "el mismo cobro no sirve para una segunda venta")
v_ef = venta("efectivo", 500)
ok(bool(v_ef["venta_id"]), "efectivo sigue sin pedir cobro")
as_("authenticated", EN)
vm = jsn(one("select registrar_venta_mostrador(%s,%s::jsonb,%s::jsonb)", (turno, json.dumps([{"producto_id": p1, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 200}, {"medio": "mercadopago", "monto": 300}]))))
ok(bool(vm["venta_id"]), "pago mixto: efectivo y QR por el monto cobrado (el encargado también vende)")
as_("postgres")
ok(one("select count(*) from cobros_qr_pos where venta_id=%s", (vm["venta_id"],)) == 1, "la parte QR del pago mixto consumió su cobro")
as_("authenticated", CJ)
sv2 = jsn(one("select qr_cobros_sin_venta(%s)", (ka,)))
ok(sorted(float(x["monto"]) for x in sv2) == [250.0], "después de las ventas queda solo el cobro sin usar")

# Un cobro de hace más de 12 horas ya no se usa solo
as_("postgres")
cur.execute("update cobros_qr_pos set created_at = now() - interval '13 hours' where id=%s", (c_c,))
as_("authenticated", CJ)
ok(has(fails("select registrar_venta_mostrador(%s,%s::jsonb,%s::jsonb)", (turno, json.dumps([{"producto_id": p250, "cantidad": 1}]), json.dumps([{"medio": "mercadopago", "monto": 250}]))), "qr_sin_cobro"), "un cobro de hace 13 horas no se usa solo")
sv3 = jsn(one("select qr_cobros_sin_venta(%s)", (ka,)))
ok(len(sv3) == 1 and sv3[0]["vigente"] is False, "el cobro viejo sigue en la lista, marcado como no vigente")

# Reembolso de un cobro ya usado
as_("postgres")
usado = one("select id from cobros_qr_pos where venta_id=%s", (vq["venta_id"],))
ok(conf(usado, "reembolsado", pid=one("select payment_id from cobros_qr_pos where id=%s", (usado,))) == "reembolsado_con_venta", "el reembolso de un cobro con venta se marca para avisar")
ok(estado(usado)["estado"] == "reembolsado", "el cobro quedó reembolsado")
ok(conf(c_c, "reembolsado", pid="pay-4") == "reembolsado", "el reembolso de un cobro sin venta")

# ===== 8) Permisos y aislamiento
as_("authenticated", CJ)
ok(rows("select id from cobros_qr_pos where kiosco_id=%s", (ka,)) >= 4, "el cajero lee los cobros de su local")
ok(rows("select id from cobros_qr_pos where kiosco_id=%s", (kb,)) == 0, "y ninguno de otro local")
ok(rows("insert into cobros_qr_pos(kiosco_id,monto,expira_at) values (%s,500,now()+interval '5 minutes')", (ka,)) == -1, "un cajero no escribe cobros")
ok(rows("update cobros_qr_pos set estado='aprobado' where kiosco_id=%s", (ka,)) in (-1, 0), "un cajero no cambia el estado de un cobro")
ok(rows("delete from cobros_qr_pos where kiosco_id=%s", (ka,)) in (-1, 0), "un cajero no borra cobros")
ok(rows("select * from pos_qr_config") == -1, "pos_qr_config no se lee desde el navegador")
as_("authenticated", A)
ok(rows("select * from pos_qr_config") == -1, "ni siquiera el dueño la lee directo (usa qr_estado_config)")
ok(rows("update cobros_qr_pos set estado='aprobado' where kiosco_id=%s", (ka,)) in (-1, 0), "el dueño tampoco escribe cobros desde el navegador")
as_("authenticated", B)
ok(rows("select id from cobros_qr_pos where kiosco_id=%s", (ka,)) == 0, "otro dueño no ve mis cobros")
as_("anon")
ok(bool(fails("select * from cobros_qr_pos")), "anon no lee cobros")
for fn, args in (("qr_vencer_pendientes(%s)", (ka,)), ("qr_estado_cobro(%s)", (c_a,)), ("qr_cancelar_cobro(%s)", (c_a,)), ("qr_puede_consultar(%s)", (c_a,))):
    as_("authenticated", CJ); ok(bool(fails(f"select {fn}", args)), f"un cajero no llama {fn.split('(')[0]}")
    as_("anon"); ok(bool(fails(f"select {fn}", args)), f"anon no llama {fn.split('(')[0]}")
as_("authenticated", CJ)
ok(bool(fails("select qr_confirmar('p', %s, 500, 'ARS', 'aprobado')", (c_a,))), "un cajero no confirma pagos")

# ===== 9) Desconectar Mercado Pago apaga el QR
as_("authenticated", CJ); ok(has(fails("select mp_desconectar(%s)", (ka,)), "no_autorizado"), "un cajero no desconecta Mercado Pago")
as_("authenticated", A)
one("select mp_desconectar(%s)", (ka,))
as_("postgres")
ok(one("select cobro_qr_activo from kioscos where id=%s", (ka,)) is False and one("select cobro_online_activo from kioscos where id=%s", (ka,)) is False, "desconectar apaga el cobro online y el QR")
ok(one("select count(*) from integraciones_pago where kiosco_id=%s", (ka,)) == 0, "y borra la credencial")
ok(one("select count(*) from pos_qr_config where kiosco_id=%s", (ka,)) == 1, "el alta del QR queda (la sucursal y la caja ya existen en Mercado Pago)")
as_("authenticated", CJ)
c3 = jsn(one("select qr_estado_config(%s)", (ka,)))
ok(c3["conexion"] is False and c3["activo"] is False and c3["configurado"] is False, "sin conexión el QR figura apagado para la caja")
as_("authenticated", A); ok(has(fails("select qr_configurar_activo(%s,true)", (ka,)), "qr_sin_config"), "sin conexión no se puede encender")
# Con el QR apagado, la venta por "mercadopago" vuelve a registrarse sin cobro
v_off = venta("mercadopago", 500)
ok(bool(v_off["venta_id"]), "apagado el QR, la caja vende como antes")

# La orden de Mercado Pago queda guardada en el cobro y no se repite.
as_("postgres")
ok(one("select count(*) from information_schema.columns where table_name='cobros_qr_pos' and column_name='mp_order_id'") == 1, "el cobro guarda el id de la orden de Mercado Pago")
o1 = one("insert into cobros_qr_pos(kiosco_id,turno_id,monto,estado,expira_at,mp_order_id) values (%s,%s,100,'cancelado',now(),'ORD1') returning id", (ka, turno))
ok(bool(o1), "el servidor guarda el id de la orden")
ok(bool(fails("insert into cobros_qr_pos(kiosco_id,turno_id,monto,estado,expira_at,mp_order_id) values (%s,%s,200,'cancelado',now(),'ORD1')", (ka, turno))), "una orden no se asigna a dos cobros")
cur.execute("rollback")
print(f"\n{'OK' if bad == 0 else 'HAY FALLAS'}: {bad} falla(s)")
sys.exit(1 if bad else 0)
