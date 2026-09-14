// Parse the Košice-Dargovských hrdinov 2026 REFERENDUM okrsky PDF (pres. rozh. 60/2026 Z.z.,
// referendum 4. júla 2026) into okrsok_streets rows.
//
// Source: kosice-dh.sk/files/2026-05-06-155912-VOLEBN___OKRSKY_-_REFERENDUM_2026.pdf
// (data/ke_dh_src.pdf). Layout: blocks separated by underscore rules; each block header line is
//   "N.   <volebná miestnosť>   <first spádová ulica>"
// and subsequent lines add more streets. Three left-to-right columns (okrsok№ | miestnosť | ulice),
// so the street entry is always the RIGHTMOST cell (split on runs of ≥2 spaces, take last). Number
// lists wrap onto digit-initial continuation lines (append to the previous street). The okrsok
// number sits at the TOP of its block, so simple top-down carry-forward is correct here.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { norm, streetKey } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const PDF = "data/ke_dh_src.pdf";
const MC = "Košice-Dargovských hrdinov";
const MCNORM = "dargovskych hrdinov";
const N_OKRSKY = 12;

const text = execFileSync("pdftotext", ["-layout", PDF, "-"], { encoding: "utf8" });
const rawLines = text.split("\n");

type Ent = { okrsok: number; entry: string };
const ents: Ent[] = [];
let cur = 0;
let started = false;
for (let raw of rawLines) {
  raw = raw.replace(/\f/g, " ");
  const t = raw.trim();
  if (!t) continue;
  if (/^[_\-\s]+$/.test(t)) continue; // horizontal rule / page-break dashes
  if (/^V Košiciach|^PhDr\.|starosta|^Volebný okrsok a|^volebný|^okrsok č\.|^Pre voličov/i.test(t)) continue;
  const cells = t.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
  if (!cells.length) continue;
  const okrM = cells[0].match(/^(\d+)\.$/);
  if (okrM) {
    cur = +okrM[1];
    started = true;
    // header line: rightmost cell is the first street (okrsok№ + miestnosť sit to its left)
    if (cells.length >= 2) {
      const last = cells[cells.length - 1];
      if (!/^\d+\.$/.test(last)) ents.push({ okrsok: cur, entry: last });
    }
    continue;
  }
  if (!started) continue;
  const last = cells[cells.length - 1];
  // A digit-initial line is a wrapped continuation of the previous street's number list.
  if (/^\d/.test(last) && ents.length && ents[ents.length - 1].okrsok === cur) {
    ents[ents.length - 1].entry = ents[ents.length - 1].entry.replace(/,\s*$/, "") + "," + last;
  } else {
    ents.push({ okrsok: cur, entry: last });
  }
}

// Street display name = the entry up to its first digit or "(" (drops the number list and any
// "(nepárne …)" note); used both as the WHOLE-street name and as the split-street grouping key.
const nameOf = (entry: string) => entry.split(/[\d(]/)[0].replace(/[,\s]+$/, "").trim();

// Split-street rule: a street in >1 okrsok keeps its per-okrsok ENUM/RANGE; a street in a single
// okrsok collapses to WHOLE (drops house numbers — robust to RA carrying extra numbers).
const okrOfKey = new Map<string, Set<number>>();
for (const e of ents) {
  const k = streetKey(norm(nameOf(e.entry)));
  if (!k) continue;
  (okrOfKey.get(k) ?? okrOfKey.set(k, new Set()).get(k)!).add(e.okrsok);
}
const wholeDone = new Set<string>();

const out = ents.flatMap((e) => {
  const name = nameOf(e.entry);
  const k = streetKey(norm(name));
  if (!k) return [];
  const split = (okrOfKey.get(k)?.size ?? 1) > 1;
  let input: string;
  if (!split) {
    const dk = `${k}|${e.okrsok}`;
    if (wholeDone.has(dk)) return [];
    wholeDone.add(dk);
    input = name;
  } else {
    // normalize the one odd "(nepárne čísla)" note to a trailing parseStreetSpec marker
    input = e.entry.replace(/\(\s*(ne)?párne[^)]*\)/i, (_m, ne) => `(${ne ? "nepárne" : "párne"})`);
  }
  const parsed = parseStreetSpec(input);
  return [{
    mc: MC,
    mcNorm: MCNORM,
    okrsok: e.okrsok,
    obvod: 0,
    street: parsed.street || name,
    streetNorm: parsed.streetNorm || norm(name),
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    srcSpadove: e.entry,
  }];
});

writeFileSync("data/ke_dargovskych_hrdinov_okrsok_streets.json", JSON.stringify(out));

// Audit
const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
console.log(`rows: ${out.length}   okrsky: ${okrs.length} (${okrs[0]}-${okrs[okrs.length - 1]})`);
const missing = [...Array(N_OKRSKY)].map((_, i) => i + 1).filter((n) => !okrs.includes(n));
console.log(`missing okrsky 1-${N_OKRSKY}: ${missing.length ? missing.join(",") : "none"}`);
console.log(`cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
console.log(`rows/okrsok: ${okrs.map((o) => `${o}:${out.filter((r) => r.okrsok === o).length}`).join(" ")}`);
console.log("samples:");
for (const r of [out[0], out[Math.floor(out.length / 2)], out[out.length - 1]]) console.log("  " + JSON.stringify(r));
