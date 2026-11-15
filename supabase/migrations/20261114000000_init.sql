-- Heir Estates admin on Supabase: listings, the CRM and the commission log.
--
-- Who can do what:
--   * admins (an active row in admin_users whose email matches the signed-in user) can read and
--     change everything, through row-level security;
--   * the public sites (the anon key) can read published listings only, through public_listings()
--     and public_listing(), and their photos; no table is readable by anon directly;
--   * nobody can sign up unless an admin has added their email first (before_user_created hook).
--
-- Personal data lives only in leads and lead_notes. Never add fields for government IDs, TINs or
-- income documents.

-- ── who is an admin ─────────────────────────────────────────────────────────────────────────────

create table admin_users (
  id bigint generated always as identity primary key,
  email text not null unique check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  name text not null check (length(name) between 2 and 100),
  phone text check (length(phone) <= 40),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create function is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and active
  )
$$;

-- ── listings ────────────────────────────────────────────────────────────────────────────────────

create table listings (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title text not null check (length(title) between 2 and 150),
  -- project and RFO units, or a non-project listing: resale, rental or lot
  type text not null check (type in ('project_unit', 'rfo_unit', 'resale', 'rental', 'lot')),
  project text, -- an id from `order` in src/projects.js
  location text,
  price_min bigint check (price_min >= 0), -- pesos; one price: price_max null; neither: price on request
  price_max bigint check (price_max >= price_min),
  unit_type text,
  floor_area numeric(10, 2) check (floor_area > 0), -- sqm
  description text check (length(description) <= 8000),
  status text not null default 'available' check (status in ('available', 'reserved', 'sold', 'hidden')),
  lts_no text, -- DHSUD License to Sell, for project and RFO units
  owner_authority boolean not null default false, -- for non-project listings
  published boolean not null default false,
  published_at timestamptz, -- the first time it went public; the slug is fixed from then on
  agent_id bigint references admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint range_has_minimum check (price_max is null or price_min is not null),
  constraint project_unit_has_project check (type <> 'project_unit' or project is not null),
  constraint lts_before_publishing check (not published or type not in ('project_unit', 'rfo_unit') or trim(coalesce(lts_no, '')) <> ''),
  constraint authority_before_publishing check (not published or type in ('project_unit', 'rfo_unit') or owner_authority)
);
create index listings_public on listings (published, status, project);

create table listing_photos (
  id bigint generated always as identity primary key,
  listing_id bigint not null references listings (id) on delete cascade,
  storage_key text not null unique, -- <listing id>/<uuid>.webp in the listing-photos bucket
  alt text check (length(alt) <= 200),
  sort int not null default 0
);
create index listing_photos_listing on listing_photos (listing_id, sort);

create table settings (
  key text primary key check (key in ('contract_effective_date', 'broker_name', 'broker_prc_no', 'broker_firm', 'default_agent_id')),
  value text check (length(value) <= 200)
);

-- ── the CRM (phase 3) ───────────────────────────────────────────────────────────────────────────

create table leads (
  id bigint generated always as identity primary key,
  source_site text not null, -- 'main' or a project id
  listing_id bigint references listings (id) on delete set null,
  name text not null,
  mobile text not null,
  email text not null,
  interest text,
  budget text,
  viewing_time text,
  message text,
  consent_at timestamptz not null, -- when they ticked the privacy consent, recorded by the server
  agent_id bigint references admin_users (id) on delete set null,
  stage text not null default 'new' check (stage in ('new', 'contacted', 'viewing', 'reserved', 'closed', 'lost')),
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_agent_stage on leads (agent_id, stage);
create index leads_created on leads (created_at);

create table lead_notes (
  id bigint generated always as identity primary key,
  lead_id bigint not null references leads (id) on delete cascade,
  author_email text default (auth.jwt() ->> 'email'),
  body text not null,
  created_at timestamptz not null default now()
);
create index lead_notes_lead on lead_notes (lead_id);

create table reminders (
  id bigint generated always as identity primary key,
  lead_id bigint not null references leads (id) on delete cascade,
  agent_id bigint references admin_users (id) on delete set null,
  due_at timestamptz not null,
  body text not null,
  done_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index reminders_due on reminders (due_at) where done_at is null;

-- ── commissions (phase 4) ───────────────────────────────────────────────────────────────────────

-- One row per commission release. No buyer names or personal details, ever: the monthly report
-- goes to the client as it is.
create table commissions (
  id bigint generated always as identity primary key,
  received_on date not null,
  project text,
  listing_id bigint references listings (id) on delete set null,
  unit_code text not null,
  via_sites boolean not null, -- came through the sites
  payment_mode text not null check (payment_mode in ('full_cash', 'bank_financing', 'installment')),
  release text not null check (release in ('full', 'partial')),
  gross numeric(14, 2) not null check (gross >= 0), -- pesos
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (project is not null or listing_id is not null)
);
create index commissions_received on commissions (received_on);

-- ── the activity log: every change, who made it, each field's old and new value ────────────────

create table activity (
  id bigint generated always as identity primary key,
  entity text not null, -- the table
  entity_id text,
  user_email text,
  action text not null, -- insert, update, delete
  changes jsonb,
  at timestamptz not null default now()
);
create index activity_entity on activity (entity, entity_id);

create function log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  changes jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(o -> k, n -> k)) into changes
    from jsonb_object_keys(n) k
    where (o -> k) is distinct from (n -> k) and k <> 'updated_at';
    if changes is null then return null; end if;
  elsif tg_op = 'DELETE' and tg_table_name in ('leads', 'lead_notes') then
    changes := null; -- a lead deleted on request leaves no personal details behind
  else
    changes := coalesce(n, o);
  end if;
  insert into public.activity (entity, entity_id, user_email, action, changes)
  values (tg_table_name, coalesce(n, o) ->> coalesce(nullif(tg_argv[0], ''), 'id'), auth.jwt() ->> 'email', lower(tg_op), changes);
  return null;
end $$;

create trigger log after insert or update or delete on admin_users for each row execute function log_activity();
create trigger log after insert or update or delete on listings for each row execute function log_activity();
create trigger log after insert or update or delete on listing_photos for each row execute function log_activity();
create trigger log after insert or update or delete on settings for each row execute function log_activity('key');
create trigger log after insert or update or delete on leads for each row execute function log_activity();
create trigger log after insert or update or delete on lead_notes for each row execute function log_activity();
create trigger log after insert or update or delete on reminders for each row execute function log_activity();
create trigger log after insert or update or delete on commissions for each row execute function log_activity();

-- ── rules the database keeps, whatever sends the change ─────────────────────────────────────────

create function touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger touch before update on listings for each row execute function touch();
create trigger touch before update on leads for each row execute function touch();
create trigger touch before update on commissions for each row execute function touch();

-- a listing's address is fixed once published; it goes public only with the broker's details set
create function listings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type in ('resale', 'rental', 'lot') then new.project := null; end if;
  if tg_op = 'UPDATE' then
    new.published_at := old.published_at;
    if old.published_at is not null and new.slug <> old.slug then
      raise exception 'The address can''t change once the listing has been published';
    end if;
  end if;
  if new.published then
    if not exists (select 1 from public.settings where key = 'broker_name' and trim(coalesce(value, '')) <> '')
       or not exists (select 1 from public.settings where key = 'broker_prc_no' and trim(coalesce(value, '')) <> '') then
      raise exception 'Add the broker''s name and PRC licence no. in Settings before publishing';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end $$;
create trigger guard before insert or update on listings for each row execute function listings_guard();

-- no one switches off their own account, or turns their own email into someone else's
create function admin_users_guard() returns trigger
language plpgsql as $$
begin
  if old.email = lower(coalesce(auth.jwt() ->> 'email', '')) and (not new.active or new.email <> old.email) then
    raise exception 'You can''t switch off or rename your own account';
  end if;
  return new;
end $$;
create trigger guard before update on admin_users for each row execute function admin_users_guard();

-- ── row-level security: admins everything, anyone else nothing ──────────────────────────────────

alter table admin_users enable row level security;
alter table listings enable row level security;
alter table listing_photos enable row level security;
alter table settings enable row level security;
alter table leads enable row level security;
alter table lead_notes enable row level security;
alter table reminders enable row level security;
alter table commissions enable row level security;
alter table activity enable row level security;

create policy admins on admin_users for all to authenticated using (is_admin()) with check (is_admin());
create policy admins on listings for all to authenticated using (is_admin()) with check (is_admin());
create policy admins on listing_photos for all to authenticated using (is_admin()) with check (is_admin());
create policy admins on settings for all to authenticated using (is_admin()) with check (is_admin());
create policy admins on leads for all to authenticated using (is_admin()) with check (is_admin());
create policy admins on lead_notes for all to authenticated using (is_admin()) with check (is_admin());
create policy admins on reminders for all to authenticated using (is_admin()) with check (is_admin());
create policy admins on commissions for all to authenticated using (is_admin()) with check (is_admin());
-- the log is written by its trigger only, and never edited
create policy admins_read on activity for select to authenticated using (is_admin());
revoke insert, update, delete on activity from anon, authenticated;

-- ── what the public sites may read (the anon key, from the public Worker) ───────────────────────

create function is_public(l public.listings) returns boolean
language sql immutable as $$ select l.published and l.status <> 'hidden' $$;

-- a project's own listings, or (no project) every public listing; sold ones included, the
-- Worker leaves them out of carousels and sitemaps
create function public_listings(p_project text default null)
returns table (slug text, title text, type text, project text, location text, price_min bigint, price_max bigint,
               unit_type text, floor_area numeric, status text, updated_at timestamptz, cover text)
language sql stable security definer set search_path = '' as $$
  select l.slug, l.title, l.type, l.project, l.location, l.price_min, l.price_max, l.unit_type, l.floor_area, l.status, l.updated_at,
    (select p.storage_key from public.listing_photos p where p.listing_id = l.id order by p.sort, p.id limit 1)
  from public.listings l
  where public.is_public(l) and (p_project is null or l.project = p_project)
  order by l.published_at desc
$$;

-- one public listing with its photos, the broker's details and its agent's name and phone
create function public_listing(p_slug text) returns jsonb
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
        'firm', max(value) filter (where key = 'broker_firm'))
      from public.settings),
    'agent', (select jsonb_build_object('name', a.name, 'phone', a.phone) from public.admin_users a where a.id = l.agent_id and a.active)
  )
  from public.listings l
  where l.slug = p_slug and public.is_public(l)
$$;

-- Supabase lets anon and authenticated call new functions by default: only these two are public
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public_listings(text), public_listing(text) to anon, authenticated;
grant execute on function is_admin(), is_public(public.listings) to authenticated;

-- ── listing photos: a private bucket ────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', false, 8388608, array['image/webp', 'image/jpeg', 'image/png']);

create policy "admins manage listing photos" on storage.objects for all to authenticated
  using (bucket_id = 'listing-photos' and public.is_admin())
  with check (bucket_id = 'listing-photos' and public.is_admin());

-- anyone may read a photo while its listing is public
create function photo_is_public(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.listing_photos p join public.listings l on l.id = p.listing_id
    where p.storage_key = p_key and public.is_public(l)
  )
$$;
grant execute on function photo_is_public(text) to anon, authenticated;
create policy "public photos of public listings" on storage.objects for select to anon, authenticated
  using (bucket_id = 'listing-photos' and public.photo_is_public(name));

-- ── sign-up only for emails an admin has added (Authentication > Hooks > Before User Created) ───

create function before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.admin_users where email = lower(event -> 'user' ->> 'email') and active) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'This email isn''t on the Heir Estates admin list'));
end $$;
revoke execute on function before_user_created(jsonb) from public, anon, authenticated;
grant execute on function before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

-- ── the first admin ─────────────────────────────────────────────────────────────────────────────

insert into admin_users (email, name) values ('heirestates.fh@gmail.com', 'Marilyn & Percival Laranjo');
