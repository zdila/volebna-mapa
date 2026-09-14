// Extract okrsky geometry + 2023 NRSR results from a Flourish map embed into a
// GeoJSON FeatureCollection. The embed inlines everything as `_Flourish_data`
// (regions_map = [{ geojson, metadata, value }]); metadata columns are named in
// `_Flourish_data_column_names.regions_map.metadata`.
//
//   node src/extractFlourishOkrsky.ts [url] [out.geojson]
//   default url = https://flo.uri.sh/visualisation/15280176/embed
//
// Reference/comparison data only — overlaid in the app against our own okrsky.
import { writeFileSync } from "node:fs";

const url =
  process.argv[2] ?? "https://flo.uri.sh/visualisation/15280176/embed";
const out = process.argv[3] ?? "data/flourish_ba_okrsky.geojson";

// Grab a `<varname> = { ... }` object literal by brace-matching (string-aware).
function extractObj(src: string, varname: string): string {
  const m = new RegExp(`\\b${varname}\\s*=\\s*`).exec(src);
  if (!m) throw new Error(`${varname} not found`);
  const start = src.indexOf("{", m.index + m[0].length);
  let depth = 0,
    inStr = false,
    esc = false;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`unterminated object for ${varname}`);
}

const html = await (await fetch(url)).text();
const data = JSON.parse(extractObj(html, "_Flourish_data"));
const cols = JSON.parse(extractObj(html, "_Flourish_data_column_names"));
const names: string[] = cols.regions_map.metadata; // ["obec","okrsok",...]

const iObec = names.indexOf("obec");
const iOkrsok = names.indexOf("okrsok");
const iVolici = names.indexOf("volici");
const iUcast = names.indexOf("ucast rel");
const iVitaz = names.indexOf("víťaz");

// Normalised MČ key (lowercase, diacritics stripped, alnum only) — matches our
// okrsky `key` (regexp_replace(lower(mc),'[^a-z0-9]','')) so (key, okrsok) is a
// shared identity for cross-layer selection. Colour is golden-angle over the
// OKRSOK NUMBER with the SAME formula as buildOkrskyTiles.sh, so the same
// precinct gets the same colour in both layers.
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const features = data.regions_map.map((e: any) => {
  const obec = e.metadata[iObec];
  const okrsok = e.metadata[iOkrsok];
  const n = parseInt(String(okrsok).replace(/[^0-9]/g, ""), 10) || 0;
  const hue = Math.round(n * 137.508) % 360;
  return {
    type: "Feature",
    geometry: JSON.parse(e.geojson),
    properties: {
      obec,
      okrsok,
      key: norm(obec),
      volici: e.metadata[iVolici],
      ucast_rel: e.metadata[iUcast],
      vitaz: e.metadata[iVitaz],
      color: `hsl(${hue},62%,58%)`,
    },
  };
});

writeFileSync(out, JSON.stringify({ type: "FeatureCollection", features }));
console.error(`wrote ${features.length} features -> ${out}`);
