-- Google Sheet → inventory auto-sync
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.inventory_sources (
  owner_id        uuid primary key references auth.users(id) on delete cascade,
  sheet_url       text not null,
  export_url      text not null check (export_url like 'https://docs.google.com/spreadsheets/%'),
  mapping         jsonb,
  enabled         boolean not null default true,
  last_hash       text,
  last_rows       integer,
  last_synced_at  timestamptz,
  last_checked_at timestamptz,
  last_status     text,
  last_error      text,
  created_at      timestamptz not null default now()
);
alter table public.inventory_sources enable row level security;
drop policy if exists "own source: read" on public.inventory_sources;
create policy "own source: read" on public.inventory_sources for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.inventory_sources from public, anon, authenticated;
grant select (owner_id, sheet_url, mapping, enabled, last_rows, last_synced_at, last_checked_at, last_status, last_error, created_at)
  on public.inventory_sources to authenticated;
grant all on public.inventory_sources to service_role;

-- one shared replace routine, used by the CSV upload and the sheet sync
create or replace function private.replace_purchases_for(p_owner uuid, p_rows jsonb, p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int; up uuid := gen_random_uuid();
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Expected a list of rows'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Too many rows (max 20000)'; end if;
  delete from public.purchases where owner_id = p_owner;
  insert into public.purchases (owner_id, order_number, artist, venue, event_date, purchase_date, section,
    row_name, quantity, total_cost, cost_per, account, status, raw, upload_id)
  select p_owner,
    private.clip(e->>'order_number', 80), private.clip(e->>'artist', 200), private.clip(e->>'venue', 200),
    private.to_date(e->>'event_date'), private.to_date(e->>'purchase_date'),
    private.clip(e->>'section', 60), private.clip(e->>'row', 30),
    private.to_num(e->>'quantity')::int,
    coalesce(private.to_num(e->>'total_cost'), private.to_num(e->>'cost_per') * private.to_num(e->>'quantity')),
    coalesce(private.to_num(e->>'cost_per'),
             case when private.to_num(e->>'quantity') > 0 then round(private.to_num(e->>'total_cost') / private.to_num(e->>'quantity'), 2) end),
    private.clip(e->>'account', 120), private.clip(e->>'status', 60),
    e->'raw', up
  from jsonb_array_elements(p_rows) e;
  get diagnostics n = row_count;
  insert into public.sync_runs(owner_id, kind, source, received, added)
  values (p_owner, 'inventory', p_source, jsonb_array_length(p_rows), n);
  return jsonb_build_object('rows', n);
end $$;
revoke all on function private.replace_purchases_for(uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.replace_purchases(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return private.replace_purchases_for(auth.uid(), p_rows, 'csv');
end $$;

-- server-only entry point for the sync function
create or replace function public.replace_purchases_service(p_owner uuid, p_rows jsonb, p_source text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.replace_purchases_for(p_owner, p_rows, p_source);
$$;
revoke all on function public.replace_purchases_service(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.replace_purchases_service(uuid, jsonb, text) to service_role;

-- secret that proves a request came from the schedule
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'sheet_sync_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'sheet_sync_cron_secret', 'Authorizes scheduled sheet-sync calls');
  end if;
end $$;

create or replace function public.check_cron_secret(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'sheet_sync_cron_secret' and decrypted_secret = p_secret);
$$;
revoke all on function public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_cron_secret(text) to service_role;

create or replace function private.run_sheet_sync() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://jhbhkjomjjbldlofuigt.supabase.co/functions/v1/sheet-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sheet_sync_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
end $$;
revoke all on function private.run_sheet_sync() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'sheet-sync-every-30-min';
select cron.schedule('sheet-sync-every-30-min', '*/30 * * * *', 'select private.run_sheet_sync()');
