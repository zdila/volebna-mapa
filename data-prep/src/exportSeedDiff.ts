// Export what a re-label CHANGED, as a GeoJSON you can drop into an in-progress JOSM session.
//
//   node src/exportSeedDiff.ts <mc> [snapshotPrefix]      (default prefix: before_)
//     node src/exportSeedDiff.ts kosice            # compares against before_seeds_* / before_unmatched_*
//
// Take the snapshot BEFORE re-running the labeller:
//
//   psql volebna -c "drop table if exists before_seeds_<mc>;
//                    create table before_seeds_<mc> as select ra_id, mcnorm, okrsok from seeds_<mc>;"
//   psql volebna -c "drop table if exists before_unmatched_<mc>;
//                    create table before_unmatched_<mc> as select * from unmatched_<mc>;"
//
// (a single-MČ table has no mcnorm column — drop it from the first SELECT there).
//
// Two kinds of change matter when you are already editing polygons by hand:
//
//   change=new    was unmatched, now seeds an okrsok — these ADD influence to a precinct that
//                 had none from them, so a border near a cluster of them was drawn blind
//   change=moved  already matched, but now belongs to a DIFFERENT okrsok — these MOVE influence
//                 between two precincts, so both their borders may shift
//
// Everything is tagged `kind=seed` so the editing style colours it by okrsok as usual; filter on
// `change=new` / `change=moved` to isolate them.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const DB = "volebna";
// stderr dropped: this database emits a "collation version mismatch" WARNING on every connection.
const q = (sql: string) =>
  execFileSync("psql", [DB, "-tAqc", sql], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const mc = process.argv[2];
if (!mc) {
  console.error("usage: node src/exportSeedDiff.ts <mc>");
  process.exit(1);
}
// Baseline to compare against. Defaults to the "before_" snapshot; pass another prefix to diff
// against a later checkpoint — e.g. after handing over one diff, snapshot the current state as
// r1_seeds_<mc>/r1_unmatched_<mc> and the NEXT diff shows only what changed since, rather than
// repeating everything already applied.
const prefix = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "before_";
const beforeSeeds = `${prefix}seeds_${mc}`;
const beforeUnmatched = `${prefix}unmatched_${mc}`;

const exists = (t: string) =>
  q(`select 1 from pg_tables where schemaname='public' and tablename=${lit(t)}`) === "1";
for (const t of [beforeSeeds, beforeUnmatched, `seeds_${mc}`]) {
  if (!exists(t)) {
    console.error(`missing table ${t} — take the snapshot before re-labelling (see header)`);
    process.exit(1);
  }
}

const hasMcnorm =
  q(`select 1 from information_schema.columns where table_schema='public'
       and table_name='seeds_${mc}' and column_name='mcnorm'`) === "1";
const mcSel = hasMcnorm ? "'mcnorm', s.mcnorm," : "";
const mcJoin = hasMcnorm ? "and s.mcnorm = b.mcnorm" : "";

type Feature = { type: "Feature"; properties: Record<string, string>; geometry: unknown };
const rows = (sql: string): Feature[] => {
  const raw = q(sql);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const [props, geom] = JSON.parse(line) as [Record<string, unknown>, unknown];
    const properties: Record<string, string> = {};
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === "") continue;
      properties[k] = String(v);
    }
    return { type: "Feature", properties, geometry: geom };
  });
};

const common = `'kind','seed', 'okrsok', s.okrsok, ${mcSel}
  'street', s.street, 'orient', s.orient, 'supisne', s.supisne, 'ra_id', s.ra_id,
  'name', trim(coalesce(s.street,'') || ' ' || coalesce(s.orient, 's.č. ' || s.supisne, ''))`;

// Was unmatched, now seeds an okrsok. `was` carries the reason it used to fail.
const added = rows(`
  select json_build_array(
           json_build_object(${common}, 'change','new', 'was', b.reason),
           st_asgeojson(st_transform(s.geom, 4326), 7)::json)
    from seeds_${mc} s join ${beforeUnmatched} b on b.ra_id = s.ra_id
   where s.ra_id is not null`);

// Matched before and now, but to a different okrsok.
const moved = rows(`
  select json_build_array(
           json_build_object(${common}, 'change','moved',
             'from_okrsok', b.okrsok${hasMcnorm ? ", 'from_mcnorm', b.mcnorm" : ""}),
           st_asgeojson(st_transform(s.geom, 4326), 7)::json)
    from seeds_${mc} s join ${beforeSeeds} b on b.ra_id = s.ra_id
   where s.ra_id is not null and (s.okrsok <> b.okrsok ${hasMcnorm ? "or s.mcnorm <> b.mcnorm" : ""})`);

const features = [...added, ...moved];
mkdirSync("data/edit", { recursive: true });
const out = `data/edit/${mc}_seed_diff${prefix === "before_" ? "" : `_vs_${prefix.replace(/_$/, "")}`}.geojson`;
writeFileSync(out, JSON.stringify({ type: "FeatureCollection", features }));

console.log(`wrote ${out}`);
console.log(`  change=new    ${added.length}  (were unmatched, now seed an okrsok)`);
console.log(`  change=moved  ${moved.length}  (matched before, now a different okrsok)`);
console.log(`
Open it in JOSM as a SECOND layer alongside the file you are editing — it changes nothing in
your layer. Filter with  change=new  /  change=moved  .`);
