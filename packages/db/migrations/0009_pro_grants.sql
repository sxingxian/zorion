-- Pro given by an admin, kept apart from paid Pro (users.plan, which only Stripe changes).
-- A host is on Pro while either is active. 'infinity' means no end date. Old grants stay for the record.
alter table users add column pro_grant_until timestamptz;
alter table users add column pro_grant_note text;
