-- Files dropped into the Mons chat (admin/src/pages/Mons.jsx): screenshots, flyers, price lists.
-- The Worker hands them to Gemini with the message they came with; later messages only name them,
-- so a long PDF is paid for once. Images, PDFs and plain text: what Gemini reads as it is.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mons-uploads', 'mons-uploads', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain', 'text/csv']);
create policy "admins use mons uploads" on storage.objects for all to authenticated
  using (bucket_id = 'mons-uploads' and public.is_admin())
  with check (bucket_id = 'mons-uploads' and public.is_admin());

-- on a message: [{ path, name, type, size }]
alter table mons_messages add column if not exists attachments jsonb not null default '[]';
