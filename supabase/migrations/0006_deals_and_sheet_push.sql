-- Deals & Presales inbox (sorted from danielbehman@primelioninc.com) and newsletter signup tracker.
create table if not exists public.deal_emails (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  gmail_id text not null,
  received_at timestamptz not null,
  sender_name text, sender_email text,
  subject text not null default '',
  kind text not null default 'news' check (kind in ('presale','onsale','deal','news')),
  artists text[] not null default '{}',
  codes text[] not null default '{}',
  starts_at timestamptz, ends_at timestamptz,
  link text check (link is null or link ~ '^https://'),
  summary text,
  pinned boolean not null default false,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, gmail_id)
);
create index if not exists deal_emails_owner_idx on public.deal_emails (owner_id, received_at desc);
create table if not exists public.deal_sources (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, url text check (url is null or url ~ '^https://'),
  category text not null default 'other' check (category in ('marketplace','promoter','venue','card','artist','alerts','other')),
  status text not null default 'todo' check (status in ('todo','subscribed','needs_you','failed','skipped')),
  email_used text, note text, signed_up_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);
alter table public.deal_emails enable row level security;
alter table public.deal_sources enable row level security;
revoke all on public.deal_emails, public.deal_sources from anon, public;
grant select, delete on public.deal_emails to authenticated;
grant update (pinned, done) on public.deal_emails to authenticated;
grant select, insert, update, delete on public.deal_sources to authenticated;
drop policy if exists "own deal emails" on public.deal_emails;
create policy "own deal emails" on public.deal_emails for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "own deal sources" on public.deal_sources;
create policy "own deal sources" on public.deal_sources for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Inventory sheet delivered by the Chrome extension (signed in to Google as you; no sharing or admin needed).
alter table public.inventory_sources add column if not exists via_extension boolean not null default false;
create or replace function public.sheet_target_with_key(p_key text)
returns table (export_url text) language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := private.owner_for_key(p_key);
begin
  return query select s.export_url from public.inventory_sources s where s.owner_id = v_owner and s.enabled;
end $$;
revoke all on function public.sheet_target_with_key(text) from public;
grant execute on function public.sheet_target_with_key(text) to anon, authenticated;
create or replace function public.owner_for_sync_key(p_key text) returns uuid
language sql security definer set search_path = '' as $$ select private.owner_for_key(p_key) $$;
revoke all on function public.owner_for_sync_key(text) from public, anon, authenticated;
grant execute on function public.owner_for_sync_key(text) to service_role;
