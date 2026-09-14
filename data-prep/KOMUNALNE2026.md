# Komunálne voľby 24. 10. 2026 — Košice & Bratislava okrsky

The dataset was re-sourced from the **voľby do orgánov samosprávy obcí a do orgánov
samosprávnych krajov** held **24 October 2026** (decree of the NR SR chair **145/2026 Z. z.**,
23 June 2026). This replaced the July-2026 *referendum* division, which is archived — see
[Vintages](#vintages).

The two divisions are genuinely different: the referendum consolidated precincts to save cost,
the municipal election restores full ones. Petržalka went 43 → 96, Ružinov 35 → 74, Košice
161 → 190.

## What is in the database

| | MČ | okrsky published | okrsky mapped |
|---|---|---|---|
| Košice | 22 | 190 | **189** |
| Bratislava | 17 | 388 | **386** |
| **Total** | **39** | **578** | **575** |

The three unmapped precincts are documented under [Known gaps](#known-gaps) — none is a parser
failure; all three are precincts whose territory the issuing office did not publish.

Still on the referendum vintage (not part of this request): Banská Bystrica 78, Nitra 74,
Prešov 66, Žilina 72.

## Finding the sources

**Košice publishes a city-wide index** — this is the single most useful discovery:

    https://static.kosice.sk/files/manual/volby/volby2026_volebne_okrsky.pdf

It lists all 22 mestské časti with their okrsok count **and a direct link to each MČ's own
document**. Extract the links from the PDF's *annotations*, not its text — several wrap across
lines and one (Juh) is plain text rather than a link:

```bash
pdftohtml -i -stdout ke_volebne_okrsky.pdf | grep -o 'href="[^"]*"'
```

Use the per-MČ counts in that index as the **acceptance test** for every parser.

**Bratislava has no equivalent.** bratislava.sk publishes only the volebné *obvody* and states
that okrsky are "v kompetencii jednotlivých mestských častí", so all 17 documents were located
on the individual MČ sites. The full URL list lives in the header comments of `src/parseKvBa.ts`,
`src/parseKvBaTables.ts` and `src/parseKvBaSmall.ts`.

Fetch notes:
- **kosicejuh.sk** returns *Access Forbidden* without a `Referer` header.
- **karlovaves.sk** still has a broken TLS chain → `curl -k`.
- **jarovce.sk** is HTTP-only.
- The **RA WFS** (`rageo.minv.sk`) fails intermittently and returns **0 points without erroring**
  — Nové Mesto's first fetch came back empty and succeeded on retry. Always check the point count.

Raw downloads and their `pdftotext -layout` output are kept in `data/kv2026/`; the staged inputs
the parsers read are `data/kv_ke_<slug>.*` and `data/kv_ba_<slug>.*`.

## Parsers

Every document reduces to one of three shapes, so there are three engines rather than 39 scripts.

### 1. Prose sections — `src/kvSections.ts`

An okrsok header, then that okrsok's streets (a comma list that wraps, or one street per line).
MČ differ only in *which* line opens a section, *which* line starts the street list, and what
counts as chrome — so they are a config table, not code.

Config knobs: `header`, `streetsAfter`, `perLine`, `colSplit`, `skip`, `stop`, `startAfter`,
`endSection`, `contLine`, `twoUpAt`.

Users: `src/parseKvKe.ts` (9 Košice MČ), `src/parseKvBa.ts` (11 Bratislava MČ).

Two rules worth knowing:
- **`stop` is only armed after a section has opened.** Otherwise footer wording that also appears
  in the preamble ("Starosta … určuje") aborts the parse before it starts.
- **`endSection` closes a section without ending the parse** — for documents that put each okrsok
  on its own page and repeat the whole preamble every time (Šaca).

### 2. Coordinate tables — `src/kvTable.ts`

Word/Excel tables **merge the okrsok cell** across all of that okrsok's street rows and centre
the number in it, so `pdftotext -layout` prints the number beside a *middle* row: rows above
**and** below it belong to that okrsok. Reading "a number starts a new block" mis-assigns every
row above each anchor.

`assignAnchors` recovers the true grouping with a contiguous DP that minimises
`Σ |mean(y of a block's rows) − y of that block's anchor|` — the partition whose block centroids
land on the anchors. Word coordinates come from `pdftotext -tsv`.

Users: `src/parseKvKeTables.ts` (Staré Mesto, Sídlisko KVP, Dargovských hrdinov, Juh, Nad
jazerom), `src/parseKvBaTables.ts` (Petržalka, Dúbravka), and `src/keOkrskyTable.ts` for Sídlisko
Ťahanovce, which kept the referendum-era layout exactly.

Three traps, each of which cost a precinct before it was fixed:
- **`pushCell` folds a wrapped house-number line into the row above.** Left as rows of their own
  they do not merely sit empty — they shift every later row relative to the anchors, so the DP
  slices blocks in the wrong places. A `s. č. NNNN` row is *not* a continuation.
- **`skip` must be tested against both the street and the number column.** A "Volebný obvod č. N"
  banner is centred over the table and can land in the number column.
- **`tableStart` gates the table region.** Dúbravka's page 1 and Košice-Staré Mesto's preamble
  carry numbered paragraphs ("1. Voľby do orgánov…") that otherwise become phantom anchors.

### 3. Transcribed

`src/parseKvKeSmall.ts` (Pereš, Luník IX) and `src/parseKvBaSmall.ts` (Vajnory, Záhorská
Bystrica). Luník IX, Vajnory and Záhorská Bystrica are **300 dpi scans with no text layer** —
transcribed from the page images rather than OCR'd, because an OCR slip in a street name silently
drops that street's addresses.

The five single-okrsok Košice MČ (Džungľa, Kavečany, Lorinčík, Poľov, Šebastovce) name no streets
at all — the okrsok *is* the whole mestská časť — so their street list is carried over from the
referendum vintage, where it is identical by construction.

### Nové Mesto is the exception — official per-address data

`src/parseKvBaNovemesto.ts` reads the MČ's own ArcGIS layer **"Adresné body - Komunálne voľby
2026"** (org `yYjTjOIUts73Bpbo`, layer 1): 5043 address points each carrying `VOL_OKR`. This is
the authoritative assignment, and it shows — **99.9 % match versus 57.9 %** from the PDF prose.
It also independently confirms the 32 okrsky of the banm.sk PDF.

Whenever an MČ publishes per-address data, prefer it. Prešov's pipeline uses the same shape.

### Shared normalisation — `src/kvCommon.ts`

`proseRange` and `expandMultiSpec` handle what the 2026 municipal documents write and the
referendum ones did not. Both matter because a mis-parsed spec silently becomes a **WHOLE**
street, handing that okrsok every house on it and making every point ambiguous where a
neighbouring okrsok claims the rest:

- prose ranges — `"Železiarenská párne čísla od 2 do 20"`, `"Kadnárova od 209 do 340"`
- `"X-Y párne i nepárne"` and `"(párne, nepárne)"` → both sides, no parity filter
- several specs on one street — `"Czambelova párne 8-18, nepárne 7-9"`,
  `"Šoltésovej 1-5 nepárne a 16-38 párne"`
- a parity word stated only on the **last** fragment governs the earlier ones:
  `"Južná trieda 2-10 a 20-22 párne"` = both ranges even
- inline `"súp. č. NNNN"` items dropped (a spec holds one number *kind*, not both)

One abbreviation went into `STREET_FIX` in `src/normalize.ts`: Dargovských hrdinov writes its
main street as the initialism **`PČL`** (Povstania českého ľudu). Without it okrsok 9, whose only
street that is, gets no seeds.

## Running it

```bash
cd data-prep

# 1. parse (each prints okrsky found vs published — they must match)
node src/parseKvKe.ts          # 9 Košice MČ, prose
node src/parseKvKeTables.ts    # 5 Košice MČ, coordinate tables
node src/parseKvKeSmall.ts     # Pereš, Luník IX + 5 single-okrsok MČ
node src/parseKvKeSidliskoTahanovce.ts
node src/mergeKvKosice.ts      # -> data/kosice_okrsok_streets.json (+ per-MČ audit)

node src/parseKvBa.ts          # 11 Bratislava MČ, prose
node src/parseKvBaTables.ts    # Petržalka, Dúbravka
node src/parseKvBaSmall.ts     # Vajnory, Záhorská Bystrica (scans)
node src/parseKvBaNovemesto.ts # official per-address layer (authoritative for Nové Mesto)

# 2. derive geometry
#    Košice: one table, okrsok numbers restart per MČ
ogr2ogr -f PostgreSQL PG:dbname=volebna data/ra_kosice.geojson -nln ra_kosice_all \
        -overwrite -t_srs EPSG:5514 -lco GEOMETRY_NAME=geom -nlt POINT
node src/fixGluedStreetsKosice.ts   # RA-authority repair of prefix-glued street names
                                   # (MUST run between merge and label — skipping it costs ~0.7%)
node src/labelKosice.ts
psql volebna -f src/build_kosice_geom.sql
psql volebna -c "drop table ra_kosice_all"

#    Bratislava: one table per MČ
./buildKvBa.sh
#    ...then fold them into ONE dataset shaped like Košice's, so the whole city
#    can be checked and hand-edited in a single JOSM file:
psql volebna -f src/build_bratislava_union.sql
node src/exportOkrskyJosm.ts bratislava

# 3. tiles
./buildOkrskyTiles.sh && ./buildSeedsTiles.sh
```

`rebuild.sh <mc> | --all | --tiles` still works for re-deriving after a `seed_overrides.csv` edit.

### Bratislava as one dataset

`src/build_bratislava_union.sql` unions the per-MČ tables into `okrsky_bratislava`,
`seeds_bratislava`, `unmatched_bratislava` and `bratislava_boundary`, adding the `mcnorm` column
the per-MČ names leave implicit. Okrsok numbers restart per MČ exactly as in Košice, so a precinct
is `(mcnorm, okrsok)` and every existing tool works unchanged. Devín has no polygons — its decree
creates 2 okrsky but names no streets — though its boundary IS in the union, so the city outline
stays whole for the outside-address check.

Deriving each MČ against its own `_bnd` hides one class of error until they meet: **33 pairs of MČ
boundary polygons overlap** (28 226 m² of slivers), which makes 33 pairs of okrsky from different
boroughs overlap too. Nothing per-MČ can see that. `checkFile`'s `wrong-side-of-border` test is
deliberately NOT scoped to one mestská časť for this reason.

⚠️ **Nové Mesto is parsed twice and order used to matter.** `parseKvBa.ts` reads its PDF prose and
`parseKvBaNovemesto.ts` reads the MČ's authoritative per-address export. They used to write the
same file, so running the prose parser alone silently replaced 160 ENUM rows with whole-street
rows — eleven okrsky each claimed all of Račianska, every address on it became `ambiguous`, and
Nové Mesto fell to **57.9% matched with 2071 ambiguous** with nothing in the pipeline complaining.
The prose parse now writes `kv_ba_novemesto_prose_okrsok_streets.json` and cannot clobber it.

## Vintages

The referendum-2026 tables were **archived, not dropped**: `okrsky_*`, `seeds_*`, `unmatched_*`,
`uncovered_*` and `seed_stats` for Košice and the Bratislava MČ now live in the PostgreSQL schema
**`ref2026`**. `public` holds the live komunálne-2026 dataset.

Because `pg_tables` spans schemas, every discovery query in `buildOkrskyTiles.sh`,
`buildSeedsTiles.sh` and `rebuild.sh` is now scoped with `schemaname='public'` — without that
they would pick the archive up as a second copy of every city.

### Results

`buildOkrskyTiles.sh` has a **`REF2026_VINTAGE`** list. Only cities on it get a non-null
`refkey`, i.e. only they are joined to the ŠÚ SR referendum results. Košice and the Bratislava MČ
are deliberately excluded: the komunálne division numbers and draws precincts differently, so
joining referendum rows by `(obec_code, okrsok)` would silently attach **another area's** turnout
to each precinct. They carry no result props and the app paints them in the "no data" colour.

Add komunálne results to that list once ŠÚ SR publishes them (expected shortly after 24 Oct 2026,
same `volby.statistics.sk` shape as `src/loadRef2026.sql` handles).

## Hand-editing polygons in JOSM

The derived Voronoi shapes are a good approximation, not the legal boundary. To finish one by
hand:

```bash
node src/exportOkrskyJosm.ts lamac              # whole MČ
node src/exportOkrskyJosm.ts kosice --mc zapad  # one Košice mestská časť
node src/exportOkrskyJosm.ts petrzalka --okrsok 12,13,14
#   -> data/edit/<name>.geojson   ... edit in JOSM, File > Save As over the same file
node src/importOkrskyJosm.ts lamac
./buildOkrskyTiles.sh
```

### Catching a precinct that reaches out of the city

The file's own checks can only say an address is in the *wrong* precinct — every address it knows
about is this city's, so a border drawn out into a neighbouring village looks perfectly fine.
`addNeighbourSeeds.ts` closes that blind spot by adding the SURROUNDING municipalities' addresses
as `kind=neighbour` points, which are never assigned to an okrsok:

```bash
# once: Register adries for the precincts' bbox plus a margin (~50k points for Košice)
node --experimental-strip-types src/fetchRa.ts "21.13918 48.61289 21.35182 48.80913" \
     data/ra_kosice_ring.geojson
node --experimental-strip-types src/addNeighbourSeeds.ts kosice --ring data/ra_kosice_ring.geojson
node --experimental-strip-types src/checkFile.ts kosice      # fixme=outside-address-inside-precinct
node --experimental-strip-types src/addNeighbourSeeds.ts kosice --clear   # remove them again
```

What counts as "not this city" is the `<mc>_boundary` table, **not** the set of ids already in the
file. `ra_kosice_all` is itself a bbox fetch (55 263 rows against the city's 20 057 placed
addresses), so id-difference marks every address the decree could not place — a village's
súpisné-only houses AND Košice's own unnamed ones — as foreign: 16 697 false positives against 82
true ones. The city polygon is the only honest discriminator; RA's WFS carries no municipality name.

Only points within `--within` metres (default 400) of the drawn precincts are added; the rest are
clutter. Re-running replaces the previous set rather than accumulating.

### A precinct with islands is several features, and that is fine

An okrsok made of disjoint areas comes out of JOSM as one `Polygon` feature per island, all
carrying the same `mcnorm`/`okrsok` tags. Every tool here groups by `mcnorm`+`okrsok`, never by
feature, so that is already treated as one precinct.

Do not try to fold them into a `MultiPolygon`: it does not survive a save. Measured on a full
round-trip of Košice, of 64 okrsky merged that way only the 10 whose parts are *rings of one
polygon* (a precinct with a hole) came back as one feature — all 62 built from separate islands
were split again. JOSM's GeoJSON layer keeps a multipolygon relation only where the geometry
cannot be expressed without one. Worse, a `type=multipolygon` tag put on such a feature is copied
onto every way JOSM splits off, leaving plain closed ways falsely claiming to be multipolygons.

The export is ONE FeatureCollection holding the polygons **and** the address points they were
derived from, each tagged `kind` so JOSM's filters (Shift+F) can show/hide them independently:

| `kind` | what it is |
|---|---|
| `okrsok` | the polygon; `src=derived` or `src=manual` |
| `seed` | an address point that matched — what the polygon was built from |
| `unmatched` | an address point that did NOT match (`reason=no-street|no-number|ambiguous`) |

Filter examples: `kind=seed`, `kind=unmatched`, `okrsok=12`, `kind=seed okrsok=12`.

The tag key is `kind`, not `type` — `type` is reserved in the OSM data model, and a multipart
okrsok arrives as a `type=multipolygon` relation.

**Weld the borders first.** Neighbouring okrsky share *exact* vertices along their common border,
but JOSM's GeoJSON reader gives each polygon its own copy. Run the validator (Shift+V) and apply
the **"Duplicated nodes"** fix before touching anything: that makes each border shared, so
dragging a node moves both precincts at once and you cannot open a sliver between them.

### Style + plugin

`josm/volebne-okrsky.mapcss` colours precincts and their address points with the SAME hue (same
golden-angle formula as the web map), so a point whose colour differs from the area it sits in is
exactly what needs attention. Style options toggle colour-by-okrsok vs colour-by-mestská-časť,
area fill, point visibility and labels. `josm/plugin/` builds a "Delete vertex" map mode (`K`)
that deletes a vertex only when it has exactly two distinct neighbours pooled across all its
parent ways — dissolving interior border vertices while protecting the triple points where three
precincts meet. See **[josm/README.md](josm/README.md)**.

### Editing nodes

**Improve Way Accuracy mode (`W`)** is the tool for reshaping a border: click the polygon to lock
onto it, then **`Alt`+click deletes the node under the cursor** (`Ctrl`+click adds one, plain click
drags). It only touches the way you locked onto, so a stray click cannot delete a whole precinct —
unlike **Delete Mode** (`Ctrl`+`Delete`), which deletes nodes *or ways* and is best avoided here.
Deleting a welded node removes it from both neighbouring precincts at once, so the border stays
matched.

The bulk simplifiers — **Simplify Way** (`Shift`+`Y`) and the **SimplifyArea** plugin (More tools >
Simplify Area) — are less useful than they look. `SimplifyWayAction.isRequiredNode()` protects any
node that is tagged or has other parent ways, so after welding, every node on a shared border
belongs to two precincts and is left alone: bulk simplify only thins the tiling's OUTER perimeter.
That is the same property that stops it tearing a border open, so it is the right trade-off — just
do internal borders by hand.

### Importing only what you edited

A full-MČ export holds every okrsok, so importing it wholesale would pin all of them as manual
overrides — freezing today's derived geometry for precincts you never touched. The import
therefore compares each staged polygon with its derived counterpart and **skips the unchanged
ones** (Hausdorff distance < 0.5 m; the export rounds to ~1 cm, a real edit moves metres).
`--all` imports everything regardless.

### Edits live in the `manual` schema and survive re-derivation

`importOkrskyJosm.ts` writes `manual.okrsky_<mc>`, **not** `okrsky_<mc>`. `okrsky_<mc>` stays pure
machine output, so it can always be re-derived — a new source document, a different clip radius,
a `seed_overrides.csv` fix. `buildOkrskyTiles.sh` `COALESCE`s the two **per okrsok**, so a rebuild
improves every precinct you have not touched while the ones you have keep your geometry.

Import is an upsert keyed by okrsok (Košice: `mcnorm`+okrsok). Okrsky absent from the file are
left alone; `--replace` clears the MČ's overrides first. To revert one precinct to the derived
shape, delete its row:

```bash
psql volebna -c "delete from manual.okrsky_lamac where okrsok=3"
```

Before writing anything the import refuses the file if an `okrsok`/`mcnorm` tag was lost, a
polygon appears twice, geometry is not a polygon, or **any two precincts overlap**. `--dry-run`
runs those checks and writes nothing.

Seed points in the file are read-only context — they are ignored on import. To move or drop a
seed use `seed_overrides.csv`, which feeds the derivation itself.

## Known gaps

- **Bratislava-Devín (2 okrsky) — not derived.** The starostka's rozhodnutie of 29.07.2026 creates
  two okrsky but publishes **no territorial division**; both polling rooms are in the same
  building (Dom kultúry Devín, veľká/malá sála). There is nothing to split on, and inventing a
  split would put fiction on an election map. The division should appear in the *Oznámenie o čase
  a mieste konania volieb*, due ~25 days before the vote (≈ 29 Sep 2026) — drop it in and Devín
  can be built like any other MČ.
- **Košice-Staré Mesto okrsok 19 — no territory.** It is the precinct for voters whose permanent
  residence is registered at the mestská časť office with no street address. 18 of its 19 okrsky
  are mapped; this one has no geometry by definition.
- **Rača's PDF is signed "V Bratislave, dňa 20.7.2022"** — a stale copy-paste in the source. The
  document *is* the 2026 one (filed under `uploads/2026/07/`, headed 24 October 2026, citing
  uznesenie č. 514/23/06/26/P of 23.6.2026). 19 okrsky, versus 9 for the referendum.

## Match quality

`seed_stats` holds one row per MČ. Everything is ≥ 90 % except Košice's small single-okrsok MČ,
where the rate is moot — the okrsok is the whole boundary either way.

A sub-100 % rate is usually the **source**, not the parser: municipal lists routinely omit vacant
addresses and new build, while Register adries carries the full current street. Those points
still land spatially; they simply do not seed a precinct.

Geometry validation: **0 real overlaps** in every MČ. Cross-MČ "overlaps" reported by
`ST_Overlaps` are zero-area hairlines along shared cadastral edges — filter with
`ST_Area(ST_Intersection(...)) > 1`.
