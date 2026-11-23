-- Mons's monthly cap: what each of her replies cost in Gemini tokens, the month's total since the
-- 1st (Manila), and the mons_monthly_tokens setting it's measured against. The Worker stops her at
-- the cap (admin/worker/mons.js); the admin shows the bar (admin/src/MonsUsage.jsx).
alter table mons_messages add column tokens integer not null default 0 check (tokens >= 0);

create function mons_tokens_this_month() returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(tokens), 0) from public.mons_messages
  where created_at >= date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'
$$;
grant execute on function mons_tokens_this_month() to authenticated;

alter table settings drop constraint settings_key_check;
alter table settings add constraint settings_key_check
  check (key in ('contract_effective_date', 'broker_name', 'broker_prc_no', 'broker_prc_valid_until', 'broker_firm', 'default_agent_id', 'mons_monthly_tokens'));
