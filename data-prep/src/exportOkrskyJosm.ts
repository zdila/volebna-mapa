// Export one MČ for hand-editing in JOSM: okrsok polygons TOGETHER WITH the address points they
// were derived from, as a single GeoJSON FeatureCollection.
//
//   node src/exportOkrskyJosm.ts <mc> [--mc <mestska_cast>] [--okrsok 12,13] [--no-points]
//     node src/exportOkrskyJosm.ts lamac
//     node src/exportOkrskyJosm.ts kosice --mc zapad
//     node src/exportOkrskyJosm.ts petrzalka --okrsok 12,13,14
//
// Writes edit/<name>.geojson (WGS84). Everything carries a `kind` tag so JOSM's filters can
// show/hide each layer independently:
//
//   kind=okrsok      the polygon (src=derived | manual)
//   kind=seed        an address point that MATCHED — these are what the polygon was built from
//   kind=unmatched   an address point that did NOT match (reason=no-street|no-number|ambiguous)
//
// Useful JOSM filters (Filter panel, or Shift+F):
//   kind=seed              inverted+hide -> polygons only
//   kind=unmatched         show just the problem addresses
//   okrsok=12              one precinct and its points
//   kind=seed okrsok=12    that precinct's points only
//
// NB the tag key is `kind`, not `type` — `type` is reserved in the OSM data model (a multipart
// okrsok becomes a `type=multipolygon` relation, and overwriting that would break it).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const DB = "volebna";
// stderr is dropped: since the OS libc upgrade this database emits a "collation version mismatch"
// WARNING on every connection, which would bury the real output. (Clearing it for good needs
// REINDEX DATABASE + ALTER DATABASE ... REFRESH COLLATION VERSION — a separate decision.)
const q = (sql: string) =>
  execFileSync("psql", [DB, "-tAqc", sql], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const argv = process.argv.slice(2);
const mc = argv[0];
if (!mc || mc.startsWith("--")) {
  console.error("usage: node src/exportOkrskyJosm.ts <mc> [--mc <mestska_cast>] [--okrsok 1,2] [--no-points]");
  process.exit(1);
}
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const onlyMc = flag("mc");
const onlyOkrsok = flag("okrsok");
const noPoints = argv.includes("--no-points");

const exists = (schema: string, table: string) =>
  q(`select 1 from pg_tables where schemaname=${lit(schema)} and tablename=${lit(table)}`) === "1";
const hasCol = (table: string, col: string) =>
  q(`select 1 from information_schema.columns where table_schema='public'
       and table_name=${lit(table)} and column_name=${lit(col)}`) === "1";

if (!exists("public", `okrsky_${mc}`)) {
  console.error(`no okrsky_${mc} in '${DB}'`);
  process.exit(1);
}

// Košice keeps all 22 mestské časti in one table and restarts okrsok numbering in each, so its
// identity is (mcnorm, okrsok). Every other MČ is its own table and okrsok alone is enough.
const hasMcnorm = hasCol(`okrsky_${mc}`, "mcnorm");
if (onlyMc && !hasMcnorm) {
  console.error(`okrsky_${mc} has no mcnorm column — drop --mc`);
  process.exit(1);
}

const filters: string[] = [];
if (onlyMc) filters.push(`t.mcnorm = ${lit(onlyMc)}`);
if (onlyOkrsok) filters.push(`t.okrsok in (${onlyOkrsok.split(",").map((n) => Number(n.trim())).join(",")})`);
const where = filters.length ? `where ${filters.join(" and ")}` : "";

type Feature = { type: "Feature"; properties: Record<string, string>; geometry: unknown };

/** Rows of {props json, geom json} -> GeoJSON features, dropping empty tags (JOSM shows them). */
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

const mcnormSel = (alias: string) => (hasMcnorm ? `'mcnorm', ${alias}.mcnorm,` : "");

// --- polygons: prefer an existing hand-edit so a re-export round-trips your last save ----------
const manualJoin = exists("manual", `okrsky_${mc}`)
  ? `left join manual.okrsky_${mc} m on m.okrsok = t.okrsok${hasMcnorm ? " and m.mcnorm = t.mcnorm" : ""}`
  : "left join (select null::int okrsok, null::geometry geom) m on false";

const polys = rows(`
  select json_build_array(
           json_build_object(
             'kind','okrsok',
             -- JOSM decides Polygon vs LineString from the tags: `kind=okrsok` means nothing to
             -- it, so a perfectly good closed precinct is written back out as a LineString (872 of
             -- them in one Bratislava save). area=yes makes the closure explicit and keeps the
             -- round-trip Polygon -> area -> Polygon.
             'area','yes',
             'okrsok', t.okrsok,
             ${mcnormSel("t")}
             'src', case when m.geom is null then 'derived' else 'manual' end,
             'name', 'okrsok ' || t.okrsok),
           st_asgeojson(st_transform(coalesce(m.geom, t.geom), 4326), 7)::json)
    from okrsky_${mc} t ${manualJoin} ${where}
   order by ${hasMcnorm ? "t.mcnorm," : ""} t.okrsok`);

// --- address points ---------------------------------------------------------------------------
const pointRows = (table: string, kind: string, extra: string) => {
  // ra_id was added to the seed/unmatched tables later, so the cities labelled before that
  // (nitra, prešov, žilina) have no such column — selecting it blindly aborts the whole export.
  const raSel = hasCol(table, "ra_id") ? "t.ra_id" : "null::text";
  return !noPoints && exists("public", table)
    ? rows(`
        select json_build_array(
                 json_build_object(
                   'kind', ${lit(kind)},
                   ${mcnormSel("t")}
                   ${extra}
                   'street', t.street, 'orient', t.orient, 'supisne', t.supisne,
                   'ra_id', ${raSel},
                   'name', trim(coalesce(t.street,'') || ' ' ||
                                coalesce(t.orient, 's.č. ' || t.supisne, ''))),
                 st_asgeojson(st_transform(t.geom, 4326), 7)::json)
          from ${table} t ${where}`)
    : [];
};

const seeds = pointRows(`seeds_${mc}`, "seed", "'okrsok', t.okrsok,");
// unmatched has no okrsok (that is the point), so an --okrsok filter cannot apply to it
const unmatched = onlyOkrsok ? [] : pointRows(`unmatched_${mc}`, "unmatched", "'reason', t.reason,");

const features = [...polys, ...seeds, ...unmatched];
mkdirSync("edit", { recursive: true });
const name = onlyMc ? `${mc}_${onlyMc.replace(/\s+/g, "_")}` : mc;
const out = `edit/${name}.geojson`;
writeFileSync(out, JSON.stringify({ type: "FeatureCollection", features }));

console.log(`wrote ${out}`);
console.log(`  kind=okrsok     ${polys.length}`);
console.log(`  kind=seed       ${seeds.length}`);
console.log(`  kind=unmatched  ${unmatched.length}`);
console.log(`
In JOSM:
  1. open ${out}
  2. Validator (Shift+V) -> apply the "Duplicated nodes" fix FIRST. Neighbouring okrsky share
     exact vertices, but JOSM's GeoJSON reader gives each polygon its own copy; welding them
     makes each border shared, so dragging a node moves both precincts and cannot open a sliver.
  3. filter with e.g.  kind=seed  /  kind=unmatched  /  okrsok=12
  4. File > Save As > ${out}   (JOSM writes GeoJSON natively)
  5. node src/importOkrskyJosm.ts ${mc}
Keep the okrsok${hasMcnorm ? " and mcnorm tags" : " tag"} on every polygon — that is the identity
the import matches on. Points are ignored on import; edit them via seed_overrides.csv.`);
