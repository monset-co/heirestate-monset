-- Mons gets a private chat with each person beside the team's (admin/src/pages/Mons.jsx, and the
-- panel on every desktop page), and writes in it on her own: reminders and suggestions from the
-- Worker's cron (admin/worker/nudges.js). Safe to run again.
-- thread: null is the team chat; an email is that person's private chat, which only they can read.
alter table mons_messages add column if not exists thread text references admin_users (email) on update cascade on delete cascade;
create index if not exists mons_messages_thread_at on mons_messages (thread, created_at desc);
-- whatever the live policies are called (the live table was made from an earlier draft), they go,
-- and this one takes their place
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'mons_messages' loop
    execute format('drop policy %I on public.mons_messages', p.policyname);
  end loop;
end $$;
create policy admins on mons_messages for all to authenticated
  using ((select is_admin()) and (thread is null or thread = lower(auth.jwt() ->> 'email')))
  with check ((select is_admin()) and (thread is null or thread = lower(auth.jwt() ->> 'email')));

-- what she has already said on her own, so each reminder or suggestion comes once
-- ("cold:42:2026-11-20", "match:42:17"). Only the Worker, with the secret key, touches it.
create table if not exists mons_nudges (
  key text primary key check (length(key) <= 200),
  created_at timestamptz not null default now()
);
alter table mons_nudges enable row level security;
notify pgrst, 'reload schema';
