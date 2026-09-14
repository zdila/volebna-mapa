// Repair Košice assignment rows whose STREET NAME has a foreign token glued to the front, using
// Register adries as the authority on what is really a street.
//
//   node src/fixGluedStreets.ts [--dry-run]                       Košice (default)
//   node src/fixGluedStreets.ts --dataset bratislava [--dry-run]  every Bratislava MČ file
//
//   Run AFTER the parsers and BEFORE labelling.
//
// splitGluedStreets in kvCommon.ts handles glue AFTER the numbers ("Rázusova 1-33 párne Dunajská",
// where the source omits a comma). The opposite direction needs different evidence, because the
// glued text sits where a street name legitimately lives and Slovak street names are freely
// multi-word — "Slovenskej jednoty 1-15" and "Nižné Kapustníky" must survive untouched while
// "Pribinova Štúrova 1-25" must split. Capitalisation cannot tell those apart. RA can:
//
//   "Pribinova Štúrova" -> suffix "Štúrova" is a street here AND prefix "Pribinova" is too
//                          => two streets, the source lost the comma between them
//   "párne Štúrova"     -> suffix "Štúrova" is a street, prefix "párne" is not
//                          => a wrapped parity word crossed a block boundary; drop it
//   "Slovenskej jednoty"-> the whole name is a street => leave alone
//
// Both shapes cost real coverage: the row is filed under a name nothing matches, so the street
// silently loses every address it should have claimed (Štúrova 1–32 was reporting `no-number`).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { norm, streetKey } from "./normalize.ts";
import type { Row } from "./keCommon.ts";

const DB = "volebna";
const dryRun = process.argv.includes("--dry-run");
const dsIdx = process.argv.indexOf("--dataset");
const dataset = dsIdx >= 0 ? process.argv[dsIdx + 1] : "kosice";
const FILES =
  dataset === "kosice"
    ? ["data/kosice_okrsok_streets.json"]
    : readdirSync("data")
        .filter((f) => new RegExp(`^kv_${dataset === "bratislava" ? "ba" : dataset}_.*_okrsok_streets\\.json$`).test(f))
        .map((f) => `data/${f}`);

// stderr dropped: this database emits a "collation version mismatch" WARNING on every connection.
const q = (sql: string) =>
  execFileSync("psql", [DB, "-tAqc", sql], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

// The street names Register adries actually carries, per mestská časť. Taken from the LABELLED
// tables rather than the raw RA layer: seeds + unmatched together are exactly the addresses that
// were considered for this dataset, they already carry mcnorm, and they survive the ogr2ogr
// scratch tables being dropped at the end of a build.
const src = q(`select 1 from pg_tables where schemaname='public' and tablename='seeds_${dataset}'`)
  ? `select mcnorm, street from seeds_${dataset}
     union all select mcnorm, street from unmatched_${dataset}`
  : "";
if (!src) {
  console.error(`seeds_${dataset} not found — label the dataset first`);
  process.exit(1);
}

const raKeys = new Map<string, Set<string>>();
for (const line of q(`
  select mcnorm || '|' || street from (${src}) t
   where street is not null and street <> ''
   group by 1`).split("\n")) {
  if (!line) continue;
  const [mc, ...rest] = line.split("|");
  const street = rest.join("|");
  const set = raKeys.get(mc) ?? raKeys.set(mc, new Set()).get(mc)!;
  set.add(streetKey(norm(street)));
}

const known = (mc: string, name: string) => raKeys.get(mc)?.has(streetKey(norm(name))) ?? false;

const fixes: string[] = [];
for (const FILE of FILES) {
const rows = JSON.parse(readFileSync(FILE, "utf8")) as Row[];
const out: Row[] = [];
const seenWhole = new Set<string>();

for (const r of rows) {
  out.push(r);
  const name = (r.street ?? "").trim();
  // Only names that are pure text: a digit here means a different bug (an unparsed spec), and
  // this repair would not help.
  if (!name || /\d/.test(name) || known(r.mcNorm, name)) continue;

  const toks = name.split(/\s+/);
  if (toks.length < 2) continue;

  // Strip as little as possible: try the longest suffix first.
  for (let i = 1; i < toks.length; i++) {
    const suffix = toks.slice(i).join(" ");
    if (!known(r.mcNorm, suffix)) continue;

    const prefix = toks.slice(0, i).join(" ");
    r.street = suffix;
    r.streetNorm = norm(suffix);

    if (known(r.mcNorm, prefix)) {
      // Both halves are real streets — the source dropped the comma. The prefix carried no
      // number spec of its own, so it takes the whole street.
      const key = `${r.mcNorm}#${r.okrsok}#${streetKey(norm(prefix))}`;
      if (!seenWhole.has(key)) {
        seenWhole.add(key);
        out.push({
          ...r,
          street: prefix,
          streetNorm: norm(prefix),
          parity: "both",
          cls: "WHOLE",
          numberKind: "orientacne",
          spec: null,
          srcSpadove: `${r.srcSpadove}  [split: "${prefix}" recovered]`,
        } as Row);
        fixes.push(`  ${r.mcNorm} okr ${r.okrsok}: "${name}" -> "${suffix}" + "${prefix}" (both are streets)`);
      }
    } else {
      fixes.push(`  ${r.mcNorm} okr ${r.okrsok}: "${name}" -> "${suffix}" (dropped "${prefix}")`);
    }
    break;
  }
}

if (!dryRun && out.length !== rows.length) {
  writeFileSync(FILE, JSON.stringify(out));
  console.log(`wrote ${FILE} (${out.length} rows, was ${rows.length})`);
}
}

console.log(`${fixes.length} glued street name(s) repaired against Register adries:`);
for (const f of fixes) console.log(f);
if (dryRun) console.log("\n--dry-run: nothing written.");
