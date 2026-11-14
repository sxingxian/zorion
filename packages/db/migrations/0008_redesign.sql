-- Redesign: profile pigs, the crew map, map tiles chosen in the admin portal.

-- The pig a host picked as their picture. Guests see it on the host's meetups.
alter table users add column avatar text not null default 'chef';

-- Whether this person lets the crew see their exact start and name on the map.
-- Off: others see an unnamed rough area about 1 km wide, its centre moved by a fixed random offset.
alter table participants add column show_on_map boolean not null default false;
alter table participants add column map_offset_seed int not null default floor(random() * 2147483647)::int;

-- Route lines from each person to the middle or the chosen place, drawn on the map.
-- A route for someone who keeps their pin private starts at the edge of their rough area.
-- Erased with locations when the meetup ends.
create table route_lines (
  participant_id uuid not null references participants (id) on delete cascade,
  dest text not null,            -- 'middle' or 'place:<id>'
  start_key text not null,       -- where it was routed from; a change of start makes it stale
  line jsonb not null,           -- [[lng, lat], ...]
  source text not null,          -- which service drew it, or 'straight'
  created_at timestamptz not null default now(),
  primary key (participant_id, dest)
);

insert into settings (key, value) values
  ('map_tiles_sg', '"onemap"'),
  ('map_tiles_world', '"openfreemap"'),
  ('map_tiles_backup', '["openfreemap", "versatiles"]'),
  ('map_start_3d', 'true'),
  ('map_buildings', 'true'),
  ('map_animate', 'true')
on conflict (key) do nothing;
