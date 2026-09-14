-- Fold Bratislava's per-mestská-časť tables into ONE dataset shaped exactly like Košice's, so the
-- whole city can be edited in a single JOSM file.
--
--   psql volebna -f src/build_bratislava_union.sql
--
-- Every downstream tool already keys a precinct by (mcnorm, okrsok) — exportOkrskyJosm, checkFile,
-- applyChangesToFile, importOkrskyJosm — because Košice needed that from the start. Bratislava
-- numbers its okrsky per MČ the same way, so the union needs no renumbering: it only has to add
-- the mcnorm column the per-MČ tables leave implicit in their name.
--
-- Derived tables are rebuilt from scratch each time. manual.okrsky_bratislava (hand edits) is NOT
-- touched — it is keyed by (mcnorm, okrsok) and survives re-derivation.
\set ON_ERROR_STOP on

drop table if exists okrsky_bratislava;
drop table if exists seeds_bratislava;
drop table if exists unmatched_bratislava;
drop table if exists bratislava_boundary;

create table okrsky_bratislava (mcnorm text, okrsok int, geom geometry(MultiPolygon,5514));
create table seeds_bratislava (
  mcnorm text, okrsok int, ra_id text, street text, orient text, supisne text,
  geom geometry(Point,5514));
create table unmatched_bratislava (
  mcnorm text, reason text, ra_id text, street text, orient text, supisne text,
  geom geometry(Point,5514));
create table bratislava_boundary (mcnorm text, geom geometry(MultiPolygon,5514));

do $$
declare
  mc text;
  -- Devín is absent on purpose: its decree creates 2 okrsky but names no streets, so it cannot be
  -- divided. Its boundary IS included below, so the city outline stays whole for the
  -- outside-address check.
  mcs text[] := array['staremesto','ruzinov','novemesto','petrzalka','dubravka','karlovaves',
                      'raca','vrakuna','podunajskebiskupice','devinskanovaves','lamac',
                      'zahorskabystrica','vajnory','rusovce','jarovce','cunovo'];
begin
  foreach mc in array mcs loop
    if to_regclass('public.okrsky_' || mc) is not null then
      execute format(
        'insert into okrsky_bratislava select %L, okrsok, st_multi(geom) from okrsky_%I', mc, mc);
      execute format(
        'insert into seeds_bratislava select %L, okrsok, ra_id, street, orient, supisne, geom
           from seeds_%I', mc, mc);
      execute format(
        'insert into unmatched_bratislava select %L, reason, ra_id, street, orient, supisne, geom
           from unmatched_%I', mc, mc);
    end if;
  end loop;

  -- Boundaries: every MČ that has one, Devín included.
  foreach mc in array mcs || array['devin'] loop
    if to_regclass('public.' || mc || '_bnd') is not null then
      execute format('insert into bratislava_boundary select %L, st_multi(st_union(geom)) from %I_bnd',
                     mc, mc);
    end if;
  end loop;
end $$;

create index on okrsky_bratislava using gist(geom);
create index on seeds_bratislava using gist(geom);
create index on unmatched_bratislava using gist(geom);
create index on bratislava_boundary using gist(geom);

select 'okrsky' what, count(*) n, count(distinct mcnorm) mc from okrsky_bratislava
union all select 'seeds', count(*), count(distinct mcnorm) from seeds_bratislava
union all select 'unmatched', count(*), count(distinct mcnorm) from unmatched_bratislava
union all select 'boundary parts', count(*), count(distinct mcnorm) from bratislava_boundary;
