# Volebná mapa okrskov — processing pipeline

How we turn public data into per-okrsok polygons. Companion to `../BRIEF.md` (the *why*);
this is the *how*.

> **Current vintage: komunálne voľby 24. 10. 2026.** Košice (22 MČ) and Bratislava (17 MČ) were
> re-sourced from the municipal-election documents; see **[KOMUNALNE2026.md](KOMUNALNE2026.md)**
> for those sources, parsers and how to run them. The previous referendum-2026 tables are
> archived in the `ref2026` PostgreSQL schema. Banská Bystrica, Nitra, Prešov and Žilina are
> still on the referendum vintage.

## Layout

This `data-prep/` directory holds **only the data-preparation pipeline** (scripts, source data,
docs). The repo **root** is the application itself. Run all prep commands from **inside
`data-prep/`** (`node src/…`, `psql -f src/…`) — paths below are relative to it.

The pipeline's **output is the `okrsky_*` PostGIS tables**, consumed directly by the app (and by
QGIS) over a **DB connection** — we do **not** write per-MČ GeoJSON result files.

## The core idea

Slovakia publishes **no okrsok polygons**. We derive them:

```
address points (with street + house number)          "seeds"
        +                                       ─────────────────►  label each point
street → okrsok assignment (which house votes where)                 with its okrsok
        │
        ▼
   Voronoi over the labelled points, per MČ
        │
        ▼
   dissolve cells by okrsok  →  clip to the MČ boundary  →  okrsok polygons
```

The okrsok's **shape comes from where its addresses physically are**, not from street
geometry. A street split between two okrsky (odd vs even side, or by house-number range)
seeds each side separately, so the boundary falls between the buildings.

**Map unit is the okrsok**, keyed by **(mestská časť / obec, okrsok number)** — numbers
restart per municipality. Never confuse okrsok with *obvod* (an obvod = several whole okrsky).

## Tech

- **TypeScript, run natively** (`node src/foo.ts`, Node ≥ 23 — no build step, no deps).
- **PostgreSQL / PostGIS**, database `volebna`, all geometry in **EPSG:5514** (S-JTSK) for
  metric-correct Voronoi. Reproject to WGS84 (4326) only when the app/tiles need it.
- **GDAL/ogr2ogr** for loading source layers into PostGIS; **tippecanoe** for the eventual
  PMTiles export (done from the DB, at the app layer — not per-MČ files here).
- No Python, no C++ (per brief).

## Data sources

| Layer | Source | Notes |
|---|---|---|
| **Address points** | Register adries (RA) WFS: `https://rageo.minv.sk/geoserver/ad/ows`, typeName `ad:Address` | ~1.7 M points, INSPIRE. See "RA fetch" below. |
| **KE assignment** | opendata.kosice.sk — "Komunálne voľby 2022 – volebné miestnosti" GeoJSON | 1 feature per (okrsok, spádová ulica); house-number spec in free text. |
| **KE MČ boundaries** | opendata.kosice.sk ArcGIS — `Administratívne_hranice` layer 0 (Katastrálne územia); dissolve by `NM4` | 29 k.ú. → 22 MČ. `NM4` = MČ name, `IDN4` = obec code. |
| **BA MČ boundaries** | magistrát ArcGIS org `pRlN1m0su5BYaFAS`, layer `Mestská_časť_1` | 17 MČ; `ZUJ` = obec code, `NAZOV_ZUJ` = name. |
| **BA assignment** | per-MČ. Some publish on ArcGIS (e.g. Lamač `Ulice__súp_č_zaradené_do_vol_okrskov`, Nové Mesto `Volebné_okrsky_2024`). Others are PDFs. | Find via ArcGIS search API. |
| **Results** | ŠÚ SR (volby.statistics.sk), per-okrsok CSV | Join on (obec code, okrsok number). Not yet wired. |

Find a city's ArcGIS layers:
`https://www.arcgis.com/sharing/rest/search?q=<terms>&f=json`
(add `orgid:<id>` to scope to one org; resolve a Hub item's service URL with
`https://www.arcgis.com/sharing/rest/content/items/<id>?f=json`).

## Stages

### 1. Assignment table
Parse the source into one normalized schema: one row per (okrsok, street, house-number spec).

- **Košice:** `src/buildKosiceStreets.ts` — reads the KE GeoJSON → `data/kosice_okrsok_streets.json` (+ `.csv`).
  Prints an audit (row/okrsok/MČ counts, class breakdown, house-number collisions).
- **Lamač (BA):** parsed inline from the ArcGIS line layer's `NAZOV` + `VOL_OKRS_C`
  → `data/lamac_okrsok_streets.json`.

Row schema: `mc, mcNorm, okrsok, obvod, street, streetNorm, parity, cls, numberKind, spec`.
`cls` ∈ `WHOLE | RANGE | ENUM | INSTITUTION`. `spec.ranges` = `[from, to, parity][]`,
`spec.singles` = ints or lettered tokens (`"40/A"`, `"9A"`).

The free-text parser (`src/houseSpec.ts`) handles the messy real cases:
- ranges `3-39`, en-dash `–`, missing spaces (`Fábryho12-16`)
- enumerations `2, 4, 6`; mixed `1-19, 21, 23`
- section letters `40/A`, `9A`, lone-letter continuation (`Skladná 1A, B, C`)
- **per-range parity**: a trailing `(nepárne)` binds only to the range it follows, so
  `1-7, 9-31 (nepárne)` = {1..7 both sides} ∪ {odd 9..31} — *not* the whole list odd.
- contradiction guard: `11-43 (párne)` (endpoints odd) → treat as both, trust the numbers
- súpisné-číslo enumerations (`Súpisne čísla 2669, …`) → `numberKind: "supisne"`
- institutions (`ÚVTOS /Budovateľská ul./`) — no geometry, assigned by hand

### 2. House-number matcher — `src/matcher.ts`
Given an address `(mcNorm, street, orient, supisne)`, return its okrsok.

- Index key = `mcNorm + streetKey(streetNorm)`. `streetKey` (in `src/normalize.ts`)
  strips diacritics, lowercases, **expands abbreviations** (`Nám.`→`námestie`, `sv.`→`svätého`, …)
  and **drops the generic word "ulica"** — because RA writes `Ulica 1. mája` / `Lorinčícka ulica`
  while the assignment omits it.
- Test: `WHOLE` = any number (optional parity); `RANGE` = in a range with that range's parity;
  `ENUM` = exact membership (lettered `1A` beats a range covering its integer).
- Same-okrsok multi-hits collapse to one answer; genuinely cross-okrsok hits = `ambiguous`.

Self-test: `node src/testMatcher.ts` expands every RANGE/ENUM back to concrete numbers and
matches them home. Currently `ok=3521 wrong=0 miss=18` (the 18 are 4 real source-overlap streets).

### 3. Fetch address points — `src/fetchRa.ts`
`node src/fetchRa.ts "<minx miny maxx maxy>" <out.geojson>`

Pages the RA WFS (GeoServer caps a page at 5000; deep paging is slow — minutes for a city).
BBOX axis order for EPSG:4258 is **lat,lon**. GML output only (GeoJSON errors on the app-schema).
Parses: `gml:pos` → lat/lon; `LocatorDesignator` type `addressNumber` = **súpisné**,
`buildingIdentifier` = **orientačné** (letters live here); `ThoroughfareName` component = street.

### 4. Assign MČ + label
Load points into PostGIS, assign each to a MČ by point-in-polygon against the boundary layer,
then match street points with the matcher → seeds tagged `(mcnorm, okrsok, obvod)`.

- **Košice:** `src/labelKosice.ts` reads street points from `ra_kosice_all ⋈ kosice_mc` (PIP gives
  each point its `mcnorm`), matches, and writes `seeds_kosice` + `unmatched_kosice` + the `seed_stats`
  row straight to PostGIS; prints per-MČ match rate. Seeds carry `mcnorm/okrsok/obvod/street/orient/supisne`.
- **BA MČ:** `src/labelMc.ts <mcNorm> <assignment.json> <ra_table> <bnd_table>` — same, single-MČ.
- Súpisné-only points (no street) are not matched here; they land in an okrsok spatially (step 5).

### 5. Geometry — `src/build_kosice_geom.sql`
Per MČ: Voronoi over that MČ's seeds (extended to the boundary envelope, else outer land is a
gap), clip each cell to the MČ boundary, dissolve by okrsok → `okrsky_kosice`.
Voronoi is done **per MČ** so cells never cross a MČ border; the outer edge is the official boundary.

### 6. Validate
- every okrsok non-empty and all 197 present
- per-MČ coverage: union of okrsky = MČ boundary (gap = 0, spill = 0)
- no inter-okrsok overlaps within a MČ
- unmatched-address report (step 4)
- where available, cross-check against held-out geometry (Lamač: 83% of official street-line
  length falls in the correct derived okrsok)

### 7–8. Results join & export (not yet built)
Join ŠÚ SR CSV on `(obec code, okrsok)` — add the `IDN4`/`ZUJ` code to each okrsok first.
Export the `okrsky_*` tables to PMTiles (tippecanoe) + low-detail basemap (Planetiler) for
MapLibre. This happens at the **app layer, straight from the DB** — not as intermediate files here.

## PostGIS tables (database `volebna`)

All table names use the **full MČ name** (no short codes). The DB holds three durable kinds:
the result polygons (`okrsky_<mc>`), the boundaries they were clipped to (`<mc>_bnd`), and the
labelled address points (`seeds_<mc>`) — kept for QA / manual cleanup in QGIS. Raw RA loads and
Voronoi cells are transient (dropped after a run, regenerable from the source files in `data/`).

| Table | What |
|---|---|
| **`okrsky_<mc>`** | **result okrsok polygons** — `okrsky_kosice` (197; fields `mcnorm, okrsok, obvod`), `okrsky_ruzinov` (70), `okrsky_petrzalka` (95), `okrsky_novemesto` (45, official polygons), `okrsky_dubravka` (31), `okrsky_karlovaves` (30), `okrsky_lamac` (4) — BA ones keyed by `okrsok` |
| **`seeds_<mc>`** | **labelled address points** that derived each okrsok — `seeds_kosice` (18980; `mcnorm, okrsok, obvod, street, orient, supisne`), `seeds_ruzinov`/`_petrzalka`/`_karlovaves`/`_dubravka`/`_lamac` (`okrsok, street, orient, supisne`). Nové Mesto has none (official polygons). |
| `kosice_katastre`, `kosice_mc`, `kosice_boundary` | Košice cadastre, 22 dissolved MČ boundaries, whole-city outline |
| `ruzinov_bnd`, `petrzalka_bnd`, `novemesto_bnd`, `dubravka_bnd`, `karlovaves_bnd`, `lamac_bnd` | the BA MČ boundaries (from `ba_mc.geojson`, keyed by ZUJ) |
| `seed_stats` | **match evidence**, one row per MČ: `street_pts, matched (=seeds_<mc> count), no_street, no_number, ambiguous, match_pct, okrsky, okrsky_seeded, note`. `labelMc.ts` upserts this row directly on each run. |
| `unmatched_<mc>` | the address points that did **not** become seeds, for QA: `reason` (`no-street`/`no-number`/`ambiguous`), `street, orient, supisne` (+`mcnorm` for kosice). Row count = `no_street+no_number+ambiguous` in `seed_stats`. |
| `uncovered_<mc>` | the **reverse** check — assignment entries that matched **no** RA point: `okrsok, street, cls, ra_pts_on_street, src` (+`mcnorm` for kosice). `ra_pts_on_street = 0` → the document's street name isn't in RA (name mismatch/typo, a súpisné/garden-colony or admin entry like "…bez konkrétnej adresy", or a parse artifact); `> 0` → street exists but this entry's numbers aren't in RA. |

`labelMc.ts` / `labelKosice.ts` are **DB-in / DB-out**: they read the street points from `ra_<mc>_all`
(joined to the boundary), and write `seeds_<mc>`, `unmatched_<mc>`, and the `seed_stats` row straight
into PostGIS (via `ogr2ogr /vsistdin/` + `psql`). No GeoJSON is written to disk.

Transient per-run tables (dropped after build): `ra_<mc>_all` (loaded RA fetch); Voronoi cells are
built inside a CTE / temp table in the build SQL and never persist.

## Running it for a new MČ / city

1. Get the **MČ boundary** polygon (from `ba_mc.geojson` by ZUJ, or a cadastre layer) → load as `<mc>_bnd`.
2. Get the **assignment** and parse it into the row schema (reuse `parseStreetSpec` on any
   "street + house range" text) → `data/<mc>_okrsok_streets.json`. (`parse<Mc>.ts` per source.)
3. `node src/fetchRa.ts "<bbox>" data/ra_<mc>.geojson`.
4. `ogr2ogr` the fetch into PostGIS: `ra_<mc>_all` (EPSG:5514), and add a GiST index on `geom`.
5. `node src/labelMc.ts <mcNorm> data/<mc>_okrsok_streets.json ra_<mc>_all <mc>_bnd` — reads the
   in-boundary street points from the DB, matches, and writes `seeds_<mc>`, `unmatched_<mc>`, and
   the `seed_stats` row **straight into PostGIS** (no files). Prints the match rate.
6. `psql volebna -v seeds=seeds_<mc> -v bnd=<mc>_bnd -v result=okrsky_<mc> -v n=<count> -f
   src/build_mc_geom.sql` (Voronoi → clip → dissolve + validation). (Košice uses the per-MČ
   `src/build_kosice_geom.sql` + `node src/labelKosice.ts`, since it spans 22 MČ.)
7. Drop the transient `ra_<mc>_all`. Keep `okrsky_<mc>`, `seeds_<mc>`, `unmatched_<mc>`, `<mc>_bnd`,
   the `seed_stats` row, and the source `data/ra_<mc>.geojson`.

Only steps 1–2 are city-specific.

## Known issues & caveats

- **Fragmentation.** Raw point-Voronoi produces multi-part okrsky where two okrsky's addresses
  interleave at a boundary (KE: 73/197 substantially multi-part; Lamač okr4: 12 parts). Needs a
  cleanup pass: k-NN seed-outlier removal + sliver reassignment, then optional **snap boundaries
  to cadastral parcels / street centerlines** (street lines exist for Lamač etc.).
- **Boundary alignment.** Voronoi runs *between* points, so a boundary sits behind the houses;
  final maps need manual street-alignment. Keep a separate editable layer (`okrsky_edit`) so
  re-running the pipeline never clobbers hand edits.
- **Vintage.** Geometry is built from the **2022** okrsok numbering. 2026 renumbers/redraws
  (e.g. Košice-Juh: 20 okrsky in 2022 → 18 in 2026). **Rebuild from the 2026 assignment before
  joining 2026 results**, and diff numbering per MČ.
- **Source gaps.** The 2022 KE assignment omits some house numbers (e.g. only the odd side of a
  street). Those addresses are unmatched by rule but still land in an okrsok spatially.
- **Collisions.** 4 KE streets assign the same house number to two okrsky (Južná trieda, Poludníková,
  Skladná, Klimkovičova) — flagged in the build audit; unresolvable without newer data.
