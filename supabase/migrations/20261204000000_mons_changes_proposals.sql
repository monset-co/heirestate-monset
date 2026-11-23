-- The live mons_messages was made from an early draft of 20261202000000_mons.sql, before these two
-- columns were added to it, so that migration counts as applied without them. Every /api/mons call
-- then failed on its first read ("Something went wrong").
alter table mons_messages add column if not exists changes jsonb not null default '[]';
alter table mons_messages add column if not exists proposals jsonb not null default '[]';
notify pgrst, 'reload schema';
