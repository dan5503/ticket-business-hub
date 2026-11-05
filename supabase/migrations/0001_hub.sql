-- =====================================================================
-- Personal Business Hub — Phase 1 database setup
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run more than once.
-- =====================================================================

-- Tools we need: pgcrypto (encryption) and Vault (locked key storage)
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault;

-- A private area the website can never reach directly
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Create the encryption key once and lock it in the Vault
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'hub_credentials_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'hub_credentials_key',
      'Encrypts saved usernames/passwords on hub link cards'
    );
  end if;
end $$;

create or replace function private.hub_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'hub_credentials_key' limit 1;
$$;
revoke all on function private.hub_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. The link cards table
-- ---------------------------------------------------------------------
create table if not exists public.hub_links (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 80),
  url           text not null check (url ~* '^https?://' and char_length(url) <= 2000),
  category      text check (char_length(category) <= 40),
  description   text check (char_length(description) <= 200),
  icon          text check (char_length(icon) <= 8),
  sort_order    integer not null default 0,
  login_username_enc bytea,
  login_password_enc bytea,
  has_login     boolean generated always as
                  (login_username_enc is not null or login_password_enc is not null) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists hub_links_owner_idx on public.hub_links(owner_id);

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists hub_links_touch on public.hub_links;
create trigger hub_links_touch before update on public.hub_links
for each row execute function private.touch_updated_at();

-- Row-level security: you only ever see/change your own rows
alter table public.hub_links enable row level security;

drop policy if exists "own links: read"   on public.hub_links;
drop policy if exists "own links: add"    on public.hub_links;
drop policy if exists "own links: change" on public.hub_links;
drop policy if exists "own links: delete" on public.hub_links;
create policy "own links: read"   on public.hub_links for select to authenticated using (owner_id = (select auth.uid()));
create policy "own links: add"    on public.hub_links for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own links: change" on public.hub_links for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own links: delete" on public.hub_links for delete to authenticated using (owner_id = (select auth.uid()));

-- Column-level lock: the website may never read or write the encrypted
-- columns directly — only through the two functions below.
revoke all on public.hub_links from public, anon, authenticated;
grant select (id, owner_id, title, url, category, description, icon, sort_order, has_login, created_at, updated_at)
  on public.hub_links to authenticated;
grant insert (title, url, category, description, icon, sort_order) on public.hub_links to authenticated;
grant update (title, url, category, description, icon, sort_order) on public.hub_links to authenticated;
grant delete on public.hub_links to authenticated;

-- ---------------------------------------------------------------------
-- 3. Save a login for a card (encrypts before storing)
--    p_update_password = false keeps the current password unchanged.
--    Empty username/password = remove it.
-- ---------------------------------------------------------------------
create or replace function public.set_link_login(
  p_link_id uuid,
  p_username text,
  p_password text,
  p_update_password boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text := private.hub_key();
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if k is null then
    raise exception 'Encryption key missing';
  end if;
  if not exists (select 1 from public.hub_links where id = p_link_id and owner_id = auth.uid()) then
    raise exception 'Link not found';
  end if;

  update public.hub_links set
    login_username_enc = case when coalesce(p_username, '') = '' then null
                              else extensions.pgp_sym_encrypt(p_username, k, 'cipher-algo=aes256') end,
    login_password_enc = case
                           when not p_update_password then login_password_enc
                           when coalesce(p_password, '') = '' then null
                           else extensions.pgp_sym_encrypt(p_password, k, 'cipher-algo=aes256') end
  where id = p_link_id and owner_id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- 4. Reveal a login (decrypts only for the owner, only on request)
-- ---------------------------------------------------------------------
create or replace function public.reveal_link_login(p_link_id uuid)
returns table (username text, password text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text := private.hub_key();
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return query
    select
      case when l.login_username_enc is null then null else extensions.pgp_sym_decrypt(l.login_username_enc, k) end,
      case when l.login_password_enc is null then null else extensions.pgp_sym_decrypt(l.login_password_enc, k) end
    from public.hub_links l
    where l.id = p_link_id and l.owner_id = auth.uid();
end $$;

revoke all on function public.set_link_login(uuid, text, text, boolean) from public, anon;
revoke all on function public.reveal_link_login(uuid) from public, anon;
grant execute on function public.set_link_login(uuid, text, text, boolean) to authenticated;
grant execute on function public.reveal_link_login(uuid) to authenticated;
