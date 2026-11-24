-- Security audit, 2026-11-24.

-- 1. Mons's messages: people write only their own, plain messages. Her replies, what she changed,
--    what waits for Confirm and what it cost are written by the Worker alone (secret key,
--    admin/worker/mons.js), so nobody can plant a Confirm card that does something other than it
--    says, post as a colleague, or zero the token count to get round the monthly cap.
drop policy admins on mons_messages;
create policy admins_read on mons_messages for select to authenticated using ((select is_admin()));
create policy own_messages on mons_messages for insert to authenticated with check (
  (select is_admin()) and not from_mons and author = lower(auth.jwt() ->> 'email')
  and tokens = 0 and usage is null and changes = '[]' and proposals = '[]'
);
revoke update, delete on mons_messages from authenticated;

-- 2. Deleting a lead on request also forgets what Mons's memory holds about them (no foreign key
--    there to cascade). Their stored files are removed by the page before it calls this.
create or replace function delete_lead(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  delete from public.mons_memory where (kind = 'lead' and ref_id = p_id)
    or (kind = 'note' and ref_id in (select id from public.lead_notes where lead_id = p_id))
    or (kind = 'wa' and ref_id in (select m.id from public.wa_messages m join public.wa_threads t on t.id = m.thread_id where t.lead_id = p_id));
  delete from public.wa_threads where lead_id = p_id;
  delete from public.leads where id = p_id;
  if not found then raise exception 'No such lead'; end if;
  delete from public.activity where lead_id = p_id;
  insert into public.activity (entity, entity_id, user_email, action)
  values ('leads', p_id::text, auth.jwt() ->> 'email', 'deleted on request');
end $$;

-- 3. Who wrote, uploaded or checked something is whoever is signed in, not what the request says
--    ("verified by Marily" can't be typed in). The Worker's own writes, with no one signed in,
--    keep the name they give.
create function stamp_author() returns trigger language plpgsql set search_path = '' as $$
begin
  new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0],
    coalesce(lower(auth.jwt() ->> 'email'), to_jsonb(new) ->> tg_argv[0])));
  return new;
end $$;
revoke execute on function stamp_author() from public, anon, authenticated;
create trigger stamp_author before insert on lead_notes for each row execute function stamp_author('author_email');
create trigger stamp_author before insert on lead_files for each row execute function stamp_author('uploaded_by');
create trigger stamp_author before insert or update on lead_checklist for each row execute function stamp_author('checked_by');
create trigger stamp_author before insert on tasks for each row execute function stamp_author('created_by');
create trigger stamp_author before insert on library_files for each row execute function stamp_author('uploaded_by');

-- 4. The emailed code counts only for the account it was sent to.
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and active
  ) and exists (
    select 1 from public.second_factor
    where session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid and verified_at is not null
      and email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

-- 5. Functions made after the last blanket revoke picked up Supabase's default grant to anon.
--    They run as the caller (row-level security hides everything from anon), so this is tidiness.
revoke execute on function mons_tokens_this_month() from public, anon;
revoke execute on function match_memory(extensions.vector, int) from public, anon;
revoke execute on function match_knowledge(extensions.vector, text[], int) from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
alter function touch() set search_path = '';
alter function admin_users_guard() set search_path = '';

-- 6. A bell link stays inside the admin: "/x", never "//other-site".
alter table notifications drop constraint notifications_url_check;
alter table notifications add constraint notifications_url_check check (url ~ '^/(?!/)');
