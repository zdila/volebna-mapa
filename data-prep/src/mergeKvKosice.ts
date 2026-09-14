// Merge the 22 per-MČ Košice komunálne-2026 assignments into the one file labelKosice reads.
// Košice numbers okrsky PER MESTSKÁ ČASŤ, so (mcNorm, okrsok) is the identity — the merge is a
// plain concatenation, and the audit below checks each MČ against the okrsok count published in
// the city-wide index PDF (static.kosice.sk/.../volby2026_volebne_okrsky.pdf, 190 total).
import { readFileSync, writeFileSync } from "node:fs";
import type { Row } from "./keCommon.ts";

// slug -> okrsok count per the city index. Staré Mesto's okrsok 19 is the "trvalý pobyt v MČ"
// catch-all with no streets at all, so 18 of its 19 are mappable; same for any other MČ whose
// only extra okrsok is address-less.
const EXPECTED: Record<string, number> = {
  sever: 18, kavecany: 1, tahanovce: 2, dzungla: 1, sidlisko_tahanovce: 18,
  stare_mesto: 19, zapad: 31, sidlisko_kvp: 18, lunik_ix: 2, myslava: 2,
  peres: 2, lorincik: 1, polov: 1, saca: 3, barca: 3, sebastovce: 1,
  juh: 18, nad_jazerom: 20, krasna: 4, vysne_opatske: 3, kosicka_nova_ves: 2,
  dargovskych_hrdinov: 20,
};

const all: Row[] = [];
let expTotal = 0;
let gotTotal = 0;
console.log("MČ                        rows  okrsky  expected");
for (const [slug, exp] of Object.entries(EXPECTED)) {
  const rows = JSON.parse(readFileSync(`data/kv_ke_${slug}_okrsok_streets.json`, "utf8")) as Row[];
  const okrs = new Set(rows.map((r) => r.okrsok));
  const flag = okrs.size === exp ? "" : `  <-- ${exp - okrs.size} unmapped`;
  console.log(`${slug.padEnd(24)} ${String(rows.length).padStart(5)}  ${String(okrs.size).padStart(6)}  ${String(exp).padStart(8)}${flag}`);
  all.push(...rows);
  expTotal += exp;
  gotTotal += okrs.size;
}

const mcs = new Set(all.map((r) => r.mcNorm));
console.log(`\nmestské časti: ${mcs.size}   rows: ${all.length}   okrsky: ${gotTotal} of ${expTotal} published`);
writeFileSync("data/kosice_okrsok_streets.json", JSON.stringify(all));
console.log("wrote data/kosice_okrsok_streets.json");
