// Build kosice_okrsok_streets.json/.csv from the Košice "volebné miestnosti" GeoJSON.
// One output row per (okrsok, spádová ulica) source feature.
import { readFileSync, writeFileSync } from "node:fs";
import { mcName, norm } from "./normalize.ts";
import { parseStreetSpec, type Parsed } from "./houseSpec.ts";

const SRC = "data/kosice_volebne_miestnosti_2022.geojson";
const OUT_JSON = "data/kosice_okrsok_streets.json";
const OUT_CSV = "data/kosice_okrsok_streets.csv";

type Feature = {
  properties: {
    mestska_cast: string;
    okres: string;
    volebny_obvod_cislo: string;
    volebny_okrsok_cislo: number;
    volebna_miestnost_nazov: string;
    volebna_miestnost_adresa_ulica: string;
    volebna_miestnost_adresa_supisn: string;
    volebna_miestnost_adresa_orient: string;
    volebna_miestnost_spadove_ulice: string;
    x: string;
    y: string;
  };
};

type Row = {
  mc: string;
  mcNorm: string;
  okrsok: number;
  obvod: number;
  street: string;
  streetNorm: string;
  parity: Parsed["parity"];
  cls: Parsed["cls"];
  numberKind: Parsed["numberKind"];
  spec: Parsed["spec"];
  x: number;
  y: number;
  miestnost: string;
  adresa: string;
  srcSpadove: string;
};

const fc = JSON.parse(readFileSync(SRC, "utf8")) as { features: Feature[] };

const rows: Row[] = fc.features.map((f) => {
  const p = f.properties;
  const mc = mcName(p.mestska_cast);
  const parsed = parseStreetSpec(p.volebna_miestnost_spadove_ulice);
  const adresa = [
    p.volebna_miestnost_adresa_ulica,
    p.volebna_miestnost_adresa_orient || p.volebna_miestnost_adresa_supisn,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    mc,
    mcNorm: norm(mc),
    okrsok: p.volebny_okrsok_cislo,
    obvod: +p.volebny_obvod_cislo,
    street: parsed.street,
    streetNorm: parsed.streetNorm,
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    x: +p.x,
    y: +p.y,
    miestnost: p.volebna_miestnost_nazov,
    adresa,
    srcSpadove: p.volebna_miestnost_spadove_ulice,
  };
});

writeFileSync(OUT_JSON, JSON.stringify(rows, null, 0));

// CSV (spec flattened to its raw string; consumers who need structure use the JSON).
const csvEsc = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const cols = [
  "mc",
  "mcNorm",
  "okrsok",
  "obvod",
  "street",
  "streetNorm",
  "parity",
  "cls",
  "numberKind",
  "specRaw",
  "x",
  "y",
  "miestnost",
  "adresa",
  "srcSpadove",
] as const;
const csv = [
  cols.join(","),
  ...rows.map((r) =>
    [
      r.mc,
      r.mcNorm,
      r.okrsok,
      r.obvod,
      r.street,
      r.streetNorm,
      r.parity,
      r.cls,
      r.numberKind,
      r.spec?.raw ?? "",
      r.x,
      r.y,
      r.miestnost,
      r.adresa,
      r.srcSpadove,
    ]
      .map(csvEsc)
      .join(","),
  ),
].join("\n");
writeFileSync(OUT_CSV, csv);

// ---- Audit -------------------------------------------------------------------
const byCls = Object.groupBy(rows, (r) => r.cls);
const mcs = new Set(rows.map((r) => r.mcNorm));
const okrsky = new Set(rows.map((r) => `${r.mcNorm}#${r.okrsok}`));

console.log(`rows: ${rows.length}`);
console.log(`MČ: ${mcs.size}   okrsky: ${okrsky.size}`);
console.log(
  `by cls: ` +
    (["WHOLE", "RANGE", "ENUM", "INSTITUTION"] as const)
      .map((c) => `${c}=${byCls[c]?.length ?? 0}`)
      .join("  "),
);

// Suspicious: classified WHOLE but the source still contains a digit that isn't a
// leading ordinal ("1. mája") — would mean a spec we failed to parse.
const suspWhole = rows.filter(
  (r) =>
    r.cls === "WHOLE" &&
    /\d/.test(r.srcSpadove) &&
    !/^\s*\d+\.\s/.test(r.srcSpadove),
);
console.log(`\nsuspicious WHOLE (digit in source, not ordinal): ${suspWhole.length}`);
for (const r of suspWhole.slice(0, 40)) console.log(`  |${r.srcSpadove}|`);

// Source-data conflicts: a house number on one street claimed by >1 okrsok. These
// can't be resolved by rule — they need a human/2026-data fix. Report per street.
const collisions = new Map<string, Set<number>>();
const seen = new Map<string, Set<number>>(); // "mc street n" -> okrsok set
for (const r of rows) {
  if ((r.cls !== "RANGE" && r.cls !== "ENUM") || r.numberKind === "supisne") continue;
  const nums: number[] = [];
  for (const [a, b, p] of r.spec!.ranges) {
    const start = p === "both" ? a : a % 2 === (p === "odd" ? 1 : 0) ? a : a + 1;
    const step = p === "both" ? 1 : 2;
    for (let n = start; n <= b; n += step) nums.push(n);
  }
  for (const s of r.spec!.singles) {
    const m = String(s).match(/\d+/);
    if (m) nums.push(+m[0]);
  }
  for (const n of nums) {
    const k = `${r.mcNorm}|${r.streetNorm}|${n}`;
    const set = seen.get(k) ?? seen.set(k, new Set()).get(k)!;
    set.add(r.okrsok);
    if (set.size > 1)
      (collisions.get(`${r.mc} / ${r.street}`) ??
        collisions.set(`${r.mc} / ${r.street}`, new Set()).get(`${r.mc} / ${r.street}`)!).add(n);
  }
}
console.log(`\nhouse-number collisions (same number, ≥2 okrsky): ${collisions.size} street(s)`);
for (const [st, ns] of collisions)
  console.log(`  ${st}: ${[...ns].sort((a, b) => a - b).join(", ")}`);

// Empty street name on a non-institution/non-supisne row => extraction failure.
const noStreet = rows.filter(
  (r) => !r.streetNorm && r.cls !== "INSTITUTION" && r.numberKind !== "supisne",
);
console.log(`\nempty streetNorm (unexpected): ${noStreet.length}`);
for (const r of noStreet.slice(0, 20)) console.log(`  |${r.srcSpadove}|`);
