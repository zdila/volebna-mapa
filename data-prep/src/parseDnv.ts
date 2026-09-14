// Parse the Devínska Nová Ves 2026 referendum "Zoznam ulíc" PDF (pdftotext -layout) into
// okrsok_streets rows. Layout: an okrsok header line "N <polling place>", then for each street a
// name line (column 0) followed by indented comma-separated house-number lines (wrapping, and
// occasionally interleaved with "súp. č. NNNN" súpisné-only buildings). "Bez názvu ulice." is a
// no-street súpisné catch-all.
// A street enumerated under a single okrsok is emitted WHOLE (seed every point, robust to an
// incomplete list); a street split across okrsky keeps its per-okrsok number ENUM to place the split.
import { readFileSync, writeFileSync } from "node:fs";
import { norm, streetKey } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const lines = readFileSync("data/dnv_okrsky.txt", "utf8").split("\n");

type Entry = { okrsok: number; street: string; nums: string[] };
const entries: Entry[] = [];
let okrsok = 0;
let cur: Entry | null = null;

for (const raw of lines) {
  if (/^Mestská časť|Strana:|Dátum:|^\s*Zoznam ulíc\s*$|^\s*pre\s*$|^\s*Referendum\s*$|Dátum konania/.test(raw)) continue;
  if (!raw.trim()) continue;
  const h = raw.match(/^(\d+)\s+[A-ZČŠŽ]/); // okrsok header "N <polling place>"
  if (h) { okrsok = +h[1]; cur = null; continue; }
  if (/^\s/.test(raw)) { // indented -> house-number list for the current street
    if (cur) cur.nums.push(...raw.split(",").map((s) => s.trim()).filter((s) => s && !/^súp/i.test(s)));
    continue;
  }
  const name = raw.trim();
  if (/^Bez názvu/i.test(name)) { cur = null; continue; } // no-street catch-all (súpisné only)
  cur = { okrsok, street: name, nums: [] };
  entries.push(cur);
}

// A street split across >1 okrsok must keep its number enumeration; single-okrsok streets go WHOLE.
const okrCount = new Map<string, Set<number>>();
for (const e of entries) {
  const k = streetKey(norm(e.street));
  (okrCount.get(k) ?? okrCount.set(k, new Set()).get(k)!).add(e.okrsok);
}

const rows = entries.map((e) => {
  const split = (okrCount.get(streetKey(norm(e.street)))?.size ?? 1) > 1;
  const input = split && e.nums.length ? `${e.street} ${e.nums.join(",")}` : e.street;
  const parsed = parseStreetSpec(input);
  return {
    mc: "Devínska Nová Ves",
    mcNorm: "devinskanovaves",
    okrsok: e.okrsok,
    obvod: 0,
    street: parsed.street || e.street,
    streetNorm: parsed.streetNorm || norm(e.street),
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    srcSpadove: input,
  };
});

writeFileSync("data/devinskanovaves_okrsok_streets.json", JSON.stringify(rows));

// Audit
const okrs = new Set(rows.map((r) => r.okrsok));
console.log(`rows: ${rows.length}   okrsky: ${okrs.size}   (${[...okrs].sort((a, b) => a - b).join(",")})`);
console.log(`cls: ${Object.entries(Object.groupBy(rows, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
console.log("\nsplit streets (kept as ENUM):");
for (const r of rows.filter((r) => r.cls !== "WHOLE")) console.log(`  okr${r.okrsok} ${r.street} [${r.cls}] n=${(r.spec?.singles?.length ?? 0)}  «${r.srcSpadove.slice(0, 55)}»`);
