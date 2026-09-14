// Build the Prešov okrsok_streets.json from the city's per-address referendum-2026 export
// (data/presov_okrsky_raw.json): 9447 rows, each an address (Ulica + Or._č.) → Číslo_okrsku.
// Group by street: a street wholly inside one okrsok is emitted WHOLE (robust to RA carrying extra
// house numbers); a street split across okrsky keeps a per-okrsok ENUM of its orientačné numbers.
import { readFileSync, writeFileSync } from "node:fs";
import { norm, streetKey } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

type Rec = { Ulica: string; "Or._č.": string; "Číslo_okrsku": string };
const data = JSON.parse(readFileSync("data/presov_okrsky_raw.json", "utf8")) as Rec[];

// street display name -> okrsok -> set of orientačné numbers
const byStreet = new Map<string, Map<number, Set<string>>>();
for (const r of data) {
  const street = (r.Ulica ?? "").trim();
  const orient = String(r["Or._č."] ?? "").trim();
  const okr = parseInt(String(r["Číslo_okrsku"]).trim(), 10);
  if (!street || !orient || !Number.isFinite(okr)) continue;
  const m = byStreet.get(street) ?? byStreet.set(street, new Map()).get(street)!;
  (m.get(okr) ?? m.set(okr, new Set()).get(okr)!).add(orient);
}

// A street (by canonical key) present in >1 okrsok must keep its number ENUM; else it goes WHOLE.
const okrOfKey = new Map<string, Set<number>>();
for (const [street, okrs] of byStreet) {
  const k = streetKey(norm(street));
  const s = okrOfKey.get(k) ?? okrOfKey.set(k, new Set()).get(k)!;
  for (const o of okrs.keys()) s.add(o);
}

const rows = [...byStreet].flatMap(([street, okrs]) => {
  const split = (okrOfKey.get(streetKey(norm(street)))?.size ?? 1) > 1;
  return [...okrs].map(([okr, orients]) => {
    const nums = [...orients].sort((a, b) => parseInt(a) - parseInt(b));
    const input = split ? `${street} ${nums.join(",")}` : street;
    const parsed = parseStreetSpec(input);
    return {
      mc: "Prešov",
      mcNorm: "presov",
      okrsok: okr,
      obvod: 0,
      street: split ? street : parsed.street || street,
      streetNorm: norm(street),
      parity: parsed.parity,
      cls: parsed.cls,
      numberKind: parsed.numberKind,
      spec: parsed.spec,
      srcSpadove: input,
    };
  });
});

writeFileSync("data/presov_okrsok_streets.json", JSON.stringify(rows));

// Audit
const okrs = new Set(rows.map((r) => r.okrsok));
console.log(`rows: ${rows.length}   streets: ${byStreet.size}   okrsky: ${okrs.size} (${Math.min(...okrs)}-${Math.max(...okrs)})`);
console.log(`cls: ${Object.entries(Object.groupBy(rows, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
const missing = [...Array(66)].map((_, i) => i + 1).filter((n) => !okrs.has(n));
console.log(`okrsky 1-66 missing: ${missing.length ? missing.join(",") : "none"}`);
const splitStreets = [...okrOfKey].filter(([, s]) => s.size > 1).length;
console.log(`split streets (ENUM, across >1 okrsok): ${splitStreets}`);
