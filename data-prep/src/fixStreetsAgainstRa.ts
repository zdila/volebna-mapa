// Repair garbled assignment street names against the authoritative RA street list. Some source PDFs
// have a broken font→Unicode map that mangles specific letter combos on extraction (Nitra: "rn"→"m"
// so Hornozoborská→Homozoborská, Filkorna→Filkoma; "Hl"→"Fll" so Hlavná→Fllavná). RA carries the
// correct spellings, so for each assignment street that matches NO RA street we find the RA street it
// should be: first by a garble-collapsing canonical key, else by a tight edit-distance (≤2, unique).
// Rewrites data/<mc>_okrsok_streets.json in place. Usage: node src/fixStreetsAgainstRa.ts <mc> <ra_table> <bnd_table>
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { norm, streetKey } from "./normalize.ts";

const [mc, raTable, bnd] = process.argv.slice(2);
if (!mc || !raTable || !bnd) { console.error("usage: node src/fixStreetsAgainstRa.ts <mc> <ra_table> <bnd_table>"); process.exit(1); }

type Row = { street: string; streetNorm: string; okrsok: number };
const rows = JSON.parse(readFileSync(`data/${mc}_okrsok_streets.json`, "utf8")) as Row[];

// Distinct RA street names inside the boundary (the correct spellings).
const raStreets = JSON.parse(execFileSync("psql", ["volebna", "-tAqc",
  `select coalesce(json_agg(distinct r.street),'[]') from ${raTable} r join ${bnd} b on st_contains(b.geom, r.geom) where r.street is not null and r.street <> ''`],
  { encoding: "utf8", maxBuffer: 1 << 30 }).trim()) as string[];

const raKeys = new Set(raStreets.map((s) => streetKey(norm(s))));
// Collapse the known garble classes so a garbled name and its correct form share a key.
const canon = (s: string) => norm(s).replace(/rn|m/g, "ⓡ").replace(/fll|hl/g, "ⓗ").replace(/\s+/g, "");
const byCanon = new Map<string, string[]>();
for (const s of raStreets) (byCanon.get(canon(s)) ?? byCanon.set(canon(s), []).get(canon(s))!).push(s);

const lev = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

const fixCache = new Map<string, string | null>();
const findFix = (street: string): string | null => {
  if (fixCache.has(street)) return fixCache.get(street)!;
  let fix: string | null = null;
  const cands = byCanon.get(canon(street));
  if (cands && cands.length === 1) fix = cands[0]; // unique garble-canonical match
  else {
    const ns = norm(street);
    const scored = raStreets.map((r) => [lev(ns, norm(r)), r] as const).sort((a, b) => a[0] - b[0]);
    // ≤1 edit only (a 2-edit "match" wrongly paired distinct streets like Račia/Žabia); garble
    // classes bigger than 1 char are handled by the canonical key above.
    if (scored.length && scored[0][0] <= 1 && (scored.length < 2 || scored[1][0] >= scored[0][0] + 2)) fix = scored[0][1];
  }
  fixCache.set(street, fix);
  return fix;
};

const fixes = new Map<string, string>();
for (const r of rows) {
  if (raKeys.has(streetKey(r.streetNorm))) continue; // already matches RA
  const fix = findFix(r.street);
  if (fix && streetKey(norm(fix)) !== streetKey(r.streetNorm)) {
    fixes.set(r.street, fix);
    r.street = fix;
    r.streetNorm = norm(fix);
  }
}

writeFileSync(`data/${mc}_okrsok_streets.json`, JSON.stringify(rows));
console.log(`corrected ${fixes.size} distinct street names against RA:`);
for (const [bad, good] of fixes) console.log(`  «${bad}» -> «${good}»`);
