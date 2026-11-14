-- How much of Google's free monthly allowance Zorion has used, per billable service and month.
-- Counted by Zorion itself, because an API key can't read the billing account.
create table usage_counters (
  key text primary key,          -- e.g. google:places_text:2026-11
  count integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into settings (key, value) values ('google_budget', '"90"') on conflict (key) do nothing;
