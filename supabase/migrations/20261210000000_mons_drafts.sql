-- Documents Mons drafts from the Word templates in Documents (admin/worker/drafts.js) are saved in
-- mons-uploads under drafts/, so the bucket takes Word files too. People still attach only what
-- she can read (the page and the Worker allow images, PDFs and text).
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id = 'mons-uploads';
