-- A property's building (condominium or development), so "Where → a building" lists whatever
-- buildings the inventory has: a new one becomes a choice the moment a property in it is added.
-- Filled in here for what's already in, from the names the sheet uses however it spells them.

alter table inventory add column building text check (length(building) between 2 and 120);
create index inventory_building on inventory (building) where building is not null;

update inventory i set building = (
  select b.name from (values
    (1, '38 Park Avenue', '38 park'),
    (2, 'Amalfi Oasis (SRP)', 'amalfi'),
    (3, 'ARC Towers', 'arc towers'),
    (4, 'Avalon Condominium', 'avalon'),
    (5, 'Avida Towers Cebu (IT Park)', 'avida towers (cebu|i\.?\s?t\.? park)'),
    (6, 'Avida Towers Riala', 'riala'),
    (7, 'Baseline Residences', 'base ?line'),
    (8, 'Botanika Garden Residences', 'botanika'),
    (9, 'Casa Mira Towers Guadalupe', 'casa mira.*guadalupe'),
    (10, 'Casa Mira Towers Mandaue', 'casa mira.*mandaue'),
    (11, 'City Clou', 'city clou'),
    (12, 'City Suites Ramos', 'city suites'),
    (13, 'Club Ultima', 'club ultima'),
    (14, 'East Aurora', 'east aurora'),
    (15, 'Grand Residences', 'grand residences'),
    (16, 'Horizon 101', 'horizon 101'),
    (17, 'Le Menda Residences', 'le menda'),
    (18, 'Mabolo Garden Flats', 'mabolo garden'),
    (19, 'Mandani Bay', 'mandani'),
    (20, 'Marco Polo Residences', 'marco polo'),
    (21, 'Mivela Garden Residences', 'mivela'),
    (22, 'Mivesa Garden Residences', 'mivesa'),
    (23, 'Northwoods Place', 'northwoods'),
    (24, 'One Oasis', 'one oasis'),
    (25, 'Pacific Grande Residences', 'pacific grande'),
    (26, 'Parkpoint Residences', 'park ?point'),
    (27, 'Royal Oceancrest', 'oceancrest'),
    (28, 'Saekyung 956', 'saekyung'),
    (29, 'San Remo Oasis', 'san remo'),
    (30, 'Solinea', 'solinea'),
    (31, 'Sunvida Tower', 'sunvida'),
    (32, 'Symfoni Nichols', 'symfoni'),
    (33, 'Taft East Gate', 'taft east'),
    (34, 'Tambuli Seaside Living', 'tambuli'),
    (35, 'The Alcoves', 'alcoves'),
    (36, 'The Median', 'the median'),
    (37, 'The Midpoint Residences', 'midpoint'),
    (38, 'The Padgett Place', 'padgett'),
    (39, '32 Sanson by Rockwell', '32 sanson'),
    (40, 'Ultima Residences', 'ultima residences'),
    (41, 'Urban Deca Homes Banilad', 'urban deca'),
    (42, 'Vertex Central', 'vertex central'),
    (43, 'West Jones Residences', 'west ?jones')
  ) b(n, name, re)
  where i.location ~* b.re
  order by b.n limit 1)
where building is null and location is not null;
