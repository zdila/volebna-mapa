// Put back address points that were deleted from a JOSM working file.
//
//   node --experimental-strip-types src/restoreDeletedSeeds.ts <mc> [file.geojson] [--dry-run]
//
// Compares the `ra_id`s present in the file against seeds_<mc> + unmatched_<mc> and re-adds every
// address the file no longer has, with its database geometry and assignment. Existing features are
// NOT touched at all — a point you have dragged keeps the position you gave it, a point you have
// re-tagged keeps your tags. Only absent addresses come back.
//
// Restored points are tagged `change=restored` so you can find them in JOSM (filter change=restored)
// and delete them again deliberately if that is what you meant.
//
// ⚠️ Save and close the file in JOSM first.
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const DB = "volebna";
const q = (sql: string) =>
  execFileSync("psql", [DB, "-F", "\t", "-Atc", sql], {
    encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"],
  }).trim();

const mc = process.argv[2];
if (!mc || mc.startsWith("--")) {
  console.error("usage: node src/restoreDeletedSeeds.ts <mc> [file.geojson] [--dry-run]");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const file = process.argv.slice(3).find((a) => !a.startsWith("--")) ?? `data/edit/${mc}.geojson`;

type Feature = { type: string; properties?: Record<string, unknown>; geometry?: unknown };
const fc = JSON.parse(readFileSync(file, "utf8")) as { features: Feature[] };

// JOSM joins the tags of combined nodes with ";", so one feature can stand for two addresses —
// split on ";" or a merged node would make both of its addresses look deleted.
const have = new Set<string>();
for (const f of fc.features) {
  const p = f.properties;
  if (!p || !String(p.kind ?? "").includes("seed") && !String(p.kind ?? "").includes("unmatched")) continue;
  if (p.ra_id == null) continue;
  for (const id of String(p.ra_id).split(";")) have.add(id.trim());
}

const rows = q(`
  select kind, ra_id, mcnorm, okrsok, street, orient, supisne, reason,
         st_x(st_transform(geom,4326)), st_y(st_transform(geom,4326))
    from (
      select 'seed' kind, ra_id, mcnorm, okrsok::text okrsok, street, orient, supisne,
             ''::text reason, geom from seeds_${mc}
      union all
      select 'unmatched', ra_id, mcnorm, '', street, orient, supisne, reason, geom from unmatched_${mc}
    ) d
   where ra_id is not null
   order by mcnorm, street, orient`).split("\n").filter(Boolean).map((l) => l.split("\t"));

const added: string[] = [];
for (const [kind, raId, mcnorm, okrsok, street, orient, supisne, reason, x, y] of rows) {
  if (have.has(raId)) continue;
  const name = `${street} ${orient || supisne}`;
  const props: Record<string, unknown> = {
    name, kind, ra_id: raId, supisne, orient, mcnorm, street, change: "restored",
  };
  if (kind === "seed") props.okrsok = okrsok;
  else props.reason = reason;
  fc.features.push({
    type: "Feature", properties: props,
    geometry: { type: "Point", coordinates: [Number(x), Number(y)] },
  });
  added.push(`  ${mcnorm}${okrsok ? ` okr ${okrsok}` : ` (${reason})`} — ${name}`);
}

console.log(file);
console.log(`  addresses restored : ${added.length}`);
for (const a of added) console.log(a);

if (dryRun) {
  console.log("\n--dry-run: file not modified.");
  process.exit(0);
}
const bak = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 17)}`;
copyFileSync(file, bak);
writeFileSync(file, JSON.stringify(fc));
console.log(`\nbackup: ${bak}\nupdated. In JOSM reload, then filter  change=restored`);
