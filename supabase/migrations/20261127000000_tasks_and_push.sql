-- The Notes board (admin /notes), after dashboard-monset's task board, and push notifications.
-- The board is sticky notes in a column per person. A note in someone's column is a task for them; one in "My notes" is private to whoever
-- wrote it (reminders, a listing seen on Facebook, a number to call), so they stop living in Messenger.
-- Drag a private note onto a teammate and it becomes their task.
create table tasks (
  id bigint generated always as identity primary key,
  body text not null check (length(body) between 1 and 4000),
  color text not null default 'yellow' check (color in ('yellow', 'pink', 'blue', 'green')),
  private boolean not null default false,
  -- whose column it's in; none: anyone's to take
  assignee text references admin_users (email) on update cascade on delete set null,
  due_on date,
  urgent boolean not null default false,
  done_at timestamptz,
  lead_id bigint references leads (id) on delete set null, -- the client it's about, if any
  created_by text not null default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  constraint private_is_unassigned check (not private or assignee is null)
);
create index tasks_assignee on tasks (assignee) where not private;

alter table tasks enable row level security;
-- everyone on the team sees the shared board; a private note only its writer, even to edit or bin it
create policy admins on tasks for all to authenticated
  using (is_admin() and (not private or created_by = lower(auth.jwt() ->> 'email')))
  with check (is_admin() and (not private or created_by = lower(auth.jwt() ->> 'email')));

-- ── push notifications: the devices each admin turned them on for (Settings) ────────────────────
-- The admin Worker reads these with its secret key to send alerts (admin/worker/push.js).
create table push_subscriptions (
  endpoint text primary key check (endpoint ~ '^https://'),
  email text not null default lower(auth.jwt() ->> 'email') references admin_users (email) on update cascade on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
-- each admin sees and changes only their own devices
create policy own on push_subscriptions for all to authenticated
  using (is_admin() and email = lower(auth.jwt() ->> 'email'))
  with check (is_admin() and email = lower(auth.jwt() ->> 'email'));
