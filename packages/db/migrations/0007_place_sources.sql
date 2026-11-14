-- Which service found a meetup's places is already in places.provider ('google', 'geoapify', 'osm').
-- This records which service gave the trip times, so the app can credit it.
alter table places add column routed_by text;
