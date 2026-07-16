# Volebná mapa — web app

MapLibre GL + Protomaps PMTiles front end: a Protomaps basemap with our derived
**okrsok** (precinct) polygons, the **seed** address points they were derived
from, and the **2026 referendum results** (ŠÚ SR) as switchable choropleths.

## Stack

- **maplibre-gl** ^5
- **pmtiles** ^4 (vector tiles over HTTP range requests)
- **@protomaps/basemaps** ^5 (basemap layer styles; flavors `WHITE` / `BLACK`)
- **vite** dev server / bundler
- **@biomejs/biome** lint + format (`npm run lint` / `npm run format`)

## Data layers

Built from PostGIS by the scripts in `../data-prep/` into `../basemap/build/`:

| Source     | File                     | Role                                            |
|------------|--------------------------|-------------------------------------------------|
| `okrsky`   | `okrsky.pmtiles`         | precinct polygons + label points + ŠÚ SR results |
| `seeds`    | `seeds.pmtiles`          | labelled address points (z12+)                  |
| `flourish` | `flourish_okrsky.pmtiles`| throwaway reference layer (BA, 2023)            |

`public/tiles` is a symlink to `../../basemap/build`, so Vite serves the tiles
with range support at `<base>/tiles/*.pmtiles`.

## Basemap hosting (two modes)

The full `slovakia.pmtiles` is ~612 MB — fine to self-host, too big for GitHub
Pages (100 MB/file cap). The app supports both:

- **Self-hosted** (default, no key): uses the local `world.pmtiles` (z0–6
  overview) + `slovakia.pmtiles` (z0–14). Best for local dev.
- **Hosted** (`VITE_PROTOMAPS_KEY` set): uses Protomaps' hosted tile API
  (`api.protomaps.com`, one worldwide source to z15). No large file to ship —
  the build then stages only the ~8 MB of overlays. See `.env.example`.

The choice is automatic: a key present → hosted; absent → self-hosted. Theme
`light`/`dark` swaps the Protomaps flavor (`WHITE` ⇄ `BLACK`) live.

## Settings in the URL

The panel state persists in the URL hash next to the map position, so views are
shareable and survive reload (applied on the first paint, no flash):

```
#map=<z>/<lat>/<lng>&color=turnout|q1|q2&layer=flourish&seeds=0&theme=light|dark
```

Each key is omitted when it holds its default (`distinct` coloring, `ours`
layer, seeds on, `auto` theme), keeping the hash clean.

## Run

```sh
npm install
npm run dev      # http://localhost:5173 (self-hosted local basemap)
npm run build    # type-check + production bundle into dist/
npm run lint     # biome check
npm run format   # biome check --write
```

**Run the basemap + data-prep builds first** (see `../basemap/README.md` and
`../data-prep/`) or the map 404s on the tiles.

## Deploy to GitHub Pages

1. Get a Protomaps key (`https://protomaps.com/api`) and set it, e.g.
   `echo 'VITE_PROTOMAPS_KEY=…' > .env.local`.
2. Build under the repo subpath: `npm run build -- --base=/<repo>/`.
3. Publish `dist/` (≈9 MB) to the `gh-pages` branch / Pages.

Glyphs and sprites load from Protomaps' hosted assets
(`protomaps.github.io/basemaps-assets`); self-host them later if desired.
