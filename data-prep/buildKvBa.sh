#!/usr/bin/env bash
# Derive komunálne-2026 okrsok polygons for every Bratislava MČ that publishes a street list.
# Per MČ: load its Register-adries points, match each street point to an okrsok (labelMc), then
# build the Voronoi/clip geometry (build_mc_geom.sql, 300 m seed clip by default).
# Devín is NOT here: its decree creates 2 okrsky but names no streets, so it cannot be divided.
set -uo pipefail
DB="${PGDATABASE:-volebna}"
cd "$(dirname "$0")"
q() { psql -d "$DB" -tAqc "$1" 2>/dev/null; }

MCS="staremesto ruzinov novemesto petrzalka dubravka karlovaves raca vrakuna podunajskebiskupice devinskanovaves lamac zahorskabystrica vajnory rusovce jarovce cunovo"

for mc in $MCS; do
  asg="data/kv_ba_${mc}_okrsok_streets.json"
  ra="data/ra_${mc}.geojson"
  echo "===== $mc ====="
  [ -f "$asg" ] || { echo "  missing $asg — skipped"; continue; }
  [ -f "$ra" ]  || { echo "  missing $ra — skipped"; continue; }

  ogr2ogr -f PostgreSQL "PG:dbname=$DB" "$ra" -nln "ra_${mc}_all" -overwrite \
          -t_srs EPSG:5514 -lco GEOMETRY_NAME=geom -nlt POINT 2>&1 \
    | grep -viE "collation|HINT|DETAIL|WARNING" | head -2

  node src/labelMc.ts "$mc" "$asg" "ra_${mc}_all" "${mc}_bnd" 2>&1 \
    | grep -viE "collation|HINT|DETAIL|WARNING|NOTICE" | head -4

  n=$(q "select count(distinct okrsok) from seeds_${mc}")
  [ -n "$n" ] && [ "$n" -gt 0 ] || { echo "  no seeds — skipped geometry"; continue; }
  psql -d "$DB" -v ON_ERROR_STOP=1 -f src/build_mc_geom.sql \
       -v seeds="seeds_${mc}" -v bnd="${mc}_bnd" -v result="okrsky_${mc}" -v n="$n" </dev/null 2>&1 \
    | grep -viE "collation|HINT|DETAIL|WARNING|NOTICE|^SET|^BEGIN|^COMMIT" | tail -3

  psql -d "$DB" -q -c "drop table if exists ra_${mc}_all" 2>/dev/null
done
echo "ALL DONE"
