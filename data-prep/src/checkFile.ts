// Check a JOSM working file for geometry and assignment problems, and write `fixme` tags into it.
//
//   node src/checkFile.ts <mc> [file.geojson] [--dry-run]
//     node src/checkFile.ts kosice
//
// The file is SELF-CONTAINED: both the okrsok polygons and the address points are read straight out
// of it, loaded into scratch PostGIS tables and cross-checked against each other. Nothing is
// compared against the database — a seed you have dragged to its true position is the position the
// check uses, and a seed you have re-tagged is the assignment the check uses. Anything wrong gets a
// `fixme` tag describing it, so JOSM can filter to exactly the problems:  fixme=*
//
// On POLYGONS:
//   fixme=not-an-area-unclosed-linestring
//                                the way is not closed, so the precinct has no interior at all and
//                                every address in it reports as outside all precincts. A CLOSED
//                                way written as a LineString is fine — JOSM does that whenever the
//                                tags do not imply an area, which `kind=okrsok` does not.
//   fixme=self-intersection      the ring crosses itself (JOSM: Validator > Self-intersecting way)
//   fixme=overlaps-okrsok-N      two precincts claim the same ground
//
// On SEEDS:
// A seed tagged `ignore=yes` (a mall, a school — a building whose position says nothing about
// where a border belongs) is excused these checks, UNLESS the decree names its house number, in
// which case the assignment is deliberate and still has to hold.
//
//   fixme=ignored-but-explicit   tagged ignore=yes, but the decree names its house number
//   fixme=wrong-side-of-border   the address sits inside a DIFFERENT precinct's polygon — in any
//                                mestská časť, not just its own. Either that border is wrong, or
//                                the address is assigned to the wrong okrsok.
// On NEIGHBOUR points (addresses of the surrounding municipalities, added by addNeighbourSeeds.ts):
//   fixme=outside-address-inside-precinct
//                                a house that does not belong to this city falls inside one of
//                                your precincts — that border reaches too far out
//
//   fixme=outside-all-precincts  the address is in no precinct at all — usually a border that
//                                needs extending, or a seed excluded from the derivation.
//
// The `change` tags written by applyChangesToFile are left alone: they say what MOVED, this says
// what is WRONG, and the two are independent. Both are cleared and recomputed on each run, so a
// tag always describes the current state rather than accumulating.
//
// ⚠️ Save and close the file in JOSM first — JOSM keeps its own copy in memory.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { backupFile } from "./fileBackup.ts";
import { readdirSync } from "node:fs";
import { loadPolygons, lit, polyKey, type Feature } from "./josmPolygons.ts";
import { norm, streetKey } from "./normalize.ts";

const DB = "volebna";
const q = (sql: string) =>
  execFileSync("psql", [DB, "-F", "\t", "-Atc", sql], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const mc = process.argv[2];
if (!mc || mc.startsWith("--")) {
  console.error("usage: node src/checkFile.ts <mc> [file.geojson] [--dry-run]");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const file = process.argv.slice(3).find((a) => !a.startsWith("--")) ?? `edit/${mc}.geojson`;

const fc = JSON.parse(readFileSync(file, "utf8")) as { features: Feature[] };

const key = (p: Record<string, unknown>) => polyKey(p, mc);

// --- load the file's polygons into a scratch table -----------------------------------------------
const { notArea } = loadPolygons(fc, mc, DB);

// The address points come from the file as well. Identity is the feature INDEX, not `ra_id`: an
// index is always present and always unique, so a point with no id, or two nodes JOSM merged into
// one, still get checked and still get their tag written back to the right feature.
const seedRows: string[] = [];
fc.features.forEach((f, i) => {
  const p = f.properties;
  if (p?.kind !== "seed" || p.okrsok == null) return;
  const c = f.geometry?.type === "Point" ? (f.geometry.coordinates as number[]) : null;
  if (!c) return;
  // Register adries gives both addresses of a corner building the SAME point (all such pairs here
  // are within 1 cm), so JOSM sees duplicate nodes and merging them joins the tags with ";"
  // ("12;13"). That is a quirk of the source data, not something to fix in the map — such a node
  // has no single okrsok to test against, so skip it silently.
  if (!Number.isInteger(Number(p.okrsok))) return;
  seedRows.push(`(${i}, ${lit(String(p.mcnorm ?? mc))}, ${Number(p.okrsok)},
     st_transform(st_setsrid(st_makepoint(${c[0]}, ${c[1]}), 4326), 5514))`);
});

// Addresses of the SURROUNDING municipalities, put in the file by addNeighbourSeeds.ts. They are
// reference points, never assigned to an okrsok: if one falls inside a precinct, that precinct has
// reached across the city boundary and claimed a house that is not Košice's to claim.
const nbrRows: string[] = [];
fc.features.forEach((f, i) => {
  const p = f.properties;
  if (p?.kind !== "neighbour") return;
  const c = f.geometry?.type === "Point" ? (f.geometry.coordinates as number[]) : null;
  if (!c) return;
  nbrRows.push(`(${i}, st_transform(st_setsrid(st_makepoint(${c[0]}, ${c[1]}), 4326), 5514))`);
});

execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-q"], {
  input: `drop table if exists _check_nbr;
          create table _check_nbr (idx int, geom geometry(Point,5514));
          ${nbrRows.length ? `insert into _check_nbr values ${nbrRows.join(",\n")};` : ""}
          create index on _check_nbr using gist(geom);
          drop table if exists _check_seed;
          create table _check_seed (idx int, mcnorm text, okrsok int, geom geometry(Point,5514));
          insert into _check_seed values ${seedRows.join(",\n")};
          create index on _check_seed using gist(geom);`,
  stdio: ["pipe", "pipe", "ignore"],
});

// --- addresses the decree names by number -----------------------------------------------------
// `ignore=yes` marks a seed whose position says nothing about where a border belongs — a mall, a
// school, an office block. Those are excused the containment checks.
//
// But NOT when the decree names the house number outright. A whole-street rule can sweep a mall in
// by accident; an explicit "ROMANOVA 23, 33, 35, 37, …" cannot. There somebody decided this
// building votes in this precinct, so the border really does have to include it and the check
// still has to run. Only a WHOLE-street or RANGE assignment can be waved off.
type Spec = { singles?: (number | string)[]; ranges?: [number, number, string][] } | null;
type AsgRow = { mcNorm: string; okrsok: number; street: string; cls: string; spec: Spec };

const asgFiles =
  mc === "kosice"
    ? ["data/kosice_okrsok_streets.json"]
    : readdirSync("data")
        .filter((f) => /^kv_ba_(?!.*_prose_).*_okrsok_streets\.json$/.test(f))
        .map((f) => `data/${f}`);

const byStreet = new Map<string, AsgRow[]>();
const byOkrsok = new Map<string, AsgRow[]>();
for (const f of asgFiles) {
  let rows: AsgRow[];
  try {
    rows = JSON.parse(readFileSync(f, "utf8")) as AsgRow[];
  } catch {
    continue;
  }
  for (const r of rows) {
    const k = `${r.mcNorm}#${r.okrsok}#${streetKey(norm(r.street ?? ""))}`;
    (byStreet.get(k) ?? byStreet.set(k, []).get(k)!).push(r);
    const o = `${r.mcNorm}#${r.okrsok}`;
    (byOkrsok.get(o) ?? byOkrsok.set(o, []).get(o)!).push(r);
  }
}

/**
 * The decree abbreviates personal names where Register adries spells them out — "Nábr. arm. gen.
 * L. Svobodu" against "Nábrežie arm.gen.Ludvíka Svobodu". The labeller matches those, so the seed
 * exists; an exact key lookup here would not, and would report `rule=unknown` for addresses that
 * are perfectly well assigned. Treat a single-letter token as matching a word starting with it.
 */
const compatible = (a: string, b: string) => {
  if (a === b) return true;
  const x = a.split(" ");
  const y = b.split(" ");
  if (x.length !== y.length) return false;
  return x.every((t, i) => {
    const u = y[i];
    if (t === u) return true;
    if (t.length === 1) return u.startsWith(t);
    if (u.length === 1) return t.startsWith(u);
    return false;
  });
};

/** Assignment rows for this address's street in this okrsok, exact key first, then abbreviations. */
const rowsFor = (p: Record<string, unknown>): AsgRow[] => {
  const sk = streetKey(norm(String(p.street ?? "")));
  const exact = byStreet.get(`${p.mcnorm ?? mc}#${Number(p.okrsok)}#${sk}`);
  if (exact?.length) return exact;
  return (byOkrsok.get(`${p.mcnorm ?? mc}#${Number(p.okrsok)}`) ?? []).filter((r) =>
    compatible(sk, streetKey(norm(r.street ?? ""))),
  );
};

/**
 * Which rule in the decree puts this address in this okrsok:
 *
 *   explicit       the house number is written out exactly   "ROMANOVA 23, 33, 35, 37"
 *   explicit-base  only the bare number is listed and this is a letter-suffixed sibling —
 *                  the decree says "Tomášikova 34", the address is 34A
 *   range          it falls inside a numeric range           "Kadnárova od 1 do 40"
 *   whole          the street is listed with no numbers      "Šaštínska"
 *   supisne        matched on súpisné číslo, not orientačné
 *   manual         assigned by hand (assigned=manual) — the decree does not mention it
 *   unknown        nothing in the assignment explains it; worth knowing about
 *
 * `explicit` is the only one that means somebody decided about THIS building, which is why it is
 * the only one that overrides `ignore=yes`. `explicit-base` deliberately does not: nobody wrote
 * "34A" down, so a mall at 34A can still be excused.
 */
const ruleFor = (p: Record<string, unknown>): string => {
  if (p.assigned === "manual") return "manual";
  const rows = rowsFor(p);
  if (!rows.length) return String(p.supisne ?? "") && !p.orient ? "supisne" : "unknown";

  const raw = String(p.orient ?? "").toUpperCase();
  const n = Number.parseInt(raw, 10);

  for (const r of rows) {
    if (r.cls === "ENUM" && r.spec?.singles?.some((x) => String(x).toUpperCase() === raw)) {
      return "explicit";
    }
  }
  // "34A" where the decree lists plain "34": the labeller treats the suffixed building as part of
  // the numbered one, so the seed exists — but the decree never named it.
  if (Number.isFinite(n) && raw !== String(n)) {
    for (const r of rows) {
      if (r.cls === "ENUM" && r.spec?.singles?.some((x) => String(x).toUpperCase() === String(n))) {
        return "explicit-base";
      }
    }
  }
  if (Number.isFinite(n)) {
    for (const r of rows) {
      for (const [lo, hi, par] of r.spec?.ranges ?? []) {
        if (n < lo || n > hi) continue;
        if (par === "odd" && n % 2 === 0) continue;
        if (par === "even" && n % 2 !== 0) continue;
        return "range";
      }
    }
  }
  if (rows.some((r) => r.cls === "WHOLE")) return "whole";
  return String(p.supisne ?? "") && !p.orient ? "supisne" : "unknown";
};

// --- gather the problems --------------------------------------------------------------------------
const rows = (sql: string) => q(sql).split("\n").filter(Boolean).map((l) => l.split("\t"));

// Faults are recorded against the FEATURE that carries them, not the precinct. A precinct drawn as
// five ways used to get the same tag on all five because one of them self-intersected, which makes
// `fixme=*` point at four innocent ways and hides which one to actually look at.
const partFixme = new Map<number, string[]>();
const addPart = (idx: number, msg: string) =>
  (partFixme.get(idx) ?? partFixme.set(idx, []).get(idx)!).push(msg);

// Precinct-level, because there is no single feature to blame: the whole precinct has no area.
const polyFixme = new Map<string, string[]>();
const add = (k: string, msg: string) => (polyFixme.get(k) ?? polyFixme.set(k, []).get(k)!).push(msg);

for (const [k, types] of notArea) {
  add(k, `not-an-area-${[...types].sort().join("+").toLowerCase()}`);
}

const reasonTag = (reason: string) =>
  /Self-intersection/i.test(reason)
    ? "self-intersection"
    : reason.split("[")[0].trim().replace(/\s+/g, "-").toLowerCase();

// A way that is invalid on its own.
for (const [idx, reason] of rows(
  `select idx, st_isvalidreason(g) from _check_part where not st_isvalid(g)`,
)) addPart(Number(idx), reasonTag(reason));

// A precinct whose ways are each valid but whose COLLECTION is not. Two ways of one precinct may
// meet at a point, never along a line and never with overlapping interiors — either makes the
// multipolygon invalid, so the precinct has no usable area even though every way looks fine.
// Blame the pair that actually meets, not every part of the precinct.
//   2******** interiors overlap
//   ****1**** boundaries meet in a LINE (Dúbravka okr 2: two pieces sharing 79 m of edge)
for (const [a, b, how] of rows(
  `select a.idx, b.idx,
          case when st_relate(a.g, b.g, '2********') then 'parts-overlap-each-other'
               else 'parts-share-an-edge' end
     from _check_part a join _check_part b
       on a.mcnorm=b.mcnorm and a.okrsok=b.okrsok and a.idx<b.idx
    where st_isvalid(a.g) and st_isvalid(b.g)
      and (st_relate(a.g, b.g, '2********') or st_relate(a.g, b.g, '****1****'))`,
)) {
  addPart(Number(a), how);
  addPart(Number(b), how);
}

// Overlaps between precincts, blamed on the exact pair of ways that overlap.
for (const [ia, ib, oa, ob] of rows(
  `select a.idx, b.idx, a.okrsok, b.okrsok
     from _check_part a join _check_part b
       on a.mcnorm=b.mcnorm and a.okrsok<b.okrsok
    -- st_intersection throws a TopologyException on an invalid input, so skip pairs that are
    -- still invalid; they are already reported above, and the overlap becomes computable once
    -- the ring is fixed.
    where st_isvalid(a.g) and st_isvalid(b.g)
      and st_area(st_intersection(a.g,b.g)) > 1`,
)) {
  addPart(Number(ia), `overlaps-okrsok-${ob}`);
  addPart(Number(ib), `overlaps-okrsok-${oa}`);
}

// Deliberately NOT restricted to the seed's own mestská časť. A precinct that reaches across a
// borough boundary and swallows a neighbouring MČ's address is exactly as wrong as one that
// swallows its neighbour's inside the same borough, and scoping the test by `mcnorm` hid that
// whole class of error.
const wrongSide = new Map<number, string>();
for (const [idx, inOkrsok] of rows(
  `select s.idx, other.okrsok from _check_seed s
     join _check_poly other on (other.mcnorm, other.okrsok) is distinct from (s.mcnorm, s.okrsok)
      and st_isvalid(other.geom) and st_contains(other.geom, s.geom)
     left join _check_poly own on own.mcnorm = s.mcnorm
      and own.okrsok = s.okrsok and st_isvalid(own.geom) and st_contains(own.geom, s.geom)
    where own.okrsok is null`,
)) wrongSide.set(Number(idx), inOkrsok);

const intruder = new Map<number, string>();
for (const [idx, mcn, okrsok] of rows(
  `select n.idx, c.mcnorm, c.okrsok from _check_nbr n
     join _check_poly c on st_isvalid(c.geom) and st_contains(c.geom, n.geom)`,
)) intruder.set(Number(idx), `${mcn} okr ${okrsok}`);

const orphan = new Set(
  rows(`select s.idx from _check_seed s
         where not exists (
           select 1 from _check_poly c
            where st_isvalid(c.geom) and st_contains(c.geom, s.geom))`).map((r) => Number(r[0])),
);

// --- write the tags ---------------------------------------------------------------------------------
const counts = { poly: 0, wrongSide: 0, orphan: 0, intruder: 0, ignored: 0, ignoredButNamed: 0 };
const intruderList: string[] = [];
const ruleCount: Record<string, number> = {};
fc.features.forEach((f, i) => {
  const p = f.properties ?? (f.properties = {});
  delete p.fixme;
  delete p.lies_in_okrsok;
  delete p.check;          // superseded by fixme
  delete p.in_okrsok;
  delete p.isolated_m;
  // A precinct really can be three large blocks (Staré Mesto okr 17 is Dargovská 1,2,3, and Nad
  // jazerom carves out single buildings by name), so a seed count says nothing on its own.
  delete p.seeds;
  delete p.rule;           // recomputed below for seeds

  if (p.kind === "okrsok") {
    const msgs = [...(partFixme.get(i) ?? []), ...(polyFixme.get(key(p)) ?? [])];
    if (msgs.length) {
      p.fixme = [...new Set(msgs)].join("; ");
      counts.poly++;
    }
    return;
  }
  if (p.kind === "neighbour") {
    const where = intruder.get(i);
    if (where) {
      p.fixme = "outside-address-inside-precinct";
      counts.intruder++;
      intruderList.push(`${where} — ${p.name ?? p.street ?? "?"}`);
    }
    return;
  }
  if (p.kind !== "seed") return;

  const rule = ruleFor(p);
  p.rule = rule;
  ruleCount[rule] = (ruleCount[rule] ?? 0) + 1;

  const msgs: string[] = [];

  // `ignore=yes` says this building's position should not steer a border. The decree naming its
  // number says the opposite — somebody placed THIS building in THIS precinct. Both cannot be
  // true, so say so rather than silently letting one win.
  if (p.ignore === "yes" && rule === "explicit") {
    msgs.push("ignored-but-explicit");
    counts.ignoredButNamed++;
  } else if (p.ignore === "yes") {
    counts.ignored++;
    return;
  }

  if (wrongSide.has(i)) {
    msgs.push("wrong-side-of-border");
    counts.wrongSide++;
  } else if (orphan.has(i)) {
    msgs.push("outside-all-precincts");
    counts.orphan++;
  }
  if (msgs.length) p.fixme = msgs.join("; ");
});

console.log(`${file}`);
console.log(`  polygons with fixme     : ${counts.poly}`);
const byPrecinct = new Map<string, Set<string>>();
for (const [k, msgs] of polyFixme) for (const m of msgs) (byPrecinct.get(k) ?? byPrecinct.set(k, new Set()).get(k)!).add(m);
fc.features.forEach((f, i) => {
  const p = f.properties;
  if (p?.kind !== "okrsok") return;
  const msgs = partFixme.get(i);
  if (!msgs) return;
  const k = key(p);
  for (const m of msgs) (byPrecinct.get(k) ?? byPrecinct.set(k, new Set()).get(k)!).add(m);
});
for (const [k, msgs] of [...byPrecinct].sort()) console.log(`      ${k.replace("#", " okr ")} — ${[...msgs].join("; ")}`);
console.log(`  seeds wrong-side        : ${counts.wrongSide}`);
console.log(`  seeds outside all       : ${counts.orphan}`);
if (counts.ignored || counts.ignoredButNamed) {
  console.log(`  seeds ignore=yes skipped: ${counts.ignored}`);
  console.log(`  ignored-but-explicit    : ${counts.ignoredButNamed}   <-- contradiction, flagged`);
}
console.log(`  rule=  ${Object.entries(ruleCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
if (nbrRows.length) {
  console.log(`  outside addresses caught: ${counts.intruder}  (of ${nbrRows.length} neighbour points)`);
  for (const x of [...new Set(intruderList)].sort().slice(0, 40)) console.log(`      ${x}`);
  if (intruderList.length > 40) console.log(`      … and ${intruderList.length - 40} more`);
}

if (dryRun) {
  console.log("\n--dry-run: file not modified.");
  process.exit(0);
}
const bak = backupFile(file);
writeFileSync(file, JSON.stringify(fc));
console.log(`\nbackup: ${bak}`);
console.log(`updated. In JOSM reload, then filter  fixme=*  (and  change=*  for what moved).`);
