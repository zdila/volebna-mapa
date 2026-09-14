// Parse the Žilina 2026 referendum "Zoznam volebných okrskov…" PDF (pdftotext -layout) into
// okrsok_streets rows. Same shape as DNV: an okrsok header "Volebný okrsok č. N <polling place>"
// (the polling address may wrap to a 2nd column-0 line — it always ends in a building number, street
// names never do), then one street per line, with indented comma-separated house-number lists for
// split streets. "bez ulice" = no-street marker. A street wholly in one okrsok is emitted WHOLE
// (robust to RA extras); a street split across okrsky keeps its per-okrsok number ENUM.
import { readFileSync, writeFileSync } from "node:fs";
import { norm, streetKey } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const lines = readFileSync("data/zilina_okrsky.txt", "utf8").split("\n");
const isPageChrome = (l: string) =>
  /^MsÚ v Žiline|^\s*Dátum:|^Zoznam volebných okrskov|^\s*Žilina\s*$|^\s*pre\s*$|^\s*Referendum 2026\s*$|^\s*Dátum konania:/.test(l);

type Entry = { okrsok: number; street: string; nums: string[] };
const entries: Entry[] = [];
let okrsok = 0;
let cur: Entry | null = null;
let mode: "idle" | "polling" | "streets" = "idle";

for (const raw of lines) {
  if (isPageChrome(raw) || !raw.trim()) continue;

  const h = raw.match(/^Volebný okrsok č\.\s+(\d+)\b/);
  if (h) {
    okrsok = +h[1];
    cur = null;
    mode = /\d\s*$/.test(raw) ? "streets" : "polling"; // whole polling place on the header line?
    continue;
  }
  if (mode === "polling") { // skip the wrapped polling-place address; it ends in a building number
    if (/\d\s*$/.test(raw)) mode = "streets";
    continue;
  }
  if (mode !== "streets") continue;

  if (/^\s/.test(raw)) { // indented -> house-number list for the current street
    if (cur) cur.nums.push(...raw.split(",").map((s) => s.trim()).filter((s) => s && !/^súp/i.test(s)));
    continue;
  }
  const name = raw.trim();
  if (/^bez ulice$/i.test(name)) { cur = null; continue; } // no-street marker
  if (/^časť obce\b/i.test(name)) { cur = null; continue; } // village sub-header, not a street
  if (/^V Žiline dňa|^Ing\.|primátor/i.test(name)) { mode = "idle"; continue; } // trailing signature block
  cur = { okrsok, street: name, nums: [] };
  entries.push(cur);
}

// A street (canonical key) split across >1 okrsok keeps its number ENUM; single-okrsok streets WHOLE.
const okrOfKey = new Map<string, Set<number>>();
for (const e of entries) {
  const k = streetKey(norm(e.street));
  (okrOfKey.get(k) ?? okrOfKey.set(k, new Set()).get(k)!).add(e.okrsok);
}

const rows = entries.map((e) => {
  const split = (okrOfKey.get(streetKey(norm(e.street)))?.size ?? 1) > 1;
  const input = split && e.nums.length ? `${e.street} ${e.nums.join(",")}` : e.street;
  const parsed = parseStreetSpec(input);
  return {
    mc: "Žilina",
    mcNorm: "zilina",
    okrsok: e.okrsok,
    obvod: 0,
    street: split ? e.street : parsed.street || e.street,
    streetNorm: norm(e.street),
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    srcSpadove: input,
  };
});

writeFileSync("data/zilina_okrsok_streets.json", JSON.stringify(rows));

// Audit
const okrs = new Set(rows.map((r) => r.okrsok));
console.log(`rows: ${rows.length}   streets: ${new Set(entries.map((e) => e.street)).size}   okrsky: ${okrs.size} (${Math.min(...okrs)}-${Math.max(...okrs)})`);
console.log(`cls: ${Object.entries(Object.groupBy(rows, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
const missing = [...Array(72)].map((_, i) => i + 1).filter((n) => !okrs.has(n));
console.log(`okrsky 1-72 missing: ${missing.length ? missing.join(",") : "none"}`);
console.log(`split streets (ENUM): ${[...okrOfKey].filter(([, s]) => s.size > 1).length}`);
