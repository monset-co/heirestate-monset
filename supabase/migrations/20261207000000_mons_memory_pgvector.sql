-- Mons's memory moves from Vectorize into Postgres (pgvector, as the knowledge base): one database
-- to run, and search filtered by the same row-level security as everything else. It also takes the
-- team chat: past the newest 10 messages she no longer re-reads it every time, she looks it up.
create extension if not exists vector with schema extensions;

create table mons_memory (
  kind text not null check (kind in ('note', 'wa', 'lead', 'chat')),
  ref_id bigint not null, -- the row's id in lead_notes, wa_messages, leads or mons_messages
  embedding extensions.vector(1024) not null, -- bge-m3
  primary key (kind, ref_id)
);
create index mons_memory_ann on mons_memory using hnsw (embedding extensions.vector_cosine_ops);
alter table mons_memory enable row level security;
create policy admins_read on mons_memory for select to authenticated using ((select is_admin()));

-- the closest rows by meaning; the Worker then reads each one as the asker, so a deleted row or
-- one they can't see drops out there
create function match_memory(query extensions.vector(1024), k int default 10)
returns table (kind text, ref_id bigint, similarity real)
language sql stable set search_path = public, extensions as $$
  select kind, ref_id, (1 - (embedding <=> query))::real from mons_memory
  order by embedding <=> query limit least(greatest(k, 1), 20);
$$;
grant execute on function match_memory(extensions.vector, int) to authenticated;

-- the cron's place in each kind, chat included
alter table mons_index_state drop constraint if exists mons_index_state_kind_check;
alter table mons_index_state add constraint mons_index_state_kind_check check (kind in ('note', 'wa', 'lead', 'chat'));
