// Generic seed labeller for one MČ — fully DB-in / DB-out, no GeoJSON intermediates.
// Reads the in-boundary street points from a loaded RA table, matches each to its okrsok, and
// writes seeds_<mc> + unmatched_<mc> straight into PostGIS, plus a seed_stats upsert row.
// Usage: node src/labelMc.ts <mcNorm> <assignment.json> <ra_table> <bnd_table>
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { norm, streetKey } from "./normalize.ts";
import { buildIndex, match, type Address, type OkrsokRow } from "./matcher.ts";

const [mcNorm, asgPath, raTable, bndTable] = process.argv.slice(2);
if (!mcNorm || !asgPath || !raTable || !bndTable) {
  console.error("usage: node src/labelMc.ts <mcNorm> <assignment.json> <ra_table> <bnd_table>");
  process.exit(1);
}
const DB = "volebna";
const q = (sql: string) => execFileSync("psql", [DB, "-tAqc", sql], { encoding: "utf8", maxBuffer: 1 << 30 });
const exec = (sql: string) => execFileSync("psql", [DB, "-qc", sql], { encoding: "utf8" });
// Load a set of point features straight into PostGIS via ogr2ogr reading GeoJSON from stdin.
const loadPoints = (table: string, features: object[], emptyCols: string) => {
  if (!features.length) { exec(`drop table if exists ${table}; create table ${table} (${emptyCols}, geom geometry(Point,5514))`); return; }
  execFileSync("ogr2ogr", ["-f", "PostgreSQL", `PG:dbname=${DB}`, "/vsistdin/", "-nln", table, "-overwrite", "-t_srs", "EPSG:5514", "-lco", "GEOMETRY_NAME=geom", "-nlt", "POINT"],
    { input: JSON.stringify({ type: "FeatureCollection", features }), maxBuffer: 1 << 30 });
};
const feat = (lon: number, lat: number, properties: object) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties });

const rows = JSON.parse(readFileSync(asgPath, "utf8")) as OkrsokRow[];
const idx = buildIndex(rows);

// In-boundary street points from the DB (lon/lat in WGS84).
type Pt = { ra_id: string | null; street: string; orient: string | null; supisne: string | null; lon: number; lat: number };
// ra_id (RA address-point id = OSM ref:minvskaddress) is optional — older RA tables lack it.
const hasRaId = q(`select 1 from information_schema.columns where table_schema='public' and table_name='${raTable.toLowerCase()}' and column_name='ra_id' limit 1`).trim() === "1";
const raIdSel = hasRaId ? "r.ra_id," : "null::text ra_id,";
const pts = JSON.parse(q(
  `select coalesce(json_agg(row_to_json(t)),'[]') from (
     select ${raIdSel} r.street, r.orient, r.supisne,
            st_x(st_transform(r.geom,4326)) lon, st_y(st_transform(r.geom,4326)) lat
     from ${raTable} r join ${bndTable} b on st_contains(b.geom, r.geom)
     where r.street is not null and r.street <> '') t`).trim()) as Pt[];

const seedFeats: object[] = [];
const missFeats: object[] = [];
const stat = { total: 0, ok: 0, noStreet: 0, noNumber: 0, ambiguous: 0 };
const seeded = new Set<number>();
const unmatched = new Map<string, number>();
const raStreetPts = new Map<string, number>(); // streetKey -> # RA points (reverse-coverage)
const matchCount = new Map<OkrsokRow, number>(); // assignment row -> # RA points it matched

for (const p of pts) {
  stat.total++;
  raStreetPts.set(streetKey(norm(p.street)), (raStreetPts.get(streetKey(norm(p.street))) ?? 0) + 1);
  const res = match(idx, { mcNorm, streetNorm: norm(p.street), orient: p.orient, supisne: p.supisne } as Address);
  if (res.status === "ok") {
    stat.ok++;
    seeded.add(res.row.okrsok);
    matchCount.set(res.row, (matchCount.get(res.row) ?? 0) + 1);
    seedFeats.push(feat(p.lon, p.lat, { okrsok: res.row.okrsok, ra_id: p.ra_id, street: p.street, orient: p.orient, supisne: p.supisne }));
  } else {
    if (res.status === "no-street") stat.noStreet++;
    else if (res.status === "no-number") stat.noNumber++;
    else stat.ambiguous++;
    unmatched.set(p.street, (unmatched.get(p.street) ?? 0) + 1);
    missFeats.push(feat(p.lon, p.lat, { reason: res.status, ra_id: p.ra_id, street: p.street, orient: p.orient, supisne: p.supisne }));
  }
}

loadPoints(`seeds_${mcNorm}`, seedFeats, "okrsok int, ra_id text, street text, orient text, supisne text");
loadPoints(`unmatched_${mcNorm}`, missFeats, "reason text, ra_id text, street text, orient text, supisne text");

// Reverse coverage: assignment entries that matched NO RA point. ra_pts_on_street=0 means the
// document's street name isn't found in RA (name mismatch / missing); >0 means the street exists
// but this entry's number spec matched nothing (numbers absent from RA — demolished/planned/typo).
const esc = (s: string) => (s ?? "").replace(/'/g, "''");
const uncovered = rows.filter((r) => r.cls !== "INSTITUTION" && r.streetNorm && !matchCount.get(r));
let uSql = `drop table if exists uncovered_${mcNorm}; create table uncovered_${mcNorm} (okrsok int, street text, cls text, ra_pts_on_street int, src text);`;
if (uncovered.length)
  uSql += `insert into uncovered_${mcNorm} (okrsok,street,cls,ra_pts_on_street,src) values ` +
    uncovered.map((r) => `(${r.okrsok}, '${esc(r.street)}', '${r.cls}', ${raStreetPts.get(streetKey(r.streetNorm)) ?? 0}, '${esc((r as { srcSpadove?: string }).srcSpadove ?? "")}')`).join(",") + ";";
exec(uSql);

const allOkr = new Set(rows.map((r) => r.okrsok));
const pct = ((100 * stat.ok) / stat.total).toFixed(1);
exec(`insert into seed_stats (mc, okrsky, okrsky_seeded, street_pts, matched, no_street, no_number, ambiguous, match_pct)
      values ('${mcNorm}', ${allOkr.size}, ${seeded.size}, ${stat.total}, ${stat.ok}, ${stat.noStreet}, ${stat.noNumber}, ${stat.ambiguous}, ${pct})
      on conflict (mc) do update set okrsky=excluded.okrsky, okrsky_seeded=excluded.okrsky_seeded, street_pts=excluded.street_pts,
        matched=excluded.matched, no_street=excluded.no_street, no_number=excluded.no_number, ambiguous=excluded.ambiguous, match_pct=excluded.match_pct`);

const unseeded = [...allOkr].filter((o) => !seeded.has(o)).sort((a, b) => a - b);
console.log(`${mcNorm}: ${stat.total} pts | ok=${stat.ok} (${pct}%) no-street=${stat.noStreet} no-number=${stat.noNumber} amb=${stat.ambiguous} | okrsky seeded ${seeded.size}/${allOkr.size}`);
if (unseeded.length) console.log(`unseeded okrsky: ${unseeded.join(",")}`);
console.log(`wrote seeds_${mcNorm} (${seedFeats.length}), unmatched_${mcNorm} (${missFeats.length}), uncovered_${mcNorm} (${uncovered.length}), seed_stats['${mcNorm}']`);
if (uncovered.length) {
  const nameMiss = uncovered.filter((r) => !(raStreetPts.get(streetKey(r.streetNorm)) ?? 0));
  console.log(`uncovered assignment entries: ${uncovered.length}  (of which ${nameMiss.length} are streets not found in RA at all — name mismatch / missing)`);
}
console.log("top unmatched:");
for (const [s, n] of [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(3)}  ${s}`);
