-- A building a client prefers is its own wish, apart from "where": "Solinea or 38 Park Avenue"
-- is a different ask from "Cebu Business Park". Buildings picked under Where so far move here.

alter table leads add column buildings text[] not null default '{}' check (cardinality(buildings) <= 30);

-- what's under Where that isn't a district or a city is a building (admin/src/match.js AREAS)
with places(name) as (values
  ('IT Park'), ('Lahug'), ('Banilad'), ('Talamban'), ('Mabolo'), ('Cebu Business Park'), ('Kasambagan'), ('Guadalupe'),
  ('Banawa'), ('Busay'), ('Capitol / Fuente'), ('Labangon'), ('Tisa'), ('Anywhere in Cebu City'), ('Mandaue'),
  ('Lapu-Lapu / Mactan'), ('Talisay'), ('Minglanilla'), ('Consolacion'), ('Liloan'), ('Cordova'), ('Naga'))
update leads set
  buildings = array(select a from unnest(areas) a where a not in (select name from places)),
  areas = array(select a from unnest(areas) a where a in (select name from places))
where exists (select 1 from unnest(areas) a where a not in (select name from places));

alter table leads drop constraint leads_priorities_check;
alter table leads add constraint leads_priorities_check check (priorities <@ array['kind', 'size', 'area', 'building', 'near', 'furnishing', 'budget', 'when']);
