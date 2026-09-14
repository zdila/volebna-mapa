// Parse the Petržalka "OKRSKY REFERENDUM (4.7.2026)" PDF into okrsok_streets rows.
//
// The 2026 doc is a clean 4-column table:  Číslo okrsku | Volebná miestnosť | Ulica | Čísla domov.
// Unlike the 2023 vintage (right-anchored -layout parse), the 2026 table cannot be parsed
// reliably from `pdftotext -layout` text because number cells are VERTICALLY CENTERED: a
// street whose house-number list wraps to N text lines prints its street label on the MIDDLE
// line, so number rows appear both ABOVE and BELOW the label. In flattened text you cannot
// tell whether a number-only line continues the street above or opens the street below.
//
// Solution: use word COORDINATES (`pdftotext -tsv data/petrzalka_okrsky.pdf data/petrzalka_okrsky.tsv`).
// Because each street label sits at the vertical CENTER of its (contiguous) number block,
// assigning every number row to the NEAREST street label by y provably reproduces the cells.
//
// Column layout (x, in PDF points): okrsok number ~66-69 | building 91-146 | street 186-250 |
// numbers 245+. Building and street both contain ALL-CAPS tokens (SOŠ/ZŠ/MŠ vs DARGOVSKÁ),
// so we split on x (>=150 = street/number region) and then classify by content
// (digit-initial = house number, else ALL-CAPS = street). The building column is discarded;
// the okrsok number is printed only on the first row of each group and is CARRIED FORWARD via
// per-page okrsok markers (contiguous top-to-bottom). A spurious header "1" reprints at the top
// of every page (y~92) and is rejected by requiring okrsok numbers to increase monotonically.
import { readFileSync, writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const HEADER_Y = 90; // drop the repeated page header (OKRSKY / Ulica / Čísla domov, y 57-85)
const OKRSOK_X_MAX = 86; // okrsok-number column
const REGION_X = 180; // left edge of the street+number region: street tokens start at x=186,
// house numbers at x>=245; the building column (incl. the school's own house number, e.g.
// "Tematínska 10") reaches only x<=174.5, so 180 excludes it.
const YTOL = 3; // rows within this many points are the same physical line

const UPPER = "A-ZÁÄČĎÉÍĽĹŇÓÔÖŔŠŤÚÝŽ";
const STREET_TOK = new RegExp(`^[-.${UPPER}]+$`); // ALL-CAPS street token (letters, dots, hyphen)
const HAS_UPPER = new RegExp(`[${UPPER}]`);

type Word = { page: number; x: number; y: number; text: string };

const words: Word[] = readFileSync("data/petrzalka_okrsky.tsv", "utf8")
  .split("\n")
  .slice(1)
  .map((l) => l.split("\t"))
  .filter((r) => r[0] === "5" && r[11] !== undefined) // level-5 rows = individual words
  .map((r) => ({ page: +r[1], x: +r[6], y: +r[7], text: r[11] }))
  .filter((w) => w.y >= HEADER_Y);

// --- okrsok markers (carry-forward): per-page, monotonically increasing 1..43 ---
type Marker = { page: number; y: number; okrsok: number };
const markers: Marker[] = [];
let cur = 0;
for (const w of [...words].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
  if (w.x < OKRSOK_X_MAX && /^\d+$/.test(w.text)) {
    const n = +w.text;
    if (n > cur && n <= 43) {
      cur = n;
      markers.push({ page: w.page, y: w.y, okrsok: n });
    }
  }
}

const okrsokOf = (page: number, y: number): number => {
  let best = 0;
  for (const m of markers) if (m.page === page && m.y <= y + YTOL && m.okrsok > best) best = m.okrsok;
  return best;
};

// --- group street tokens and number tokens into physical lines (per page, per y) ---
type Line = { page: number; y: number; okrsok: number; toks: Word[] };
const groupLines = (ws: Word[]): Line[] => {
  const lines: Line[] = [];
  for (const w of [...ws].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
    const last = lines[lines.length - 1];
    if (last && last.page === w.page && Math.abs(last.y - w.y) <= YTOL) last.toks.push(w);
    else lines.push({ page: w.page, y: w.y, okrsok: okrsokOf(w.page, w.y), toks: [w] });
  }
  // sort tokens left-to-right, refresh okrsok using the min y of the merged line
  for (const l of lines) {
    l.toks.sort((a, b) => a.x - b.x);
    l.y = Math.min(...l.toks.map((t) => t.y));
    l.okrsok = okrsokOf(l.page, l.y);
  }
  return lines;
};

const region = words.filter((w) => w.x >= REGION_X);
const isNum = (t: string) => /^\d/.test(t);
const isStreet = (t: string) => STREET_TOK.test(t) && HAS_UPPER.test(t);

const streetLines = groupLines(region.filter((w) => isStreet(w.text)));
const numberLines = groupLines(region.filter((w) => isNum(w.text)));

// A wrapped multi-word street name ("PRI VOJENSKOM" / "CINTORÍNE", "M. CURIE" / "SKLODOWSKEJ")
// prints its parts on consecutive text lines with the font's leading (9.96 pt) between them,
// whereas two DISTINCT streets are spaced by a larger row gap (>=10.56 pt). This ~0.6 pt cut is
// constant across the doc (fixed font), so we merge street lines with gap < WRAP_GAP into one
// street. This correctly joins even "M. CURIE SKLODOWSKEJ" whose long list wraps so BOTH name
// lines carry numbers (37 | 39,41) — the number-continuation heuristic can't tell that apart.
const WRAP_GAP = 10.25;

// --- per okrsok: build street groups (merging wrapped names), then assign number lines ---
type Rec = { okrsok: number; ys: number[]; name: string; nums: { y: number; s: string }[] };
const recs: Rec[] = [];

for (const okr of [...new Set(markers.map((m) => m.okrsok))].sort((a, b) => a - b)) {
  const sLines = streetLines.filter((l) => l.okrsok === okr).sort((a, b) => a.y - b.y);
  const nLines = numberLines.filter((l) => l.okrsok === okr).sort((a, b) => a.y - b.y);

  // merge consecutive street lines that are a single wrapped name
  const groups: Rec[] = [];
  for (const l of sLines) {
    const name = l.toks.map((t) => t.text).join(" ");
    const last = groups[groups.length - 1];
    if (last && l.y - last.ys[last.ys.length - 1] < WRAP_GAP) {
      last.name += " " + name;
      last.ys.push(l.y);
    } else groups.push({ okrsok: okr, ys: [l.y], name, nums: [] });
  }

  // assign each number line to the street group whose nearest label line is closest in y
  // (each street label sits at the vertical centre of its own contiguous number block)
  for (const nl of nLines) {
    let best = -1;
    let bestD = Infinity;
    groups.forEach((g, i) => {
      const d = Math.min(...g.ys.map((y) => Math.abs(y - nl.y)));
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) groups[best].nums.push({ y: nl.y, s: nl.toks.map((t) => t.text).join(" ") });
  }
  recs.push(...groups.map((g) => ({ ...g, nums: g.nums.sort((a, b) => a.y - b.y) })));
}

// --- emit okrsok_streets rows via parseStreetSpec ---
const out = recs.map((r) => {
  const nums = r.nums.map((n) => n.s).join(" ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
  const raw = `${r.name} ${nums}`.trim();
  const parsed = parseStreetSpec(raw);
  return {
    mc: "Petržalka",
    mcNorm: "petrzalka",
    okrsok: r.okrsok,
    obvod: 0,
    street: parsed.street || r.name,
    streetNorm: parsed.streetNorm || norm(r.name),
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    srcSpadove: raw,
  };
});

writeFileSync("data/petrzalka_okrsok_streets.json", JSON.stringify(out));

// --- acceptance audit ---
const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
const maxOkr = Math.max(...okrs);
console.log(`rows: ${out.length}   okrsky: ${okrs.length}   (max okrsok ${maxOkr})`);
console.log(`okrsky present: ${okrs.join(",")}`);
const missing = [...Array(maxOkr)].map((_, i) => i + 1).filter((n) => !okrs.includes(n));
console.log(`okrsky 1..${maxOkr} with NO streets: ${missing.length ? missing.join(",") : "none"}`);
console.log(`cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
const perOkr = Object.groupBy(out, (r) => r.okrsok);
const thin = okrs.filter((o) => (perOkr[o]?.length ?? 0) <= 1).map((o) => `${o}(${perOkr[o]!.length})`);
console.log(`thin okrsky (<=1 street): ${thin.length ? thin.join(",") : "none"}`);
console.log(`\nsample rows:`);
for (const r of out.slice(0, 3)) console.log(JSON.stringify(r));
