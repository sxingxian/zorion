-- Routed travel times, kept per person and place. Without a row, the app falls back to its own estimate.
create table place_times (
  place_id uuid not null references places (id) on delete cascade,
  participant_id uuid not null references participants (id) on delete cascade,
  minutes int not null check (minutes >= 0),
  primary key (place_id, participant_id)
);
create index place_times_participant on place_times (participant_id);

-- True when the place's times came from a routing service rather than the estimate.
alter table places add column routed boolean not null default false;

-- "estimate" (default, nothing leaves Zorion) or "google" (Routes API).
insert into settings (key, value) values ('routing_provider', '"estimate"') on conflict (key) do nothing;
