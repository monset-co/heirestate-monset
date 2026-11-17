-- Google: the business's Google account (Calendar, and the Gmail its invites go out from), connected
-- once from the admin's Calendar page. Only the admin Worker reads it, with its secret key: the refresh
-- token never reaches a browser. One row at most; connecting again replaces it.

create table google_account (
  id int primary key default 1 check (id = 1),
  email text not null check (length(email) <= 320),
  refresh_token text not null,
  connected_by text not null, -- the admin who connected it
  connected_at timestamptz not null default now()
);

alter table google_account enable row level security;
revoke all on google_account from anon, authenticated;
