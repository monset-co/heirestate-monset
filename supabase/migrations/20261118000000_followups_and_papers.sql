-- Follow-ups and papers: how warm a lead is, when it was reserved (the 30-day clock for a buyer's
-- papers), each paper checked off, when we last heard from or wrote to them, and leads that start
-- as a WhatsApp chat.

-- ── temperature, and the day it was reserved ────────────────────────────────────────────────────
alter table leads
  add column temperature text check (temperature in ('hot', 'warm', 'cold')),
  add column reserved_at timestamptz;

-- the clock starts when a lead becomes Reserved, and stops if it goes back to an earlier stage
create function leads_reserved() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stage = 'reserved' and (tg_op = 'INSERT' or old.stage is distinct from 'reserved') and new.reserved_at is null then
    new.reserved_at := now();
  elsif new.stage in ('new', 'contacted', 'viewing') then
    new.reserved_at := null;
  end if;
  return new;
end $$;
create trigger reserved before insert or update of stage on leads for each row execute function leads_reserved();

-- leads already reserved: the day the activity log saw them move there, else their last change
update leads l set reserved_at = coalesce(
  (select max(a.at) from activity a where a.entity = 'leads' and a.entity_id = l.id::text and a.changes -> 'stage' ->> 1 = 'reserved'),
  l.updated_at)
where l.stage in ('reserved', 'closed');

-- ── a lead can start as a WhatsApp chat: no email, and no website consent box ───────────────────
alter table leads alter column email drop not null, alter column consent_at drop not null;

-- ── the buyer's papers, checked off one folder at a time ────────────────────────────────────────
-- No row: missing or uploaded (the files say which). A row: someone looked and verified or rejected.
create table lead_checklist (
  lead_id bigint not null references leads (id) on delete cascade,
  item text not null check (item in ('ids', 'income', 'reservation', 'contract', 'payments')),
  status text not null check (status in ('verified', 'rejected')),
  reason text check (length(reason) <= 300),
  checked_by text default (auth.jwt() ->> 'email'),
  checked_at timestamptz not null default now(),
  primary key (lead_id, item),
  constraint rejected_has_reason check (status <> 'rejected' or trim(coalesce(reason, '')) <> '')
);
alter table lead_checklist enable row level security;
create policy admins on lead_checklist for all to authenticated using (is_admin()) with check (is_admin());

-- ── each lead's follow-up picture, worked out when read ─────────────────────────────────────────
-- Last contact: the latest note, WhatsApp message either way, or stage change. Next step: the
-- earliest open reminder. Read with the reader's own rights (security_invoker), so RLS still holds.
create view lead_overview with (security_invoker = true) as
select
  l.id,
  greatest(
    l.created_at,
    (select max(n.created_at) from lead_notes n where n.lead_id = l.id),
    (select max(m.created_at) from wa_messages m join wa_threads t on t.id = m.thread_id where t.lead_id = l.id),
    (select max(a.at) from activity a where a.lead_id = l.id and a.entity = 'leads' and a.changes ? 'stage')
  ) as last_contact_at,
  r.due_at as next_step_at,
  r.body as next_step,
  -- the papers on the 30-day clock (not the Contract to Sell, which the developer sends later)
  (select count(*)::int from lead_checklist c where c.lead_id = l.id and c.status = 'verified' and c.item <> 'contract') as papers_verified
from leads l
left join lateral (
  select due_at, body from reminders where lead_id = l.id and done_at is null order by due_at limit 1
) r on true;
grant select on lead_overview to authenticated;
revoke execute on function leads_reserved() from public, anon, authenticated;
