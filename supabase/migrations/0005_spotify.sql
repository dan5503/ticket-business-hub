-- Spotify monthly listeners (public data from kworb.net), refreshed daily.
create table if not exists public.spotify_artists (
  spotify_id text primary key check (spotify_id ~ '^[A-Za-z0-9]{22}$'),
  name text not null,
  rank int, listeners bigint, daily_change bigint, peak bigint,
  updated_on date not null default current_date
);
create index if not exists spotify_artists_name_idx on public.spotify_artists (lower(name));
create table if not exists public.spotify_history (
  spotify_id text not null, day date not null, listeners bigint not null,
  primary key (spotify_id, day)
);
create table if not exists public.spotify_watch (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  spotify_id text not null check (spotify_id ~ '^[A-Za-z0-9]{22}$'),
  name text not null check (length(name) <= 200),
  added_at timestamptz not null default now(),
  primary key (owner_id, spotify_id)
);
alter table public.spotify_artists enable row level security;
alter table public.spotify_history enable row level security;
alter table public.spotify_watch enable row level security;
revoke all on public.spotify_artists, public.spotify_history, public.spotify_watch from anon, public;
grant select on public.spotify_artists, public.spotify_history to authenticated;
grant select, insert, delete on public.spotify_watch to authenticated;
drop policy if exists "read spotify" on public.spotify_artists;
create policy "read spotify" on public.spotify_artists for select to authenticated using (true);
drop policy if exists "read spotify history" on public.spotify_history;
create policy "read spotify history" on public.spotify_history for select to authenticated using (true);
drop policy if exists "own watchlist" on public.spotify_watch;
create policy "own watchlist" on public.spotify_watch for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Latest numbers with 7- and 30-day change.
create or replace view public.spotify_movers with (security_invoker = true) as
select a.*,
  a.listeners - w.listeners as change_7d,
  round(100.0 * (a.listeners - w.listeners) / nullif(w.listeners, 0), 2) as pct_7d,
  a.listeners - m.listeners as change_30d,
  round(100.0 * (a.listeners - m.listeners) / nullif(m.listeners, 0), 2) as pct_30d
from public.spotify_artists a
left join lateral (select listeners from public.spotify_history h where h.spotify_id = a.spotify_id and h.day <= a.updated_on - 7 order by day desc limit 1) w on true
left join lateral (select listeners from public.spotify_history h where h.spotify_id = a.spotify_id and h.day <= a.updated_on - 30 order by day desc limit 1) m on true;
grant select on public.spotify_movers to authenticated;

-- Called only by the spotify-sync function (service role).
create or replace function public.ingest_spotify_page(p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.spotify_artists (spotify_id, name, rank, listeners, daily_change, peak, updated_on)
  select r->>'id', left(r->>'name', 200), (r->>'rank')::int, (r->>'listeners')::bigint, (r->>'daily')::bigint, (r->>'peak')::bigint, current_date
  from jsonb_array_elements(p_rows) r where (r->>'id') ~ '^[A-Za-z0-9]{22}$'
  on conflict (spotify_id) do update set name = excluded.name, rank = excluded.rank, listeners = excluded.listeners,
    daily_change = excluded.daily_change, peak = excluded.peak, updated_on = excluded.updated_on;
  get diagnostics n = row_count;
  insert into public.spotify_history (spotify_id, day, listeners)
  select r->>'id', current_date, (r->>'listeners')::bigint from jsonb_array_elements(p_rows) r where (r->>'id') ~ '^[A-Za-z0-9]{22}$'
  on conflict (spotify_id, day) do update set listeners = excluded.listeners;
  return n;
end $$;
-- Keep 9 days for everyone (enough for the 7-day climb) and 400 days for artists you follow or have tickets for.
create or replace function public.prune_spotify() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.spotify_artists where updated_on < current_date - 3;
  delete from public.spotify_history h where h.day < current_date - 9
    and not exists (select 1 from public.spotify_watch w where w.spotify_id = h.spotify_id)
    and not exists (select 1 from public.spotify_artists a where a.spotify_id = h.spotify_id and lower(a.name) in (
      select lower(artist) from public.sales union select lower(artist) from public.purchases union select lower(artist) from public.plt_sales));
  delete from public.spotify_history where day < current_date - 400;
end $$;
revoke all on function public.ingest_spotify_page(jsonb), public.prune_spotify() from public, anon, authenticated;
grant execute on function public.ingest_spotify_page(jsonb), public.prune_spotify() to service_role;

create or replace function private.run_spotify_sync() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://jhbhkjomjjbldlofuigt.supabase.co/functions/v1/spotify-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sheet_sync_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
end $$;
revoke all on function private.run_spotify_sync() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'spotify-sync-daily';
select cron.schedule('spotify-sync-daily', '17 13 * * *', 'select private.run_spotify_sync()');
