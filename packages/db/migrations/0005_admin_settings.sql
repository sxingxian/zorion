-- Admins invite other admins by a one-time link (24 hours). The invitee sets a password and an authenticator.
create table admin_invites (
  token_hash text primary key,
  email text not null check (email = lower(email)),
  role text not null check (role in ('super', 'support')),
  totp_secret text,
  invited_by uuid references admins (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Google ads now run inside the app, not on the landing page. Each app placement shows a Google ad
-- and falls back to a sponsored slot; the shortlist slot stays a labelled sponsored place.
delete from ad_placements where key = 'landing';
update ad_placements set kind = 'adsense' where key in ('host_home', 'guest_vote');
