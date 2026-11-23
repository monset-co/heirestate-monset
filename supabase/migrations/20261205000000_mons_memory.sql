-- Where Mons's memory index has got to, per kind (note, wa, lead): the last row id it has indexed
-- (admin/worker/memory.js). Only the Worker's cron touches it, with the secret key.
create table mons_index_state (
  kind text primary key check (kind in ('note', 'wa', 'lead')),
  last_id bigint not null default 0
);
alter table mons_index_state enable row level security;
