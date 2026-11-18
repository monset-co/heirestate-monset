-- The team's own files, not any one client's: Documents (forms, price lists, spreadsheets, CSV
-- exports) and Presentations (decks to show a client), each its own admin page. Plus the
-- notification bell: every alert the admin Worker sends (admin/worker/push.js) is kept here too, so
-- it's in the app whether or not that device has push turned on.

-- ── documents and presentations ─────────────────────────────────────────────────────────────────
-- The file is in the private library bucket at <shelf>/<uuid>-<name>.
create table library_files (
  id bigint generated always as identity primary key,
  shelf text not null check (shelf in ('documents', 'presentations')),
  file_path text not null unique check (file_path ~ '^(documents|presentations)/'),
  file_name text not null check (length(file_name) between 1 and 200),
  size bigint,
  uploaded_by text default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index library_files_shelf on library_files (shelf, created_at desc);
alter table library_files enable row level security;
create policy admins on library_files for all to authenticated using (is_admin()) with check (is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library', 'library', false, 52428800, array[
  'application/pdf', 'text/csv', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);
create policy "admins manage the library" on storage.objects for all to authenticated
  using (bucket_id = 'library' and public.is_admin())
  with check (bucket_id = 'library' and public.is_admin());

-- ── the notification bell ───────────────────────────────────────────────────────────────────────
-- Written by the admin Worker (its secret key passes row-level security); each admin reads, marks
-- read and clears only their own.
create table notifications (
  id bigint generated always as identity primary key,
  email text not null references admin_users (email) on update cascade on delete cascade,
  title text not null check (length(title) <= 200),
  body text check (length(body) <= 500),
  url text check (url ~ '^/'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_inbox on notifications (email, created_at desc);
alter table notifications enable row level security;
create policy own on notifications for all to authenticated
  using (is_admin() and email = lower(auth.jwt() ->> 'email'))
  with check (is_admin() and email = lower(auth.jwt() ->> 'email'));
-- new ones reach an open app at once (Supabase Realtime, which keeps to the policy above)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
