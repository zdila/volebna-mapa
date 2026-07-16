// Coloring modes (ŠÚ SR 2026 referendum results).
//
// The okrsky tile carries, per precinct, `color` (a golden-angle DISTINGUISHER,
// no data) plus result props joined from ŠÚ SR: `turnout` (účasť %), `zap`/`zuc`
// (registered / participated), and per question `q{1,2}ano` (ÁNO share of valid
// %) + `q{1,2}a`/`q{1,2}n` (ÁNO/NIE counts). The coloring selector recolours the
// fill, relabels the precincts and re-emphasises the popup between these views.
// Precincts with no ŠÚ SR row (a MČ still on a 2022 list) lack the props → NODATA.

import type maplibregl from "maplibre-gl";

export type ColorMode = "distinct" | "turnout" | "q1" | "q2";
export type Stop = [number, string];

const NODATA = "#cfd8dc";

export const QUESTIONS = {
  q1: {
    short: "Otázka 1 – doživotná renta",
    full: "Súhlasíte so zrušením tzv. doživotnej renty, napríklad, pre Roberta Fica, ustanovenej v § 24a ods. 1 písm. b) zákona č. 120/1993 Z. z. …?",
  },
  q2: {
    short: "Otázka 2 – obnovenie ÚŠP a NAKA",
    full: "Súhlasíte s tým, aby boli obnovené Úrad špeciálnej prokuratúry a Národná kriminálna agentúra?",
  },
} as const;

// Ramps are value-anchored [value %, colour] stops. Both metrics are strongly
// compressed in our (urban) okrsky, so the stops are packed into the band where
// the data actually varies instead of spread over the full 0–100 — otherwise
// nearly every precinct lands on one end and looks identical.

// Turnout sits ~5–35 % (nat. avg 16 %; quorum 50 % was not met anywhere near).
export const TURNOUT_STOPS: Stop[] = [
  [5, "#f7fbff"],
  [12, "#c6dbef"],
  [18, "#6baed6"],
  [25, "#2171b5"],
  [35, "#08306b"],
];

// ÁNO share of valid is squeezed into ~88–99 % (almost everyone who voted said
// ÁNO). So the diverging midpoint is SHIFTED far up and stops are concentrated
// at the top to reveal variation; ÁNO ≤ 50 % (NIE won — only a couple of okrsky)
// clamps to deep red so those rare precincts stand out.
export const ANO_STOPS: Stop[] = [
  [50, "#d73027"],
  [80, "#f46d43"],
  [88, "#fdae61"],
  [92, "#fee08b"],
  [95, "#d9ef8b"],
  [97, "#91cf60"],
  [100, "#1a9850"],
];

// Build a MapLibre interpolate expr and a matching CSS gradient from the stops.
// The CSS positions each colour at its value's fraction of [lo,hi] so the legend
// bar mirrors the non-linear stop spacing (mostly warm below, greens packed up top).
const interpFill = (prop: string, stops: Stop[]): maplibregl.ExpressionSpecification =>
  [
    "case",
    ["has", prop],
    ["interpolate", ["linear"], ["get", prop], ...stops.flat()],
    NODATA,
  ] as unknown as maplibregl.ExpressionSpecification;

export const gradientCss = (stops: Stop[]) => {
  const lo = stops[0][0];
  const hi = stops[stops.length - 1][0];

  const parts = stops.map(
    ([v, c]) => `${c} ${(((v - lo) / (hi - lo)) * 100).toFixed(0)}%`,
  );

  return `linear-gradient(90deg,${parts.join(",")})`;
};

export const fillExpr: Record<ColorMode, maplibregl.ExpressionSpecification> = {
  distinct: ["get", "color"],
  turnout: interpFill("turnout", TURNOUT_STOPS),
  q1: interpFill("q1ano", ANO_STOPS),
  q2: interpFill("q2ano", ANO_STOPS),
};

export const fillOpacity = (m: ColorMode) => (m === "distinct" ? 0.5 : 0.7);

// Label: distinct mode = okrsok № over mestská časť; result modes = the metric
// value (big) over "MČ, №" (small), falling back to "MČ, №" if no data.
const distinctLabel: maplibregl.ExpressionSpecification = [
  "format",
  ["get", "okrsok"],
  { "font-scale": 1.1 },
  "\n",
  {},
  ["get", "mc"],
  { "font-scale": 0.7 },
];

const metricLabel = (prop: string): maplibregl.ExpressionSpecification => [
  "case",
  ["has", prop],
  [
    "format",
    ["concat", ["to-string", ["round", ["get", prop]]], " %"],
    { "font-scale": 1.05 },
    "\n",
    {},
    ["concat", ["get", "mc"], ", ", ["get", "okrsok"]],
    { "font-scale": 0.65 },
  ],
  ["format", ["concat", ["get", "mc"], ", ", ["get", "okrsok"]], { "font-scale": 0.9 }],
];

export const labelExpr: Record<ColorMode, maplibregl.ExpressionSpecification> = {
  distinct: distinctLabel,
  turnout: metricLabel("turnout"),
  q1: metricLabel("q1ano"),
  q2: metricLabel("q2ano"),
};
