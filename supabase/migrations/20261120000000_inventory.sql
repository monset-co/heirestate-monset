-- Inventory: every property the team can offer, from owners and other brokers, whether or not it's
-- on a public site (that's `listings`). Started from the "RPL FB Account" sheet of the team's
-- Property Listings Library (scripts/inventory_from_xlsx.py), then kept here. Its columns follow the
-- sheet's so it reads the same; the free-text ones stay free text, as the sheet has them.

create table inventory (
  id bigint generated always as identity primary key,
  -- what's on offer and what's happened, as in the sheet's Status; the page's tabs come from these
  status text[] not null default '{}' check (status <@ array['Pre-selling', 'For Rent', 'Rented', 'For Sale', 'Sold', 'For Assume', 'Reserved', 'Unavailable']),
  type text check (length(type) <= 200), -- "Studio Unit, With balcony", "House & Lot, 3BR"
  location text check (length(location) <= 500),
  price bigint check (price >= 0), -- pesos: a sale price, or a month's rent
  price_text text check (length(price_text) <= 500), -- when it isn't one number: "Rent: ₱35,000 / Sale: ₱5,500,000"
  price_note text check (length(price_note) <= 1000),
  available boolean, -- null: not known
  available_from date,
  furnishing text check (length(furnishing) <= 100),
  specs text check (length(specs) <= 4000),
  inclusions text check (length(inclusions) <= 4000),
  payment_terms text check (length(payment_terms) <= 2000),
  notes text check (length(notes) <= 8000), -- amenities and anything else
  pet_friendly text check (pet_friendly in ('yes', 'no', 'unconfirmed')),
  summary text check (length(summary) <= 4000), -- the ready-to-post description
  -- where it came from and where it's posted
  source text check (length(source) <= 300), -- the owner or broker
  source_url text check (source_url ~ '^https?://'),
  fb_posted_on date,
  fb_post_note text check (length(fb_post_note) <= 300), -- "tbp", "owner no reply yet"
  fb_post_url text check (fb_post_url ~ '^https?://'),
  rph_code text check (length(rph_code) <= 100), -- Rent.ph
  rph_url text check (rph_url ~ '^https?://'),
  fh_code text check (length(fh_code) <= 100), -- Filipino Homes
  fh_url text check (fh_url ~ '^https?://'),
  -- papers in hand
  rapa boolean not null default false,
  ats boolean not null default false,
  pictures boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inventory_status on inventory using gin (status);

create trigger log after insert or update or delete on inventory for each row execute function log_activity();
create trigger touch before update on inventory for each row execute function touch();

alter table inventory enable row level security;
create policy admins on inventory for all to authenticated using (is_admin()) with check (is_admin());
revoke all on inventory from anon;
