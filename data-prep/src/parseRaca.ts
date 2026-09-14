// Parse the Rača 2026 referendum "Oznámenie" PDF (pdftotext -layout) into okrsok_streets rows.
// Blocks are delimited by "Volebný okrsok N: <polling place>"; the street list follows an "ulice:"
// line as a comma-separated run wrapping across lines. House specs are written in Slovak prose:
//   "Žitná od 17 do 66"  (range),  "Hubeného od 4 do 62 párne"  (range+parity),
//   "Hubeného 23 a 25"   (enum),   "Račianska 184, 188A, 190"   (enum),  bare name = whole street.
import { readFileSync, writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const lines = readFileSync("data/raca_okrsky.txt", "utf8").split("\n");

const blocks = new Map<number, string>();
let okrsok = 0;
let inUlice = false;
for (const raw of lines) {
  const t = raw.trim();
  const m = t.match(/^Volebný okrsok\s+(\d+):/);
  if (m) { okrsok = +m[1]; inUlice = false; blocks.set(okrsok, ""); continue; }
  if (/^ulice:/i.test(t)) { inUlice = true; blocks.set(okrsok, t.replace(/^ulice:\s*/i, "")); continue; }
  if (/^V Bratislave|^Mgr\.|^starosta|^OZNÁMENIE|ZMENA V ORGAN|^Starosta|^o podmienkach|^neskorších/.test(t)) { inUlice = false; continue; }
  if (inUlice && okrsok && t && !/^\d\s*$/.test(t)) blocks.set(okrsok, `${blocks.get(okrsok)} ${t}`); // skip stray page numbers
}

// Normalise one okrsok's raw street run to a clean comma-separated list in parseStreetSpec syntax.
const clean = (s: string): string =>
  s
    // okrsok 7: unclosed "(Kadnárova 27, 29, … 88," enumeration duplicates the "od 27 do 88" range
    // and swallows the following street — drop it, keep the range + Ulica Augustína Murína.
    .replace(/Kadnárova od 27 do 88 \(Kadnárova[\s\S]*?88,\s*ulica Augustína Murína/, "Kadnárova od 27 do 88, ulica Augustína Murína,")
    // a completed "od X do Y [párne]" not followed by a comma → insert one before the next street
    .replace(/(od \d+ do \d+(?:\s+(?:ne)?párne)?)\s+(?=[A-ZČŠŽĽŔÁÉÍÓÚÝ])/g, "$1, ")
    .replace(/(\d)\s+a\s+(\d)/g, "$1, $2")     // "23 a 25" -> "23, 25"
    .replace(/\bod (\d+) do (\d+)/g, "$1-$2")  // prose range -> dash
    .replace(/\s+/g, " ")
    .trim();

// Commas separate both streets and number tokens; a comma-fragment starting with a digit continues
// the previous street's number list ("184, 188A, 190").
const splitEntries = (text: string): string[] => {
  const entries: string[] = [];
  for (const frag of text.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (/^\d/.test(frag) && entries.length) entries[entries.length - 1] += "," + frag;
    else entries.push(frag);
  }
  return entries;
};

// Move a trailing parity word into parseStreetSpec's "(párne)" form.
const toSpecInput = (e: string): string => e.replace(/\s+(nepárne|párne)\s*$/i, " ($1)").trim();

const rows = [...blocks].flatMap(([okr, raw]) =>
  splitEntries(clean(raw)).map((entry) => {
    const input = toSpecInput(entry);
    const parsed = parseStreetSpec(input);
    return {
      mc: "Rača",
      mcNorm: "raca",
      okrsok: okr,
      obvod: 0,
      street: parsed.street || input,
      streetNorm: parsed.streetNorm || norm(input),
      parity: parsed.parity,
      cls: parsed.cls,
      numberKind: parsed.numberKind,
      spec: parsed.spec,
      srcSpadove: entry,
    };
  }),
);

writeFileSync("data/raca_okrsok_streets.json", JSON.stringify(rows));

// Audit
const okrs = new Set(rows.map((r) => r.okrsok));
console.log(`rows: ${rows.length}   okrsky: ${okrs.size}   (${[...okrs].sort((a, b) => a - b).join(",")})`);
console.log(`cls: ${Object.entries(Object.groupBy(rows, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
console.log("\nnon-whole entries:");
for (const r of rows.filter((r) => r.cls !== "WHOLE")) console.log(`  okr${r.okrsok} ${r.street} [${r.cls}] ranges=${JSON.stringify(r.spec?.ranges)} singles=${JSON.stringify(r.spec?.singles)}  «${r.srcSpadove}»`);
