-- Leads in three kinds, each its own tab: pre-selling (the project sites), rentals and brokerage
-- (resale and lots, for the team's own inventory). Leads can now be added by hand too, from
-- WhatsApp, Rent.ph, Filipino Homes and the rest, with what they're looking for: the columns of the
-- team's "CLF" sheet, which seeds them (scripts/leads_from_xlsx.py).

alter table leads
  add column category text not null default 'pre-selling' check (category in ('pre-selling', 'rentals', 'brokerage')),
  add column property_type text check (length(property_type) <= 200), -- "House & Lot, 3BR"
  add column location text check (length(location) <= 300), -- where they want it
  add column furnishing text check (length(furnishing) <= 200),
  add column target_date text check (length(target_date) <= 120); -- "January or February 2027"

-- an inquiry from a listing page is the kind its listing is
create function leads_category() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.listing_id is not null then
    select case l.type when 'rental' then 'rentals' when 'resale' then 'brokerage' when 'lot' then 'brokerage' else 'pre-selling' end
    into new.category from public.listings l where l.id = new.listing_id;
  end if;
  return new;
end $$;
create trigger category before insert on leads for each row execute function leads_category();
revoke execute on function leads_category() from public, anon, authenticated;

update leads l set category = case li.type when 'rental' then 'rentals' when 'resale' then 'brokerage' when 'lot' then 'brokerage' else 'pre-selling' end
from listings li where li.id = l.listing_id;
