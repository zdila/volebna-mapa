// Parse the Nitra 2026 referendum "Informácia o čase a mieste konania referenda" PDF
// (pdftotext -layout) into okrsok_streets rows. Same shape as Žilina/DNV: header
// "Okrsok č. N <polling place + address>" (all on one line, ends in the venue's building number),
// then one street per line, with indented comma-separated house-number lists for split streets.
// Street wholly in one okrsok -> WHOLE (robust to RA extras); split across okrsky -> per-okrsok ENUM.
import { readFileSync, writeFileSync } from "node:fs";
import { norm, streetKey } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const lines = readFileSync("data/nitra_okrsky.txt", "utf8").split("\n");
const isPageChrome = (l: string) => /^MESTO NITRA|^\s*Strana:|^\s*Dátum:/.test(l);

type Entry = { okrsok: number; street: string; nums: string[] };
const entries: Entry[] = [];
let okrsok = 0;
let cur: Entry | null = null;
let mode: "idle" | "polling" | "streets" = "idle";

for (const raw of lines) {
  if (isPageChrome(raw) || !raw.trim()) continue;

  const h = raw.match(/^Okrsok č\.\s+(\d+)\b/);
  if (h) {
    okrsok = +h[1];
    cur = null;
    mode = /\d\s*$/.test(raw) ? "streets" : "polling"; // polling address usually ends the header line
    continue;
  }
  if (mode === "polling") { if (/\d\s*$/.test(raw)) mode = "streets"; continue; }
  if (mode !== "streets") continue;
  if (/^(V Nitre|Ing\.|Mgr\.|primátor)/i.test(raw.trim())) { mode = "idle"; continue; } // trailing signature

  if (/^\s/.test(raw)) { // indented -> house-number list for the current street
    if (cur) cur.nums.push(...raw.split(",").map((s) => s.trim()).filter((s) => s && !/^súp/i.test(s)));
    continue;
  }
  const name = raw.trim();
  if (/^bez ulice$/i.test(name)) { cur = null; continue; }
  cur = { okrsok, street: name, nums: [] };
  entries.push(cur);
}

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
    mc: "Nitra",
    mcNorm: "nitra",
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

writeFileSync("data/nitra_okrsok_streets.json", JSON.stringify(rows));

const okrs = new Set(rows.map((r) => r.okrsok));
console.log(`rows: ${rows.length}   streets: ${new Set(entries.map((e) => e.street)).size}   okrsky: ${okrs.size} (${Math.min(...okrs)}-${Math.max(...okrs)})`);
console.log(`cls: ${Object.entries(Object.groupBy(rows, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
const missing = [...Array(74)].map((_, i) => i + 1).filter((n) => !okrs.has(n));
console.log(`okrsky 1-74 missing: ${missing.length ? missing.join(",") : "none"}`);
console.log(`split streets (ENUM): ${[...okrOfKey].filter(([, s]) => s.size > 1).length}`);
