// Parse the Bratislava-Podunajské Biskupice "Referendum 2026" okrsky PDF (pdftotext -layout)
// into okrsok_streets rows. The 2026 layout (Rozhodnutie č. 2, 07.05.2026) is a 4-column table:
//   okrsok № | streets (one per line, wraps) | sídlo miestnosti | najnižší počet členov
// The okrsok number (01–08) sits on the first street's line; the polling-place text lives in the
// right column and bleeds onto street lines (e.g. okrsok 04 "Ipeľská   F.G. Lorcu"). Splitting each
// line on runs of 2+ spaces isolates the street (field 0) from the right-column bleed / count.
// Streets are NAMES ONLY — no house-number ranges — so every street is WHOLE. Parenthetical
// qualifiers ("(vrátane nemocnice)", "(vrátane DOS Gerium)") are stripped from the matched name but
// kept verbatim in srcSpadove.
import { readFileSync, writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const lines = readFileSync("data/podunajskebiskupice_okrsky.txt", "utf8").split("\n");

type Entry = { okrsok: number; street: string };
const entries: Entry[] = [];
let okrsok = 0;

for (const rawFF of lines) {
  const raw = rawFF.replace(/\f/g, ""); // page breaks glue a form-feed onto the next header
  const t = raw.trim();
  if (!t) continue;

  // Footer / signature block ends the table.
  if (/^(Ing\.|starosta|mestskej časti|V zmysle|určujem|volebné okrsky,)/i.test(t)) {
    if (/^Ing\./i.test(t)) break;
    continue;
  }

  // Header line: "NN  Street …". Number 01–08 at (near) column 0, then 2+ spaces, then the
  // first street (plus right-column bleed). Distinguishes from lone page numbers (no street).
  const okrM = t.match(/^(0?[1-8])\s{2,}(\S.*)$/);
  if (okrM) {
    okrsok = +okrM[1];
    const street = okrM[2].split(/\s{2,}/)[0].trim(); // first street, minus polling place / count
    if (street && /[a-záčďéíĺľňóôŕšťúýž]/i.test(street)) entries.push({ okrsok, street });
    continue;
  }
  if (!okrsok) continue; // still in the title block

  // Repeated column headers / title fragments.
  if (/^(okrsok|číslo|zahrňujúci|bývajúcich|na hlasovanie|komis|R o z h|na území|Referend|dňa |Bratislava)/i.test(t)) continue;

  const field0 = t.split(/\s{2,}/)[0].trim(); // drop right-column bleed (polling place / count)
  if (/^obyvatelia bez domova$/i.test(field0)) continue; // admin catch-all, no geometry
  if (!/[a-záčďéíĺľňóôŕšťúýž]/i.test(field0)) continue;   // page-number / stray-digit lines
  entries.push({ okrsok, street: field0 });
}

// Street NAME only. Strip parenthetical qualifiers for matching; keep raw for srcSpadove.
const toSpecInput = (street: string): string =>
  street.replace(/\s*\(.*?\)/g, "").replace(/\s+/g, " ").trim();

const out = entries.map((e) => {
  const input = toSpecInput(e.street);
  const parsed = parseStreetSpec(input);
  return {
    mc: "Podunajské Biskupice",
    mcNorm: "podunajskebiskupice",
    okrsok: e.okrsok,
    obvod: 0,
    street: parsed.street || input,
    streetNorm: parsed.streetNorm || norm(input),
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    srcSpadove: e.street,
  };
});

writeFileSync("data/podunajskebiskupice_okrsok_streets.json", JSON.stringify(out));

// Audit
const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
console.log(`rows: ${out.length}   okrsky: ${okrs.length}   [${okrs.join(", ")}]`);
console.log(`cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
const counts = Object.fromEntries(okrs.map((o) => [o, out.filter((r) => r.okrsok === o).length]));
console.log(`streets per okrsok: ${okrs.map((o) => `${o}:${counts[o]}`).join("  ")}`);
const few = okrs.filter((o) => counts[o] < 2);
console.log(`okrsky with <2 streets: ${few.length ? few.join(",") : "none"}`);
for (const r of out.filter((r) => r.cls !== "WHOLE")) console.log(`  NON-WHOLE okr${r.okrsok} «${r.srcSpadove}» -> ${r.cls}`);
