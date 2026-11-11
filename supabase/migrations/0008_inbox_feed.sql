-- STATUS: written, NOT YET APPLIED to the database (waiting for the owner to approve).
-- Inbox feed: a small Google Apps Script running in danielbehman@primelioninc.com copies new emails here.
-- Why: Gmail hides forwarded emails that fail the sender check (e.g. Outlook "Redirect" rules) from the
-- Gmail connector's search, but Apps Script sees the whole inbox. The deal/presale scans read this table
-- in addition to Gmail search, so nothing forwarded from a buyer account is missed.
create table if not exists public.inbox_feed (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  gmail_id text not null,
  thread_id text,
  received_at timestamptz not null,
  sender text,
  to_addr text,
  subject text,
  body text,              -- plain text, clipped; only kept for emails that look ticket-related
  ticket_related boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, gmail_id)
);
create index if not exists inbox_feed_owner_received on public.inbox_feed (owner_id, received_at desc);
alter table public.inbox_feed enable row level security;
drop policy if exists inbox_feed_own on public.inbox_feed;
create policy inbox_feed_own on public.inbox_feed for select using (owner_id = auth.uid());

-- Write-only entry point for the Apps Script (same sync keys as the Chrome extension: they can add, never read).
create or replace function public.ingest_inbox_with_key(p_key text, p_msgs jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_id uuid; n int;
begin
  select id, owner_id into v_id, v_owner from public.sync_keys
  where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null;
  if v_owner is null then raise exception 'Invalid or revoked sync key'; end if;
  if jsonb_typeof(p_msgs) <> 'array' then raise exception 'Expected a list'; end if;
  if jsonb_array_length(p_msgs) > 500 then raise exception 'Too many messages (max 500)'; end if;
  update public.sync_keys set last_used_at = now() where id = v_id;

  insert into public.inbox_feed (owner_id, gmail_id, thread_id, received_at, sender, to_addr, subject, body, ticket_related)
  select v_owner, left(m->>'id', 40), left(m->>'thread_id', 40),
         coalesce((m->>'date')::timestamptz, now()), left(m->>'from', 300), left(m->>'to', 300),
         left(m->>'subject', 500), left(m->>'body', 30000), coalesce((m->>'ticket')::boolean, false)
  from jsonb_array_elements(p_msgs) m
  where coalesce(m->>'id', '') ~ '^[0-9a-f]{8,40}$'
  on conflict (owner_id, gmail_id) do nothing;
  get diagnostics n = row_count;

  delete from public.inbox_feed where owner_id = v_owner and received_at < now() - interval '21 days';
  return jsonb_build_object('received', jsonb_array_length(p_msgs), 'added', n);
end $$;
revoke all on function public.ingest_inbox_with_key(text, jsonb) from public;
grant execute on function public.ingest_inbox_with_key(text, jsonb) to anon, authenticated;
