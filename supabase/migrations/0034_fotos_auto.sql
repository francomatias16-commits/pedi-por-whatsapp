-- 0034 · Etapa 3D: fotos automáticas de productos (sugeridas, nunca aplicadas solas).
-- Aditiva. El servidor busca fotos candidatas (base de la red, Open Food Facts y, si hay clave, un buscador de imágenes); el dueño o
-- el encargado elige una y confirma; la app la descarga, la comprime a 400 KB y la sube al bucket del local. Esta migración guarda:
--  - kioscos.fotos_auto_activo: interruptor por local, arranca apagado.
--  - fotos_uso: cuántas consultas hizo cada local por día y por fuente (medir costo y poner tope a la fuente paga). Solo el servidor.
--  - fotos_historial: cada foto aplicada (de dónde salió, quién la puso, si confirmó que puede usarla) y la imagen anterior, para deshacer.
--  - foto_aplicar / foto_deshacer: atómicas y con permisos por rol.
-- Aplicar DESPUÉS de 0001..0033.

alter table public.kioscos add column if not exists fotos_auto_activo boolean not null default false;

create table public.fotos_uso (
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  dia date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  fuente text not null check (fuente in ('global', 'openfoodfacts', 'busqueda')),
  consultas int not null default 0 check (consultas >= 0),
  primary key (kiosco_id, dia, fuente)
);
alter table public.fotos_uso enable row level security;
revoke all on public.fotos_uso from anon, authenticated;   -- sin políticas: solo el servidor

create table public.fotos_historial (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  url_anterior text,
  url_nueva text not null,
  fuente text not null check (fuente in ('global', 'openfoodfacts', 'busqueda')),
  derechos_confirmados boolean not null default false,
  usuario uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deshecho_at timestamptz
);
create index fotos_historial_producto on public.fotos_historial (producto_id, created_at desc);
alter table public.fotos_historial enable row level security;
revoke all on public.fotos_historial from anon, authenticated;
grant select on public.fotos_historial to authenticated;
create policy fotos_historial_miembros on public.fotos_historial for select to authenticated using (public.es_miembro(kiosco_id, array['encargado', 'dueno']));

-- Cupo diario. Solo el servidor. Con p_limite, la consulta no se cuenta ni se permite si ya se llegó al tope.
create or replace function public.fotos_usar_cupo(p_kiosco uuid, p_fuente text, p_limite int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dia date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; v_n int;
begin
  if p_fuente not in ('global', 'openfoodfacts', 'busqueda') then raise exception 'foto_invalida'; end if;
  insert into public.fotos_uso (kiosco_id, dia, fuente, consultas) values (p_kiosco, v_dia, p_fuente, 0) on conflict do nothing;
  update public.fotos_uso set consultas = consultas + 1
   where kiosco_id = p_kiosco and dia = v_dia and fuente = p_fuente and (p_limite is null or consultas < p_limite)
   returning consultas into v_n;
  if v_n is null then raise exception 'limite_fotos'; end if;
  return jsonb_build_object('usadas', v_n, 'limite', p_limite);
end $$;

-- Aplicar una foto ya subida al bucket del local. Encargado y dueño. Una foto de búsqueda en internet exige confirmar los derechos.
create or replace function public.foto_aplicar(p_kiosco uuid, p_producto uuid, p_url text, p_fuente text, p_derechos boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ant text; v_id uuid;
begin
  if auth.uid() is null or not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  if p_fuente not in ('global', 'openfoodfacts', 'busqueda') then raise exception 'foto_invalida'; end if;
  if p_fuente = 'busqueda' and not coalesce(p_derechos, false) then raise exception 'derechos_requeridos'; end if;
  if p_url is null or length(p_url) > 1000 or p_url !~ '^https://'
     or position(('/object/public/productos/' || p_kiosco::text || '/') in p_url) = 0 then raise exception 'foto_invalida'; end if;
  select imagen_url into v_ant from public.productos where id = p_producto and kiosco_id = p_kiosco for update;
  if not found then raise exception 'foto_producto_invalido'; end if;
  update public.productos set imagen_url = p_url where id = p_producto;
  insert into public.fotos_historial (kiosco_id, producto_id, url_anterior, url_nueva, fuente, derechos_confirmados, usuario)
    values (p_kiosco, p_producto, v_ant, p_url, p_fuente, coalesce(p_derechos, false), auth.uid()) returning id into v_id;
  return jsonb_build_object('historial_id', v_id, 'anterior', v_ant);
end $$;

-- Deshacer una aplicación: vuelve a la imagen anterior. Si después se cambió la foto de otra forma, no toca nada.
create or replace function public.foto_deshacer(p_kiosco uuid, p_historial uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_h public.fotos_historial%rowtype; v_actual text;
begin
  if auth.uid() is null or not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  select * into v_h from public.fotos_historial where id = p_historial and kiosco_id = p_kiosco and deshecho_at is null for update;
  if not found then raise exception 'foto_no_encontrada'; end if;
  select imagen_url into v_actual from public.productos where id = v_h.producto_id and kiosco_id = p_kiosco for update;
  if not found or v_actual is distinct from v_h.url_nueva then raise exception 'foto_cambio_posterior'; end if;
  update public.productos set imagen_url = v_h.url_anterior where id = v_h.producto_id;
  update public.fotos_historial set deshecho_at = now() where id = p_historial;
  return jsonb_build_object('anterior', v_h.url_anterior, 'quitada', v_h.url_nueva);
end $$;

-- Interruptor. Solo el dueño.
create or replace function public.fotos_configurar_activo(p_kiosco uuid, p_activo boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  update public.kioscos set fotos_auto_activo = coalesce(p_activo, false) where id = p_kiosco;
  return jsonb_build_object('activo', coalesce(p_activo, false));
end $$;

revoke all on function public.fotos_usar_cupo(uuid, text, int) from public, anon, authenticated;
revoke all on function public.foto_aplicar(uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.foto_deshacer(uuid, uuid) from public, anon;
revoke all on function public.fotos_configurar_activo(uuid, boolean) from public, anon;
grant execute on function public.foto_aplicar(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.foto_deshacer(uuid, uuid) to authenticated;
grant execute on function public.fotos_configurar_activo(uuid, boolean) to authenticated;
