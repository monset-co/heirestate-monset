-- A lead's files, in the folders a pre-selling buyer's papers go in, and notes that stick.

-- ── sticky notes: a note can be pinned to the top of the lead, in a colour ──────────────────────
alter table lead_notes
  add column pinned boolean not null default false,
  add column color text not null default 'yellow' check (color in ('yellow', 'pink', 'blue', 'green')),
  add constraint note_length check (length(body) between 1 and 4000);

-- ── files ───────────────────────────────────────────────────────────────────────────────────────
-- The file itself is in the private client-files bucket at <lead id>/<uuid>-<name>. Storage keeps
-- SQL from deleting its objects, so the admin removes a lead's files before delete_lead runs.
create table lead_files (
  id bigint generated always as identity primary key,
  lead_id bigint not null references leads (id) on delete cascade,
  folder text not null default 'other'
    check (folder in ('ids', 'income', 'reservation', 'contract', 'payments', 'presentations', 'whatsapp', 'other')),
  file_path text not null unique check (file_path ~ '^\d+/'),
  file_name text not null check (length(file_name) between 1 and 200),
  size bigint,
  uploaded_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index lead_files_lead on lead_files (lead_id, folder);
alter table lead_files enable row level security;
create policy admins on lead_files for all to authenticated using (is_admin()) with check (is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-files', 'client-files', false, 26214400, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);
create policy "admins manage client files" on storage.objects for all to authenticated
  using (bucket_id = 'client-files' and public.is_admin())
  with check (bucket_id = 'client-files' and public.is_admin());
