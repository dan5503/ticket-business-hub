-- =====================================================================
-- Phase 2/3: sales (from Discord), purchases/inventory (from CSV),
-- extension sync keys, sync log, and sign-up lock.
-- =====================================================================

-- ---------- helpers: forgiving number/date parsing ----------
create or replace function private.to_num(v text) returns numeric
language plpgsql immutable set search_path = '' as $$
declare s text; neg boolean := false;
begin
  if v is null then return null; end if;
  s := btrim(v);
  if s ~ '^\(.*\)$' then neg := true; s := substr(s, 2, length(s) - 2); end if;
  s := regexp_replace(s, '[\$,%\s]|USD', '', 'g');
  if s = '' or s = '-' then return null; end if;
  return case when neg then -s::numeric else s::numeric end;
exception when others then return null;
end $$;

create or replace function private.to_date(v text) returns date
language plpgsql stable set search_path = '' set datestyle = 'ISO, MDY' as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  return btrim(v)::timestamp::date;
exception when others then return null;
end $$;

create or replace function private.clip(v text, n int) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(btrim(v), n), '');
$$;

-- ---------- sign-up lock: only allowed emails can create an account ----------
create table if not exists private.allowed_emails (email text primary key);
insert into private.allowed_emails values ('dan5503@gmail.com') on conflict do nothing;

create or replace function private.enforce_allowed_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.allowed_emails a where a.email = lower(new.email)) then
    raise exception 'Sign-ups are closed';
  end if;
  return new;
end $$;
drop trigger if exists enforce_allowed_signup on auth.users;
create trigger enforce_allowed_signup before insert on auth.users
for each row execute function private.enforce_allowed_signup();

-- ---------- SALES (one row per sale; fed by the Discord extension) ----------
create table if not exists public.sales (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source        text not null default 'hub',
  discord_message_id text,
  order_number  text,
  artist        text,
  venue         text,
  event_date    date,
  section       text,
  row_name      text,
  quantity      integer,
  total_sale    numeric(12,2),
  total_cost    numeric(12,2),
  profit        numeric(12,2),
  roi           numeric(10,2),   -- percent, e.g. 25.00 = 25%
  cost_per      numeric(12,2),
  sold_per      numeric(12,2),
  purchase_date date,
  sold_date     date,
  account       text,            -- buyer account used to purchase
  marketplace   text,
  notes         text,
  raw           jsonb,
  fingerprint   text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (owner_id, fingerprint)
);
create unique index if not exists sales_owner_msg_uidx on public.sales(owner_id, discord_message_id) where discord_message_id is not null;
create index if not exists sales_owner_sold_idx on public.sales(owner_id, sold_date);

drop trigger if exists sales_touch on public.sales;
create trigger sales_touch before update on public.sales for each row execute function private.touch_updated_at();

alter table public.sales enable row level security;
drop policy if exists "own sales: read" on public.sales;
drop policy if exists "own sales: change" on public.sales;
drop policy if exists "own sales: delete" on public.sales;
create policy "own sales: read" on public.sales for select to authenticated using (owner_id = (select auth.uid()));
create policy "own sales: change" on public.sales for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own sales: delete" on public.sales for delete to authenticated using (owner_id = (select auth.uid()));
revoke all on public.sales from public, anon, authenticated;
grant select, delete on public.sales to authenticated;
grant update (artist, venue, event_date, section, row_name, quantity, total_sale, total_cost, profit, roi,
              cost_per, sold_per, purchase_date, sold_date, account, marketplace, notes) on public.sales to authenticated;

-- ---------- PURCHASES (your orders CSV = inventory) ----------
create table if not exists public.purchases (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  order_number  text,
  artist        text,
  venue         text,
  event_date    date,
  purchase_date date,
  section       text,
  row_name      text,
  quantity      integer,
  total_cost    numeric(12,2),
  cost_per      numeric(12,2),
  account       text,
  status        text,
  raw           jsonb,
  upload_id     uuid,
  created_at    timestamptz not null default now()
);
create index if not exists purchases_owner_idx on public.purchases(owner_id);
alter table public.purchases enable row level security;
drop policy if exists "own purchases: read" on public.purchases;
create policy "own purchases: read" on public.purchases for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.purchases from public, anon, authenticated;
grant select on public.purchases to authenticated;

-- ---------- SYNC LOG (shown as "42 new sales added") ----------
create table if not exists public.sync_runs (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  kind       text not null,          -- 'sales' or 'inventory'
  source     text not null,          -- 'extension', 'hub', 'csv'
  received   integer not null,
  added      integer not null,
  created_at timestamptz not null default now()
);
create index if not exists sync_runs_owner_idx on public.sync_runs(owner_id, created_at desc);
alter table public.sync_runs enable row level security;
drop policy if exists "own runs: read" on public.sync_runs;
create policy "own runs: read" on public.sync_runs for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.sync_runs from public, anon, authenticated;
grant select on public.sync_runs to authenticated;

-- ---------- SYNC KEYS for the Chrome extension (stored hashed) ----------
create table if not exists public.sync_keys (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label        text not null check (char_length(label) between 1 and 60),
  key_hash     text not null unique,
  key_hint     text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
alter table public.sync_keys enable row level security;
drop policy if exists "own keys: read" on public.sync_keys;
create policy "own keys: read" on public.sync_keys for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.sync_keys from public, anon, authenticated;
grant select (id, label, key_hint, created_at, last_used_at, revoked_at) on public.sync_keys to authenticated;

create or replace function public.create_sync_key(p_label text) returns text
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  k := 'hubk_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.sync_keys(owner_id, label, key_hash, key_hint)
  values (auth.uid(), coalesce(private.clip(p_label, 60), 'Chrome extension'),
          encode(extensions.digest(k, 'sha256'), 'hex'), '…' || right(k, 4));
  return k;  -- shown once, never stored in plain text
end $$;

create or replace function public.revoke_sync_key(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.sync_keys set revoked_at = now()
  where id = p_id and owner_id = auth.uid() and revoked_at is null;
$$;

-- ---------- core sales ingest (dedupes by fingerprint) ----------
create or replace function private.ingest_sales_for(p_owner uuid, p_sales jsonb, p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_recv int; n_add int;
begin
  if jsonb_typeof(p_sales) <> 'array' then raise exception 'Expected a list of sales'; end if;
  n_recv := jsonb_array_length(p_sales);
  if n_recv > 5000 then raise exception 'Too many sales in one batch (max 5000)'; end if;

  with src as (
    select e,
      private.clip(e->>'order_number', 80)            as order_number,
      private.clip(coalesce(e->>'artist', e->>'event'), 200) as artist,
      private.clip(e->>'venue', 200)                  as venue,
      private.to_date(e->>'event_date')               as event_date,
      private.clip(e->>'section', 60)                 as section,
      private.clip(coalesce(e->>'row', e->>'row_name'), 30) as row_name,
      private.to_num(coalesce(e->>'quantity', e->>'qty', e->>'tickets'))::int as quantity,
      private.to_num(coalesce(e->>'total_sale', e->>'total'))  as total_sale,
      private.to_num(e->>'total_cost')                as total_cost,
      private.to_num(e->>'profit')                    as profit,
      private.to_num(e->>'roi')                       as roi,
      private.to_num(e->>'cost_per')                  as cost_per,
      private.to_num(e->>'sold_per')                  as sold_per,
      private.to_date(e->>'purchase_date')            as purchase_date,
      private.to_date(e->>'sold_date')                as sold_date,
      private.clip(e->>'account', 120)                as account,
      private.clip(e->>'marketplace', 60)             as marketplace,
      private.clip(e->>'notes', 1000)                 as notes,
      private.clip(e->>'discord_message_id', 40)      as discord_message_id
    from jsonb_array_elements(p_sales) e
  ), filled as (
    select s.*,
      coalesce(s.total_cost, s.total_sale - s.profit, s.cost_per * s.quantity) as tc,
      coalesce(s.total_sale, s.sold_per * s.quantity) as ts
    from src s
  ), calc as (
    select f.*,
      coalesce(f.profit, f.ts - f.tc) as pf
    from filled f
  ), ins as (
    insert into public.sales (owner_id, source, discord_message_id, order_number, artist, venue, event_date,
      section, row_name, quantity, total_sale, total_cost, profit, roi, cost_per, sold_per,
      purchase_date, sold_date, account, marketplace, notes, raw, fingerprint)
    select p_owner, p_source, c.discord_message_id, c.order_number, c.artist, c.venue, c.event_date,
      c.section, c.row_name, c.quantity, c.ts, c.tc, c.pf,
      case when c.tc > 0 and c.pf is not null then round(c.pf / c.tc * 100, 2) else c.roi end,
      coalesce(c.cost_per, case when c.quantity > 0 then round(c.tc / c.quantity, 2) end),
      coalesce(c.sold_per, case when c.quantity > 0 then round(c.ts / c.quantity, 2) end),
      c.purchase_date, c.sold_date, c.account, c.marketplace, c.notes, c.e,
      md5(concat_ws('|', lower(c.order_number), lower(c.artist), c.event_date, lower(c.section),
                    lower(c.row_name), c.quantity, c.ts, c.sold_date))
    from calc c
    where c.artist is not null or c.order_number is not null
    on conflict do nothing
    returning 1
  )
  select count(*) into n_add from ins;

  insert into public.sync_runs(owner_id, kind, source, received, added)
  values (p_owner, 'sales', p_source, n_recv, n_add);

  return jsonb_build_object('received', n_recv, 'added', n_add, 'duplicates', n_recv - n_add);
end $$;
revoke all on function private.ingest_sales_for(uuid, jsonb, text) from public, anon, authenticated;

-- from the hub (signed in)
create or replace function public.ingest_sales(p_sales jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return private.ingest_sales_for(auth.uid(), p_sales, 'hub');
end $$;

-- from the Chrome extension (uses a sync key, no login)
create or replace function public.ingest_sales_with_key(p_key text, p_sales jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_id uuid;
begin
  select id, owner_id into v_id, v_owner from public.sync_keys
  where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null;
  if v_owner is null then raise exception 'Invalid or revoked sync key'; end if;
  update public.sync_keys set last_used_at = now() where id = v_id;
  return private.ingest_sales_for(v_owner, coalesce(p_sales, '[]'::jsonb), 'extension');
end $$;

-- latest sync status for the extension popup
create or replace function public.sync_status_with_key(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.sync_keys
  where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null;
  if v_owner is null then raise exception 'Invalid or revoked sync key'; end if;
  return jsonb_build_object(
    'total_sales', (select count(*) from public.sales where owner_id = v_owner),
    'last_sold_date', (select max(sold_date) from public.sales where owner_id = v_owner),
    'latest_message_id', (select discord_message_id from public.sales where owner_id = v_owner and discord_message_id is not null
                          order by length(discord_message_id) desc, discord_message_id desc limit 1));
end $$;

-- ---------- replace inventory from a CSV upload ----------
create or replace function public.replace_purchases(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int; up uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Expected a list of rows'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Too many rows (max 20000)'; end if;

  delete from public.purchases where owner_id = auth.uid();
  insert into public.purchases (owner_id, order_number, artist, venue, event_date, purchase_date, section,
    row_name, quantity, total_cost, cost_per, account, status, raw, upload_id)
  select auth.uid(),
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
  values (auth.uid(), 'inventory', 'csv', jsonb_array_length(p_rows), n);
  return jsonb_build_object('rows', n);
end $$;

-- ---------- function permissions ----------
revoke all on function public.create_sync_key(text) from public, anon;
revoke all on function public.revoke_sync_key(uuid) from public, anon;
revoke all on function public.ingest_sales(jsonb) from public, anon;
revoke all on function public.replace_purchases(jsonb) from public, anon;
grant execute on function public.create_sync_key(text) to authenticated;
grant execute on function public.revoke_sync_key(uuid) to authenticated;
grant execute on function public.ingest_sales(jsonb) to authenticated;
grant execute on function public.replace_purchases(jsonb) to authenticated;
revoke all on function public.ingest_sales_with_key(text, jsonb) from public;
revoke all on function public.sync_status_with_key(text) from public;
grant execute on function public.ingest_sales_with_key(text, jsonb) to anon, authenticated;
grant execute on function public.sync_status_with_key(text) to anon, authenticated;

-- live updates in the hub when a new sale arrives
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sales') then
    alter publication supabase_realtime add table public.sales;
  end if;
exception when undefined_object then null;
end $$;
