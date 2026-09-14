// Parse the Banská Bystrica 2026 referendum "Volebné okrsky" PDF (pdftotext -layout) into
// okrsok_streets rows. This PDF is a SCANNED, OCR'd document — usable but imperfect. Layout is
// 3-column: "N[.]  <comma street list, wraps>   <polling place>". Streets carry inline dash-ranges
// ("Trieda SNP 2-38, 7-31", "Magurská 61—69"). OCR damage: okrsok 10 is scrambled and okrsky 19 & 21
// were dropped — those are supplied by a hand-keyed override file data/bb_okrsky_patch.json (read
// from the PDF page image). Garbled street NAMES are repaired afterwards by fixStreetsAgainstRa.ts.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const lines = readFileSync("data/bb_okrsky.txt", "utf8").split("\n");
const chrome = /MESTO BANSKÁ BYSTRICA|^\s*V zmysle|U\s*TVÁRAM|volebné okrsky a určujem|^\s*Strana|V Banskej Bystrici/;

const blocks = new Map<number, string>();
let okr = 0, maxSeen = 0;
for (const raw of lines) {
  if (chrome.test(raw) || !raw.trim()) continue;
  const streetCol = (s: string) => s.split(/\s{3,}/)[0].trim(); // drop the far-right polling column
  const m = raw.match(/^\s*(\d{1,2})\.?\s{2,}(\S.*)$/);
  if (m && +m[1] > maxSeen) { // monotonic header (the scrambled okr10 line "1 …" is < maxSeen -> ignored here)
    okr = maxSeen = +m[1];
    blocks.set(okr, streetCol(m[2]));
  } else if (okr && /^\s*[A-Za-zČŠŽĽ]/.test(raw)) { // continuation must start with a letter (not a stray digit)
    blocks.set(okr, `${blocks.get(okr)} ${streetCol(raw)}`);
  }
}

// Apply hand-keyed overrides for the OCR-broken okrsky (10, 19, 21).
if (existsSync("data/bb_okrsky_patch.json")) {
  const patch = JSON.parse(readFileSync("data/bb_okrsky_patch.json", "utf8")) as Record<string, string>;
  for (const [k, v] of Object.entries(patch)) blocks.set(+k, v);
}

// Rača-style: normalise OCR range punctuation, split a comma list where digit-fragments continue the
// previous street's number spec, move any trailing parity word into parseStreetSpec's "(párne)" form.
const clean = (s: string) =>
  s.replace(/[–—]/g, "-").replace(/\s*-\s*/g, "-").replace(/\bčasť obce\b/gi, "")
    .replace(/(\d)\s+(?=[A-ZČŠŽĽ])/g, "$1, ") // OCR sometimes drops the comma after a range ("11-33 Stromová")
    .replace(/\s+/g, " ").trim();
const splitEntries = (t: string): string[] => {
  const out: string[] = [];
  for (const f of t.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (/^\d/.test(f) && out.length) out[out.length - 1] += "," + f;
    else out.push(f);
  }
  return out;
};

const rows = [...blocks].flatMap(([o, raw]) =>
  splitEntries(clean(raw)).map((entry) => {
    const parsed = parseStreetSpec(entry.replace(/\s+(nepárne|párne)\s*$/i, " ($1)"));
    return {
      mc: "Banská Bystrica", mcNorm: "banskabystrica", okrsok: o, obvod: 0,
      street: parsed.street || entry, streetNorm: parsed.streetNorm || norm(entry),
      parity: parsed.parity, cls: parsed.cls, numberKind: parsed.numberKind, spec: parsed.spec, srcSpadove: entry,
    };
  }),
);

writeFileSync("data/banskabystrica_okrsok_streets.json", JSON.stringify(rows));
const okrs = new Set(rows.map((r) => r.okrsok));
console.log(`rows: ${rows.length}   okrsky: ${okrs.size}`);
const missing = [...Array(78)].map((_, i) => i + 1).filter((n) => !okrs.has(n));
console.log(`okrsky 1-78 missing/empty: ${missing.length ? missing.join(",") : "none"}`);
console.log(`cls: ${Object.entries(Object.groupBy(rows, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
