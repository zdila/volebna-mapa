-- Reusable per-MČ okrsok geometry build. Voronoi over the labelled seeds (extended to the
-- boundary envelope, else outer land is a gap), clip to the MČ boundary, dissolve by okrsok,
-- then trim each okrsok to within :clip metres of a seed so cells don't balloon into empty
-- rural land far from any address (internal okrsok borders are preserved — both neighbours are
-- clipped by the same buffer, so no gap/overlap appears between them; the trimmed fringe becomes
-- intentional no-okrsok land).
-- Params (pass with psql -v): seeds=<seed table>  bnd=<boundary table>  result=<okrsky table>  n=<expected okrsok count>
--   optional: clip=<metres> (default 300; pass clip=0 to disable the distance cap).
-- e.g. psql volebna -v seeds=db_seeds -v bnd=db_bnd -v result=okrsky_db -v n=31 -f src/build_mc_geom.sql
\if :{?clip}
\else
  \set clip 300
\endif

-- Manual corrections (exclude / move) keyed by ra_id, from seed_overrides.csv loaded into table
-- seed_overrides (src/loadOverrides.sql). Guard so the build still works when it's absent.
create table if not exists seed_overrides (ra_id text, action text, lon float8, lat float8);

-- Distinct seed coordinates (Voronoi needs unique points). Apply overrides first: drop 'exclude'
-- seeds and relocate 'move' seeds to their corrected lon/lat so bad RA points don't carve
-- spurious okrsok fragments.
drop table if exists _seeds_u;
create temp table _seeds_u as
  select distinct on (st_astext(geom)) okrsok, geom from (
    select s.okrsok,
           case when o.action = 'move'
                then st_transform(st_setsrid(st_makepoint(o.lon, o.lat), 4326), 5514)
                else s.geom end as geom
    from :seeds s
    left join seed_overrides o on o.ra_id = s.ra_id
    where o.action is distinct from 'exclude'
  ) s;
create index on _seeds_u using gist(geom);

drop table if exists :result;
create table :result as
with cells as (
  select s.okrsok, st_intersection(v.geom, b.geom) as geom
  from :bnd b
  cross join lateral (
    select (st_dump(st_voronoipolygons(st_collect(g.geom), 0.0, st_expand(b.geom, 500)))).geom as geom
    from _seeds_u g
  ) v
  join _seeds_u s on st_contains(v.geom, s.geom)
  where st_intersects(v.geom, b.geom)
),
diss as (
  select okrsok, st_makevalid(st_unaryunion(st_collect(geom))) as geom
  from cells group by okrsok
),
clip as (  -- union of :clip-metre disks around the seeds (null when clip=0 -> no trimming). Seeds are
           -- grid-snapped (~:clip/10 m) first so dense urban clusters collapse to a few points — the
           -- buffer is otherwise far too slow — with only ±(grid/2) m effect on the cap distance.
  select case when :clip > 0 then st_buffer(st_collect(g), :clip, 'quad_segs=4') end as geom
  from (select distinct st_snaptogrid(geom, :clip / 10.0) as g from _seeds_u) q
)
select d.okrsok,
       st_multi(st_makevalid(case when c.geom is null then d.geom else st_intersection(d.geom, c.geom) end)) as geom
from diss d cross join clip c;
create index on :result using gist(geom);

\echo '== okrsok count (expect :n) / empty / multi-part =='
select (select count(*) from :result) as okrsky,
       (select count(*) from :result where st_isempty(geom) or geom is null) as empty,
       (select count(*) from :result where st_numgeometries(geom) > 1) as multipart;
\echo '== gap_ha (= trimmed rural fringe > :clip m from a seed; intentional) / spill_ha (expect ~0) =='
select round((st_area(st_difference(b.geom, u.geom))/10000)::numeric, 2) as gap_ha,
       round((st_area(st_difference(u.geom, b.geom))/10000)::numeric, 2) as spill_ha,
       round((st_area(b.geom)/10000)::numeric, 0) as bnd_ha
from :bnd b, (select st_unaryunion(st_collect(geom)) geom from :result) u;
\echo '== inter-okrsok overlaps > 1 m2 (expect 0) =='
select count(*) from :result a join :result c on a.okrsok < c.okrsok
where st_intersects(a.geom, c.geom) and st_area(st_intersection(a.geom, c.geom)) > 1;
