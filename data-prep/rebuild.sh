#!/usr/bin/env bash
# Rebuild after editing seed_overrides.csv, after fresh DB data, or after a global
# geometry change (e.g. the clip radius): reload corrections, re-derive okrsok
# polygons (overrides applied inline by the geom builders), then rebuild the
# okrsky + seeds PMTiles.
#
#   ./rebuild.sh <mc>      re-derive one MČ + rebuild both tiles
#                          e.g.  ./rebuild.sh kosice    ./rebuild.sh ruzinov
#   ./rebuild.sh --all     re-derive EVERY MČ + rebuild both tiles
#                          (use after a global change like the clip default)
#   ./rebuild.sh --tiles   skip DB derivation, just rebuild both tiles
#
# After editing seed_overrides.csv only the MČ whose seed changed needs re-deriving
# (find it by which seeds_<mc> holds the ra_id). The tile builds always cover all MČ.
set -euo pipefail
DB="${PGDATABASE:-volebna}"
cd "$(dirname "$0")"

# Derive one MČ's okrsok polygons (overrides applied inline). Košice has its own
# builder; every other derived MČ uses the generic one. Official-polygon MČ
# (e.g. novemesto) have no seeds_* and are skipped.
derive_mc() {
  local mc="$1"
  echo "== derive okrsky_$mc =="
  if [ "$mc" = "kosice" ]; then
    psql -d "$DB" -v ON_ERROR_STOP=1 -f src/build_kosice_geom.sql </dev/null
    return
  fi
  [ -n "$(psql -d "$DB" -tAc "select 1 from pg_tables where schemaname='public' and tablename='seeds_$mc'")" ] \
    || { echo "  no seeds_$mc (official-polygon or unknown MČ) — skipped" >&2; return; }
  [ -n "$(psql -d "$DB" -tAc "select 1 from pg_tables where schemaname='public' and tablename='${mc}_bnd'")" ] \
    || { echo "  missing boundary table ${mc}_bnd — skipped" >&2; return; }
  local n
  n=$(psql -d "$DB" -tAc "select count(distinct okrsok) from seeds_$mc")
  psql -d "$DB" -v ON_ERROR_STOP=1 -f src/build_mc_geom.sql \
    -v seeds="seeds_$mc" -v bnd="${mc}_bnd" -v result="okrsky_$mc" -v n="$n" </dev/null
}

# Ensure the ŠÚ SR 2026 referendum result tables are loaded (once) so the okrsky
# tile can join turnout + answers. Idempotent; skipped if the CSVs aren't present.
ensure_results() {
  [ -f data/ref2026/REF2026_SK_tab02e.csv ] || return 0
  [ -n "$(psql -d "$DB" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ref2026_turnout'")" ] \
    && return 0
  echo "== load ŠÚ SR 2026 referendum results =="
  psql -d "$DB" -v ON_ERROR_STOP=1 -f src/loadRef2026.sql >/dev/null
}

rebuild_tiles() {
  ensure_results
  echo "== okrsky tile =="; ./buildOkrskyTiles.sh
  echo "== seeds tile  =="; ./buildSeedsTiles.sh
}

[ $# -ge 1 ] || { echo "usage: ./rebuild.sh <mc> | --all | --tiles" >&2; exit 1; }

case "$1" in
  --tiles)
    rebuild_tiles ;;
  --all)
    echo "== load overrides =="
    psql -d "$DB" -v ON_ERROR_STOP=1 -f src/loadOverrides.sql
    # Read the MČ list into an array FIRST — psql in derive_mc would otherwise
    # consume a while-read loop's stdin and cut the iteration short.
    mapfile -t ALL < <(
      psql -d "$DB" -tAc "select substring(tablename from 'seeds_(.*)') \
                          from pg_tables where schemaname='public' and tablename like 'seeds_%' order by 1")
    for mc in "${ALL[@]}"; do derive_mc "$mc"; done
    rebuild_tiles ;;
  *)
    echo "== load overrides =="
    psql -d "$DB" -v ON_ERROR_STOP=1 -f src/loadOverrides.sql
    derive_mc "$1"
    rebuild_tiles ;;
esac

echo "done: refresh the app"
