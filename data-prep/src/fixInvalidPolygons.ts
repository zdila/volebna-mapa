// Repair invalid okrsok geometry in a JOSM working file, IN PLACE, without discarding the editing
// that produced it.
//
//   node src/fixInvalidPolygons.ts <mc> [file.geojson] [--dry-run]
//
// Simplification folds a thin lobe back through itself and the ring self-intersects; two pieces of
// one precinct end up sharing an edge; a border sweeps past its neighbour. None of that is visible
// at editing zoom — the faults are sub-metre — but each makes the precinct's area undefined, so
// every containment test against it becomes meaningless.
//
// Three repairs, in order, each the least destructive thing that can work:
//
//   1. a single WAY that is invalid            -> ST_MakeValid on that way alone
//   2. a precinct still invalid afterwards     -> union its parts into one feature. This is the
//      (its pieces touch along a line)            edge-touching case: the pieces are the same
//                                                 precinct, so merging them loses nothing
//   3. two precincts overlapping               -> subtract the overlap from the side that has NO
//                                                 seeds in it. If both or neither have seeds the
//                                                 answer is a judgement call, so it is reported
//                                                 and left alone
//
// Geometry is never taken from the derivation: a repaired precinct keeps the shape you gave it,
// minus the fold. Every repaired feature is tagged `fixed=<what was done>` so you can filter to
// them in JOSM and check the result. Run checkFile afterwards.
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const DB = "volebna";
const q = (sql: string) =>
  execFileSync("psql", [DB, "-F", "\t", "-Atc", sql], {
    encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const rows = (sql: string) => q(sql).split("\n").filter(Boolean).map((l) => l.split("\t"));

const mc = process.argv[2];
if (!mc || mc.startsWith("--")) {
  console.error("usage: node src/fixInvalidPolygons.ts <mc> [file.geojson] [--dry-run]");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const file = process.argv.slice(3).find((a) => !a.startsWith("--")) ?? `data/edit/${mc}.geojson`;

type Feature = { properties?: Record<string, unknown>; geometry?: { type: string; coordinates?: unknown } };
const fc = JSON.parse(readFileSync(file, "utf8")) as { features: Feature[] };

// --- load every okrsok feature, keyed by its index in the file ------------------------------------
const vals: string[] = [];
const wasLoaded = new Set<number>();
fc.features.forEach((f, idx) => {
  const p = f.properties;
  if (p?.kind !== "okrsok") return;
  let g = f.geometry;
  if (g?.type === "LineString") {
    const c = g.coordinates as number[][];
    if (c.length < 4 || c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1]) return;
    g = { type: "Polygon", coordinates: [c] };
  }
  if (g?.type !== "Polygon" && g?.type !== "MultiPolygon") return;
  wasLoaded.add(idx);
  vals.push(`(${idx}, $m$${p.mcnorm ?? mc}$m$, ${Number(p.okrsok)},
     st_transform(st_setsrid(st_geomfromgeojson($g$${JSON.stringify(g)}$g$),4326),5514))`);
});

execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-q"], {
  input: `drop table if exists _fix;
          create table _fix (idx int, mcnorm text, okrsok int, g geometry, orig geometry);
          insert into _fix (idx, mcnorm, okrsok, g) values ${vals.join(",")};
          update _fix set orig = g;
          create index on _fix using gist(g);
          -- 1. way-level repair
          update _fix set g = st_collectionextract(st_makevalid(g), 3) where not st_isvalid(g);`,
  stdio: ["pipe", "pipe", "ignore"],
});

const step1 = rows(`select idx, mcnorm, okrsok from _fix where not st_equals(g, orig)`);

// 2. precincts whose parts touch along a line: union them into one.
const merge = rows(`
  select mcnorm, okrsok, count(*)
    from _fix group by mcnorm, okrsok
   having count(*) > 1 and not st_isvalid(st_collect(g))`);
if (merge.length) {
  execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-q"], {
    input: merge
      .map(([m, o]) => `update _fix f set g = (select st_union(g) from _fix x
                          where x.mcnorm=$m$${m}$m$ and x.okrsok=${o})
                        where f.mcnorm=$m$${m}$m$ and f.okrsok=${o}
                          and f.idx = (select min(idx) from _fix x
                                        where x.mcnorm=$m$${m}$m$ and x.okrsok=${o});
                        delete from _fix
                         where mcnorm=$m$${m}$m$ and okrsok=${o}
                           and idx <> (select min(idx) from _fix x
                                        where x.mcnorm=$m$${m}$m$ and x.okrsok=${o});`)
      .join("\n"),
    stdio: ["pipe", "pipe", "ignore"],
  });
}

// 3. overlaps between DIFFERENT precincts: give the ground to whichever side has seeds in it.
const seedTable = q(`select 1 from pg_tables where tablename='seeds_${mc}'`) === "1" ? `seeds_${mc}` : "";
const overlaps = rows(`
  with p as (select mcnorm, okrsok, st_union(g) g from _fix group by mcnorm, okrsok),
  o as (select a.mcnorm am, a.okrsok ao, b.mcnorm bm, b.okrsok bo,
               st_intersection(a.g, b.g) ov
          from p a join p b on (a.mcnorm, a.okrsok) < (b.mcnorm, b.okrsok)
         where st_isvalid(a.g) and st_isvalid(b.g) and st_area(st_intersection(a.g, b.g)) > 1)
  select am, ao, bm, bo, round(st_area(ov)::numeric, 0),
         ${seedTable ? `(select count(*) from ${seedTable} s where s.mcnorm=am and s.okrsok=ao and st_contains(ov, s.geom))` : "0"},
         ${seedTable ? `(select count(*) from ${seedTable} s where s.mcnorm=bm and s.okrsok=bo and st_contains(ov, s.geom))` : "0"}
    from o`);

const trimmed: string[] = [];
const tidied: string[] = [];
const undecided: string[] = [];
const tidyFlag = process.argv.find((x) => x.startsWith("--tidy-slivers="));
const tidy = tidyFlag ? Number(tidyFlag.split("=")[1]) : 100;
for (const [am, ao, bm, bo, area, na, nb] of overlaps) {
  const a = Number(na), b = Number(nb);
  // The side with seeds in the disputed ground owns it; the other has over-reached.
  let loser = a === 0 && b > 0 ? [am, ao] : b === 0 && a > 0 ? [bm, bo] : null;
  // Neither side has an address in the disputed ground and it is tiny: nobody's vote depends on
  // who owns it, but leaving it makes the precincts a non-partition and flags forever. Give it to
  // the lower-numbered okrsok, deterministically. Same mestská časť only — an overlap ACROSS a
  // borough boundary comes from the _bnd polygons disagreeing with each other, which is a source
  // defect to see, not to paper over.
  if (!loser) {
    undecided.push(`${am} okr ${ao} vs ${bm} okr ${bo} — ${area} m2, seeds ${a}/${b}`);
    continue;
  }
  const [wm, wo] = loser[0] === am && loser[1] === ao ? [bm, bo] : [am, ao];
  execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-q"], {
    input: `update _fix f set g = st_collectionextract(st_makevalid(st_difference(f.g,
              (select st_union(g) from _fix x where x.mcnorm=$m$${wm}$m$ and x.okrsok=${wo}))), 3)
             where f.mcnorm=$m$${loser[0]}$m$ and f.okrsok=${loser[1]};
            delete from _fix where mcnorm=$m$${loser[0]}$m$ and okrsok=${loser[1]} and st_isempty(g);`,
    stdio: ["pipe", "pipe", "ignore"],
  });
  trimmed.push(`${loser[0]} okr ${loser[1]} — ${area} m2 given to ${wm} okr ${wo} (${Math.max(a, b)} seeds there)`);
}

// What is left are precincts that overlap with NO address in the disputed ground. Those are NOT
// repaired here, on purpose. Two attempts failed and both made the file worse:
//   * subtracting pairwise oscillates — where three precincts meet in one sliver, taking it off
//     one hands it to the next pair (4 features rewritten per pass, forever);
//   * sweeping a whole MČ in okrsok order and subtracting everything already claimed turns
//     neighbours that merely TOUCH into differences, because after simplification their shared
//     borders are no longer bit-identical. That shaved real slivers off dozens of precincts and
//     introduced fresh self-intersections: 14 flagged precincts became 42.
// They are slivers of empty ground a metre or two across, most of them across a borough boundary
// where the _bnd polygons disagree with each other. Leaving them visible beats corrupting good
// geometry to silence them.

// --- write the repaired geometry back -------------------------------------------------------------
// Only features whose geometry PostGIS actually changed. Re-serialising the rest would rewrite
// every coordinate at 7 decimals and silently perturb polygons nobody asked to touch.
const out = new Map<number, string>();
for (const [idx, gj] of rows(
  `select idx, st_asgeojson(st_transform(g,4326),7) from _fix where not st_equals(g, orig)`,
)) out.set(Number(idx), gj);
const loaded = new Set(
  rows(`select idx from _fix`).map((r) => Number(r[0])),
);

// What was done to each precinct, so the tag says which repair it was.
const fixKind = new Map<string, string>();
for (const [, m, o] of step1) fixKind.set(`${m}#${o}`, "makevalid");
for (const [m, o] of merge) fixKind.set(`${m}#${o}`, "merged-touching-parts");
for (const t of trimmed) {
  const g = t.match(/^(\S+) okr (\d+)/);
  if (g) fixKind.set(`${g[1]}#${g[2]}`, "overlap-trimmed");
}

let changed = 0;
let dropped = 0;
const keep: Feature[] = [];
fc.features.forEach((f, idx) => {
  const p = f.properties;
  if (p?.kind !== "okrsok") { keep.push(f); return; }
  const gj = out.get(idx);
  if (gj === undefined) {
    // Present in _fix and unchanged -> leave the feature exactly as it is.
    // Absent from _fix but it WAS loaded -> it was merged into a sibling, so drop it.
    if (!loaded.has(idx) && wasLoaded.has(idx)) { dropped++; return; }
    keep.push(f);
    return;
  }
  f.geometry = JSON.parse(gj) as Feature["geometry"];
  // So a repaired precinct can be found and eyeballed afterwards: JOSM filter `fixed=*`.
  // Never cleared automatically — it is a record of what this tool touched, and only you know
  // when you have satisfied yourself that the repair was right.
  p.fixed = fixKind.get(`${p.mcnorm ?? mc}#${p.okrsok}`) ?? "geometry";
  changed++;
  keep.push(f);
});
fc.features = keep;

console.log(file);
console.log(`  ways repaired (ST_MakeValid)   : ${step1.length}`);
for (const [, m, o] of step1) console.log(`      ${m} okr ${o}`);
console.log(`  precincts merged (touching)    : ${merge.length}`);
for (const [m, o, n] of merge) console.log(`      ${m} okr ${o} — ${n} features -> 1`);
console.log(`  overlaps resolved by seeds     : ${trimmed.length}`);
for (const t of trimmed) console.log(`      ${t}`);

if (undecided.length) {
  console.log(`  overlaps NOT resolved          : ${undecided.length}   <-- your call`);
  for (const u of undecided) console.log(`      ${u}`);
}
console.log(`  features rewritten             : ${changed}`);
console.log(`  features removed by merging    : ${dropped}`);

if (dryRun) { console.log("\n--dry-run: file not modified."); process.exit(0); }
// Seconds included: two tools writing in the same minute would otherwise share a backup name and
// the second would overwrite the first — which happened, and cost the only pre-repair snapshot.
const bak = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 17)}`;
copyFileSync(file, bak);
writeFileSync(file, JSON.stringify(fc));
console.log(`\nbackup: ${bak}\nupdated. Reload in JOSM, then run checkFile.`);
