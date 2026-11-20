-- Faster reads after a performance review. is_admin() is security definer, so Postgres can't fold
-- it into the query: written bare in a policy it ran once for every row (and again inside every
-- subquery of lead_overview). Wrapped in a select it runs once per statement. Same rule, same result.

-- the open reminders of one lead (lead_overview looks them up for every lead)
create index reminders_lead_open on reminders (lead_id, due_at) where done_at is null;

alter policy admins on admin_users using ((select is_admin())) with check ((select is_admin()));
alter policy admins on listings using ((select is_admin())) with check ((select is_admin()));
alter policy admins on listing_photos using ((select is_admin())) with check ((select is_admin()));
alter policy admins on settings using ((select is_admin())) with check ((select is_admin()));
alter policy admins on leads using ((select is_admin())) with check ((select is_admin()));
alter policy admins on lead_notes using ((select is_admin())) with check ((select is_admin()));
alter policy admins on reminders using ((select is_admin())) with check ((select is_admin()));
alter policy admins on commissions using ((select is_admin())) with check ((select is_admin()));
alter policy admins on lead_files using ((select is_admin())) with check ((select is_admin()));
alter policy admins on lead_checklist using ((select is_admin())) with check ((select is_admin()));
alter policy admins on inventory using ((select is_admin())) with check ((select is_admin()));
alter policy admins on library_files using ((select is_admin())) with check ((select is_admin()));
alter policy admins_read on activity using ((select is_admin()));
alter policy admins_read on wa_threads using ((select is_admin()));
alter policy admins_read on wa_messages using ((select is_admin()));
alter policy admins_update on wa_threads using ((select is_admin())) with check ((select is_admin()));
