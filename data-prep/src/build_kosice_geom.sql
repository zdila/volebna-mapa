-- Build all Košice okrsok polygons from labelled seeds. Voronoi is computed PER MČ so cells
-- never cross a MČ border; each MČ's cells are clipped to its official cadastral boundary
-- (table kosice_mc) and dissolved by okrsok. Depends on: seeds_kosice, kosice_mc.
-- Finally each okrsok is trimmed to within :clip metres of a seed (default 300; clip=0 disables)
-- so rural cells don't balloon into empty land far from any address. Internal okrsok borders are
-- preserved (both neighbours clipped by the same per-MČ buffer); the trimmed fringe is no-okrsok.
\if :{?clip}
\else
  \set clip 300
\endif

-- Manual corrections (exclude / move) keyed by ra_id, from seed_overrides.csv loaded into table
-- seed_overrides (src/loadOverrides.sql). Guard so the build still works when it's absent.
create table if not exists seed_overrides (ra_id text, action text, lon float8, lat float8);

-- Distinct seed coordinates per MČ (Voronoi needs unique points). Apply overrides first: drop
-- 'exclude' seeds and relocate 'move' seeds to their corrected lon/lat — so bad RA points don't
-- carve spurious okrsok fragments.
drop table if exists _seeds_u;
create temp table _seeds_u as
  select distinct on (mcnorm, st_astext(geom)) mcnorm, okrsok, obvod, geom from (
    select s.mcnorm, s.okrsok, s.obvod,
           case when o.action = 'move'
                then st_transform(st_setsrid(st_makepoint(o.lon, o.lat), 4326), 5514)
                else s.geom end as geom
    from seeds_kosice s
    left join seed_overrides o on o.ra_id = s.ra_id
    where o.action is distinct from 'exclude'
  ) s;
create index on _seeds_u using gist(geom);

drop table if exists okrsky_kosice;
create table okrsky_kosice as
with cells as (
  -- Per-MČ Voronoi, clipped to the MČ boundary, each cell tagged by the seed inside it.
  select s.mcnorm, s.okrsok, s.obvod, st_intersection(v.geom, m.geom) as geom
  from kosice_mc m
  cross join lateral (
    select (st_dump(
      st_voronoipolygons(st_collect(g.geom), 0.0, st_expand(m.geom, 500))
    )).geom as geom
    from _seeds_u g where g.mcnorm = m.mcnorm
  ) v
  join _seeds_u s on s.mcnorm = m.mcnorm and st_contains(v.geom, s.geom)
  where st_intersects(v.geom, m.geom)
),
diss as (
  select mcnorm, okrsok, min(obvod) as obvod,
         st_makevalid(st_unaryunion(st_collect(geom))) as geom
  from cells group by mcnorm, okrsok
),
clip as (  -- per-MČ union of :clip-metre disks around seeds (null when clip=0 -> no trimming). Seeds
           -- are grid-snapped (~:clip/10 m) so dense clusters collapse to a few points (else the
           -- buffer is far too slow) — with only ±(grid/2) m effect on the cap distance.
  select mcnorm, case when :clip > 0 then st_buffer(st_collect(g), :clip, 'quad_segs=4') end as geom
  from (select distinct mcnorm, st_snaptogrid(geom, :clip / 10.0) as g from _seeds_u) q
  group by mcnorm
)
select d.mcnorm, d.okrsok, d.obvod,
       st_multi(st_makevalid(case when c.geom is null then d.geom else st_intersection(d.geom, c.geom) end)) as geom
from diss d join clip c on c.mcnorm = d.mcnorm;
create index on okrsky_kosice using gist(geom);
