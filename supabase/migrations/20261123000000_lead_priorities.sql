-- The wishes that matter most to a client (where, budget, …): ticked on the lead's matches, they
-- rank the inventory that meets them first, and can narrow it to only those (admin/src/match.js).
alter table leads
  add column priorities text[] not null default '{}' check (priorities <@ array['kind', 'size', 'area', 'furnishing', 'budget', 'when']);
