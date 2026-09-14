// Small Košice MČ for the KOMUNÁLNE VOĽBY 24.10.2026.
//
// Two groups:
//
// 1. TRANSCRIBED — Pereš (2 okrsky) and Luník IX (2 okrsky). Both documents are short enough
//    that a coordinate parser would be more code than content, and Luník IX's is a 300 dpi SCAN
//    with no text layer at all (mclunik9.sk, "Utvorenie volebných okrskov … 24.10.2026", signed
//    31.07.2026), read off the page image. Pereš: mcperes.sk download_file_f.php?id=2450397, a
//    4-column table whose okrsok cell spans the whole block.
//
// 2. CARRIED OVER — the five SINGLE-okrsok MČ (Džungľa, Kavečany, Lorinčík, Poľov, Šebastovce).
//    Their 2026 decrees create one okrsok and name NO streets: the okrsok simply IS the whole
//    mestská časť. The city index PDF confirms 1 okrsok for each. The street list is therefore
//    vintage-independent — every street in the MČ maps to okrsok 1 either way — so the street
//    list is taken from REGISTER ADRIES (every street inside the boundary), with the referendum
//    list at data/ref2026_src/kosice_okrsok_streets.json kept only as a fallback. See the note
//    at the bottom: a document-derived list silently drops streets it omits or misspells.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { audit, type Row } from "./keCommon.ts";
import { buildKvRow } from "./kvCommon.ts";

// stderr dropped: this database emits a "collation version mismatch" WARNING on every connection.
const q = (sql: string) =>
  execFileSync("psql", ["volebna", "-tAqc", sql], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

type Mc = { slug: string; mc: string; mcNorm: string; okrsky: number; streets: Record<number, string[]> };

const TRANSCRIBED: Mc[] = [
  {
    slug: "peres",
    mc: "Košice-Pereš",
    mcNorm: "peres",
    okrsky: 2,
    streets: {
      // "Chatky" and "prihlásení na MČ" are catch-all entries, not streets — dropped.
      1: ["Bystrická (párne)", "Krásnohorská", "Krompašská", "Perešská", "Revúcka", "Svidnícka"],
      2: [
        "Betliarska",
        "Bystrická (nepárne)",
        "Gelnická",
        "Haburská",
        "Jasovská",
        "Jelšavská",
        "Medzevská",
        "Na Košarisku",
        "Sabinovská",
        "Vranovská",
      ],
    },
  },
  {
    slug: "lunik_ix",
    mc: "Košice-Luník IX",
    mcNorm: "lunik ix",
    okrsky: 2,
    streets: {
      // Scan reads: okrsok 1 "Hrebendova 2A / Hrebendova č. 1-3 / Hrebendova 10 – 12".
      // Hrebendova is not split across okrsky, so it stays WHOLE (robust to RA extras).
      1: ["Hrebendova"],
      2: ["Krčméryho 1-15", "Podjavorinskej 3-13"],
    },
  },
];

// mcNorm -> slug for the single-okrsok MČ carried over from the referendum-vintage assignment.
const CARRIED: { slug: string; mcNorm: string }[] = [
  { slug: "dzungla", mcNorm: "dzungla" },
  { slug: "kavecany", mcNorm: "kavecany" },
  { slug: "lorincik", mcNorm: "lorincik" },
  { slug: "polov", mcNorm: "polov" },
  { slug: "sebastovce", mcNorm: "sebastovce" },
];

for (const m of TRANSCRIBED) {
  const out: Row[] = [];
  for (const [okrsok, streets] of Object.entries(m.streets)) {
    for (const s of streets) out.push(buildKvRow(m.mc, m.mcNorm, +okrsok, s));
  }
  writeFileSync(`data/kv_ke_${m.slug}_okrsok_streets.json`, JSON.stringify(out));
  console.log(`\n=== ${m.mc} ===`);
  audit(out, m.okrsky);
}

// For a single-okrsok MČ the okrsok is coextensive with the mestská časť, so the authoritative
// street list is simply "every street Register adries has inside the boundary" — not whatever a
// document happened to enumerate. Matching against a carried-over list silently drops any street
// it omits or misspells: Džungľa lost Severné Nábrežie / Vŕbová / Trolejbusová / Úzka (50
// addresses), Lorinčík 164, Poľov 58 (its list writes "P-itná" for "Pitná").
//
// So derive the list from RA when it is loaded, and keep the carried-over list only as a fallback
// for running the parsers before the RA table exists.
const raStreets = (mcNorm: string): string[] => {
  if (!q(`select 1 from pg_tables where schemaname='public' and tablename='ra_kosice_all'`)) return [];
  return q(`
    select distinct r.street
      from ra_kosice_all r join kosice_mc m on st_contains(m.geom, r.geom)
     where m.mcnorm = ${lit(mcNorm)} and r.street is not null and r.street <> ''
     order by 1`).split("\n").filter(Boolean);
};

const prev = JSON.parse(readFileSync("data/ref2026_src/kosice_okrsok_streets.json", "utf8")) as Row[];
for (const c of CARRIED) {
  const carried = prev.filter((r) => r.mcNorm === c.mcNorm);
  const okrs = [...new Set(carried.map((r) => r.okrsok))];
  if (okrs.length !== 1 || okrs[0] !== 1) {
    throw new Error(`${c.mcNorm}: expected a single okrsok 1 in the carried-over data, got ${okrs.join(",")}`);
  }

  const fromRa = raStreets(c.mcNorm);
  const mcName = carried[0]?.mc ?? c.mcNorm;
  const rows = fromRa.length
    ? fromRa.map((s) => buildKvRow(mcName, c.mcNorm, 1, s))
    : carried;
  const note = fromRa.length
    ? `from RA: ${fromRa.length} streets (carried-over list had ${carried.length})`
    : "carried over — ra_kosice_all not loaded";

  writeFileSync(`data/kv_ke_${c.slug}_okrsok_streets.json`, JSON.stringify(rows));
  console.log(`\n=== ${mcName} (1 okrsok, ${note}) ===`);
  audit(rows, 1);
}
