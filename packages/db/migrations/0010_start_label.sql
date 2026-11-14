-- The name of a typed starting place ("Bugis MRT"), shown only to that person so they can see what they picked.
-- Null for a shared GPS location. Erased with the start itself when the meetup ends.
alter table participants add column start_label text;
