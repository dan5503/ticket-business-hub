-- Presale sign-ups (register / Verified Fan / "sign up for the artist presale") get their own kind,
-- separate from presales that already have a code or start time to buy at.
alter table public.deal_emails drop constraint if exists deal_emails_kind_check;
alter table public.deal_emails add constraint deal_emails_kind_check
  check (kind in ('presale','onsale','deal','signup','news'));
