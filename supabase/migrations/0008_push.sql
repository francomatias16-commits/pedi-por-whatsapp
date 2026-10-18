-- Etapa 3 · avisos con la app cerrada (Web Push): suscripciones por dispositivo.
-- Cada dueño guarda las suscripciones de sus celulares. La anon key no puede leerlas;
-- el envío lo hace /api/push/pedido con la service role (solo del lado del servidor).
create table public.push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  usuario uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now()
);
create index on public.push_suscripciones (kiosco_id);

alter table public.push_suscripciones enable row level security;
create policy push_dueno on public.push_suscripciones for all to authenticated
  using (public.es_dueno(kiosco_id))
  with check (public.es_dueno(kiosco_id) and usuario = auth.uid());
revoke all on public.push_suscripciones from anon;
grant select, insert, update, delete on public.push_suscripciones to authenticated;
