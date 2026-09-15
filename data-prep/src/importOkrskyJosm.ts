// Import hand-edited okrsok polygons back from JOSM.
//
//   node src/importOkrskyJosm.ts <mc> [file.geojson] [--replace] [--all] [--dry-run]
//     node src/importOkrskyJosm.ts lamac
//     node src/importOkrskyJosm.ts kosice edit/kosice_zapad.geojson
//
// Edits land in the **`manual` schema** (`manual.okrsky_<mc>`), NOT in `okrsky_<mc>`. That is the
// whole point: `okrsky_<mc>` is machine output and any re-derivation (rebuild.sh, a new source
// document, a clip-radius change) overwrites it wholesale. Keeping hand-work in a parallel table
// means you can keep re-deriving — the derived geometry improves everywhere you have NOT touched,
// and your edits still win where you have. buildOkrskyTiles.sh prefers `manual` per (mc, okrsok).
//
// Only `kind=okrsok` features are read; seeds/unmatched points in the file are ignored (they are
// there for orientation while editing — to move or drop a seed use seed_overrides.csv, which
// feeds the DERIVATION and so survives properly).
//
// Import is an UPSERT keyed by okrsok (Košice: mcnorm+okrsok): okrsky present in the file are
// inserted or replaced, okrsky absent from it are left alone. `--replace` instead clears the MČ's
// manual table first, so a partial file becomes the complete set of overrides.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DB = "volebna";
// Reads drop stderr (this database emits a "collation version mismatch" WARNING on every
// connection). WRITES keep it: an ON_ERROR_STOP failure there — e.g. st_makevalid returning a
// GEOMETRYCOLLECTION that st_multi cannot cast to geometry(MultiPolygon,5514) — would otherwise
// surface as a bare "Command failed: psql" with no diagnostic at all.
const psql = (args: string[], input?: string, keepStderr = false) =>
  execFileSync("psql", [DB, ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 1 << 30,
    stdio: ["pipe", "pipe", keepStderr ? "inherit" : "ignore"],
  }).trim();
const q = (sql: string) => psql(["-tAqc", sql]);
const write = (args: string[], input?: string) => psql(args, input, true);
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const argv = process.argv.slice(2);
const mc = argv[0];
if (!mc || mc.startsWith("--")) {
  console.error("usage: node src/importOkrskyJosm.ts <mc> [file.geojson] [--replace] [--all] [--dry-run]");
  process.exit(1);
}
const replace = argv.includes("--replace");
const importAll = argv.includes("--all");
const dryRun = argv.includes("--dry-run");
const file = argv.slice(1).find((a) => !a.startsWith("--")) ?? `edit/${mc}.geojson`;

const hasMcnorm =
  q(`select 1 from information_schema.columns where table_schema='public'
       and table_name='okrsky_${mc}' and column_name='mcnorm'`) === "1";

type Feature = { properties?: Record<string, unknown>; geometry?: { type: string } | null };
const fc = JSON.parse(readFileSync(file, "utf8")) as { features?: Feature[] };
const feats = fc.features ?? [];

// --- collect the polygons, and refuse anything ambiguous rather than guessing -------------------
const rows: { okrsok: number; mcnorm: string | null; parts: string[] }[] = [];
const problems: string[] = [];
const seen = new Map<string, (typeof rows)[number]>();
let skipped = 0;

for (const f of feats) {
  const p = f.properties ?? {};
  if (p.kind !== "okrsok") {
    skipped++;
    continue;
  }
  const okrsok = Number(p.okrsok);
  if (!Number.isInteger(okrsok) || okrsok <= 0) {
    problems.push(`a kind=okrsok feature has okrsok=${JSON.stringify(p.okrsok)} — tag lost or edited?`);
    continue;
  }
  const mcnorm = hasMcnorm ? (p.mcnorm == null ? null : String(p.mcnorm)) : null;
  if (hasMcnorm && !mcnorm) {
    problems.push(`okrsok ${okrsok} has no mcnorm tag (Košice needs it — okrsok numbers repeat per MČ)`);
    continue;
  }
  const g = f.geometry;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) {
    problems.push(
      `okrsok ${okrsok}${mcnorm ? ` (${mcnorm})` : ""}: geometry is ${g?.type ?? "missing"}, not a polygon` +
      (g?.type === "LineString" ? " — an unclosed way; close it in JOSM (select it, press A over the gap)" : ""),
    );
    continue;
  }
  // A multipart okrsok comes back from JOSM as SEVERAL Polygon features carrying the same tags
  // (its GeoJSON writer does not re-assemble multipolygon relations), so parts are collected and
  // unioned rather than rejected. Košice's 189 okrsky arrive as ~294 features this way.
  const key = `${mcnorm ?? ""}#${okrsok}`;
  const existing = seen.get(key);
  if (existing) {
    existing.parts.push(JSON.stringify(g));
    continue;
  }
  const row = { okrsok, mcnorm, parts: [JSON.stringify(g)] };
  seen.set(key, row);
  rows.push(row);
}

const multipart = rows.filter((r) => r.parts.length > 1).length;
console.log(
  `${file}: ${rows.length} okrsky from ${rows.reduce((n, r) => n + r.parts.length, 0)} polygon features` +
  ` (${multipart} multipart, ${skipped} point/other features ignored)`,
);
if (problems.length) {
  console.error(`\nrefusing to import — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}
if (!rows.length) {
  console.error("nothing to import");
  process.exit(1);
}

// --- stage, validate, then publish -------------------------------------------------------------
const mcnormCol = hasMcnorm ? "mcnorm text," : "";
const mcnormVal = (r: (typeof rows)[number]) => (hasMcnorm ? `${lit(r.mcnorm!)},` : "");
const keyCols = hasMcnorm ? "mcnorm, okrsok" : "okrsok";

// EPSG:5514 is the project's working CRS; JOSM hands geometry back in WGS84. `raw` keeps the
// geometry exactly as drawn so validity can be judged on THAT — see below.
const values = rows
  .map((r) => {
    const parts = r.parts
      .map((p) => `st_transform(st_setsrid(st_geomfromgeojson(${lit(p)}),4326),5514)`)
      .join(",");
    const raw = r.parts.length > 1 ? `st_collect(array[${parts}])` : parts;
    // st_collectionextract(..., 3) keeps only the POLYGONAL components. Two things make it
    // necessary: st_collect of a MultiPolygon part with a Polygon part yields a
    // GEOMETRYCOLLECTION (JOSM emits one okrsok's parts as a mix of both), and st_makevalid turns
    // a self-intersecting ring into polygons PLUS dangling lines. Without it the insert dies with
    // "Geometry type (GeometryCollection) does not match column type (MultiPolygon)".
    // The self-intersecting cases are still refused below — this only makes the staging survive
    // long enough to report them.
    return `(${mcnormVal(r)}${r.okrsok}, st_multi(st_collectionextract(st_makevalid(${raw}), 3)), ${raw})`;
  })
  .join(",\n");

write(["-v", "ON_ERROR_STOP=1", "-q"], `
create schema if not exists manual;
drop table if exists _josm_stage;
create table _josm_stage (${mcnormCol} okrsok int, geom geometry(MultiPolygon,5514), raw geometry);
insert into _josm_stage (${keyCols}, geom, raw) values
${values};
`);

// Judge validity on the geometry AS DRAWN. Testing the repaired copy is vacuous — st_makevalid
// always returns something valid — so the old check reported "0" while silently reshaping a
// self-intersecting polygon into something other than what JOSM showed you.
const invalidList = q(`
  select coalesce(string_agg(
           ${hasMcnorm ? "mcnorm||'/'||okrsok" : "okrsok::text"} || ' (' || st_isvalidreason(raw) || ')',
           '; '), '')
    from _josm_stage where not st_isvalid(raw)`);
const invalid = invalidList ? String(invalidList.split(";").length) : "0";
const overlaps = q(`
  select count(*) from _josm_stage a join _josm_stage b
    on ${hasMcnorm ? "a.mcnorm=b.mcnorm and " : ""}a.okrsok < b.okrsok
   and st_area(st_intersection(a.geom,b.geom)) > 1`);
const areas = q(`
  select coalesce(string_agg(${hasMcnorm ? "mcnorm||'/'||okrsok" : "okrsok::text"}, ', '), '')
    from _josm_stage where st_area(geom) < 100`);

console.log(`  polygons in file   : ${rows.length}`);
console.log(`  invalid geometries : ${invalid}`);
console.log(`  overlapping pairs  : ${overlaps}${overlaps === "0" ? "" : "   <-- precincts must not overlap"}`);
if (areas) console.log(`  suspiciously tiny  : ${areas}`);

if (invalidList) {
  console.error(`\nrefusing to import — ${invalid} polygon(s) are self-intersecting AS DRAWN:`);
  console.error(`  ${invalidList}`);
  console.error('Fix them in JOSM (Validator, "Self-intersecting way"), then re-run.');
  psql(["-q", "-c", "drop table if exists _josm_stage"]);
  process.exit(1);
}

if (overlaps !== "0") {
  console.error("\nrefusing to import: fix the overlaps in JOSM first (re-run with the file corrected).");
  psql(["-q", "-c", "drop table if exists _josm_stage"]);
  process.exit(1);
}

// Only record what you actually EDITED. A full-MČ export holds every okrsok, so importing it
// wholesale would pin all of them as manual overrides — freezing today's derived geometry for
// precincts you never touched, and cutting them off from future re-derivation. Compare each
// staged polygon with its derived counterpart and drop the ones that did not really move.
// The threshold is a distance, not an area: the export rounds coordinates to 7 decimals (~1 cm),
// so an untouched polygon comes back a hair different, while a real edit moves a border metres.
if (!importAll) {
  const unchanged = q(`
    delete from _josm_stage st using okrsky_${mc} d
     where d.okrsok = st.okrsok ${hasMcnorm ? "and d.mcnorm = st.mcnorm" : ""}
       and st_hausdorffdistance(st.geom, d.geom) < 0.5
    returning 1`).split("\n").filter(Boolean).length;
  const kept = q("select count(*) from _josm_stage");
  console.log(`  unchanged, skipped  : ${unchanged}   (--all imports them anyway)`);
  console.log(`  edited, to import   : ${kept}`);
  if (kept === "0") {
    console.log("\nnothing was edited — nothing to import.");
    psql(["-q", "-c", "drop table if exists _josm_stage"]);
    process.exit(0);
  }
}

if (dryRun) {
  console.log("\n--dry-run: nothing written.");
  psql(["-q", "-c", "drop table if exists _josm_stage"]);
  process.exit(0);
}

write(["-v", "ON_ERROR_STOP=1", "-q"], `
create table if not exists manual.okrsky_${mc} (
  ${mcnormCol} okrsok int, geom geometry(MultiPolygon,5514), edited_at timestamptz default now());
create unique index if not exists okrsky_${mc}_manual_key on manual.okrsky_${mc} (${keyCols});
${replace ? `truncate manual.okrsky_${mc};` : ""}
insert into manual.okrsky_${mc} (${keyCols}, geom)
select ${keyCols}, geom from _josm_stage
on conflict (${keyCols}) do update set geom = excluded.geom, edited_at = now();
drop table _josm_stage;
`);

const total = q(`select count(*) from manual.okrsky_${mc}`);
console.log(`\nwrote manual.okrsky_${mc} — ${rows.length} okrsky this run, ${total} held in total.`);
console.log(`Now rebuild the tiles so the map picks them up:  ./buildOkrskyTiles.sh`);
console.log(`To drop an override and fall back to the derived shape:`);
console.log(`  psql ${DB} -c "delete from manual.okrsky_${mc} where okrsok=<N>"`);
