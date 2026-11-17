-- What a client wants, as fixed choices the team picks rather than types, so it can be matched
-- against the inventory (admin/src/match.js holds the same choices). The free-text fields added in
-- …_lead_categories.sql are sorted into them here, their words kept at the end of the notes.

alter table leads
  add column looking_to text[] not null default '{}' check (looking_to <@ array['Rent', 'Buy resale', 'Buy pre-selling', 'Assume balance', 'Sell or lease out']),
  add column property_types text[] not null default '{}' check (property_types <@ array['Condo', 'House & Lot', 'Townhouse', 'Lot', 'Commercial', 'Studio', '1BR', '2BR', '3BR+']),
  add column areas text[] not null default '{}' check (cardinality(areas) <= 30),
  add column furnishings text[] not null default '{}' check (furnishings <@ array['Fully furnished', 'Furnished', 'Semi-furnished', 'Finished', 'Unfurnished']),
  add column budget_max bigint check (budget_max >= 0), -- pesos: the most they'll pay (a month, for rentals)
  add column needed_by date; -- when they need to move in or buy by

update leads set looking_to = case category when 'rentals' then '{Rent}' when 'brokerage' then '{Buy resale}' else '{Buy pre-selling}' end::text[];

update leads set property_types = array_remove(array[
  case when property_type ~* 'condo|studio|loft|apartment' then 'Condo' end,
  case when property_type ~* 'house|h&l|bungalow|duplex|detached|attached|mansion' then 'House & Lot' end,
  case when property_type ~* 'townhouse|rowhouse' then 'Townhouse' end,
  case when property_type ~* '(^|,\s*)(corner |farm |residential )?lot\s*(,|$)' then 'Lot' end,
  case when property_type ~* 'commercial|office|warehouse|building|hotel' then 'Commercial' end,
  case when property_type ~* 'studio' then 'Studio' end,
  case when property_type ~* '\m1\s?BR' then '1BR' end,
  case when property_type ~* '\m2\s?BR' then '2BR' end,
  case when property_type ~* '\m([3-9]|1\d)\s?BR' then '3BR+' end
], null)
where property_type is not null;

update leads l set areas = coalesce((
  select array_agg(a.name order by a.n) from (values
    (1, 'IT Park', 'it park|apas'), (2, 'Lahug', 'lahug|nivel'), (3, 'Banilad', 'banilad'), (4, 'Talamban', 'talamban'),
    (5, 'Mabolo', 'mabolo'), (6, 'Cebu Business Park', 'business park|ayala|cbp'), (7, 'Kasambagan', 'kasambagan'),
    (8, 'Guadalupe', 'guadalupe'), (9, 'Banawa', 'banawa'), (10, 'Busay', 'busay'), (11, 'Capitol / Fuente', 'capitol|fuente|osme[ñn]a|ramos'),
    (12, 'Labangon', 'labangon'), (13, 'Tisa', 'tisa'), (14, 'Mandaue', 'mandaue'), (15, 'Lapu-Lapu / Mactan', 'lapu|mactan'),
    (16, 'Talisay', 'talisay'), (17, 'Minglanilla', 'minglanilla'), (18, 'Consolacion', 'consolacion'), (19, 'Liloan', 'liloan'),
    (20, 'Cordova', 'cordova'), (21, 'Naga', 'naga')
  ) a(n, name, re) where l.location ~* a.re), '{}')
where location is not null;
-- "Cebu City" with no district named: anywhere in it
update leads set areas = areas || '{Anywhere in Cebu City}'
where location ~* 'cebu city' and not areas && array['IT Park', 'Lahug', 'Banilad', 'Talamban', 'Mabolo', 'Cebu Business Park', 'Kasambagan', 'Guadalupe', 'Banawa', 'Busay', 'Capitol / Fuente', 'Labangon', 'Tisa'];

update leads set furnishings = array_remove(array[
  case when furnishing ~* 'fully furnished' then 'Fully furnished' end,
  case when furnishing ~* '(^|,\s*)furnished' then 'Furnished' end,
  case when furnishing ~* 'semi' then 'Semi-furnished' end,
  case when furnishing ~* '(^|,\s*)finished' then 'Finished' end,
  case when furnishing ~* 'unfurnished' then 'Unfurnished' end
], null)
where furnishing is not null;

-- the most they named: "50,000–110,000" → 110,000; "₱120,000 (can stretch to 150,000)" → 150,000
update leads set budget_max = (select max(replace(m[1], ',', '')::bigint) from regexp_matches(budget, '(\d[\d,]{3,})', 'g') m)
where budget ~ '\d[\d,]{3,}';

update leads set needed_by = target_date::date where target_date ~ '^\d{4}-\d{2}-\d{2}$';

-- the words as they were typed, so nothing said is lost
update leads set message = left(concat_ws(e'\n\n', message, 'As first written: ' || concat_ws('; ',
    'type ' || property_type, 'where ' || location, 'furnishing ' || furnishing, 'when ' || target_date)), 2000)
where coalesce(property_type, location, furnishing, target_date) is not null;

alter table leads drop column property_type, drop column location, drop column furnishing, drop column target_date;
