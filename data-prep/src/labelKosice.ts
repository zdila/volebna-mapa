// Label Košice RA street points with their okrsok — DB-in / DB-out, no GeoJSON intermediates.
// Each point gets its mcnorm by point-in-polygon against the cadastral MČ boundaries (kosice_mc),
// is matched to an okrsok, and lands in seeds_kosice / unmatched_kosice, with a seed_stats row.
// Usage: node src/labelKosice.ts   (reads ra_kosice_all ⋈ kosice_mc)
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { norm, streetKey } from "./normalize.ts";
import { buildIndex, match, type Address, type OkrsokRow } from "./matcher.ts";

const DB = "volebna";
const q = (sql: string) => execFileSync("psql", [DB, "-tAqc", sql], { encoding: "utf8", maxBuffer: 1 << 30 });
const exec = (sql: string) => execFileSync("psql", [DB, "-qc", sql], { encoding: "utf8" });
const loadPoints = (table: string, features: object[]) => {
  if (!features.length) return;
  execFileSync("ogr2ogr", ["-f", "PostgreSQL", `PG:dbname=${DB}`, "/vsistdin/", "-nln", table, "-overwrite", "-t_srs", "EPSG:5514", "-lco", "GEOMETRY_NAME=geom", "-nlt", "POINT"],
    { input: JSON.stringify({ type: "FeatureCollection", features }), maxBuffer: 1 << 30 });
};
const feat = (lon: number, lat: number, properties: object) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties });

const rows = JSON.parse(readFileSync("data/kosice_okrsok_streets.json", "utf8")) as OkrsokRow[];
const idx = buildIndex(rows);

// Street points with their MČ (PIP against kosice_mc), lon/lat in WGS84.
// ra_id (RA address-point id = OSM ref:minvskaddress) is optional — older RA tables lack it.
type Pt = { mcnorm: string; ra_id: string | null; street: string; orient: string | null; supisne: string | null; lon: number; lat: number };
const hasRaId = q(`select 1 from information_schema.columns where table_schema='public' and table_name='ra_kosice_all' and column_name='ra_id' limit 1`).trim() === "1";
const raIdSel = hasRaId ? "r.ra_id," : "null::text ra_id,";
const pts = JSON.parse(q(
  `select coalesce(json_agg(row_to_json(t)),'[]') from (
     select m.mcnorm, ${raIdSel} r.street, r.orient, r.supisne,
            st_x(st_transform(r.geom,4326)) lon, st_y(st_transform(r.geom,4326)) lat
     from ra_kosice_all r join kosice_mc m on st_contains(m.geom, r.geom)
     where r.street is not null and r.street <> '') t`).trim()) as Pt[];

type Stat = { total: number; ok: number; noStreet: number; noNumber: number; ambiguous: number };
const perMc = new Map<string, Stat>();
const bump = (mc: string): Stat => perMc.get(mc) ?? perMc.set(mc, { total: 0, ok: 0, noStreet: 0, noNumber: 0, ambiguous: 0 }).get(mc)!;

const seedFeats: object[] = [];
const missFeats: object[] = [];
const seeded = new Set<string>();
const raStreetPts = new Map<string, number>(); // "mcnorm streetKey" -> # RA points
const matchCount = new Map<OkrsokRow, number>();

for (const p of pts) {
  const st = bump(p.mcnorm);
  st.total++;
  const rk = `${p.mcnorm} ${streetKey(norm(p.street))}`;
  raStreetPts.set(rk, (raStreetPts.get(rk) ?? 0) + 1);
  const res = match(idx, { mcNorm: p.mcnorm, streetNorm: norm(p.street), orient: p.orient, supisne: p.supisne } as Address);
  if (res.status === "ok") {
    st.ok++;
    seeded.add(`${p.mcnorm}#${res.row.okrsok}`);
    matchCount.set(res.row, (matchCount.get(res.row) ?? 0) + 1);
    seedFeats.push(feat(p.lon, p.lat, { mcnorm: p.mcnorm, okrsok: res.row.okrsok, obvod: res.row.obvod, ra_id: p.ra_id, street: p.street, orient: p.orient, supisne: p.supisne }));
  } else {
    if (res.status === "no-street") st.noStreet++;
    else if (res.status === "no-number") st.noNumber++;
    else st.ambiguous++;
    missFeats.push(feat(p.lon, p.lat, { mcnorm: p.mcnorm, reason: res.status, ra_id: p.ra_id, street: p.street, orient: p.orient, supisne: p.supisne }));
  }
}

loadPoints("seeds_kosice", seedFeats);
loadPoints("unmatched_kosice", missFeats);

// Reverse coverage: assignment entries (per MČ) that matched no RA point. See labelMc.ts.
const esc = (s: string) => (s ?? "").replace(/'/g, "''");
const uncovered = rows.filter((r) => r.cls !== "INSTITUTION" && r.streetNorm && !matchCount.get(r));
let uSql = `drop table if exists uncovered_kosice; create table uncovered_kosice (mcnorm text, okrsok int, street text, cls text, ra_pts_on_street int, src text);`;
if (uncovered.length)
  uSql += `insert into uncovered_kosice (mcnorm,okrsok,street,cls,ra_pts_on_street,src) values ` +
    uncovered.map((r) => `('${esc(r.mcNorm)}', ${r.okrsok}, '${esc(r.street)}', '${r.cls}', ${raStreetPts.get(`${r.mcNorm} ${streetKey(r.streetNorm)}`) ?? 0}, '${esc((r as { srcSpadove?: string }).srcSpadove ?? "")}')`).join(",") + ";";
exec(uSql);

const tot = { total: 0, ok: 0, noStreet: 0, noNumber: 0, ambiguous: 0 };
for (const s of perMc.values()) for (const k of Object.keys(tot) as (keyof Stat)[]) tot[k] += s[k];
const okrskyTotal = new Set(rows.map((r) => `${r.mcNorm}#${r.okrsok}`)).size;
const pct = ((100 * tot.ok) / tot.total).toFixed(1);
exec(`insert into seed_stats (mc, okrsky, okrsky_seeded, street_pts, matched, no_street, no_number, ambiguous, match_pct)
      values ('kosice', ${okrskyTotal}, ${seeded.size}, ${tot.total}, ${tot.ok}, ${tot.noStreet}, ${tot.noNumber}, ${tot.ambiguous}, ${pct})
      on conflict (mc) do update set okrsky=excluded.okrsky, okrsky_seeded=excluded.okrsky_seeded, street_pts=excluded.street_pts,
        matched=excluded.matched, no_street=excluded.no_street, no_number=excluded.no_number, ambiguous=excluded.ambiguous, match_pct=excluded.match_pct`);

console.log(`Košice: ${tot.total} street pts | matched ok=${tot.ok} (${pct}%) | no-street=${tot.noStreet} no-number=${tot.noNumber} amb=${tot.ambiguous}`);
const nameMiss = uncovered.filter((r) => !(raStreetPts.get(`${r.mcNorm} ${streetKey(r.streetNorm)}`) ?? 0));
console.log(`wrote seeds_kosice (${seedFeats.length}), unmatched_kosice (${missFeats.length}), uncovered_kosice (${uncovered.length}; ${nameMiss.length} streets not in RA), seed_stats['kosice']`);
console.log("per-MČ match rate (lowest first):");
for (const [mc, s] of [...perMc].sort((a, b) => a[1].ok / a[1].total - b[1].ok / b[1].total).slice(0, 8))
  console.log(`  ${((100 * s.ok) / s.total).toFixed(1).padStart(5)}%  ${String(s.ok).padStart(4)}/${String(s.total).padEnd(4)}  ${mc}`);
