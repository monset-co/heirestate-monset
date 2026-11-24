-- Word and Excel files can be dropped into the Mons chat too: the Worker reads their text out of
-- them (admin/worker/drafts.js docxText, xlsxText), since Gemini doesn't read them as they are.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
where id = 'mons-uploads';
