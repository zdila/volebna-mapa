#!/usr/bin/env bash
# Build a PMTiles POINT tileset of all seed points (the labelled address points
# used to derive okrsky) from PostGIS. One layer "seeds".
#
#   PostGIS (seeds_<mc>, EPSG:5514)  --ogr2ogr--> GeoJSONSeq --> tippecanoe
#     --> seeds.pmtiles (EPSG:4326), layer "seeds"
#
# Colour/key match the okrsky tile (buildOkrskyTiles.sh) so a seed shares its
# okrsok's colour and (key, okrsok) identity. Shown only when zoomed in (z12+).
#
# --- Manual corrections (survive DB re-import) ------------------------------
# We NEVER edit the imported seeds_* tables. Fixes live in a separate CSV keyed
# by a stable RA address id, applied here as an overlay:
#
#   seed_overrides.csv   first 4 columns: ra_id,action,lon,lat (extra trailing
#                        columns like city,street,number,reason are documentation
#                        and are ignored — keep the 4 structured ones FIRST so the
#                        awk parser stays immune to commas in the free-text fields)
#     <id>,exclude,,            drop this seed
#     <id>,move,17.1234,48.567  reposition it (lon/lat WGS84)
#
# Requires a stable id column on seeds_* (default `ra_id`, override with REF_COL,
# e.g. REF_COL='ref:minvskaddress'). If the column or CSV is absent the overlay
# is simply skipped, so this stays a no-op until the id is in the data.
# (The DB polygon side loads the same CSV via src/loadOverrides.sql and applies it
# INLINE in src/build_kosice_geom.sql / build_mc_geom.sql — same ra_id key, so
# seeds and polygons stay consistent.)
set -euo pipefail

DB="${PGDATABASE:-volebna}"
OUT="${1:-../basemap/build/seeds.pmtiles}"   # served by the app at /tiles/seeds.pmtiles
REF_COL="${REF_COL:-ra_id}"                  # stable RA address id column
OVERRIDES="${OVERRIDES:-seed_overrides.csv}" # manual corrections file

mapfile -t CITIES < <(psql -d "$DB" -tAc \
  "SELECT substring(tablename from 'seeds_(.*)') FROM pg_tables \
   WHERE schemaname='public' AND tablename LIKE 'seeds_%' ORDER BY tablename")

[ "${#CITIES[@]}" -gt 0 ] || { echo "no seeds_* tables in DB '$DB'" >&2; exit 1; }
echo "cities: ${CITIES[*]}" >&2

# Bratislava is now ALSO held as one union table (okrsky_bratislava / seeds_bratislava, built by
# src/build_bratislava_union.sql) so the whole city can be checked and hand-edited in a single
# JOSM file. The per-MČ tables it was built from are still there, so without this both would be
# discovered and every Bratislava precinct would be emitted twice — once from the union and once
# from its own borough table. The union wins: it is what the hand edits in manual.okrsky_bratislava
# are keyed against.
BA_MC="staremesto ruzinov novemesto petrzalka dubravka karlovaves raca vrakuna podunajskebiskupice \
       devinskanovaves lamac zahorskabystrica vajnory rusovce jarovce cunovo devin"
if [[ " ${CITIES[*]} " == *" bratislava "* ]]; then
  keep=()
  for c in "${CITIES[@]}"; do
    [[ " $BA_MC " == *" $c "* ]] || keep+=("$c")
  done
  CITIES=("${keep[@]}")
  echo "bratislava union present -> per-MČ tables skipped; cities: ${CITIES[*]}" >&2
fi


# Overlay is active if ANY seeds_* table has the id column AND the CSV has rows. Cities may be
# in a MIXED state (some backfilled with ra_id, some not) — handled per-city in the loop below.
has_ref=$(psql -d "$DB" -tAc \
  "SELECT 1 FROM information_schema.columns \
   WHERE table_schema='public' AND table_name LIKE 'seeds_%' AND column_name='$REF_COL' LIMIT 1")
ov_values=""
if [ -n "$has_ref" ] && [ -f "$OVERRIDES" ]; then
  ov_values=$(awk -F, 'NR>1 && $1!="" {
    gsub(/\r/,""); gsub(/'\''/,"",$1); gsub(/'\''/,"",$2);
    lon=($3==""?"NULL":$3+0); lat=($4==""?"NULL":$4+0);
    printf "%s('\''%s'\'','\''%s'\'',%s,%s)", sep, $1, $2, lon, lat; sep=","
  }' "$OVERRIDES")
fi

# Per-city SELECT. ra_id is ALWAYS emitted (into the tile, for the popup, and for
# the override join): cities that have the id column expose it, the rest NULL.
union=""
for c in "${CITIES[@]}"; do
  has_mc=$(psql -d "$DB" -tAc \
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='seeds_$c' AND column_name='mcnorm'")
  mc_expr=$([ -n "$has_mc" ] && echo "mcnorm" || echo "'$c'")
  has_c_ref=$(psql -d "$DB" -tAc \
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='seeds_$c' AND column_name='$REF_COL'")
  ref_sel=$([ -n "$has_c_ref" ] && echo ", \"$REF_COL\"::text AS ra_id" || echo ", NULL::text AS ra_id")
  [ -n "$union" ] && union+=" UNION ALL "
  union+="SELECT okrsok::text AS okrsok, '$c' AS mesto, $mc_expr AS mc,
            street, orient::text AS orient, supisne::text AS supisne$ref_sel, geom FROM seeds_$c"
done

# color = golden angle over okrsok number; key = normalised mc (Košice prefixed)
# — both identical to the okrsky tile so seeds line up with their precinct. ra_id
# is carried through so it shows in the seed popup (paste straight into the CSV).
cols="okrsok, mc, street, orient, supisne, u.ra_id AS ra_id,
    case when mesto = mc then regexp_replace(lower(mc), '[^a-z0-9]', '', 'g')
         else regexp_replace(lower(mesto || mc), '[^a-z0-9]', '', 'g') end AS key,
    'hsl(' || (round(coalesce(nullif(regexp_replace(okrsok, '[^0-9]', '', 'g'), '')::int, 0) * 137.508)::int % 360)
      || ',62%,58%)' AS color"

if [ -n "$ov_values" ]; then
  # Apply corrections: drop excludes, replace geom for moves (lon/lat WGS84 ->
  # 5514, then ogr2ogr reprojects the whole set back to 4326).
  echo "applying overrides from $OVERRIDES (key=$REF_COL)" >&2
  sql="WITH ov(ra_id, action, lon, lat) AS (VALUES $ov_values)
    SELECT $cols,
      case when ov.action='move'
           then ST_Transform(ST_SetSRID(ST_MakePoint(ov.lon::float8, ov.lat::float8), 4326), 5514)
           else u.geom end AS geom
    FROM ($union) u
    LEFT JOIN ov ON u.ra_id::text = ov.ra_id
    WHERE ov.action IS DISTINCT FROM 'exclude'"
else
  sql="SELECT $cols, geom FROM ($union) u"
fi

mkdir -p "$(dirname "$OUT")"

ogr2ogr -f GeoJSONSeq /vsistdout/ PG:"dbname=$DB" -sql "$sql" \
    -s_srs EPSG:5514 -t_srs EPSG:4326 \
| tippecanoe -o "$OUT" -l seeds -q --force \
    -Z12 -z14 -r1 --no-tile-size-limit

echo "==> $OUT"
pmtiles show "$OUT" 2>&1 | grep -iE "min zoom|max zoom|bounds" || true
