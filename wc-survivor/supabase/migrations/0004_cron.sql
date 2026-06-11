-- ============================================================================
-- Scheduling (OPTIONAL but recommended for hands-off live operation)
-- ----------------------------------------------------------------------------
-- Two jobs:
--   1. auto_lock  — every minute, flip 'open' rounds to 'locked' once lock_at
--                   passes. This makes everyone's picks public on time even if
--                   nobody is online.
--   2. sync_pull  — every 5 minutes, ping the sync-results Edge Function so real
--                   results are ingested and rounds resolved automatically.
--
-- Requires the pg_cron and pg_net extensions (available on Supabase).
-- Fill in <PROJECT_REF> and the service-role key placeholder before running,
-- or run the auto_lock job only and trigger sync manually / from the Admin UI.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Time-based auto-lock (no external calls needed)
create or replace function auto_lock_due_rounds() returns void
language sql security definer set search_path = public as $$
  update rounds set status = 'locked'
  where status = 'open' and lock_at is not null and now() >= lock_at;
$$;

select cron.schedule('wc-survivor-auto-lock', '* * * * *', $$ select auto_lock_due_rounds(); $$);

-- 2) Periodic results sync via Edge Function.
--    Store the service-role key in Vault (recommended) rather than inline.
--    Example using a Vault secret named 'service_role_key':
--
-- select cron.schedule(
--   'wc-survivor-sync', '*/5 * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://<PROJECT_REF>.functions.supabase.co/sync-results',
--     headers := jsonb_build_object(
--                  'Content-Type','application/json',
--                  'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
--     body    := jsonb_build_object('contest_id','00000000-0000-0000-0000-0000000000c1')
--   );
--   $$
-- );
--
-- To remove a job:  select cron.unschedule('wc-survivor-sync');
