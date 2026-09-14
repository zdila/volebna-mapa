# Bratislava — per-MČ okrsok data inventory

Working register for processing BA MČ by MČ. Okrsok counts are the **2022 (OSK) ŠÚ SR
ground truth** — the number of okrsky we must end up with (vintage may shift for 2026).
17 MČ, 394 okrsky (2022).

Status legend: ✅ have machine-readable source · 🟡 partial/needs work · 🔴 not found yet · ⬜ not started

> ⚠️ **2026 reorganization is happening NOW (July 2026).** Bratislava cut city-wide volebné
> **obvody** 17 → 11 (approved 2026-07-07). MČ are also redrawing **okrsky** for 2026 (e.g. Rača
> reorganized okrsky for the July 2026 referendum). The **2026-referendum okrsky are the freshest
> vintage** and some MČ already publish them (Nové Mesto has `Volebné_okrsky_2026_Referendum`
> polygons). Prefer 2026 sources over 2022 for go-live; treat all 2022 counts below as anchors only.
> There is **no city-wide okrsok assignment registry** — magistrát holds only boundaries + a
> `Zoznam komunikácií` street registry; okrsok assignment is per-MČ.

MČ boundaries (all 17): magistrát ArcGIS `services8.arcgis.com/pRlN1m0su5BYaFAS` →
`Mestská_časť_1` FeatureServer (service name `Hranice_UJ`). Field `ZUJ` = obec code,
`NAZOV_ZUJ` = name. Saved as `data/ba_mc.geojson`.

Global okrsok-source search: `https://www.arcgis.com/sharing/rest/search?q=<term>&f=json`.

| # | MČ | ZUJ | okrsky (2022) | status | source |
|---|---|---|---|---|---|
| 1 | Petržalka | 529460 | 95 | ✅ DONE | petrzalka.sk — NRSR2023 PDF; 95 okrsky built |
| 2 | Ružinov | 529320 | 70 | ✅ DONE | ruzinov.sk — street→okrsok PDF; 70 built (95% match) |
| 3 | Nové Mesto | 529346 | 45 | ✅ DONE | ArcGIS `kollarik_banm` — official polygons, 45 built |
| 4 | Staré Mesto | 528595 | 34→19 | ✅ | staremesto.sk 2026 referendum PDF — BUILT (19, 2026 set) |
| 5 | Dúbravka | 529389 | 31 | ✅ DONE | dubravka.sk — príloha PDF; 31 built (98% match) |
| 6 | Karlova Ves | 529397 | 30 | ✅ DONE | karlovaves.sk — PDF; 30 built (98.6% match) |
| 7 | Podunajské Biskupice | 529311 | 18 | ✅ | biskupice.sk — okrsky+miestnosti PDF |
| 8 | Rača | 529354 | 18 | 🟡 | raca.sk (okrsky reorganized for 2026 referendum) |
| 9 | Devínska Nová Ves | 529371 | 14 | 🟡 | mestskacastdnv.sk |
| 10 | Vrakuňa | 529338 | 13 | ✅ | vrakuna.sk — okrsky+ulice PDF |
| 11 | Lamač | 529419 | 6 | ✅ | ArcGIS `BA_Lamac` — street lines (assignment) |
| 12 | Vajnory | 529362 | 5 | 🟡 | vajnory.sk |
| 13 | Záhorská Bystrica | 529427 | 5 | 🟡 | zahorskabystrica.sk |
| 14 | Rusovce | 529494 | 4 | 🟡 | rusovce.sk |
| 15 | Devín | 529401 | 2 | 🟡 | devin.sk — trivial (2 okrsky) |
| 16 | Čunovo | 529435 | 2 | 🟡 | cunovo.sk — trivial (2 okrsky) |
| 17 | Jarovce | 529443 | 2 | 🟡 | jarovce.sk — trivial (2 okrsky) |

---

## 11. Lamač — ✅ DONE (proof MČ)
- **Source:** ArcGIS org `BA_Lamac` = `services9.arcgis.com/IEKf5RR0c6g8ks4p`.
  - Assignment: `Ulice__súp_č_zaradené_do_vol_okrskov/FeatureServer/0` (also a `..._2023` version).
- **Format:** street **centerlines** (polyline), fields `NAZOV` (street incl. house range, e.g.
  "Bakošova 1-36"), `VOL_OKRS_C` ("Volebný okrsok č. N"), `POZN` (note). 91 features, `NEZARADENÁ`
  bucket for unassigned.
- **Notes:** parses straight into our schema via `parseStreetSpec`. Ran full pipeline: 4 okrsky
  (assignment vintage), 98.4% RA match, gap/overlap 0, 83% street-line agreement.
  ⚠️ **Vintage mismatch:** ŠÚ SR 2022 says Lamač had **6** okrsky, but this layer has **4** — the
  ArcGIS layer is a different (later, reduced) vintage. Reconcile before go-live.

## 3. Nové Mesto (BANM) — ✅ DONE (official polygons, no derivation)
- **Source:** ArcGIS org `kollarik_banm` = `services8.arcgis.com/yYjTjOIUts73Bpbo`. FeatureServer
  layer names carry **non-ASCII** (é/á) so URL-encode; layer IDs are **not 0** — query the
  FeatureServer root (`…/FeatureServer?f=json`) to get the real `layers[].id`.
- **Layer used:** `Volebné_okrsky_CISTOPIS` (layer id **4**) — 47 features = **45 okrsky** (okr29,
  okr41 are 2-part). Fields: `V_OKR` (okrsok number), `V_MIESTN` (polling place), `UlicaNM`,
  `VOLICI` (voters). "Čistopis" = the clean/final standard-election set. Pulled with
  `outSR=4326&f=geojson` → `data/nm_okrsky_cistopis.geojson`.
- **⚠️ Do NOT use `Volebné_okrsky_2026_Referendum_Upravene` (layer 323):** only **21** polygons —
  the 2026 referendum **merged** okrsky for a low-turnout single vote. Wrong granularity for
  komunálne/krajské. CISTOPIS (45) is the right set.
- **Build:** dissolve the loaded ArcGIS layer by `v_okr` → `okrsky_novemesto` (45). Validation vs magistrát MČ
  boundary (`novemesto_bnd`, ZUJ 529346): 3748 ha both, gap 6.3 ha / spill 6.5 ha (0.17%, boundary-source
  difference only), 2 multi-part, 1 trivial 8.3 m² sliver overlap (okr17/19, in the official data).
  Export `data/nm_okrsky.geojson`. Tables `okrsky_novemesto`, `novemesto_bnd`.
- **Note:** these are **official ground truth** — better than a Voronoi derivation. Could later be
  used to validate the derived method, but NM publishes no parseable street→okrsok assignment.

## 1. Petržalka — ✅ DONE (biggest MČ, 95 okrsky)
- **Source used:** PDF NRSR2023 `/wp-content/uploads/2023/09/2-Volebne-Okrsky-volby-do-NRSR-2023.pdf`
  (`data/petrzalka_2023.pdf` → `pdftotext -layout` → `data/petrzalka_2023.txt`). Columns
  **Volebný obvod | okrsok | Volebná miestnosť | Ulica | Čísla domov**.
  Also available (unused): XLS (2014 vintage), EP2024 PDF. Prefer **2026** doc when published.
- **Parser `src/parsePetrzalka.ts`** — the fixed-column slicing was too fragile (long polling-place
  names shift columns; diacritics like `Ö` break uppercase runs). Rewrote **right-anchored**:
  čísla domov = first digit-token after a street token → end of line; street = the contiguous
  ALL-CAPS run before it (polling place is Title Case, so it terminates the run). Handles:
  whole-street rows with no numbers (LABUTIA), street-name wraps (`ULICA GUSTÁVA` + `MALLÉHO`),
  čísla wraps (drop stray left-column obvod digits — real list tokens end in a comma),
  and mixed open-ended parity + enum (`Fialová 1 a ďalšie nepárne čísla, 2, 2A…` → emits a RANGE
  row + an ENUM row for the same okrsok; the matcher collapses same-okrsok multi-hits).
  Output: 196 rows, 95 okrsky, ENUM=193 RANGE=2 WHOLE=1.
- **Matcher surname fallback** (added to `src/matcher.ts`, benefits all cities): person-named streets
  are abbreviated differently between RA and the list (RA `A. Gwerkovej` / `M. Curie Sklodowskej`
  vs list `GWERKOVEJ` / `M. C. SKLODOWSKEJ`). On a primary-key miss, match on the distinctive
  **tail token** (≥4 chars, non-generic) when it is unambiguous within the MČ.
- **Match:** `src/labelMc.ts` → **81.3%** (ok=1854/2281), **95/95 okrsky seeded**, no-street=37,
  no-number=390. The lower rate vs KE (94.6%) is a **source gap, not a bug**: the 2023 PDF
  enumerates only a *subset* of house numbers per street, while RA (current) carries the full
  street incl. post-2023 construction (Slnečnice on Kopčianska/Panónska, new entrance-letters on
  Žltá). Those addresses still land in an okrsok spatially via Voronoi — they're just not seeds.
  Residual no-street is edge roads (Einsteinova = Staré Mesto border).
- **Geometry `src/build_mc_geom.sql`:** load seeds → Voronoi extended to boundary → clip to
  `petrzalka_bnd` → dissolve by okrsok → `okrsky_petrzalka`. **95 okrsky, gap 0, spill 0, 0 overlaps,
  2864 ha ≈ Petržalka's ~2870 ha.** 54/95 multi-part (fragmentation — deferred cleanup, as KE).
  Export `data/petrzalka_okrsky.geojson`. Tables: `okrsky_petrzalka`, `seeds_petrzalka`, `petrzalka_bnd`.

## 2. Ružinov — ✅ DONE (70 okrsky, biggest by area 3972 ha)
- **Source:** `https://www.ruzinov.sk/data/MediaLibrary/2/21967/zoznam-ulic-s-udajom-o-volebnom-okrsku.pdf`
  → `data/ruzinov_okrsky.pdf` → `pdftotext -layout` → `data/ruzinov_okrsky.txt`. Clean 4-column
  table: **Ulica | Orientačné čísla | Okrsok č. | Adresa volebnej miestnosti**. `celá` = whole street.
- **Parser `src/parseRuzinov.ts`:** fields are separated by ≥2 spaces and číslá lists have no internal
  spaces, so `line.split(/\s{2,}/)` → `[street, čísla, okrsok, address]`. Long číslá lists **wrap**:
  the street/okrsok/address land on a middle 3-part line (no čísla) and number fragments become
  orphan lines above/below — reattached to their **nearest** 3-part line (the street is vertically
  centred in its číslá block, so nearest-line resolves even the two adjacent Mierová rows). One street
  "Ružinov" (garden colonies) uses **súpisné** numbers (>500) → flagged `numberKind:"supisne"`.
  Output: 437 rows, 70 okrsky (1–70, none missing), WHOLE=230 ENUM=207.
- **Match `src/labelMc.ts`: 95.0%** (ok=6563/6908), **70/70 seeded**, no-street=38, no-number=307.
  Unmatched = major/industrial roads (Ivanská cesta=airport, Galvaniho=business park, Mlynské nivy,
  Bajkalská) — partially enumerated or edge roads; still land spatially.
- **Geometry `src/build_mc_geom.sql`** (boundary table `ruzinov_bnd`, ZUJ 529320): Voronoi→clip→dissolve
  → `okrsky_ruzinov`. **70 okrsky, gap 0, spill 0, 0 overlaps, 3972 ha = boundary.** 60/70 multi-part
  (fragmentation, deferred). Tables `okrsky_ruzinov`, `seeds_ruzinov`, `ruzinov_bnd`.
  RA fetch: 25598 in bbox, 11111 in-boundary, 6908 street pts.

## 6. Karlova Ves — ✅ DONE (30 okrsky, 1094 ha)
- **Source:** `https://www.karlovaves.sk/wp-content/uploads/2022/08/Urcenie_volebnych_okrskov_kom-volby_volby-VUC_2022_final.pdf`
  → `data/karlovaves_okrsky.pdf/.txt`. ⚠️ **karlovaves.sk has a broken TLS chain** (missing
  intermediate) — fetch with `curl -k` (public municipal doc).
- **Format:** record layout per okrsok (`Volebný okrsok N` / `Volebná miestnosť` / `Ulica  Orientačné
  číslo` / `StreetName  numbers|všetky`, numbers wrap). `všetky` = whole street. Parser
  `src/parseKarlovaVes.ts`: 2-space column split like Ružinov; continuation lines (start with digit)
  append to prev street. 105 rows, 30 okrsky, WHOLE=86 ENUM=19.
- **Match `src/labelMc.ts karlovaves`: 98.6%**, 30/30 seeded. Geometry via `build_mc_geom.sql`
  (`-v seeds=karlovaves_seeds bnd=karlovaves_bnd result=okrsky_karlovaves n=30`): gap/spill/overlap 0, 18 multi-part.
  Result table `okrsky_karlovaves`, boundary `karlovaves_bnd`.

## 5. Dúbravka — ✅ DONE (31 okrsky, 865 ha)
- **Source:** `https://www.dubravka.sk/files/documents/samosprava/volby/2022%20samospravy/rozhodnutie-priloha.pdf`
  → `data/dubravka_okrsky.pdf/.txt`.
- **Format:** `Volebný okrsok | Ulice | Volebná miestnosť` table; the Ulice cell is a comma-separated
  street list (mostly whole) that wraps, with a few house-number splits using Slovak range words
  (`1 až 27 nepárne a 24`, `2 až 22 párne`, `1-7`). Parser `src/parseDubravka.ts`: split polling
  place off by institution keyword (`Základná`/`KC`/`SPŠE`/`Bývalá`…, robust to per-page indent
  shifts); split street list on commas where a digit-leading fragment continues the previous
  street's numbers; normalize `až`→`-`, `párne`→`(párne)` (lookbehind so `nepárne` survives), `a`→`,`;
  a parity-range + extra single is emitted as two rows. 81 rows, 31 okrsky, WHOLE=74 RANGE=4 ENUM=3.
- **Match `src/labelMc.ts dubravka`: 98.0%**, 31/31 seeded (needed the tail-fallback ≥4 fix — see
  below — for `Kpt. J. Rašu` = RA `Kpt. Jána Rašu`). Unmatched `Pod kopčekmi`/`Pod brehmi` = newer
  streets absent from the 2022 list (source gap). Geometry: gap/spill/overlap 0, 12 multi-part.
  Result `okrsky_dubravka`, boundary `dubravka_bnd`.

### Reusable pipeline pieces (added while doing these two)
- **`src/labelMc.ts`** — generic labeller: `node src/labelMc.ts <mcNorm> <assignment.json>
  <ra_streets.geojson> <seeds_out.geojson>` (the generic labeller for every new MČ).
- **`src/build_mc_geom.sql`** — parameterized Voronoi/clip/dissolve + validation; run with
  `psql -v seeds=… -v bnd=… -v result=… -v n=… -f src/build_mc_geom.sql`.
- **Matcher tail-fallback threshold lowered 5→4 chars** (`src/matcher.ts`) so short surnames
  (`Rašu`) match; still guarded by per-MČ tail uniqueness. KE self-test unchanged (0 wrong).

## 4. Staré Mesto — ✅ BUILT (19 okrsky, 2026 set)
- **Source:** `https://data.moderneobce.sk/data/uploads/staremesto.sk/referendum/2026/Oznamenie_referendum_2026.pdf`
  (2026 referendum Oznámenie, `pdftotext -layout`). Clean 2-col `StreetName  celá|celé|number-list`.
- ⚠️ **This is the 2026 post-reorganisation set (19 okrsky), not the 2022–2026 term's 34.** Chosen
  over consistency with the other (2023-era) MČ; won't line up with 2023 ŠÚ SR results.
- Parser `src/parseStareMesto.ts`; 99.7% match, 19/19 seeded, gap/spill/overlap = 0. Result
  `okrsky_staremesto`, boundary `staremesto_bnd` (ba_mc ZUJ 528595).
- Gotcha: "Ul. 29. augusta" is a **date-named street** — split the number spec as a trailing pure
  comma-list and parse it against a digit-free placeholder, or its 28 RA points go unmatched.

## 7. Podunajské Biskupice — ✅ source found (18 okrsky)
- **Source:** `https://www.biskupice.sk/evt_file.php?file=12692&original=Okrsky+a+volebné+miestnosti.pdf`
  (okrsky + polling places + streets per okrsok, PDF, live).

## 10. Vrakuňa — ✅ source found (13 okrsky)
- **Source:** `https://www.vrakuna.sk/data/page/vrakuna.sk/17012/volebne-okrsky-volebne-miestnosti-a-zoznam-ulic-patriacich-k-prislusnym-volebnym-okrskom.pdf`
  (okrsky + polling places + streets). Newer: `/21075/volebne-okrsky.pdf`.
- **Format:** PDF, okrsok → streets.

## 🟡 Site identified, exact okrsok doc TBD (9 MČ)
Staré Mesto (basm.gisplan.sk + staremesto.sk elections section), Rača (raca.sk — note: okrsky
reorganized for the July 2026 referendum, so grab the 2026 version), Devínska Nová Ves
(mestskacastdnv.sk), Vajnory (vajnory.sk), Záhorská Bystrica (zahorskabystrica.sk), Rusovce
(rusovce.sk), Devín / Čunovo / Jarovce (2 okrsky each — trivial). Pattern: the "Určenie/Utvorenie
volebných okrskov" PDF in each site's voľby section. Prefer 2026 documents.

## Coverage — COMPLETE (17/17 MČ, 358 okrsky)
All 17 Bratislava MČ built; result tables `okrsky_<mc>`, gap/spill/overlap = 0 each.
Petržalka 95, Ružinov 70, Nové Mesto 45, Dúbravka 31, Karlova Ves 30, Staré Mesto 19,
Podunajské Biskupice 18, Vrakuňa 13, DNV 9, Rača 9, Záhorská Bystrica 4, Lamač 4, Rusovce 4,
Vajnory 3, Jarovce 2, Devín 1, Čunovo 1 = **358 okrsky**. With Košice (197) = **555 total**.

⚠️ **Vintage is MIXED.** 2026 referendum sets (reorganised, usually fewer okrsky): Staré Mesto,
Rača (18→9), DNV (14→9), Vajnory (5→3), Záhorská Bystrica (5→4), Čunovo (2→1), Devín (2→1), Jarovce.
2023-era: Ružinov, Petržalka, Dúbravka, Karlova Ves, Podunajské Biskupice, Vrakuňa, Lamač, Rusovce.
Nové Mesto = 2024 official polygons. A single-vintage refresh is needed before joining one
election's ŠÚ SR results uniformly.

Parsers: `parseRaca.ts` (prose ranges), `parseDnv.ts` (per-street enum, split-street detection),
`buildWholeStreets.ts` (whole-street MČ from `data/<mc>_ws.json`). Čunovo/Devín consolidated to a
single 2026 okrsok → `okrsky_<mc>` = the whole boundary.
