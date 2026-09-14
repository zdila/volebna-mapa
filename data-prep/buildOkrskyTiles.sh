#!/usr/bin/env bash
# Build a PMTiles vector tileset of all okrsok polygons from PostGIS.
#
#   PostGIS (okrsky_<mesto>, EPSG:5514)  --ogr2ogr--> GeoJSONSeq --> tippecanoe
#     --> okrsky.pmtiles (EPSG:4326), with TWO layers:
#       okrsky      polygons (okrsok, mesto, mc, key, color + referendum results)
#       okrsky_pts  one label point per okrsok (okrsok, mesto, mc + results)
#
# Two layers because a polygon clipped across tiles gets its label drawn once
# PER tile → duplicate labels. A point sits in exactly one tile, so labelling the
# point layer instead gives exactly one label per precinct.
#
# tippecanoe (not GDAL direct) for --detect-shared-borders +
# --no-simplification-of-shared-nodes: adjacent okrsok borders stay coincident
# when simplified → no gaps/slivers. Streamed — no GeoJSON file touches disk.
#
# --- 2026 referendum results (ŠÚ SR) --------------------------------------
# If the result tables exist (loaded by src/loadRef2026.sql) each okrsok is
# LEFT JOINed to its ŠÚ SR row and the tile carries turnout + both questions'
# ÁNO/NIE, so the app can recolour/relabel between "distinct precinct" and
# result choropleths. Join key = (obec_code, okrsok): every Bratislava/Košice
# mestská časť is its OWN obec in ŠÚ SR terms, matching our per-MČ okrsky_<mc>
# tables. obec_code is resolved by normalised name, SCOPED by city so the
# village "Dúbravka" (a standalone obec) never collides with "Bratislava -
# Dúbravka" (a MČ): BA MČ key = 'bratislava'+slug, Košice = 'kosice'+mcnorm,
# standalone cities = the bare slug. Okrsky with no ŠÚ SR row (e.g. a MČ still on
# a 2022 street list whose okrsok count differs) simply carry no result props →
# the app shows them in the "no data" colour. Guard: builds fine result-less.
#
#   ./buildOkrskyTiles.sh [output.pmtiles]
set -euo pipefail

DB="${PGDATABASE:-volebna}"
OUT="${1:-../basemap/build/okrsky.pmtiles}"   # served by the app at /tiles/okrsky.pmtiles

# Standalone cities: their okrsky_<slug> table IS one whole obec, matched by the
# bare slug against the un-prefixed ŠÚ SR obec name. Everything that is neither
# 'kosice' nor one of these is treated as a Bratislava MČ ('bratislava'+slug).
STANDALONE="banskabystrica nitra presov zilina"

# Cities whose okrsky are still the 2026 REFERENDUM division, and so can legitimately be joined
# to the ŠÚ SR referendum results. Košice and the Bratislava MČ were re-sourced to the KOMUNÁLNE
# VOĽBY 24.10.2026 division, which numbers and draws precincts differently — joining referendum
# rows to them by (obec_code, okrsok) would silently attach ANOTHER area's turnout to each
# precinct, so their refkey is NULL and the LEFT JOIN yields no result props (the app then paints
# them in the "no data" colour). Move a city back into this list only if its okrsky are rebuilt
# from a referendum-vintage source; add komunálne results here once ŠÚ SR publishes them.
REF2026_VINTAGE="banskabystrica nitra presov zilina"

# Auto-discover all okrsky_<mesto> tables (new MČ are still being generated, so
# don't hardcode). mesto = the suffix after "okrsky_".
mapfile -t CITIES < <(psql -d "$DB" -tAc \
  "SELECT substring(tablename from 'okrsky_(.*)') FROM pg_tables \
   WHERE schemaname='public' AND tablename LIKE 'okrsky_%' ORDER BY tablename")

[ "${#CITIES[@]}" -gt 0 ] || { echo "no okrsky_* tables in DB '$DB'" >&2; exit 1; }
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


# UNION of all cities → (okrsok text, mesto, mc, refkey, geom). `mc` = the
# mestská časť label: for tables that carry an mcnorm column (Košice = one city
# table with 22 MČ inside) use mcnorm; for the per-MČ Bratislava/standalone
# tables the whole table IS one obec, so mc = the table's slug. `refkey` = the
# scoped key used to resolve the ŠÚ SR obec_code (see header).
union=""
for c in "${CITIES[@]}"; do
  has_mc=$(psql -d "$DB" -tAc \
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='okrsky_$c' AND column_name='mcnorm'")
  mc_expr=$([ -n "$has_mc" ] && echo "t.mcnorm" || echo "'$c'")
  if [[ " $REF2026_VINTAGE " != *" $c "* ]]; then
    refkey_expr="NULL::text"          # komunálne-2026 division: referendum results don't apply
  elif [ "$c" = "kosice" ]; then
    refkey_expr="'kosice'||regexp_replace(lower(unaccent(t.mcnorm)),'[^a-z0-9]','','g')"
  elif [[ " $STANDALONE " == *" $c "* ]]; then
    refkey_expr="'$c'"
  else
    refkey_expr="'bratislava$c'"
  fi
  # Hand-edited polygons (schema `manual`, written by src/importOkrskyJosm.ts) WIN per okrsok.
  # okrsky_<c> stays pure machine output so it can always be re-derived; the COALESCE means a
  # rebuild improves every precinct you have not touched without discarding the ones you have.
  src_geom="t.geom"
  from_expr="okrsky_$c t"
  if [ -n "$(psql -d "$DB" -tAc "SELECT 1 FROM pg_tables WHERE schemaname='manual' AND tablename='okrsky_$c'")" ]; then
    join_key="m.okrsok = t.okrsok"
    [ -n "$has_mc" ] && join_key="$join_key AND m.mcnorm = t.mcnorm"
    src_geom="COALESCE(m.geom, t.geom)"
    from_expr="okrsky_$c t LEFT JOIN manual.okrsky_$c m ON $join_key"
    echo "  $c: using hand-edited polygons from manual.okrsky_$c" >&2
  fi

  [ -n "$union" ] && union+=" UNION ALL "
  union+="SELECT t.okrsok::text AS okrsok, '$c' AS mesto, $mc_expr AS mc, $refkey_expr AS refkey, $src_geom AS geom FROM $from_expr"
done

# Do we have referendum results to join?
has_results=$(psql -d "$DB" -tAc \
  "SELECT 1 FROM information_schema.tables WHERE table_name='ref2026_turnout'")

if [ -n "$has_results" ]; then
  echo "joining ŠÚ SR 2026 referendum results" >&2
  # obec_code lookup, scoped by city (see header) so same-name obce don't collide.
  obec_cte="WITH obec_map AS (
      SELECT obec_code, regexp_replace(lower(unaccent(obec_name)),'[^a-z0-9]','','g') AS key
        FROM (SELECT DISTINCT obec_code,obec_name FROM ref2026_turnout) o
        WHERE obec_name LIKE 'Bratislava - %' OR obec_name LIKE 'Košice - %'
      UNION ALL
      SELECT obec_code, regexp_replace(lower(unaccent(obec_name)),'[^a-z0-9]','','g')
        FROM (SELECT DISTINCT obec_code,obec_name FROM ref2026_turnout) o
        WHERE obec_name NOT LIKE '% - %'
    )"
  enriched_from="( $union ) u
      LEFT JOIN obec_map m  ON m.key = u.refkey
      LEFT JOIN ref2026_turnout t  ON t.obec_code=m.obec_code AND t.okrsok=u.okrsok
      LEFT JOIN ref2026_answers a1 ON a1.obec_code=m.obec_code AND a1.okrsok=u.okrsok AND a1.otazka='1'
      LEFT JOIN ref2026_answers a2 ON a2.obec_code=m.obec_code AND a2.okrsok=u.okrsok AND a2.otazka='2'"
  # turnout %, registered/participated counts, and per-question ÁNO/NIE (counts +
  # ÁNO share of valid). Empty ŠÚ SR cells → NULL → tippecanoe omits the attr.
  res_cols="nullif(t.ucast_pct,'')::numeric AS turnout,
      nullif(t.zapisani,'')::int AS zap, nullif(t.zucastneni,'')::int AS zuc,
      nullif(a1.ano,'')::int AS q1a, nullif(a1.nie,'')::int AS q1n, nullif(a1.ano_pct,'')::numeric AS q1ano,
      nullif(a2.ano,'')::int AS q2a, nullif(a2.nie,'')::int AS q2n, nullif(a2.ano_pct,'')::numeric AS q2ano"
else
  echo "no ref2026_turnout table — building without results" >&2
  obec_cte=""
  enriched_from="( $union ) u"
  res_cols="NULL::numeric AS turnout"
fi

# Polygons + a distinct colour derived from the OKRSOK NUMBER (golden-angle hue
# ×137.508°). Deriving from okrsok (not a per-mesto index) means the SAME formula
# in the Flourish extractor yields the SAME colour for the same precinct, so the
# two comparison layers line up. `key` = normalised mc (lowercase, alnum only) so
# it matches the Flourish `obec` slug for id-based cross-layer selection. The
# golden-angle `color` is a visual DISTINGUISHER only (encodes no data); the
# result props (turnout/q1*/q2*) drive the choropleth modes in the app.
poly_sql="$obec_cte
  SELECT u.okrsok, u.mesto, u.mc,
    case when u.mesto = u.mc then regexp_replace(lower(u.mc), '[^a-z0-9]', '', 'g')
         else regexp_replace(lower(u.mesto || u.mc), '[^a-z0-9]', '', 'g') end AS key,
    u.geom,
    'hsl(' || (round(coalesce(nullif(regexp_replace(u.okrsok, '[^0-9]', '', 'g'), '')::int, 0) * 137.508)::int % 360)
      || ',62%,58%)' AS color,
    $res_cols
  FROM $enriched_from"

# One label point per okrsok (point-on-surface = guaranteed inside the polygon),
# carrying the same result props so labels can show okrsok / turnout / ÁNO %.
pt_sql="$obec_cte
  SELECT u.okrsok, u.mesto, u.mc, ST_PointOnSurface(u.geom) AS geom,
    $res_cols
  FROM $enriched_from"

ogr_seq() { # $1 = sql
  ogr2ogr -f GeoJSONSeq /vsistdout/ PG:"dbname=$DB" -sql "$1" \
    -s_srs EPSG:5514 -t_srs EPSG:4326
}

mkdir -p "$(dirname "$OUT")"

# -L name:file with process substitution → two layers in one pmtiles.
tippecanoe -o "$OUT" -q --force \
    -Z6 -z14 \
    --detect-shared-borders \
    --no-simplification-of-shared-nodes \
    --no-tiny-polygon-reduction \
    -L "okrsky:"<(ogr_seq "$poly_sql") \
    -L "okrsky_pts:"<(ogr_seq "$pt_sql")

echo "==> $OUT"
pmtiles show "$OUT" 2>&1 | grep -iE "min zoom|max zoom|bounds" || true
