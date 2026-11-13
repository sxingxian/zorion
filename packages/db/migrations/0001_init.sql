-- Zorion schema, version 1. Applied in order by packages/db/migrate.mjs.

-- ---------- hosts and sign-in ----------
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text,
  totp_secret text,                      -- AES-GCM encrypted, never returned by the API
  totp_enabled boolean not null default false,
  totp_last_step bigint not null default 0,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  theme text not null default 'gold' check (theme in ('gold', 'pink')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  stripe_customer_id text unique,
  pro_until timestamptz,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create table email_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_codes_email on email_codes (email, created_at desc);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  kind text not null default 'full' check (kind in ('full', 'pending_2fa')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user on sessions (user_id);

create table recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz
);
create index recovery_codes_user on recovery_codes (user_id);

-- Attempt counters for sign-in, codes and guest codes. Keys are hashed, never raw emails or IPs.
create table throttles (
  key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

-- ---------- categories ----------
create table categories (
  key text primary key,
  name text not null,
  icon text not null,
  osm jsonb not null default '[]',
  google jsonb not null default '{}',
  active boolean not null default true,
  position int not null default 0
);

create table own_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null,
  icon text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------- meetups ----------
create table meetups (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references users (id) on delete cascade,
  link_token text not null unique,
  name text not null,
  time_zone text not null,
  starts_at timestamptz,
  date_mode text not null default 'fixed' check (date_mode in ('fixed', 'vote')),
  set_date_option uuid,
  status text not null default 'draft' check (status in ('draft', 'date_vote', 'voting', 'places', 'place_vote', 'confirmed', 'ended')),
  travel_mode text not null default 'walk' check (travel_mode in ('walk', 'transit', 'cycle')),
  guest_theme text not null default 'pink' check (guest_theme in ('pink', 'gold')),
  winning_category text,
  middle_lat double precision,
  middle_lng double precision,
  chosen_place uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meetups_host on meetups (host_id, created_at desc);

create table meetup_categories (
  meetup_id uuid not null references meetups (id) on delete cascade,
  key text not null,
  name text not null,
  icon text not null,
  own boolean not null default false,
  position int not null,
  primary key (meetup_id, key)
);

create table date_options (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references meetups (id) on delete cascade,
  starts_at timestamptz not null
);
create index date_options_meetup on date_options (meetup_id);

create table participants (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references meetups (id) on delete cascade,
  name text not null,
  is_host boolean not null default false,
  user_id uuid references users (id) on delete set null,
  claimed boolean not null default false,
  code_hash text,
  device_hash text,
  amend_until timestamptz,
  rsvp text not null default 'none' check (rsvp in ('none', 'going', 'maybe', 'no')),
  rsvp_is_default boolean not null default false,
  no_date_works boolean not null default false,
  skipped boolean not null default false,
  lat double precision,                  -- deleted when the meetup ends
  lng double precision,
  joined_late boolean not null default false,
  created_at timestamptz not null default now(),
  unique (meetup_id, name)
);
create index participants_meetup on participants (meetup_id);
create unique index participants_code on participants (meetup_id, code_hash) where code_hash is not null;

create table date_votes (
  participant_id uuid not null references participants (id) on delete cascade,
  option_id uuid not null references date_options (id) on delete cascade,
  primary key (participant_id, option_id)
);

create table category_votes (
  participant_id uuid not null references participants (id) on delete cascade,
  meetup_id uuid not null references meetups (id) on delete cascade,
  key text not null,
  primary key (participant_id, key)
);

create table places (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references meetups (id) on delete cascade,
  provider text not null,
  provider_ref text not null,
  name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  rating real,
  open_now boolean,
  longest_min int not null,
  position int not null,
  shortlisted boolean not null default false
);
create index places_meetup on places (meetup_id, position);

create table place_votes (
  participant_id uuid primary key references participants (id) on delete cascade,
  place_id uuid not null references places (id) on delete cascade
);

-- What guests changed after the host confirmed. The host reviews and decides.
create table changes (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references meetups (id) on delete cascade,
  participant_id uuid references participants (id) on delete cascade,
  kind text not null,
  detail text not null,
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
create index changes_meetup on changes (meetup_id, created_at desc);

-- ---------- billing ----------
create table subscriptions (
  user_id uuid primary key references users (id) on delete cascade,
  stripe_subscription_id text not null unique,
  status text not null,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
create table stripe_events (id text primary key, received_at timestamptz not null default now());

-- ---------- ads ----------
create table ad_placements (
  key text primary key,
  label text not null,
  kind text not null check (kind in ('sponsored', 'adsense')),
  enabled boolean not null default true
);
create table sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_key text,
  url text,
  starts_on date not null,
  ends_on date not null,
  active boolean not null default true,
  views bigint not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- admin ----------
create table admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  totp_secret text,
  totp_enabled boolean not null default false,
  totp_last_step bigint not null default 0,
  role text not null default 'support' check (role in ('super', 'support')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references admins (id) on delete cascade,
  token_hash text not null unique,
  kind text not null default 'full' check (kind in ('full', 'pending_2fa')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references admins (id) on delete set null,
  action text not null,
  target text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_time on audit_log (created_at desc);
-- Sensitive admin actions wait here until a second admin approves them.
create table approvals (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  payload jsonb not null,
  requested_by uuid not null references admins (id) on delete cascade,
  approved_by uuid references admins (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ---------- seed ----------
insert into categories (key, name, icon, osm, google, position) values
  ('pizza', 'Pizza', 'pizza', '["[\"amenity\"~\"restaurant|fast_food\"][\"cuisine\"~\"pizza\"]"]', '{"type":"pizza_restaurant"}', 1),
  ('ramen', 'Ramen', 'ramen', '["[\"amenity\"~\"restaurant|fast_food\"][\"cuisine\"~\"ramen|noodle\"]"]', '{"type":"ramen_restaurant"}', 2),
  ('tacos', 'Tacos', 'tacos', '["[\"amenity\"~\"restaurant|fast_food\"][\"cuisine\"~\"mexican|tacos\"]"]', '{"type":"mexican_restaurant"}', 3),
  ('bar', 'Bar', 'bar', '["[\"amenity\"~\"bar|pub\"]"]', '{"type":"bar"}', 4),
  ('cocktail', 'Cocktails', 'cocktail', '["[\"amenity\"=\"bar\"][\"cocktails\"=\"yes\"]"]', '{"text":"cocktail bar"}', 5),
  ('izakaya', 'Izakaya', 'izakaya', '["[\"amenity\"~\"restaurant|pub|bar\"][\"cuisine\"~\"japanese|izakaya\"]"]', '{"text":"izakaya"}', 6);

insert into ad_placements (key, label, kind) values
  ('host_home', 'Host home, under the meetup list', 'sponsored'),
  ('guest_vote', 'Guest category vote, under the ballot', 'sponsored'),
  ('shortlist', 'Shortlist, one labelled place', 'sponsored'),
  ('landing', 'Landing page', 'adsense');

insert into settings (key, value) values
  ('places_provider', '"osm"'),
  ('own_categories', 'true'),
  ('blocked_words', '[]'),
  ('group_size', '{"free": 8, "pro": 30}'),
  ('adsense', '{"publisherId": "", "consent": true}');
