// Put the SURROUNDING municipalities' addresses into a JOSM working file, so an okrsok that
// reaches past the city boundary is visible instead of invisible.
//
//   node --experimental-strip-types src/addNeighbourSeeds.ts <mc> [file.geojson] \
//        [--ring data/ra_kosice_ring.geojson] [--boundary kosice_boundary] \
//        [--within=400] [--edge=5] [--clear] [--dry-run]
//
// The file's own checks can only ever say that an address is in the WRONG precinct — every address
// it knows about belongs to this city, so a border drawn far out into a neighbouring village looks
// perfectly fine. These points close that blind spot: they are Register adries addresses that are
// NOT this city's, added as `kind=neighbour`, never assigned to an okrsok. checkFile then flags any
// that a precinct has swallowed (`fixme=outside-address-inside-precinct`).
//
// Only points within `--within` metres of the drawn precincts are added — the rest are clutter.
// Re-running replaces the previous set, so the file cannot accumulate them; `--clear` just removes
// them and stops.
//
// Get the ring file first (bbox of the precincts plus a margin):
//   node --experimental-strip-types src/fetchRa.ts "<minx miny maxx maxy>" data/ra_kosice_ring.geojson
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { loadPolygons, lit, type Feature } from "./josmPolygons.ts";

const DB = "volebna";
const q = (sql: string) =>
  execFileSync("psql", [DB, "-F", "\t", "-Atc", sql], {
    encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const rows = (sql: string) => q(sql).split("\n").filter(Boolean).map((l) => l.split("\t"));

const argv = process.argv.slice(2);
const mc = argv[0];
if (!mc || mc.startsWith("--")) {
  console.error("usage: node src/addNeighbourSeeds.ts <mc> [file.geojson] [--ring f] [--within=400] [--clear] [--dry-run]");
  process.exit(1);
}
const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const dryRun = argv.includes("--dry-run");
const clearOnly = argv.includes("--clear");
const within = Number(flag("within") ?? 400);
// The city outline is a union of per-MČ boundary polygons that do not agree with each other to
// better than a metre or two (Bratislava's overlap each other by 28 226 m² in total), so strict
// containment misfiles addresses sitting right on the line: six Trnavská houses came out 0.6-1.7 m
// "outside" Bratislava and were reported as swallowed by Nové Mesto okrsok 4. Only count an
// address as foreign when it is clearly outside.
const edge = Number(flag("edge") ?? 5);
const boundaryIdx = argv.indexOf("--boundary");
const boundary = boundaryIdx >= 0 ? argv[boundaryIdx + 1] : `${mc}_boundary`;
const ringIdx = argv.indexOf("--ring");
const ring = ringIdx >= 0 ? argv[ringIdx + 1] : `data/ra_${mc}_ring.geojson`;
const file =
  argv.slice(1).find((a) => !a.startsWith("--") && a !== ring && a !== boundary) ??
  `data/edit/${mc}.geojson`;

const fc = JSON.parse(readFileSync(file, "utf8")) as { features: Feature[] };

// Drop any previous run's points first, so re-running is idempotent rather than cumulative.
const before = fc.features.length;
fc.features = fc.features.filter((f) => f.properties?.kind !== "neighbour");
const removed = before - fc.features.length;

const save = () => {
  if (dryRun) {
    console.log("\n--dry-run: file not modified.");
    return;
  }
  const bak = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 17)}`;
  copyFileSync(file, bak);
  writeFileSync(file, JSON.stringify(fc));
  console.log(`\nbackup: ${bak}\nupdated.`);
};

if (clearOnly) {
  console.log(`${file}\n  neighbour points removed : ${removed}`);
  save();
  process.exit(0);
}

loadPolygons(fc, mc, DB);

// What counts as "not this city" is the CITY BOUNDARY, not the set of ids already in the file.
// The file holds only the addresses the decree could place; everything it could not — a village's
// súpisné-only addresses, but also this city's own unnamed ones — would otherwise look foreign.
// Register adries itself carries no municipality name in the WFS response, so the polygon decides.
const BOUNDARY = `bnd`;
execFileSync("ogr2ogr", [
  "-f", "PostgreSQL", `PG:dbname=${DB}`, ring,
  "-nln", "_ra_ring", "-overwrite", "-t_srs", "EPSG:5514",
  "-lco", "GEOMETRY_NAME=geom", "-nlt", "POINT",
], { stdio: ["ignore", "ignore", "inherit"] });

const cand = rows(`
  with ${BOUNDARY} as (select st_union(geom) g from ${boundary})
  select r.ra_id, coalesce(r.street,''), coalesce(r.orient,''), coalesce(r.supisne,''),
         st_x(st_transform(r.geom,4326)), st_y(st_transform(r.geom,4326))
    from _ra_ring r
   where r.ra_id is not null
     and not st_dwithin((select g from ${BOUNDARY}), r.geom, ${edge})
     and exists (select 1 from _check_poly c where st_dwithin(c.geom, r.geom, ${within}))`);

let added = 0;
for (const [raId, street, orient, supisne, x, y] of cand) {
  const num = orient || supisne;
  fc.features.push({
    properties: {
      kind: "neighbour", ra_id: raId, street, orient, supisne,
      name: street ? `${street} ${num}`.trim() : num,
    },
    geometry: { type: "Point", coordinates: [Number(x), Number(y)] },
  } as Feature);
  added++;
}

console.log(file);
console.log(`  ring file                : ${ring}`);
console.log(`  city boundary            : ${boundary} (${edge} m tolerance)`);
console.log(`  outside-city addresses within ${within} m : ${added}${removed ? `   (replacing ${removed})` : ""}`);
save();
if (!dryRun) console.log(`Now run checkFile — a swallowed address shows as fixme=outside-address-inside-precinct.`);
