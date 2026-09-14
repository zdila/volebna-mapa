// Parse the Vrakuňa "volebné okrsky, miestnosti a zoznam ulíc" PDF (pdftotext -layout) into
// okrsok_streets rows. Block layout per okrsok:
//   Volebný okrsok č. N
//   Volebná miestnosť: <polling place>
//   ulice: <comma-separated street list, wraps across lines, ends with '.'>
// House specs are inline: whole streets, ranges ("Kríková 5-20"), enums ("Čiližská 1,1A"), and a
// parity word BEFORE the numbers ("Hradská nepárne 1-29", "Rajecká párne 2-40").
import { readFileSync, writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const lines = readFileSync("data/vrakuna_okrsky.txt", "utf8").split("\n");

type Row = { okrsok: number; streets: string };
const rows: Row[] = [];
let cur: Row | null = null;
let inList = false;

for (const raw of lines) {
  const t = raw.trim();
  if (!t) continue;
  const okrM = t.match(/^Volebný okrsok č\.\s*(\d+)/);
  if (okrM) { cur = { okrsok: +okrM[1], streets: "" }; rows.push(cur); inList = false; continue; }
  if (/^Volebná miestnosť/.test(t)) { inList = false; continue; }
  if (!cur) continue;
  let s = t;
  if (/^ulice:/i.test(s)) { s = s.replace(/^ulice:\s*/i, ""); inList = true; }
  if (!inList) continue;
  // Admin catch-all ("…, obyvatelia v nehnuteľnostiach bez orientačného čísla a obyvatelia
  // s trvalým pobytom v mestskej časti Bratislava-Vrakuňa") is glued onto the same line as
  // real streets (okr. 4) and wraps to a following line. Strip from "obyvatelia" onward, and
  // drop the wrapped continuation line ("orientačného … trvalým pobytom …") entirely.
  s = s.replace(/,?\s*obyvatelia\b.*$/i, "").trim();
  if (/^orientačného|trvalým pobytom/i.test(s)) continue;
  if (!s) continue;
  cur.streets += (cur.streets ? " " : "") + s;
}

// Split a street list into per-street entries. Commas separate both streets and number tokens, so a
// comma-fragment that starts with a digit continues the previous street's number list. A second
// street glued on by a space after a number (wrap artefact "…31-105 Hradská párne…") is pre-split.
const splitEntries = (text: string): string[] => {
  const prepped = text.replace(/\.$/, "").replace(/(\d)\s+(?=[A-ZÁČĎÉÍĽĹŇÓŔŠŤÚÝŽ])/g, "$1, ");
  const entries: string[] = [];
  for (const frag of prepped.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (/^\d/.test(frag) && entries.length) entries[entries.length - 1] += "," + frag;
    else entries.push(frag);
  }
  return entries;
};

// Normalize a street entry to parseStreetSpec syntax (trailing "(párne)"/"(nepárne)"). The
// parity word appears in BOTH orders in this doc:
//   before the numbers — "Hradská nepárne 1-29", "Hradská párne 2-82"
//   after the numbers  — "Kríková 2-8 párne", "Kríková 1-7 nepárne"
// Plain "Name" (whole) and "Name <numbers>" pass through unchanged.
const toSpecInput = (entry: string): string => {
  const e = entry.replace(/\.\s*$/, "").trim();
  // parity BEFORE numbers
  const pre = e.match(/^(.+?)\s+(ne)?párne\s+(\d.*)$/i);
  if (pre) return `${pre[1].trim()} ${pre[3].trim()} (${pre[2] ? "nepárne" : "párne"})`;
  // parity AFTER numbers
  const post = e.match(/^(.+?\d[\d,\s-]*?)\s+(ne)?párne\s*$/i);
  if (post) return `${post[1].trim()} (${post[2] ? "nepárne" : "párne"})`;
  return e;
};

const out = rows.flatMap((r) =>
  splitEntries(r.streets).map((entry) => {
    const input = toSpecInput(entry);
    const parsed = parseStreetSpec(input);
    return {
      mc: "Vrakuňa",
      mcNorm: "vrakuna",
      okrsok: r.okrsok,
      obvod: 0,
      street: parsed.street || entry,
      streetNorm: parsed.streetNorm || norm(entry),
      parity: parsed.parity,
      cls: parsed.cls,
      numberKind: parsed.numberKind,
      spec: parsed.spec,
      srcSpadove: entry,
    };
  }),
);

writeFileSync("data/vrakuna_okrsok_streets.json", JSON.stringify(out));

// Audit / acceptance check
const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
console.log(`total rows: ${out.length}`);
console.log(`okrsok count: ${okrs.length}`);
console.log(`okrsok numbers: ${okrs.join(", ")}`);
const byCls = Object.groupBy(out, (r) => r.cls);
console.log(`cls: ${Object.entries(byCls).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
const EXPECTED = [...Array(14)].map((_, i) => i + 1);
const missing = EXPECTED.filter((n) => !okrs.includes(n));
console.log(`missing okrsky (of 1-14): ${missing.length ? missing.join(",") : "none"}`);
const counts = Object.fromEntries(okrs.map((o) => [o, out.filter((r) => r.okrsok === o).length]));
const sparse = okrs.filter((o) => counts[o] <= 1);
console.log(`streets per okrsok: ${okrs.map((o) => `${o}:${counts[o]}`).join(" ")}`);
console.log(`okrsky with <=1 street: ${sparse.length ? sparse.map((o) => `${o}(${counts[o]})`).join(",") : "none"}`);
const pass = okrs.length === 14 && missing.length === 0 && okrs.every((o) => counts[o] >= 1);
console.log(`ACCEPTANCE: ${pass ? "PASS" : "FAIL"}`);
console.log("\nnon-whole entries:");
for (const r of out.filter((r) => r.cls !== "WHOLE")) console.log(`  okr${r.okrsok} ${r.street} [${r.cls}] ranges=${JSON.stringify(r.spec?.ranges)} singles=${JSON.stringify(r.spec?.singles)}  «${r.srcSpadove}»`);
