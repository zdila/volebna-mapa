// Build an okrsok_streets.json for a MČ whose assignment is whole-streets-only (no house numbers):
// input data/<mc>_ws.json = { mc, mcNorm, okrsky: { "1": ["Street A", ...], ... } }.
// Every street is emitted as a WHOLE-street row via parseStreetSpec. Usage: node src/buildWholeStreets.ts <mc>
import { readFileSync, writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const mc = process.argv[2];
if (!mc) { console.error("usage: node src/buildWholeStreets.ts <mcNorm>"); process.exit(1); }
const src = JSON.parse(readFileSync(`data/${mc}_ws.json`, "utf8")) as { mc: string; mcNorm: string; okrsky: Record<string, string[]> };

const out = Object.entries(src.okrsky).flatMap(([okr, streets]) =>
  streets.map((s) => {
    const parsed = parseStreetSpec(s.trim());
    return {
      mc: src.mc,
      mcNorm: src.mcNorm,
      okrsok: +okr,
      obvod: 0,
      street: parsed.street || s.trim(),
      streetNorm: parsed.streetNorm || norm(s),
      parity: parsed.parity,
      cls: parsed.cls,
      numberKind: parsed.numberKind,
      spec: parsed.spec,
      srcSpadove: s.trim(),
    };
  }),
);

writeFileSync(`data/${src.mcNorm}_okrsok_streets.json`, JSON.stringify(out));
const okrs = new Set(out.map((r) => r.okrsok));
console.log(`${src.mcNorm}: rows ${out.length}, okrsky ${okrs.size} (${[...okrs].sort((a, b) => a - b).join(",")})`);
const nonWhole = out.filter((r) => r.cls !== "WHOLE");
if (nonWhole.length) console.log(`  ⚠ ${nonWhole.length} non-WHOLE rows: ${nonWhole.map((r) => r.street).join(", ")}`);
