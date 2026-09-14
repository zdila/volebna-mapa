// Bratislava-Nové Mesto — KOMUNÁLNE VOĽBY 24.10.2026 street→okrsok assignment, built from the
// MČ's own PER-ADDRESS export rather than from prose.
//
// Source: ArcGIS feature service "Adresné body - Komunálne voľby 2026" (org yYjTjOIUts73Bpbo,
// layer 1), 5043 address points each carrying VOL_OKR — the okrsok the address votes in. This is
// the authoritative assignment: no parsing of a PDF's wrapped street list, no guesswork about
// where a street is split. Fetched to data/kv_ba_novemesto_addresses.json.
// It confirms the 32 okrsky of banm.sk's "Informácia o utvorení volebných okrskov" PDF.
//
// Same shape as Prešov (parsePresov.ts): group by street, and a street wholly inside ONE okrsok
// is emitted WHOLE — deliberately ignoring its house list, so Register-adries addresses the
// export happens not to carry still match. A street SPLIT across okrsky keeps a per-okrsok ENUM
// of its orientačné čísla, because there the numbers are what decides the boundary.
import { readFileSync, writeFileSync } from "node:fs";
import { auditTable, emitRows } from "./kvTable.ts";

const MC = "Bratislava-Nové Mesto";
const MCNORM = "novemesto";

type Rec = {
  Ulica?: string;
  "Orientačné_číslo"?: string;
  "Súpisné_číslo"?: string;
  VOL_OKR?: number;
};

const recs = JSON.parse(
  readFileSync("data/kv_ba_novemesto_addresses.json", "utf8"),
) as Rec[];

// street -> okrsok -> orientačné čísla
const byStreet = new Map<string, Map<number, Set<string>>>();
let noStreet = 0;
for (const r of recs) {
  const street = (r.Ulica ?? "").trim();
  const okr = Number(r.VOL_OKR);
  if (!Number.isFinite(okr) || okr <= 0) continue;
  if (!street) {
    noStreet++;
    continue;
  }
  const orient = String(r["Orientačné_číslo"] ?? "").trim();
  const m = byStreet.get(street) ?? byStreet.set(street, new Map()).get(street)!;
  const set = m.get(okr) ?? m.set(okr, new Set()).get(okr)!;
  if (orient) set.add(orient);
}

// One cell per (street, okrsok): the numbers matter only where the street is split, and emitRows
// makes exactly that decision, so hand it the full number list and let it choose.
const cells: { okrsok: number; street: string; numspec: string }[] = [];
for (const [street, okrs] of byStreet) {
  for (const [okrsok, nums] of okrs) {
    cells.push({
      okrsok,
      street,
      numspec: [...nums].sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0)).join(", "),
    });
  }
}

const out = emitRows({ mc: MC, mcNorm: MCNORM }, cells);
writeFileSync("data/kv_ba_novemesto_okrsok_streets.json", JSON.stringify(out));

const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
auditTable(out, Math.max(0, ...okrs), MC);
const split = [...byStreet].filter(([, m]) => m.size > 1).length;
console.log(
  `addresses: ${recs.length}  streets: ${byStreet.size}  split across okrsky: ${split}  without a street name: ${noStreet}`,
);
