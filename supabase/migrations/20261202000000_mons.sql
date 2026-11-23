-- Mons, the admin's assistant (admin/worker/mons.js, admin/src/pages/Mons.jsx). One chat the whole
-- team shares for now: each message says who wrote it, or that Mons did. The Worker writes both
-- sides with the asker's own sign-in, so row-level security and the activity log see a real person.
create table mons_messages (
  id bigint generated always as identity primary key,
  from_mons boolean not null default false,
  author text not null default lower(auth.jwt() ->> 'email'), -- for Mons's replies: who asked
  body text not null check (length(body) between 1 and 20000),
  -- on her replies: what she changed on her own [{ text, url }], and what waits for someone to
  -- confirm [{ kind, args, summary, url, state: pending | done | declined | failed, note, by }]
  changes jsonb not null default '[]',
  proposals jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index mons_messages_at on mons_messages (created_at desc);
alter table mons_messages enable row level security;
create policy admins on mons_messages for all to authenticated using ((select is_admin())) with check ((select is_admin()));

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table mons_messages;
  end if;
end $$;
