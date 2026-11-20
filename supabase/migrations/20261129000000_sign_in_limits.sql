-- Tightening after a security review.

-- ── the emailed code: a try is counted before it's checked ──────────────────────────────────────
-- The Worker used to read the try count, compare the code, then write count + 1, so many guesses
-- sent at once all saw "no tries yet". Now one statement claims a try (and refuses past five) and
-- hands back the row to compare against. Only the Worker's secret key may call it.
create function claim_code_try(sid uuid) returns setof public.second_factor
language sql volatile security definer set search_path = '' as $$
  update public.second_factor set attempts = attempts + 1
  where session_id = sid and attempts < 5 and verified_at is null
  returning *
$$;
revoke execute on function claim_code_try(uuid) from public, anon, authenticated;
grant execute on function claim_code_try(uuid) to service_role;

-- codes sent to one email in the last hour, across every session, so a stolen password can't buy
-- endless fresh tries (or flood the inbox) by opening new sessions
alter table second_factor add column sends int not null default 0;
create index second_factor_email on second_factor (email, sent_at);

-- ── push devices: only the browsers' own push services ──────────────────────────────────────────
-- (Chrome, Edge, Android: Google; Firefox: Mozilla; Safari: Apple; Windows: WNS) so the Worker,
-- which posts to every saved endpoint, can't be pointed at any other address
alter table push_subscriptions add constraint push_service check (
  endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
) not valid;
