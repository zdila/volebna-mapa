// Update a JOSM working file IN PLACE with the current database assignments, tagging what changed.
//
//   node src/applyChangesToFile.ts <mc> [file.geojson] [--dry-run]
//     node src/applyChangesToFile.ts kosice
//
// Rewrites only the ADDRESS POINTS (kind=seed / kind=unmatched), matched by `ra_id`. The
// `kind=okrsok` polygons — your hand-drawn geometry — are copied through byte-for-byte untouched,
// as is anything else in the file. A timestamped .bak is written before the file is replaced.
//
// Points whose assignment changed gain a `change` tag so they stand out in the editing style:
//
//   change=new     the file had it unmatched; it now seeds an okrsok
//   change=moved   it now belongs to a DIFFERENT okrsok — influence moves between two precincts,
//                  so both borders may need re-checking
//   change=lost    it seeded an okrsok in the file but no longer matches; usually the parser
//                  stopped matching it WRONGLY, but check before trusting that
//
// Unchanged points are left exactly as they are, with no `change` tag, so a filter of
// `change=*` shows precisely the delta and nothing else.
//
// ⚠️ Save and close the file in JOSM first — JOSM holds its own copy in memory and will overwrite
// this on its next save.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { backupFile } from "./fileBackup.ts";

const DB = "volebna";
// stderr dropped: this database emits a "collation version mismatch" WARNING on every connection.
const q = (sql: string) =>
  execFileSync("psql", [DB, "-tAqc", sql], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

const mc = process.argv[2];
if (!mc || mc.startsWith("--")) {
  console.error("usage: node src/applyChangesToFile.ts <mc> [file.geojson] [--dry-run]");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const file = process.argv.slice(3).find((a) => !a.startsWith("--")) ?? `edit/${mc}.geojson`;

const hasMcnorm =
  q(`select 1 from information_schema.columns where table_schema='public'
       and table_name='seeds_${mc}' and column_name='mcnorm'`) === "1";

// --- current database state, keyed by RA address id ----------------------------------------------
type Now = { okrsok: string; mcnorm: string | null };
const now = new Map<string, Now>();
for (const line of q(`
  select ra_id || chr(9) || okrsok || chr(9) || ${hasMcnorm ? "coalesce(mcnorm,'')" : "''"}
    from seeds_${mc} where ra_id is not null`).split("\n")) {
  if (!line) continue;
  const [raId, okrsok, mcnorm] = line.split("\t");
  now.set(raId, { okrsok, mcnorm: mcnorm || null });
}
const unmatchedNow = new Map<string, string>();
for (const line of q(`
  select ra_id || chr(9) || reason from unmatched_${mc} where ra_id is not null`).split("\n")) {
  if (!line) continue;
  const [raId, reason] = line.split("\t");
  unmatchedNow.set(raId, reason);
}

// --- rewrite the points, leave everything else alone ---------------------------------------------
type Feature = { properties?: Record<string, unknown>; geometry?: unknown };
const fc = JSON.parse(readFileSync(file, "utf8")) as { type: string; features: Feature[] };

const counts = { new: 0, moved: 0, lost: 0, unchanged: 0, polygons: 0, skipped: 0 };

for (const f of fc.features) {
  const p = f.properties ?? (f.properties = {});
  const kind = String(p.kind ?? "");

  if (kind === "okrsok") {
    counts.polygons++;
    continue; // hand-drawn geometry — never touched
  }
  if (kind !== "seed" && kind !== "unmatched") {
    counts.skipped++;
    continue;
  }

  // JOSM merges conflicting tag values with ";" when two nodes are combined; such a point is
  // ambiguous, so leave it exactly as it is rather than guess.
  const raId = p.ra_id == null ? "" : String(p.ra_id);
  if (!raId || raId.includes(";")) {
    counts.skipped++;
    continue;
  }

  // Clear any `change` tag from a previous run, so the tag always describes THIS delta.
  delete p.change;
  delete p.was;

  const cur = now.get(raId);
  const wasSeed = kind === "seed" && p.okrsok != null;
  const wasOkrsok = wasSeed ? String(p.okrsok) : null;
  const wasMcnorm = p.mcnorm == null ? null : String(p.mcnorm);

  if (cur) {
    const same = wasSeed && wasOkrsok === cur.okrsok && (!hasMcnorm || wasMcnorm === cur.mcnorm);
    if (same) {
      counts.unchanged++;
      continue;
    }
    if (wasSeed) {
      p.change = "moved";
      counts.moved++;
    } else {
      p.change = "new";
      counts.new++;
    }
    p.kind = "seed";
    p.okrsok = cur.okrsok;
    if (hasMcnorm && cur.mcnorm) p.mcnorm = cur.mcnorm;
    delete p.reason;
  } else if (wasSeed) {
    // No longer matches anything.
    p.change = "lost";
    p.kind = "unmatched";
    p.reason = unmatchedNow.get(raId) ?? "no-street";
    delete p.okrsok;
    counts.lost++;
  } else {
    counts.unchanged++;
  }
}

console.log(`${file}`);
console.log(`  okrsok polygons left untouched : ${counts.polygons}`);
console.log(`  change=new                     : ${counts.new}`);
console.log(`  change=moved                   : ${counts.moved}`);
console.log(`  change=lost                    : ${counts.lost}${counts.lost ? "   <-- check these" : ""}`);
console.log(`  unchanged                      : ${counts.unchanged}`);
console.log(`  skipped (no ra_id / merged)    : ${counts.skipped}`);

if (dryRun) {
  console.log("\n--dry-run: file not modified.");
  process.exit(0);
}

const bak = backupFile(file);
writeFileSync(file, JSON.stringify(fc));
console.log(`\nbackup: ${bak}`);
console.log(`updated in place. In JOSM: reload the file, then filter  change=*  to see the delta.`);
