-- Phases 3 and 4: sign-in's second step, the CRM's rules, and the commission log as Annex B needs it.

-- ── sign-in's second step ───────────────────────────────────────────────────────────────────────
-- After their password, an admin enters a code emailed to them. The admin Worker sends and checks it
-- (admin/worker); this table is how the database knows a session has passed. RLS is on with no
-- policies, so only the Worker's secret key can read or write it.
create table second_factor (
  session_id uuid primary key, -- the session_id claim of the signed-in user's token
  email text not null,
  code_hash text, -- sha-256 of "<session_id>:<code>", hex; cleared once used
  expires_at timestamptz,
  attempts int not null default 0,
  sent_at timestamptz,
  verified_at timestamptz
);
alter table second_factor enable row level security;

-- an admin is on the list, active, and signed in with both steps in this session
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and active
  ) and exists (
    select 1 from public.second_factor
    where session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid and verified_at is not null
  )
$$;

-- ── leads ───────────────────────────────────────────────────────────────────────────────────────

alter table leads
  add constraint lead_lengths check (
    length(source_site) <= 40 and length(name) between 2 and 100 and length(mobile) <= 40 and length(email) <= 254
    and length(interest) <= 120 and length(budget) <= 80 and length(viewing_time) <= 80 and length(message) <= 2000
    and length(lost_reason) <= 300
  ),
  add constraint lost_has_reason check (stage <> 'lost' or trim(coalesce(lost_reason, '')) <> '');

-- a new lead goes to its listing's agent, or else the default agent in Settings
create function leads_assign() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.agent_id is null and new.listing_id is not null then
    select l.agent_id into new.agent_id from public.listings l where l.id = new.listing_id;
  end if;
  if new.agent_id is null then
    select nullif(value, '')::bigint into new.agent_id from public.settings where key = 'default_agent_id';
  end if;
  if new.agent_id is not null and not exists (select 1 from public.admin_users where id = new.agent_id and active) then
    new.agent_id := null;
  end if;
  return new;
end $$;
create trigger assign before insert on leads for each row execute function leads_assign();

-- the activity log knows which lead each row is about, so a lead deleted on request takes its
-- history with it
alter table activity add column lead_id bigint;
create index activity_lead on activity (lead_id) where lead_id is not null;

create or replace function log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  changes jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(o -> k, n -> k)) into changes
    from jsonb_object_keys(n) k
    where (o -> k) is distinct from (n -> k) and k <> 'updated_at';
    if changes is null then return null; end if;
  elsif tg_op = 'DELETE' and tg_table_name in ('leads', 'lead_notes', 'reminders') then
    changes := null; -- a deleted lead leaves no personal details behind
  else
    changes := r;
  end if;
  insert into public.activity (entity, entity_id, user_email, action, changes, lead_id)
  values (
    tg_table_name, r ->> coalesce(nullif(tg_argv[0], ''), 'id'), auth.jwt() ->> 'email', lower(tg_op), changes,
    case tg_table_name when 'leads' then (r ->> 'id')::bigint when 'lead_notes' then (r ->> 'lead_id')::bigint when 'reminders' then (r ->> 'lead_id')::bigint end
  );
  return null;
end $$;

-- Deletion on request (Data Privacy Act): the lead, its notes, reminders and history go; what
-- stays is one line saying who deleted lead #n and when.
create function delete_lead(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  delete from public.leads where id = p_id;
  if not found then raise exception 'No such lead'; end if;
  delete from public.activity where lead_id = p_id;
  insert into public.activity (entity, entity_id, user_email, action)
  values ('leads', p_id::text, auth.jwt() ->> 'email', 'deleted on request');
end $$;

-- ── the commission log, as the Annex B report needs it (no fees are worked out here) ────────────

-- a row is a sale (date of sale), and once commission comes in, each release of it (paid on, gross)
alter table commissions
  add column sale_date date not null,
  add column cancelled boolean not null default false, -- cancelled before any commission: doesn't count
  alter column received_on drop not null,
  alter column gross drop not null,
  alter column release drop not null,
  add constraint paid_has_amount check ((received_on is null) = (gross is null)),
  add constraint unit_code_length check (length(unit_code) <= 60);

-- ── settings: the broker's licence validity is shown with it (contract 9.2) ─────────────────────

alter table settings drop constraint settings_key_check;
alter table settings add constraint settings_key_check
  check (key in ('contract_effective_date', 'broker_name', 'broker_prc_no', 'broker_prc_valid_until', 'broker_firm', 'default_agent_id'));

create or replace function public_listing(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'listing', jsonb_build_object('slug', l.slug, 'title', l.title, 'type', l.type, 'project', l.project, 'location', l.location,
      'price_min', l.price_min, 'price_max', l.price_max, 'unit_type', l.unit_type, 'floor_area', l.floor_area,
      'description', l.description, 'status', l.status, 'lts_no', l.lts_no, 'published_at', l.published_at, 'updated_at', l.updated_at),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('key', p.storage_key, 'alt', p.alt) order by p.sort, p.id)
      from public.listing_photos p where p.listing_id = l.id), '[]'),
    'broker', (select jsonb_build_object(
        'name', max(value) filter (where key = 'broker_name'),
        'prc', max(value) filter (where key = 'broker_prc_no'),
        'valid_until', max(value) filter (where key = 'broker_prc_valid_until'),
        'firm', max(value) filter (where key = 'broker_firm'))
      from public.settings),
    'agent', (select jsonb_build_object('name', a.name, 'phone', a.phone) from public.admin_users a where a.id = l.agent_id and a.active)
  )
  from public.listings l
  where l.slug = p_slug and public.is_public(l)
$$;

-- only what's meant to be called
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public_listings(text), public_listing(text), photo_is_public(text) to anon, authenticated;
grant execute on function is_admin(), delete_lead(bigint) to authenticated;
