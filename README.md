# Volebná mapa okrskov

Interactive election-precinct (**okrsok**) map for Slovakia: derived precinct
polygons for the major cities, the address **seed** points they were built from,
and the **2026 referendum results** (ŠÚ SR) as switchable choropleths.

**Live:** https://zdila.github.io/volebna-mapa/

## What's here

- **[`app/`](app/)** — the MapLibre GL + Protomaps PMTiles front end (Vite + TS).
  See [`app/README.md`](app/README.md) for the layers, coloring modes, hosting
  modes, and URL-hash settings.
- **`basemap/build/*.pmtiles`** — the small overlay tilesets served with the site
  (okrsky / seeds / flourish). The full Slovakia basemap is not published; the
  deployed build uses Protomaps' hosted tile API instead.

The data-preparation pipeline that derives the okrsok polygons from public
address data (Register adries) and joins the ŠÚ SR results is kept in the local
working copy (`data-prep/`) and is **not** part of this published repo.

## Deploy

Pushes to `main` are built and published to GitHub Pages by
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The workflow
reads the Protomaps hosted-API key from the repo secret `VITE_PROTOMAPS_KEY`
(so it never lives in the source) and builds with `--base=/volebna-mapa/`.

## Develop

```sh
cd app
npm install
npm run dev      # http://localhost:5173 (self-hosted local basemap)
npm run build    # type-check + production bundle
npm run lint     # biome
```
