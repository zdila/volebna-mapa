# Background map (basemap) data

Produces the PMTiles vector basemap that sits **under** the okrsok polygons in
the MapLibre app. Precinct geometry lives in `../data-prep/`; this is a separate,
independent concern.

## Goal

- **Slovakia**: full-detail vector tiles for a dataviz backdrop.
- **World**: low-zoom tiles only, so that when the user zooms out past Slovakia
  they see a coherent world/continent instead of a blank grey void.

The map is locked to Slovakia (`maxBounds` + `minZoom`), so we never need
high-zoom tiles outside the country.

## Approach

We build **two separate** PMTiles files and use them as **two MapLibre vector
sources**, world underneath Slovakia:

| File               | Coverage          | maxzoom | Why                                   |
|--------------------|-------------------|---------|---------------------------------------|
| `world.pmtiles`    | whole world       | `ZSPLIT` (6) | no blank map when zoomed out     |
| `slovakia.pmtiles` | Slovakia (padded) | `ZMAX` (14)  | detailed backdrop where app lives |

Source data is the **Protomaps daily planet build** (a single hosted PMTiles,
schema v4, built to z15). `pmtiles extract` reads it over HTTP range requests,
so we only download the tiles we keep — no 100+ GB planet download.

```
world.pmtiles    = extract(planet, maxzoom=ZSPLIT)             # whole world, z0..6
slovakia.pmtiles = extract(planet, bbox=SK+pad, maxzoom=ZMAX)  # SK, z0..14
```

### Why NOT merge them into one file

A `tile-join`ed single file declares **one** `maxzoom` (14) for the whole
tileset. MapLibre would then believe a z7 tile exists *everywhere* and request
one over, say, Paris — find it missing — and render **blank**, because a source
only overzooms *below* its declared maxzoom, not into missing high-zoom tiles.

Kept separate, `world.pmtiles` declares `maxzoom=6`, so MapLibre **overzooms**
that z6 world tile for any zoom > 6 anywhere on Earth → never blank. The
`slovakia.pmtiles` source simply paints detail on top where it has coverage.

## Recommended settings (see Makefile to change)

- **`ZSPLIT = 6`** — At z6 the whole of Slovakia + its neighbours fit the
  viewport, so below that we genuinely need world data; at z7+ the viewport
  (locked to SK) stays inside the country, so SK-only detail is enough.
- **`ZMAX = 14`** — Protomaps builds to z15, but for a *dataviz backdrop* z14 is
  plenty: MapLibre overzooms z14 tiles up to z18+ cleanly, and z15 roughly
  doubles the byte count for detail (building footprints etc.) a muted backdrop
  doesn't show. Drop to **13** to roughly halve size if you want it leaner.
- **`BBOX`** — country bbox padded ~0.4° so the border strip of neighbouring
  countries visible at z7–9 isn't blank. `maxBounds` in the app is the tighter,
  unpadded SK box, so the visible area is always inside the extracted data.

### "Do we even need max zoom for Slovakia with the dataviz style?"

The *flavor* (dataviz / light / grayscale) is only a **color theme** applied at
render time — it doesn't change which zoom levels exist; every flavor renders up
to the tiles' maxzoom and overzooms beyond. So the question is really "how much
*data detail* do we need", not "which style". For a precinct map users will zoom
to street level to read boundaries, so keep street/label detail: **z14 is the
sweet spot, z13 the leaner option, z12 too coarse.** You do **not** need z15.

> Note on the style flavor: the `@protomaps/basemaps` package ships flavors
> `light / dark / white / grayscale / black`. If "dataviz" means the muted,
> low-chroma backdrop, use **`grayscale`** (or `light`) — confirm the exact
> flavor name against the installed package version.

## Prerequisites

Just **go-pmtiles** (the `pmtiles` CLI):

```sh
# grab the right asset for your platform from:
#   https://github.com/protomaps/go-pmtiles/releases
# then put `pmtiles` on PATH, e.g.:
#   sudo mv pmtiles /usr/local/bin/
pmtiles version
```

## Build

```sh
# pick a recent build date from https://build.protomaps.com/
./build.sh https://build.protomaps.com/20260714.pmtiles
# -> build/world.pmtiles + build/slovakia.pmtiles
```

Zoom levels / bbox are set as vars at the top of `build.sh`.

`build/` is git-ignored (large binaries).

## Using it in MapLibre

Serve both files statically (with HTTP range support) or over `pmtiles://`. Use
**two** vector sources and generate `@protomaps/basemaps` layers twice — once per
source — with the world layers underneath. Prefix the world layer **ids** so they
don't collide with the Slovakia ones:

```js
import { Protocol } from "pmtiles";
import { layers } from "@protomaps/basemaps";

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const FLAVOR = "grayscale"; // muted "dataviz" backdrop; see note below

// World layers, underneath, with prefixed ids to avoid id collisions.
const worldLayers = layers("world", FLAVOR, { lang: "sk" })
  .map((l) => ({ ...l, id: `world_${l.id}`, source: "world" }));

// Slovakia detail on top.
const skLayers = layers("protomaps", FLAVOR, { lang: "sk" });

const SK_BOUNDS = [16.83, 47.73, 22.56, 49.61]; // tighter than the extract pad

new maplibregl.Map({
  container: "map",
  maxBounds: SK_BOUNDS,
  maxZoom: 18, // overzoom of z14 SK tiles
  style: {
    version: 8,
    glyphs: "…/{fontstack}/{range}.pbf",
    sources: {
      world: {
        type: "vector",
        url: "pmtiles://…/world.pmtiles", // declares maxzoom=6 → overzooms, never blank
        attribution: "© OpenStreetMap, © Protomaps",
      },
      protomaps: {
        type: "vector",
        url: "pmtiles://…/slovakia.pmtiles", // declares maxzoom=14
      },
    },
    layers: [...worldLayers, ...skLayers], // world first (bottom), SK on top
  },
});
```

The Slovakia source paints full detail over the (overzoomed) world wherever it
has tiles; outside its bbox the world source shows through. No `minZoom` needed —
zoom out as far as you like and the world source keeps the map filled.
