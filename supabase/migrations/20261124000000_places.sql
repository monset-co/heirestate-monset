-- Where things are, for "within N km of IT Park": a position on each property, found from its
-- location with OpenStreetMap (scripts/inventory_geocode.py, then the admin's Worker for new ones)
-- or pinned by hand on the map; and a place a client wants to be near, with how far they'll go.

alter table inventory
  add column lat double precision check (lat between 9 and 11.5), -- Cebu and around
  add column lng double precision check (lng between 123 and 125),
  -- how good the position is: a building or street, only the neighbourhood, or set on the map
  add column geo text check (geo in ('exact', 'approx', 'pinned')),
  add constraint position_whole check ((lat is null) = (lng is null) and (lat is null) = (geo is null));

alter table leads
  add column near text check (length(near) <= 80), -- a landmark's name (admin/src/places.js)
  add column near_km real check (near_km > 0 and near_km <= 50);

-- "near" joins the wishes a lead can mark as what matters most
alter table leads drop constraint leads_priorities_check;
alter table leads add constraint leads_priorities_check check (priorities <@ array['kind', 'size', 'area', 'furnishing', 'budget', 'when', 'near']);
