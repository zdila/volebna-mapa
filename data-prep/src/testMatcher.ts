// Self-consistency test: every concrete house number implied by a spec must match
// back to its own okrsok. Failures reveal matcher bugs or overlapping source specs.
import { readFileSync } from "node:fs";
import { buildIndex, match, type Address, type OkrsokRow } from "./matcher.ts";

const rows = JSON.parse(
  readFileSync("data/kosice_okrsok_streets.json", "utf8"),
) as OkrsokRow[];
const idx = buildIndex(rows);

// Enumerate the orientačné numbers a spec explicitly claims (sampled for ranges).
const claimed = (r: OkrsokRow): string[] => {
  if (!r.spec) return [];
  const out: string[] = [];
  for (const [a, b, p] of r.spec.ranges) {
    // Sample every number the range claims, respecting its own parity.
    const step = p === "both" ? 1 : 2;
    const start = p === "both" || a % 2 === (p === "odd" ? 1 : 0) ? a : a + 1;
    for (let n = start; n <= b; n += step) out.push(String(n));
  }
  for (const s of r.spec.singles) out.push(String(s));
  return out;
};

let ok = 0;
let miss = 0;
let wrong = 0;
const problems: string[] = [];

for (const r of rows) {
  if (r.cls !== "RANGE" && r.cls !== "ENUM") continue;
  if (r.numberKind === "supisne") continue; // tested via supisne field, skip here
  for (const h of claimed(r)) {
    const addr: Address = {
      mcNorm: r.mcNorm,
      streetNorm: r.streetNorm,
      orient: h,
      supisne: null,
    };
    const res = match(idx, addr);
    if (res.status === "ok" && res.row.okrsok === r.okrsok) ok++;
    else if (res.status === "ok") {
      wrong++;
      if (problems.length < 40)
        problems.push(
          `WRONG ${r.mc} ${r.street} #${h}: expected okr${r.okrsok} got okr${res.row.okrsok}`,
        );
    } else {
      miss++;
      if (problems.length < 40)
        problems.push(
          `MISS  ${r.mc} ${r.street} #${h}: ${res.status} (expected okr${r.okrsok})`,
        );
    }
  }
}

console.log(`claimed-number checks: ok=${ok} wrong=${wrong} miss=${miss}`);
for (const p of problems) console.log("  " + p);
