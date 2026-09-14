-- (Re)load the manual seed-correction registry seed_overrides.csv into DB table seed_overrides,
-- so the geometry builds (build_kosice_geom.sql / build_mc_geom.sql) can apply exclude/move when
-- deriving okrsky. Keyed by ra_id (= ref:minvskaddress). Run from the data-prep dir (relative path):
--   psql volebna -f src/loadOverrides.sql
-- The CSV's documentation columns (city/street/number/reason) are loaded but unused by the builds.
drop table if exists seed_overrides;
create table seed_overrides (
  ra_id text primary key, action text, lon float8, lat float8,
  city text, street text, number text, reason text
);
\copy seed_overrides from 'seed_overrides.csv' with (format csv, header true)
select action, count(*) from seed_overrides group by action order by action;
