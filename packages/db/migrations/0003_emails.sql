-- Emails beyond sign-in codes.

-- Hosts are told when a vote is in or a guest changes a choice. They can switch this off.
alter table users add column notify boolean not null default true;

-- A guest may leave an address to hear when the date or place is set. It is used only after they
-- confirm it from their inbox, never shown to anyone, and erased when the meetup ends.
alter table participants add column email text;
alter table participants add column email_confirmed boolean not null default false;

-- One row per kind of notice per meetup, so the same news is not sent twice.
create table notices (
  meetup_id uuid not null references meetups (id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (meetup_id, kind)
);
