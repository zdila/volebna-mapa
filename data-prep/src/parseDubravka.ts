// Parse the Dúbravka "Volebné okrsky a volebné miestnosti" REFERENDUM 2026 PDF
// (pdftotext -layout) into okrsok_streets rows.
//
// Table: 3 columns — [Volebný okrsok číslo] | [Volebná miestnosť] | [Ulice]. Unlike the older
// Dúbravka doc, this one lists WHOLE streets only (street names, no house numbers). Each street
// sits on its own line; the okrsok number lives in a merged left-hand cell and Excel renders it
// VERTICALLY CENTERED within that cell. So in the -layout text the number does NOT mark the first
// street of its okrsok — it lands in the middle of the street group, either glued to a street line
// ("2   KLIMKOVIČOVA") or on a line of its own between two streets.
//
// We rebuild the cell boundaries with a centering recurrence, working in "street-row index" units.
// Cell i covers street rows [A_i, B_i); the number is centered at C_i = (A_i + B_i) / 2, hence
// B_i = 2*C_i - A_i and A_{i+1} = B_i, seeding A_1 = 0. This is exact when rows are uniform height
// (they are). It works across the whole document without tracking table breaks, because the header
// blocks between tables contribute no street rows and therefore never shift the index.
import { readFileSync, writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const lines = readFileSync("data/dubravka_okrsky.txt", "utf8").split("\n");

// Lines that are NOT street rows: the title banner, the three stacked left-column header words, the
// "Volebná miestnosť" header, and the polling-place institution line under it.
const isTitle = (l: string) => /Volebné okrsky|REFERENDUM|Dúbravka pre/i.test(l);
const isHeaderWord = (l: string) => /^(Volebný|okrsok|číslo|Volebná miestnosť)$/.test(l.trim());
// Trailing (?=\s|$) instead of \b: the JS \b is ASCII-only, so it fails right after "ZŠ" (Š is a
// non-word char), letting polling-place lines like "ZŠ SOKOLÍKOVA 2" leak in as streets.
const isInstitution = (l: string) =>
  /^(ZŠ|KC|SPŠE|SPŠ|GYMNÁZIUM|Gymnáz|CVČ|MŠ|Materská|Základná|Stredná|Dom kult|Miestny)(?=\s|$)/.test(
    l.trim(),
  );
const isSkip = (l: string) =>
  !l.trim() || isTitle(l) || isHeaderWord(l) || isInstitution(l);

// The okrsok number lives in the narrow LEFT column, so it carries very few leading spaces; a street
// that happened to begin with a digit would sit far to the right. Require <=8 leading spaces.
const NUM_ONLY = /^ {0,8}(\d{1,2}) *$/; //            a number alone on its line (even-sized cell)
const NUM_STREET = /^ {0,8}(\d{1,2}) {2,}(\S.*?) *$/; // number glued to a street (odd-sized cell)

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

const streets: string[] = []; // street text, document order
const okrsoky: { n: number; C: number }[] = []; // number + its centered row position

for (const raw of lines) {
  if (isSkip(raw)) continue;
  const only = raw.match(NUM_ONLY);
  if (only) {
    // Own line: sits between the streets seen so far and the next one -> center at streets.length.
    okrsoky.push({ n: +only[1], C: streets.length });
    continue;
  }
  const ns = raw.match(NUM_STREET);
  if (ns) {
    streets.push(clean(ns[2]));
    okrsoky.push({ n: +ns[1], C: streets.length - 0.5 }); // centered on this street's row
    continue;
  }
  streets.push(clean(raw));
}

// Centering recurrence -> assign each street row to an okrsok.
okrsoky.sort((a, b) => a.C - b.C);
const okrsokOf = new Array<number>(streets.length).fill(0);
let A = 0;
for (const { n, C } of okrsoky) {
  const B = 2 * C - A;
  for (let i = 0; i < streets.length; i++) {
    const center = i + 0.5; // street row i occupies [i, i+1)
    if (center > A && center <= B) okrsokOf[i] = n;
  }
  A = B;
}

const out = streets.map((entry, i) => {
  const parsed = parseStreetSpec(entry);
  return {
    mc: "Dúbravka",
    mcNorm: "dubravka",
    okrsok: okrsokOf[i],
    obvod: 0,
    street: parsed.street || entry,
    streetNorm: parsed.streetNorm || norm(entry),
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    srcSpadove: entry,
  };
});

writeFileSync("data/dubravka_okrsok_streets.json", JSON.stringify(out));

// ---- Acceptance check ----
const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
const byOkr = Object.groupBy(out, (r) => r.okrsok);
console.log(`rows: ${out.length}   okrsky: ${okrs.length}`);
console.log(`okrsok numbers: ${okrs.join(",")}`);
console.log(
  `cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`,
);
const expected = [...Array(20)].map((_, i) => i + 1);
const missing = expected.filter((n) => !okrs.includes(n));
const unassigned = out.filter((r) => !r.okrsok).length;
console.log(`missing okrsky (of 1-20): ${missing.length ? missing.join(",") : "none"}`);
console.log(`unassigned streets (okrsok=0): ${unassigned}`);
const thin = okrs.filter((n) => (byOkr[n]?.length ?? 0) < 1);
console.log(`empty okrsky: ${thin.length ? thin.join(",") : "none"}`);
console.log("\nper-okrsok streets:");
for (const n of okrs) {
  console.log(`  ${n} (${byOkr[n]!.length}): ${byOkr[n]!.map((r) => r.street).join(", ")}`);
}

const pass =
  okrs.length === 20 &&
  okrs[0] === 1 &&
  okrs[19] === 20 &&
  !unassigned &&
  expected.every((n) => (byOkr[n]?.length ?? 0) >= 1);
console.log(`\nACCEPTANCE: ${pass ? "PASS" : "FAIL"}`);
