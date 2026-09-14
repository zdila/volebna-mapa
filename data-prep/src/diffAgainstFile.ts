// Diff the CURRENT database against a JOSM working file, rather than against a DB checkpoint.
//
//   node src/diffAgainstFile.ts <mc> [file.geojson]
//     node src/diffAgainstFile.ts kosice                    # -> data/edit/kosice.geojson
//     node src/diffAgainstFile.ts kosice data/edit/kosice_zapad.geojson
//
// Writes <file>_changes.geojson holding only the address points whose okrsok differs from what
// that file already shows.
//
// This is the reliable baseline. A `before_`/`rN_` checkpoint records what the database looked
// like at some moment, which is only the same thing as "what you are editing" if you exported at
// exactly that moment and applied every diff since. The file itself carries no such assumption:
// it IS what you have open, so the answer is exact whatever you did or did not apply.
//
//   change=new     the file shows it unmatched (or absent); it now seeds an okrsok
//   change=moved   the file shows it in a DIFFERENT okrsok — influence moves between two
//                  precincts, so both their borders may need re-checking
//   change=lost    the file shows it seeding an okrsok but it no longer matches (a regression —
//                  this should normally be empty)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DB = "volebna";
// stderr dropped: this database emits a "collation version mismatch" WARNING on every connection.
const q = (sql: string) =>
  execFileSync("psql", [DB, "-tAqc", sql], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

const mc = process.argv[2];
if (!mc) {
  console.error("usage: node src/diffAgainstFile.ts <mc> [file.geojson]");
  process.exit(1);
}
const file = process.argv[3] ?? `data/edit/${mc}.geojson`;

const hasMcnorm =
  q(`select 1 from information_schema.columns where table_schema='public'
       and table_name='seeds_${mc}' and column_name='mcnorm'`) === "1";

// --- what the file shows, keyed by RA address id -------------------------------------------------
type Prev = { okrsok: number | null; mcnorm: string | null };
const prev = new Map<string, Prev>();
const fc = JSON.parse(readFileSync(file, "utf8")) as {
  features?: { properties?: Record<string, unknown> }[];
};
let pts = 0;
for (const f of fc.features ?? []) {
  const p = f.properties ?? {};
  // JOSM merges conflicting tag values with ";" when two nodes are combined — such a point is
  // ambiguous, so leave it out rather than guess which side it was on.
  const kind = String(p.kind ?? "");
  if (kind !== "seed" && kind !== "unmatched") continue;
  const raId = p.ra_id == null ? "" : String(p.ra_id);
  if (!raId || raId.includes(";")) continue;
  pts++;
  prev.set(raId, {
    okrsok: kind === "seed" && p.okrsok != null ? Number(String(p.okrsok).split(";")[0]) : null,
    mcnorm: p.mcnorm == null ? null : String(p.mcnorm).split(";")[0],
  });
}

// --- what the database says now -------------------------------------------------------------------
type Now = { ra_id: string; okrsok: number; mcnorm: string | null; props: Record<string, unknown>; geom: unknown };
const rows = q(`
  select json_build_array(
           json_build_object(
             'kind','seed', 'okrsok', s.okrsok, ${hasMcnorm ? "'mcnorm', s.mcnorm," : ""}
             'street', s.street, 'orient', s.orient, 'supisne', s.supisne, 'ra_id', s.ra_id,
             'name', trim(coalesce(s.street,'') || ' ' ||
                          coalesce(s.orient, 's.č. ' || s.supisne, ''))),
           st_asgeojson(st_transform(s.geom, 4326), 7)::json)
    from seeds_${mc} s where s.ra_id is not null`);

const out: { type: "Feature"; properties: Record<string, string>; geometry: unknown }[] = [];
const counts = { new: 0, moved: 0, lost: 0 };

for (const line of rows.split("\n").filter(Boolean)) {
  const [props, geom] = JSON.parse(line) as [Record<string, unknown>, unknown];
  const raId = String(props.ra_id);
  const before = prev.get(raId);
  if (!before) continue; // not in the file at all — nothing to reconcile

  const nowOkrsok = Number(props.okrsok);
  const nowMc = props.mcnorm == null ? null : String(props.mcnorm);
  let change: "new" | "moved" | null = null;
  if (before.okrsok == null) change = "new";
  else if (before.okrsok !== nowOkrsok || (hasMcnorm && before.mcnorm !== nowMc)) change = "moved";
  if (!change) continue;

  counts[change]++;
  const properties: Record<string, string> = { change };
  for (const [k, v] of Object.entries(props)) {
    if (v !== null && v !== undefined && v !== "") properties[k] = String(v);
  }
  if (change === "moved") {
    properties.from_okrsok = String(before.okrsok);
    if (before.mcnorm) properties.from_mcnorm = before.mcnorm;
  }
  out.push({ type: "Feature", properties, geometry: geom });
}

// A point the file shows as seeding an okrsok but which no longer matches at all is a REGRESSION —
// report it loudly even though it has no current geometry to draw.
const stillMatched = new Set(
  q(`select ra_id from seeds_${mc} where ra_id is not null`).split("\n").filter(Boolean),
);
const lost: string[] = [];
for (const [raId, before] of prev) {
  if (before.okrsok != null && !stillMatched.has(raId)) lost.push(raId);
}
counts.lost = lost.length;

const outFile = file.replace(/\.geojson$/, "") + "_changes.geojson";
writeFileSync(outFile, JSON.stringify({ type: "FeatureCollection", features: out }));

console.log(`baseline: ${file} (${pts} address points)`);
console.log(`wrote ${outFile}`);
console.log(`  change=new    ${counts.new}`);
console.log(`  change=moved  ${counts.moved}`);
console.log(`  lost          ${counts.lost}${counts.lost ? "   <-- REGRESSION, investigate" : ""}`);
if (lost.length) console.log(`  lost ra_id: ${lost.slice(0, 20).join(", ")}`);
