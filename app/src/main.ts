import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { layers } from "@protomaps/basemaps";
import { Protocol } from "pmtiles";
import "./style.css";

import {
  ANO_STOPS,
  type ColorMode,
  fillExpr,
  fillOpacity,
  gradientCss,
  labelExpr,
  QUESTIONS,
  type Stop,
  TURNOUT_STOPS,
} from "./coloring";
import { readHashParams, writeHashParam } from "./hash";
import {
  FLAVORS,
  type FlavorKey,
  overlay,
  resolveFlavorKey,
  type Theme,
} from "./theme";

const LANG = "sk";

type Which = "ours" | "flourish";

// --- PMTiles protocol -------------------------------------------------------
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// Overlay tilesets (okrsky/seeds/flourish) are small (~8 MB total) and ship with
// the site — served from <base>/tiles (a symlink to ../../basemap/build in dev,
// the copied files in a build). BASE_URL makes it work under a GitHub Pages
// subpath (/repo/) as well as at the root.
const tiles = (file: string) =>
  `pmtiles://${location.origin}${import.meta.env.BASE_URL}tiles/${file}`;

// --- Basemap hosting --------------------------------------------------------
// The full Slovakia basemap PMTiles is 612 MB — too big for GitHub Pages (100 MB
// per-file cap). For the hosted demo we use Protomaps' hosted tile API instead
// (one worldwide source to z15, free for non-commercial use with a key). Set the
// key in app/.env as VITE_PROTOMAPS_KEY=... ; when it's absent we fall back to
// the local world.pmtiles + slovakia.pmtiles (self-hosted dev workflow).
const PROTOMAPS_KEY = import.meta.env.VITE_PROTOMAPS_KEY as string | undefined;
const HOSTED = !!PROTOMAPS_KEY;
const HOSTED_TILEJSON = `https://api.protomaps.com/tiles/v4.json?key=${PROTOMAPS_KEY}`;
const OSM_ATTRIB =
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> © <a href="https://protomaps.com">Protomaps</a>';

// --- Initial settings from the hash (applied to the FIRST render, no flash) --
const hp0 = readHashParams();

let colorMode: ColorMode =
  hp0.color === "turnout" || hp0.color === "q1" || hp0.color === "q2"
    ? hp0.color
    : "distinct";
let active: Which = hp0.layer === "flourish" ? "flourish" : "ours";
let seedsVisible = hp0.seeds !== "0";
let theme: Theme =
  hp0.theme === "light" || hp0.theme === "dark" || hp0.theme === "auto"
    ? hp0.theme
    : "auto";

const initFlavorKey = resolveFlavorKey(theme);
const initDark = initFlavorKey === "dark";
const vis = (on: boolean) => (on ? "visible" : "none");

// Drives the panel/popup CSS theme (see style.css); kept in sync in applyTheme.
document.documentElement.dataset.theme = initDark ? "dark" : "light";

// --- Basemap layer generation (regenerated on theme change) -----------------
// slovakia.pmtiles = full detail (z0..14); world.pmtiles = z0..6 overview so
// zooming out never shows a blank map. The Protomaps layer set is generated
// (once, or twice when self-hosting), sharing a single background, with the
// world layers underneath the Slovakia detail; world ids are prefixed.
function genBasemap(flavorKey: FlavorKey) {
  const { flavor } = FLAVORS[flavorKey];
  const sk = layers("protomaps", flavor, { lang: LANG });

  const background = sk.find((l) => l.id === "background");
  if (!background) {
    throw new Error("Protomaps basemap layers have no 'background' layer");
  }

  const skDetail = sk.filter((l) => l.id !== "background");

  // Hosted Protomaps is one worldwide source, so no separate world overview is
  // needed. Self-hosted keeps world.pmtiles (z0..6) under the SK detail so
  // zooming out never shows a blank map.
  const worldLayers = HOSTED
    ? []
    : layers("world", flavor, { lang: LANG })
        .filter((l) => l.id !== "background")
        .map((l) => ({ ...l, id: `world_${l.id}` }));

  return { background, skDetail, worldLayers };
}

const bm0 = genBasemap(initFlavorKey);

// --- Okrsky (precinct) overlay ----------------------------------------------
// okrsky.pmtiles is built from PostGIS by data-prep/buildOkrskyTiles.sh with two
// layers: "okrsky" (polygons, carrying `color` + ŠÚ SR result props) and
// "okrsky_pts" (one label point per okrsok). Initial fill/label/visibility are
// baked from the hash-restored settings so the first paint already matches.

// A filter that matches no feature — the resting state of the highlight layers.
const NO_MATCH: maplibregl.FilterSpecification = ["==", ["get", "okrsok"], " "];
const ov0 = overlay(initDark);
const oursVis = vis(active === "ours");

const okrskyLayers: maplibregl.LayerSpecification[] = [
  {
    id: "okrsky-fill",
    type: "fill",
    source: "okrsky",
    "source-layer": "okrsky",
    layout: { visibility: oursVis },
    paint: {
      "fill-color": fillExpr[colorMode],
      "fill-opacity": fillOpacity(colorMode),
      // Switch instantly and CONSISTENTLY. Otherwise the opacity change (0.5↔0.7)
      // when toggling the distinct mode animates while the colour-only switches
      // between result modes snap — an inconsistent half-animation.
      "fill-color-transition": { duration: 0, delay: 0 },
      "fill-opacity-transition": { duration: 0, delay: 0 },
    },
  },
  {
    id: "okrsky-line",
    type: "line",
    source: "okrsky",
    "source-layer": "okrsky",
    layout: { visibility: oursVis },
    paint: {
      "line-color": ov0.line,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.4, 14, 1.6],
    },
  },
  {
    // Selected precinct: bold outline + stronger fill. Filter is set on click.
    id: "okrsky-highlight",
    type: "line",
    source: "okrsky",
    "source-layer": "okrsky",
    layout: { visibility: oursVis },
    filter: NO_MATCH,
    paint: {
      "line-color": ov0.highlight,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 4],
    },
  },
  {
    id: "okrsky-highlight-fill",
    type: "fill",
    source: "okrsky",
    "source-layer": "okrsky",
    layout: { visibility: oursVis },
    filter: NO_MATCH,
    paint: { "fill-color": ov0.highlight, "fill-opacity": 0.18 },
  },
  {
    id: "okrsky-label",
    type: "symbol",
    source: "okrsky",
    "source-layer": "okrsky_pts",
    minzoom: 12,
    layout: {
      visibility: oursVis,
      "text-field": labelExpr[colorMode],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
    },
    paint: {
      "text-color": ov0.labelText,
      "text-halo-color": ov0.labelHalo,
      "text-halo-width": 1.4,
    },
  },
];

// --- Flourish reference okrsky (comparison layer) ---------------------------
// Same distinct per-okrsok colour scheme as ours (color baked into the tile by
// extractFlourishOkrsky.ts). Fill + border + highlight mirror the okrsky layers.
// Identity here is (obec, okrsok). THROWAWAY comparison layer.
const flourishVis = vis(active === "flourish");

const flourishLayers: maplibregl.LayerSpecification[] = [
  {
    id: "flourish-fill",
    type: "fill",
    source: "flourish",
    "source-layer": "flourish",
    layout: { visibility: flourishVis },
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.5 },
  },
  {
    id: "flourish-line",
    type: "line",
    source: "flourish",
    "source-layer": "flourish",
    layout: { visibility: flourishVis },
    paint: {
      "line-color": ov0.line,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.4, 14, 1.6],
    },
  },
  {
    id: "flourish-highlight",
    type: "line",
    source: "flourish",
    "source-layer": "flourish",
    layout: { visibility: flourishVis },
    filter: NO_MATCH,
    paint: {
      "line-color": ov0.highlight,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 4],
    },
  },
  {
    id: "flourish-highlight-fill",
    type: "fill",
    source: "flourish",
    "source-layer": "flourish",
    layout: { visibility: flourishVis },
    filter: NO_MATCH,
    paint: { "fill-color": ov0.highlight, "fill-opacity": 0.18 },
  },
];

// --- Map --------------------------------------------------------------------
// Centred on Slovakia but with a generous central-Europe pan margin so it never
// feels caged, and you can zoom out to see SK in context (the world source keeps
// the map filled — never blank).
const map = new maplibregl.Map({
  container: "map",
  // Named-param hash (#map=z/lat/lng) so our own settings params can coexist in
  // the hash without either side clobbering the other. See read/writeHashParam.
  hash: "map",
  center: [19.5, 48.7],
  zoom: 7,
  minZoom: 4,
  maxZoom: 18,
  maxBounds: [
    [16, 47], // generous margin (~all of SK's neighbours) — not caged to SK
    [24, 50],
  ],
  style: {
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${FLAVORS[initFlavorKey].name}`,
    sources: {
      // Basemap: hosted Protomaps (one worldwide source) when a key is set,
      // otherwise the self-hosted world + slovakia PMTiles pair.
      ...(HOSTED
        ? {
            protomaps: {
              type: "vector" as const,
              url: HOSTED_TILEJSON,
              attribution: OSM_ATTRIB,
            },
          }
        : {
            world: {
              type: "vector" as const,
              url: tiles("world.pmtiles"),
              attribution: OSM_ATTRIB,
            },
            protomaps: {
              type: "vector" as const,
              url: tiles("slovakia.pmtiles"),
            },
          }),
      okrsky: { type: "vector", url: tiles("okrsky.pmtiles") },
      // Reference okrsky scraped from a Flourish map (BA region, 2023 NRSR).
      flourish: { type: "vector", url: tiles("flourish_okrsky.pmtiles") },
      // Seed points (labelled address points used to derive okrsky).
      seeds: { type: "vector", url: tiles("seeds.pmtiles") },
    },
    layers: [
      bm0.background,
      ...bm0.worldLayers,
      ...bm0.skDetail,
      ...okrskyLayers,
      ...flourishLayers,
      {
        id: "seeds-circle",
        type: "circle",
        source: "seeds",
        "source-layer": "seeds",
        layout: { visibility: vis(seedsVisible) },
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2, 14, 4],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.6,
          "circle-opacity": 0.9,
        },
      },
    ],
  },
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));

// --- Selection + popup ------------------------------------------------------
// Selection is an ID — (key, okrsok) — not a screen point. Both datasets carry
// the same normalised MČ `key` and matching okrsok numbers, so the selection
// survives switching layers: we just re-apply the (key, okrsok) filter to the
// now-active layer. `lngLat` is kept only to anchor the popup.
const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false });

const OURS = [
  "okrsky-fill",
  "okrsky-line",
  "okrsky-highlight",
  "okrsky-highlight-fill",
  "okrsky-label",
];

const FLOURISH = [
  "flourish-fill",
  "flourish-line",
  "flourish-highlight",
  "flourish-highlight-fill",
];

type Sel = { key: string; okrsok: string; lngLat: maplibregl.LngLat };

const CFG = {
  ours: { source: "okrsky", sourceLayer: "okrsky", fill: "okrsky-fill" },
  flourish: { source: "flourish", sourceLayer: "flourish", fill: "flourish-fill" },
} as const;

let selected: Sel | null = null;
let suppressClose = false; // true while we remove() the popup programmatically
let legendEl: HTMLDivElement | null = null;
let colorSectionEl: HTMLDivElement | null = null; // the whole "Farbenie" block

const selFilter = (s: Sel): maplibregl.FilterSpecification => [
  "all",
  ["==", ["get", "key"], s.key],
  ["==", ["get", "okrsok"], s.okrsok],
];

const clearHighlight = () => {
  for (const id of [
    "okrsky-highlight",
    "okrsky-highlight-fill",
    "flourish-highlight",
    "flourish-highlight-fill",
  ]) {
    map.setFilter(id, NO_MATCH);
  }
};

const removePopup = () => {
  suppressClose = true;
  popup.remove();
  suppressClose = false;
};

// Update popup in place when already open — calling addTo() again would
// internally remove() it, firing "close" and wiping the highlight we just set.
const showPopup = (lngLat: maplibregl.LngLatLike, html: string) => {
  popup.setLngLat(lngLat).setHTML(html);

  if (!popup.isOpen()) {
    popup.addTo(map);
  }
};

const pct = (v: unknown) => (v == null || v === "" ? "?" : `${(+v).toFixed(1)} %`);

function popupHtml(which: Which, p: Record<string, unknown>): string {
  const okr = `<strong>okrsok ${p.okrsok ?? "?"}</strong>`;

  if (which === "flourish") {
    return (
      `${okr}<br>${p.obec ?? "?"}` +
      `<br><small>Flourish 2023 · víťaz ${p.vitaz ?? "?"} · účasť ${p.ucast_rel ?? "?"} %</small>`
    );
  }

  const where = p.mesto && p.mesto !== p.mc ? `${p.mc} · ${p.mesto}` : p.mc;
  let html = `${okr}<br>${where ?? "?"}`;

  // Referendum results (present only where an ŠÚ SR row joined). The line for the
  // active coloring mode is bolded so switching modes re-emphasises the popup.
  if (p.turnout != null) {
    const em = (m: ColorMode, s: string) =>
      colorMode === m ? `<strong>${s}</strong>` : s;

    const cnt = (a: unknown, n: unknown) =>
      `<span class="muted">(${a ?? "?"} : ${n ?? "?"})</span>`;

    html +=
      `<hr class="popup-sep"><small>` +
      em(
        "turnout",
        `Účasť ${pct(p.turnout)} <span class="muted">(${p.zuc ?? "?"} / ${p.zap ?? "?"})</span>`,
      ) +
      `<br>` +
      em("q1", `Ot. 1 – ÁNO ${pct(p.q1ano)} ${cnt(p.q1a, p.q1n)}`) +
      `<br>` +
      em("q2", `Ot. 2 – ÁNO ${pct(p.q2ano)} ${cnt(p.q2a, p.q2n)}`) +
      `</small>`;
  }

  return html;
}

// Apply the current selection to the ACTIVE layer: set the highlight filter
// (declarative — no render-timing dependency) and fill the popup from the source
// feature. If the source tile isn't loaded yet (just switched to a hidden
// layer), retry once the map settles.
function renderSelection() {
  clearHighlight();

  if (!selected) {
    removePopup();
    return;
  }

  const cfg = CFG[active];
  const filter = selFilter(selected);
  map.setFilter(cfg.fill.replace("-fill", "-highlight"), filter);
  map.setFilter(cfg.fill.replace("-fill", "-highlight-fill"), filter);

  const f = map.querySourceFeatures(cfg.source, {
    sourceLayer: cfg.sourceLayer,
    filter,
  })[0];

  if (f) {
    showPopup(selected.lngLat, popupHtml(active, f.properties));
  } else {
    removePopup();
    map.once("idle", () => selected && renderSelection());
  }
}

// Re-fill an open okrsok popup from the source feature so the active mode's line
// re-bolds. Leaves seed popups (selected === null) untouched.
function refreshPopupForMode() {
  if (!selected || !popup.isOpen()) {
    return;
  }

  const cfg = CFG[active];
  const f = map.querySourceFeatures(cfg.source, {
    sourceLayer: cfg.sourceLayer,
    filter: selFilter(selected),
  })[0];

  if (f) {
    showPopup(selected.lngLat, popupHtml(active, f.properties));
  }
}

map.on("click", (e) => {
  // A seed point (drawn on top) wins if hit — show its address, leave the okrsky
  // selection as is.
  const seed = map.queryRenderedFeatures(e.point, {
    layers: ["seeds-circle"],
  })[0];

  if (seed) {
    const p = seed.properties as {
      okrsok?: string;
      mc?: string;
      street?: string;
      orient?: string;
      supisne?: string;
      ra_id?: string;
    };
    const num = p.orient || (p.supisne ? `súp. ${p.supisne}` : "");

    showPopup(
      e.lngLat,
      `<strong>${p.street ?? "?"} ${num}</strong>` +
        `<br><small>okrsok ${p.okrsok ?? "?"} · ${p.mc ?? "?"}</small>` +
        `<br><small>ra_id: <code>${p.ra_id ?? "?"}</code></small>`,
    );
    return;
  }

  const f = map.queryRenderedFeatures(e.point, {
    layers: [CFG[active].fill],
  })[0];

  if (!f) {
    selected = null;
    clearHighlight();
    removePopup();
    return;
  }

  const p = f.properties as { key?: string; okrsok?: string };
  selected = { key: p.key ?? "", okrsok: p.okrsok ?? "", lngLat: e.lngLat };
  renderSelection();
});

popup.on("close", () => {
  if (suppressClose) {
    return;
  }

  selected = null;
  clearHighlight();
});

for (const id of ["okrsky-fill", "flourish-fill", "seeds-circle"]) {
  map.on("mouseenter", id, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", id, () => {
    map.getCanvas().style.cursor = "";
  });
}

// --- Layer switch (exclusive) -----------------------------------------------
// Radio-style: exactly one of our / Flourish okrsky is shown. Switching keeps
// the selection by re-applying the (key, okrsok) filter to the new layer.
function setActive(which: Which) {
  active = which;

  for (const id of OURS) {
    map.setLayoutProperty(id, "visibility", vis(which === "ours"));
  }

  for (const id of FLOURISH) {
    map.setLayoutProperty(id, "visibility", vis(which === "flourish"));
  }

  // Farbenie drives our result choropleths; Flourish has no such data, so hide it.
  if (colorSectionEl) {
    colorSectionEl.style.display = which === "flourish" ? "none" : "";
  }

  writeHashParam("layer", which === "ours" ? null : which);
  renderSelection();
}

// --- Coloring mode ----------------------------------------------------------
function updateLegend() {
  if (!legendEl) {
    return;
  }

  const bar = (stops: Stop[]) =>
    `<div class="legend-bar" style="background:${gradientCss(stops)}"></div>`;

  const scale = (a: string, b: string) =>
    `<div class="legend-scale"><span>${a}</span><span>${b}</span></div>`;

  if (colorMode === "distinct") {
    legendEl.innerHTML = `<div class="legend-note">Farba rozlišuje susedné okrsky (nekóduje dáta).</div>`;
  } else if (colorMode === "turnout") {
    legendEl.innerHTML =
      `<div class="legend-title">Účasť voličov</div>` +
      bar(TURNOUT_STOPS) +
      scale("5 %", "35 %+");
  } else {
    const q = QUESTIONS[colorMode];

    // Non-linear scale (stops packed 88–100 %); ticks mark the real anchors.
    legendEl.innerHTML =
      `<div class="legend-title" title="${q.full}">${q.short}</div>` +
      bar(ANO_STOPS) +
      scale("≤50 %", "100 %") +
      `<div class="legend-note">podiel ÁNO z platných (väčšina hlasov je ÁNO)</div>`;
  }
}

function setColorMode(m: ColorMode) {
  colorMode = m;

  map.setPaintProperty("okrsky-fill", "fill-color", fillExpr[m]);
  map.setPaintProperty("okrsky-fill", "fill-opacity", fillOpacity(m));
  map.setLayoutProperty("okrsky-label", "text-field", labelExpr[m]);

  updateLegend();
  refreshPopupForMode();
  writeHashParam("color", m === "distinct" ? null : m);
}

// --- Theme ------------------------------------------------------------------
// Swap the basemap flavor live by re-applying each generated layer's paint/layout
// (ids are identical across flavors), plus the sprite and our overlay colours.
function applyTheme() {
  const flavorKey = resolveFlavorKey(theme);
  const dark = flavorKey === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";

  const gen = genBasemap(flavorKey);
  for (const l of [gen.background, ...gen.skDetail, ...gen.worldLayers]) {
    if (!map.getLayer(l.id)) {
      continue;
    }

    const paint = (l as { paint?: Record<string, unknown> }).paint ?? {};
    for (const k of Object.keys(paint)) {
      map.setPaintProperty(l.id, k, paint[k]);
    }

    const layout = (l as { layout?: Record<string, unknown> }).layout ?? {};
    for (const k of Object.keys(layout)) {
      if (k !== "visibility") {
        map.setLayoutProperty(l.id, k, layout[k]);
      }
    }
  }

  // Sprite icons differ per flavor (setSprite may be absent on older MapLibre).
  (map as unknown as { setSprite?: (u: string) => void }).setSprite?.(
    `https://protomaps.github.io/basemaps-assets/sprites/v4/${FLAVORS[flavorKey].name}`,
  );

  const ov = overlay(dark);
  map.setPaintProperty("okrsky-line", "line-color", ov.line);
  map.setPaintProperty("flourish-line", "line-color", ov.line);
  map.setPaintProperty("okrsky-highlight", "line-color", ov.highlight);
  map.setPaintProperty("okrsky-highlight-fill", "fill-color", ov.highlight);
  map.setPaintProperty("flourish-highlight", "line-color", ov.highlight);
  map.setPaintProperty("flourish-highlight-fill", "fill-color", ov.highlight);
  map.setPaintProperty("okrsky-label", "text-color", ov.labelText);
  map.setPaintProperty("okrsky-label", "text-halo-color", ov.labelHalo);
}

function setTheme(t: Theme) {
  theme = t;
  applyTheme();
  writeHashParam("theme", t === "auto" ? null : t);
}

// Follow the OS while in "auto".
if (typeof window.matchMedia === "function") {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => theme === "auto" && applyTheme());
}

// --- Control panel ----------------------------------------------------------
function makeTitle(label: string) {
  const el = document.createElement("div");
  el.className = "panel-title";
  el.textContent = label;
  return el;
}

function makeRadio(
  name: string,
  label: string,
  checked: boolean,
  onPick: () => void,
  tip?: string,
) {
  const row = document.createElement("label");
  if (tip) {
    row.title = tip;
  }

  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.checked = checked;
  input.onchange = () => input.checked && onPick();

  row.append(input, document.createTextNode(` ${label}`));
  return row;
}

map.on("load", () => {
  const panel = document.createElement("div");
  panel.className = "layer-panel";

  // Coloring mode — hidden entirely when the Flourish layer is active.
  colorSectionEl = document.createElement("div");
  colorSectionEl.append(makeTitle("Farbenie"));

  const colorOpts: [string, ColorMode][] = [
    ["Rozlíšenie okrskov", "distinct"],
    ["Účasť", "turnout"],
    [QUESTIONS.q1.short, "q1"],
    [QUESTIONS.q2.short, "q2"],
  ];

  for (const [label, mode] of colorOpts) {
    const tip = mode === "q1" || mode === "q2" ? QUESTIONS[mode].full : undefined;
    colorSectionEl.append(
      makeRadio("color-mode", label, mode === colorMode, () => setColorMode(mode), tip),
    );
  }

  legendEl = document.createElement("div");
  legendEl.className = "legend";
  colorSectionEl.append(legendEl);
  updateLegend();

  colorSectionEl.style.display = active === "flourish" ? "none" : "";
  panel.append(colorSectionEl);

  // Layer choice (our derived okrsky vs the throwaway Flourish reference).
  const layerOpts: [string, Which][] = [
    ["naše okrsky", "ours"],
    ["Flourish okrsky (2023)", "flourish"],
  ];

  for (const [label, which] of layerOpts) {
    panel.append(
      makeRadio("okrsky-layer", label, which === active, () => setActive(which)),
    );
  }

  // Seeds — an independent overlay on top of whichever okrsky layer.
  const seedRow = document.createElement("label");
  seedRow.className = "panel-group";

  const seedBox = document.createElement("input");
  seedBox.type = "checkbox";
  seedBox.checked = seedsVisible;
  seedBox.onchange = () => {
    seedsVisible = seedBox.checked;
    map.setLayoutProperty("seeds-circle", "visibility", vis(seedsVisible));
    writeHashParam("seeds", seedsVisible ? null : "0");
  };

  seedRow.append(seedBox, document.createTextNode(" seedy (body, z12+)"));
  panel.append(seedRow);

  // Theme (light / dark / auto). Dark swaps the basemap to the BLACK flavor.
  const themeSection = document.createElement("div");
  themeSection.className = "panel-group";
  themeSection.append(makeTitle("Téma"));

  const themeOpts: [string, Theme][] = [
    ["Svetlá", "light"],
    ["Tmavá", "dark"],
    ["Podľa systému", "auto"],
  ];

  for (const [label, t] of themeOpts) {
    themeSection.append(makeRadio("theme", label, t === theme, () => setTheme(t)));
  }

  panel.append(themeSection);

  document.body.append(panel);
});
