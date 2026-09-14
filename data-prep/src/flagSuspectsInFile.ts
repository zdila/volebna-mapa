// Tag suspicious address points in a JOSM working file so they can be filtered and eyeballed.
//
//   node src/flagSuspectsInFile.ts <mc> [file.geojson] [--dry-run]
//
// Adds a `check` tag to seeds worth a second look, and a `seeds` count to every okrsok polygon.
// Only address points are rewritten; the hand-drawn polygons keep their geometry untouched (they
// gain the `seeds` tag only). A timestamped .bak is written first.
//
//   check=enclave    the seed sits INSIDE a different precinct's polygon, as you have drawn it.
//                    Either that border is wrong or the address is assigned to the wrong okrsok.
//                    `in_okrsok` names the polygon it actually falls in.
//   check=isolated   the nearest other seed of the SAME okrsok is far away (default 400 m).
//                    `isolated_m` gives the distance. Long rural streets do this legitimately —
//                    Čermeľské údolie really is 3 km from the rest of its okrsok — so this is a
//                    prompt to look, not a verdict.
//
// JOSM filters:  check=enclave  /  check=isolated  /  seeds=1  /  check=*
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const DB = "volebna";
const q = (sql: string) =>
  execFileSync("psql", [DB, "-tAqc", sql], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

const mc = process.argv[2];
if (!mc || mc.startsWith("--")) {
  console.error("usage: node src/flagSuspectsInFile.ts <mc> [file.geojson] [--dry-run]");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const file = process.argv.slice(3).find((a) => !a.startsWith("--")) ?? `data/edit/${mc}.geojson`;
const ISOLATED_M = 400;

if (q(`select 1 from pg_tables where schemaname='public' and tablename='_josm_check'`) !== "1") {
  console.error("_josm_check not loaded — it holds the polygons read from this file (see the session notes)");
  process.exit(1);
}

// A seed inside a DIFFERENT precinct's polygon.
const enclave = new Map<string, string>();
for (const line of q(`
  select s.ra_id || chr(9) || c.okrsok
    from seeds_${mc} s join _josm_check c
      on c.mcnorm = s.mcnorm and st_contains(c.geom, s.geom)
   where c.okrsok <> s.okrsok and s.ra_id is not null`).split("\n")) {
  if (!line) continue;
  const [raId, inOkrsok] = line.split("\t");
  enclave.set(raId, inOkrsok);
}

// A seed far from the nearest other seed of its own okrsok.
const isolated = new Map<string, string>();
for (const line of q(`
  select s.ra_id || chr(9) || round((
           select min(st_distance(s.geom, t.geom)) from seeds_${mc} t
            where t.mcnorm = s.mcnorm and t.okrsok = s.okrsok and t.ctid <> s.ctid)::numeric)
    from seeds_${mc} s where s.ra_id is not null`).split("\n")) {
  if (!line) continue;
  const [raId, d] = line.split("\t");
  if (d && Number(d) >= ISOLATED_M) isolated.set(raId, d);
}

// How many seeds each precinct actually has.
const seedCount = new Map<string, string>();
for (const line of q(`
  select mcnorm || chr(9) || okrsok || chr(9) || count(*)
    from seeds_${mc} group by mcnorm, okrsok`).split("\n")) {
  if (!line) continue;
  const [mcn, okrsok, n] = line.split("\t");
  seedCount.set(`${mcn}#${okrsok}`, n);
}

type Feature = { properties?: Record<string, unknown> };
const fc = JSON.parse(readFileSync(file, "utf8")) as { features: Feature[] };
const counts = { enclave: 0, isolated: 0, polygons: 0, sparse: 0 };

for (const f of fc.features) {
  const p = f.properties ?? (f.properties = {});
  const kind = String(p.kind ?? "");

  if (kind === "okrsok") {
    const n = seedCount.get(`${p.mcnorm}#${p.okrsok}`) ?? "0";
    p.seeds = n;
    if (Number(n) <= 3) counts.sparse++;
    counts.polygons++;
    continue;
  }
  if (kind !== "seed") continue;

  delete p.check;
  delete p.in_okrsok;
  delete p.isolated_m;

  const raId = p.ra_id == null ? "" : String(p.ra_id);
  if (!raId || raId.includes(";")) continue;

  const inOkrsok = enclave.get(raId);
  const dist = isolated.get(raId);
  if (inOkrsok) {
    p.check = "enclave";
    p.in_okrsok = inOkrsok;
    counts.enclave++;
  } else if (dist) {
    p.check = "isolated";
    p.isolated_m = dist;
    counts.isolated++;
  }
}

console.log(`${file}`);
console.log(`  check=enclave   : ${counts.enclave}  (seed inside another precinct's polygon)`);
console.log(`  check=isolated  : ${counts.isolated}  (>= ${ISOLATED_M} m from its own okrsok's nearest seed)`);
console.log(`  polygons tagged with seed count: ${counts.polygons}  (${counts.sparse} have <= 3 seeds)`);

if (dryRun) {
  console.log("\n--dry-run: file not modified.");
  process.exit(0);
}
const bak = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
copyFileSync(file, bak);
writeFileSync(file, JSON.stringify(fc));
console.log(`\nbackup: ${bak}\nupdated. In JOSM reload, then filter  check=enclave  /  check=isolated  /  seeds=1`);
