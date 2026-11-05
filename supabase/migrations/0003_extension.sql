-- Owner account auto-confirmed (only allowlisted emails can sign up at all)
create or replace function private.enforce_allowed_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.allowed_emails a where a.email = lower(new.email)) then
    raise exception 'Sign-ups are closed';
  end if;
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end $$;

-- Lets the extension's "Sync New" know where to stop
create or replace function public.existing_sales_with_key(p_key text, p_ids text[])
returns text[] language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.sync_keys
  where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null;
  if v_owner is null then raise exception 'Invalid or revoked sync key'; end if;
  if coalesce(array_length(p_ids, 1), 0) > 2000 then raise exception 'Too many ids'; end if;
  return coalesce((select array_agg(s.discord_message_id) from public.sales s
                   where s.owner_id = v_owner and s.discord_message_id = any(p_ids)), '{}');
end $$;
revoke all on function public.existing_sales_with_key(text, text[]) from public;
grant execute on function public.existing_sales_with_key(text, text[]) to anon, authenticated;
