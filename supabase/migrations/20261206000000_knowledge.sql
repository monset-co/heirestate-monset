-- 1. What each Mons reply cost, by part (admin/worker/mons.js answer()): prompt, cached, output,
--    thinking, rounds, and the characters each tool sent back. Shown small under her replies.
alter table mons_messages add column if not exists usage jsonb;

-- 2. The knowledge base: real estate know-how Mons looks up instead of guessing or carrying it in
--    every prompt. Written as Markdown in knowledge/ (reviewable, versioned), loaded by
--    scripts/load-knowledge.js; the Worker's cron fills in the embeddings (admin/worker/knowledge.js).
--    scope 'shared' is general Philippine know-how meant for every client of the product; a client's
--    own playbooks carry their name. Built to be lifted into its own project when there's a second
--    client: nothing here points at this admin's other tables.
create extension if not exists vector with schema extensions;

create table knowledge_docs (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'), -- the file name, knowledge/<slug>.md
  scope text not null default 'shared' check (scope ~ '^[a-z0-9-]{2,40}$'),
  title text not null check (length(title) between 2 and 200),
  source text check (length(source) <= 500), -- what it rests on: "RA 6552 (Maceda Law)", "Heir Estates practice"
  source_url text check (source_url ~ '^https?://'),
  valid_as_of date, -- when the facts were last checked
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'retired')),
  reviewed_by text check (length(reviewed_by) <= 200), -- the licensed broker who checked it
  updated_at timestamptz not null default now()
);

create table knowledge_chunks (
  id bigint generated always as identity primary key,
  doc_id bigint not null references knowledge_docs (id) on delete cascade,
  step text check (step ~ '^[a-z0-9-]{2,40}$'), -- the process step it belongs to: reservation, cts, papers, financing…
  heading text not null check (length(heading) between 2 and 200),
  body text not null check (length(body) between 1 and 6000),
  embedding extensions.vector(1024), -- bge-m3; null until the cron gets to it
  created_at timestamptz not null default now()
);
create index knowledge_chunks_doc on knowledge_chunks (doc_id);
create index knowledge_chunks_ann on knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- the web: how pieces lead to each other ("reserved" → "papers due" → "what if they're late")
create table knowledge_links (
  from_chunk bigint not null references knowledge_chunks (id) on delete cascade,
  to_chunk bigint not null references knowledge_chunks (id) on delete cascade,
  relation text not null check (relation in ('next', 'requires', 'see-also')),
  primary key (from_chunk, to_chunk)
);

alter table knowledge_docs enable row level security;
alter table knowledge_chunks enable row level security;
alter table knowledge_links enable row level security;
create policy admins_read on knowledge_docs for select to authenticated using ((select is_admin()));
create policy admins_read on knowledge_chunks for select to authenticated using ((select is_admin()));
create policy admins_read on knowledge_links for select to authenticated using ((select is_admin()));

-- the ANN search: the closest live pieces for these scopes, with their doc's standing and the pieces
-- they link to (headings only, to keep her prompt small)
create function match_knowledge(query extensions.vector(1024), scopes text[], k int default 5)
returns table (id bigint, heading text, body text, step text, title text, source text, source_url text, valid_as_of date, status text, similarity real, related text[])
language sql stable set search_path = public, extensions as $$
  select c.id, c.heading, c.body, c.step, d.title, d.source, d.source_url, d.valid_as_of, d.status,
    (1 - (c.embedding <=> query))::real,
    array(select t.heading from knowledge_links l join knowledge_chunks t on t.id = l.to_chunk where l.from_chunk = c.id)
  from knowledge_chunks c join knowledge_docs d on d.id = c.doc_id
  where c.embedding is not null and d.status <> 'retired' and d.scope = any (scopes)
  order by c.embedding <=> query
  limit least(greatest(k, 1), 10);
$$;
grant execute on function match_knowledge(extensions.vector, text[], int) to authenticated;
