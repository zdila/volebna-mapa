// Parse the Lamač "Oznámenie o určení volebných okrskov" PDF (referendum 2026,
// pdftotext -layout) into okrsok_streets rows.
//
// Layout: a single-page two-column table. Left column stacks okrsky 1,2,3; right
// column stacks 4,5,6. The columns are separated by a whitespace gutter and the right
// column starts consistently at character offset 55, so we slice every line there and
// process the two half-columns independently as plain single-column text.
//
// Per okrsok:
//   VOLEBNÝ OKRSOK č. N:
//   Ulice: <first street>            (label is "Ulice:" or "Ulica:")
//          <one street per following line>
// Each street line is a whole entry — no comma lists, no line wrapping. House specs
// are inline and split some streets across okrsky by range: "Bakošova 1-36" (okr1) vs
// "Bakošova 38-46" (okr6); "Studenohorská 1-24 / 25-71 / 73-91" (okr4/5/6).
//
// Two administrative catch-all lines carry no street geometry and are skipped:
//   "Osoby s TP evidovaným na mestskú časť"   (voters registered to the whole MČ)
//   "Stavby len so súpisným číslom"            (buildings with only a súpisné číslo)
import { readFileSync, writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const SPLIT_COL = 55; // right column begins here (verified from the header line)

const rawAll = readFileSync("data/lamac_okrsky.txt", "utf8").split("\n");
// The okrsok table ends at the "Volebné miestnosti …" footer, whose long text wraps
// into the right column ("ly, Malokarpatské nám. 1,") and would otherwise be captured
// as a bogus street. Cut both columns off there.
const footerIdx = rawAll.findIndex((l) => /^\s*Volebné miestnosti\b/.test(l));
const raw = footerIdx >= 0 ? rawAll.slice(0, footerIdx) : rawAll;
const leftLines = raw.map((l) => l.slice(0, SPLIT_COL));
const rightLines = raw.map((l) => l.slice(SPLIT_COL));

const OKR_RE = /^VOLEBNÝ OKRSOK č\.\s*(\d+)\s*:/;
// Label that introduces the street list — distinct from a street *named* "Ulica …"
// (e.g. "Ulica Dominika Tatarku"), which has no colon.
const LABEL_RE = /^Ulic[ea]:\s*/;
// Administrative rows without street geometry.
const ADMIN_RE = /^(Osoby s TP\b|Stavby len so súpisným\b)/i;

type Entry = { okrsok: number; street: string };
const entries: Entry[] = [];

const scanColumn = (lines: string[]) => {
  let cur: number | null = null;
  for (const rawLine of lines) {
    const t = rawLine.trim();
    if (!t) continue;
    const okrM = t.match(OKR_RE);
    if (okrM) { cur = +okrM[1]; continue; }
    if (cur == null) continue; // header/preamble text before the first okrsok
    const s = t.replace(LABEL_RE, "").trim();
    if (!s) continue;
    if (ADMIN_RE.test(s)) continue; // no street geometry — skip
    entries.push({ okrsok: cur, street: s });
  }
};

scanColumn(leftLines);
scanColumn(rightLines);

const out = entries.map((e) => {
  const parsed = parseStreetSpec(e.street);
  return {
    mc: "Lamač",
    mcNorm: "lamac",
    okrsok: e.okrsok,
    obvod: 0,
    street: parsed.street || e.street,
    streetNorm: parsed.streetNorm || norm(e.street),
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    srcSpadove: e.street,
  };
});

writeFileSync("data/lamac_okrsok_streets.json", JSON.stringify(out));

// ---- Audit / acceptance check ----
const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
console.log(`rows: ${out.length}   okrsky: ${okrs.size ?? okrs.length}   list: ${okrs.join(",")}`);
const empty = [1, 2, 3, 4, 5, 6].filter((n) => !out.some((r) => r.okrsok === n));
console.log(`okrsky 1-6 with no streets: ${empty.length ? empty.join(",") : "none"}`);
console.log(`cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);

const acceptOk = okrs.length === 6 && okrs.every((n, i) => n === i + 1) && empty.length === 0;
console.log(`ACCEPT (exactly 6 okrsky 1-6, all non-empty): ${acceptOk ? "PASS" : "FAIL"}`);

console.log("\nsplit streets (appear in >1 okrsok):");
for (const name of ["Bakošova", "Studenohorská"]) {
  const hits = out.filter((r) => r.street === name);
  console.log(`  ${name}: ${hits.map((h) => `okr${h.okrsok} [${h.cls}] ${JSON.stringify(h.spec?.ranges)}`).join("  |  ")}`);
}

console.log("\nnon-WHOLE rows:");
for (const r of out.filter((r) => r.cls !== "WHOLE"))
  console.log(`  okr${r.okrsok} ${r.street} [${r.cls}] ranges=${JSON.stringify(r.spec?.ranges)} singles=${JSON.stringify(r.spec?.singles)}  «${r.srcSpadove}»`);
