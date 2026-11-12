-- Daily cleanup of expired / finished items on the Hub's Deals pages.
-- Only removes rows from public.deal_emails (never Gmail emails, never email_scan_seen).
-- Pinned rows are never removed. Runs inside Postgres via pg_cron at 09:41 UTC daily.
create schema if not exists private;

create or replace function private.cleanup_expired_deal_emails()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d_deals int;
begin
  delete from public.deal_emails
   where not coalesce(pinned, false)
     and (
       (ends_at is not null and ends_at < now() - interval '1 day')
       or (ends_at is null and starts_at is not null and kind in ('presale','onsale','signup') and starts_at < now() - interval '3 days')
       or (ends_at is null and starts_at is null and received_at < now() - interval '14 days')
       or (coalesce(done, false) and received_at < now() - interval '2 days')
     );
  get diagnostics d_deals = row_count;
  return jsonb_build_object('deal_rows_removed', d_deals, 'at', now());
end $$;

revoke all on function private.cleanup_expired_deal_emails() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'deal-emails-expiry-cleanup';
select cron.schedule('deal-emails-expiry-cleanup', '41 9 * * *', 'select private.cleanup_expired_deal_emails()');
