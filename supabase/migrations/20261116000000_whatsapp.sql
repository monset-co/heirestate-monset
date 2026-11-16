-- WhatsApp: every chat on the business number, read and answered from the admin.
-- Meta's Cloud API posts each message and delivery status to the admin Worker (admin/worker/whatsapp.js),
-- which writes here with its secret key. Admins read both tables and may mark a chat read or link it to
-- a lead; only the Worker adds messages, so what's here is what WhatsApp actually carried.

create table wa_threads (
  id bigint generated always as identity primary key,
  wa_id text not null unique check (wa_id ~ '^\d{6,20}$'), -- their number as WhatsApp gives it: digits, country code first
  name text check (length(name) <= 200), -- their WhatsApp profile name
  lead_id bigint references leads (id) on delete set null,
  unread int not null default 0,
  last_message_at timestamptz,
  last_inbound_at timestamptz, -- free-form replies are allowed for 24 hours after this
  created_at timestamptz not null default now()
);
create index wa_threads_recent on wa_threads (last_message_at desc nulls last);
create index wa_threads_lead on wa_threads (lead_id) where lead_id is not null;

create table wa_messages (
  id bigint generated always as identity primary key,
  thread_id bigint not null references wa_threads (id) on delete cascade,
  wa_message_id text unique, -- Meta's id; Meta retries webhooks, so a repeat is ignored
  direction text not null check (direction in ('in', 'out')),
  type text not null default 'text', -- text, image, document, audio, video, sticker, location, …
  body text check (length(body) <= 8000),
  media_id text, -- fetched through the Worker on demand (/api/whatsapp/media/:id)
  media_name text,
  status text not null default 'received' check (status in ('received', 'sent', 'delivered', 'read', 'failed')),
  error text,
  sent_by text, -- the admin who sent it
  created_at timestamptz not null default now()
);
create index wa_messages_thread on wa_messages (thread_id, created_at);

-- a new chat finds its lead by mobile: "0917 123 4567" on the form is 639171234567 on WhatsApp
create function wa_threads_link() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is null then
    select l.id into new.lead_id from public.leads l
    where regexp_replace(regexp_replace(l.mobile, '\D', '', 'g'), '^0', '63') = new.wa_id
    order by l.created_at desc limit 1;
  end if;
  return new;
end $$;
create trigger link before insert on wa_threads for each row execute function wa_threads_link();

alter table wa_threads enable row level security;
alter table wa_messages enable row level security;
create policy admins_read on wa_threads for select to authenticated using (is_admin());
create policy admins_update on wa_threads for update to authenticated using (is_admin()) with check (is_admin());
create policy admins_read on wa_messages for select to authenticated using (is_admin());
-- admins may only mark read and link to a lead; the rest is the Worker's
revoke insert, update, delete on wa_threads, wa_messages from anon, authenticated;
grant update (unread, lead_id) on wa_threads to authenticated;

-- the inbox updates live (Supabase Realtime, which checks the policies above per admin)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table wa_threads, wa_messages;
  end if;
end $$;

-- deletion on request now takes their WhatsApp chat too
create or replace function delete_lead(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  delete from public.wa_threads where lead_id = p_id;
  delete from public.leads where id = p_id;
  if not found then raise exception 'No such lead'; end if;
  delete from public.activity where lead_id = p_id;
  insert into public.activity (entity, entity_id, user_email, action)
  values ('leads', p_id::text, auth.jwt() ->> 'email', 'deleted on request');
end $$;

revoke execute on function wa_threads_link() from public, anon, authenticated;
