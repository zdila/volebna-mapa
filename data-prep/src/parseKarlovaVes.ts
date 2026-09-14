// Parse the Karlova Ves "Rozhodnutie starostky ... o určení volebných okrskov" appendix
// (referendum 2026 PDF, pdftotext -layout) into okrsok_streets rows.
// Repeating block per okrsok:
//   Volebný okrsok    <N>
//   Volebná miestnosť <polling place>
//   Ulica             Orientačné číslo [/ Súpisné číslo]
//   <StreetName>      <numbers | "všetky">   (numbers wrap onto indented continuation lines)
// Most streets are "všetky" (WHOLE). A few are split across okrsky by orientačné číslo:
//   Karloveská -> okrsky 1 (odd 5..73), 6 (1C..3), 8 (even 4..34)
//   Silvánska  -> okrsky 1 (1..13),     2 (14..29)
// One okrsok-4 address is given only by súpisné číslo ("súpisné číslo 5578").
import { readFileSync, writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const lines = readFileSync("data/karlovaves_okrsky.txt", "utf8").split("\n");

type Entry = { okrsok: number; street: string; nums: string; supisne?: boolean };
const entries: Entry[] = [];
let okrsok = 0;

for (const raw of lines) {
  const t = raw.trim();
  if (!t) continue;
  const okrM = t.match(/^Volebný okrsok\s+(\d+)/);
  if (okrM) { okrsok = +okrM[1]; continue; }
  if (/^Volebná miestnosť|^Ulica\b|Orientačné|Súpisné|^Do volebného|^Príloha|^Volebné|starostka|^\d+$/.test(t)) continue;
  if (!okrsok) continue;

  // Address given only by súpisné číslo (no street): e.g. "súpisné číslo 5578".
  const supM = t.match(/^súpisn[éeá]\s+čísl[a-záéí]*\s+(.+)$/i);
  if (supM) { entries.push({ okrsok, street: "", nums: supM[1], supisne: true }); continue; }

  if (/^\d/.test(t)) {
    // continuation: wrapped číslo list -> append to the last street of this okrsok
    if (entries.length) entries[entries.length - 1].nums += ", " + t;
    continue;
  }
  const p = t.split(/\s{2,}/);
  if (p.length >= 2) entries.push({ okrsok, street: p[0], nums: p.slice(1).join(" ") });
}

const out = entries.map((e) => {
  // súpisné-only address: no street geometry, enumerate súpisné čísla directly.
  if (e.supisne) {
    const parsed = parseStreetSpec(`Súpisne čísla ${e.nums}`);
    return {
      mc: "Karlova Ves",
      mcNorm: "karlovaves",
      okrsok: e.okrsok,
      obvod: 0,
      street: "",
      streetNorm: "",
      parity: parsed.parity,
      cls: parsed.cls,
      numberKind: parsed.numberKind,
      spec: parsed.spec,
      srcSpadove: `súpisné číslo ${e.nums}`,
    };
  }
  const whole = /^v[šs]etk/i.test(e.nums.trim()); // "všetky"/"Všetky" = whole street
  const input = whole ? e.street : `${e.street} ${e.nums}`;
  const parsed = parseStreetSpec(input);
  return {
    mc: "Karlova Ves",
    mcNorm: "karlovaves",
    okrsok: e.okrsok,
    obvod: 0,
    street: parsed.street || e.street,
    streetNorm: parsed.streetNorm || norm(e.street),
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    srcSpadove: `${e.street} ${e.nums}`,
  };
});

writeFileSync("data/karlovaves_okrsok_streets.json", JSON.stringify(out));

// ---- Audit ----
const okrs = new Set(out.map((r) => r.okrsok));
const sorted = [...okrs].sort((a, b) => a - b);
console.log(`rows: ${out.length}   okrsky: ${okrs.size}   list: ${sorted.join(",")}`);
const empty = sorted.filter((n) => out.every((r) => r.okrsok !== n));
console.log(`empty okrsky: ${empty.length ? empty.join(",") : "none"}`);
const missing = [...Array(15)].map((_, i) => i + 1).filter((n) => !okrs.has(n));
console.log(`expected 1-15 missing: ${missing.length ? missing.join(",") : "none"}`);
console.log(`cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);

// Split streets: a street name appearing in more than one okrsok.
const byStreet = Object.groupBy(out.filter((r) => r.streetNorm), (r) => r.streetNorm);
console.log("\nsplit streets (in >1 okrsok):");
for (const [k, rows] of Object.entries(byStreet)) {
  const okrsSet = new Set(rows!.map((r) => r.okrsok));
  if (okrsSet.size > 1) {
    console.log(`  ${rows![0].street}: okrsky ${[...okrsSet].sort((a, b) => a - b).join(",")}`);
    for (const r of rows!) console.log(`    okr${r.okrsok} [${r.cls}] ${r.srcSpadove}`);
  }
}

console.log("\nnon-WHOLE entries:");
for (const r of out.filter((r) => r.cls !== "WHOLE"))
  console.log(`  okr${r.okrsok} ${r.street || "(supisne)"} [${r.cls}] ranges=${JSON.stringify(r.spec?.ranges)} singles=${JSON.stringify(r.spec?.singles)}`);
