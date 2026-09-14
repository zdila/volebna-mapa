// Košice-Staré Mesto 2026 REFERENDUM okrsok→street assignment.
// Source: kosice-city.sk download_file_f.php?id=2395631 = "INFORMÁCIA o čase, vytvorení
// volebných okrskov a mieste konania referenda" (Rozhodnutie prezidenta č. 60/2026 Z. z.,
// referendum 04. júla 2026). 19 okrsky.
//
// The PDF is a machine-readable TWO-BLOCK, SIX-COLUMN table (Číslo okrsku | Územie | Sídlo,
// twice side-by-side): LEFT block = okrsky 1-7, RIGHT block = okrsky 7-19 (okrsok 7 spans
// both, merged by number). Each street is on its OWN row; the okrsok number is vertically
// CENTERED against its block of streets. So a plain text extraction can't tell which okrsok a
// street belongs to. We use `pdftotext -bbox-layout` word coordinates: assign every street row
// to the okrsok whose number marker is nearest in Y (split at the midpoints between markers).
// The trailing Sídlo (polling place) leaks into the street column on a few short-street rows;
// we truncate each row at the first >30px inter-word gap (real multi-word street names have
// small gaps, the Sídlo sits far to the right).
import { readFileSync, writeFileSync } from "node:fs";
import { audit, buildRow, splitEntries, type Row } from "./keCommon.ts";

const MC = "Košice-Staré Mesto";
const MCNORM = "stare mesto";

type Word = { x: number; y: number; xm: number; t: string };
const words: Word[] = [];
const html = readFileSync("data/ke_stare_mesto.bbox.html", "utf8");
const re =
  /<word xMin="([0-9.]+)" yMin="([0-9.]+)" xMax="([0-9.]+)" yMax="([0-9.]+)">([^<]*)<\/word>/g;
for (let m; (m = re.exec(html)); ) {
  words.push({ x: +m[1], y: +m[2], xm: +m[3], t: m[5] });
}

const GAP = 30; // px gap that separates a street name from the leaked Sídlo column
const Y_MIN = 118; // below the "Územie patriace do okrsku" header (@111)
const Y_MAX = 730; // above the footer "V Košiciach dňa 21. 04. 2026" / signature

// Reconstruct a row's street text from words in an x-range, sorted by x, stopping at the
// first inter-word gap wider than GAP (= start of the Sídlo column).
const rowText = (ws: Word[]): string => {
  const s = ws.slice().sort((a, b) => a.x - b.x);
  let out = "";
  let prevXm: number | null = null;
  for (const w of s) {
    if (prevXm !== null && w.x - prevXm > GAP) break;
    out += (out ? " " : "") + w.t;
    prevXm = w.xm;
  }
  return out.trim();
};

// Cluster words (already restricted to a column x-range) into rows by Y.
const clusterRows = (ws: Word[]): { y: number; ws: Word[] }[] => {
  const rows: { y: number; ws: Word[] }[] = [];
  let cur: { y: number; ws: Word[] } | null = null;
  for (const w of ws.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (!cur || w.y - cur.y > 4) {
      cur = { y: w.y, ws: [] };
      rows.push(cur);
    }
    cur.ws.push(w);
    cur.y = w.y;
  }
  return rows;
};

type Block = { numLo: number; numHi: number; strLo: number; strHi: number };
const LEFT: Block = { numLo: 45, numHi: 60, strLo: 63, strHi: 200 };
const RIGHT: Block = { numLo: 322, numHi: 335, strLo: 345, strHi: 465 };

const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
};

// (okrsok, rawStreetEntry) pairs collected across both blocks.
const pairs: { okrsok: number; entry: string }[] = [];

for (const b of [LEFT, RIGHT]) {
  // Okrsok number markers: pure-int words in the number column, sorted by Y.
  const markers = words
    .filter((w) => w.x >= b.numLo && w.x <= b.numHi && /^\d{1,2}$/.test(w.t))
    .map((w) => ({ okrsok: +w.t, y: w.y }))
    .sort((a, b) => a.y - b.y);

  // Valid street rows in the column, sorted by Y.
  const rows = clusterRows(words.filter((w) => w.x >= b.strLo && w.x < b.strHi))
    .filter((r) => r.y >= Y_MIN && r.y <= Y_MAX)
    .map((r) => ({ y: r.y, text: rowText(r.ws) }))
    .filter((r) => r.text && !/^Košice-Staré Mesto$/i.test(r.text));

  // Each okrsok number is vertically CENTERED in its block of street rows, so the block
  // boundaries follow the recurrence bound[i] = 2*marker[i].y - bound[i-1], seeded by the
  // top edge of the first block (first street row - half a line). Midpoints between markers
  // would be wrong whenever adjacent okrsky have different street counts.
  const rowYs = rows.map((r) => r.y);
  const spacing = median(rowYs.slice(1).map((y, i) => y - rowYs[i]));
  const bound: number[] = [rows[0].y - spacing / 2];
  for (let i = 0; i < markers.length; i++) bound.push(2 * markers[i].y - bound[i]);
  const okrsokAt = (y: number): number => {
    let k = 0;
    while (k < markers.length - 1 && y >= bound[k + 1]) k++;
    return markers[k].okrsok;
  };

  for (const r of rows) {
    const text = r.text;
    // okrsok 19 admin catch-all wraps onto a second row; drop the orphan continuation.
    if (/^Košice-Staré Mesto$/i.test(text)) continue;
    const okrsok = okrsokAt(r.y);
    // Two parity groups on one row: "Czambelova párne 8 - 18, nepárne 7 - 9" -> two entries.
    const two = text.match(
      /^(.+?)\s+(ne)?párne\s+([\d\s-]+?)\s*,\s*(ne)?párne\s+([\d\s-]+)$/i,
    );
    if (two) {
      pairs.push({ okrsok, entry: `${two[1].trim()} ${two[3].trim()} (${two[2] ? "nepárne" : "párne"})` });
      pairs.push({ okrsok, entry: `${two[1].trim()} ${two[5].trim()} (${two[4] ? "nepárne" : "párne"})` });
      continue;
    }
    // A row may still contain internal commas that split streets/enums ("Moyzesova 17,19").
    for (const entry of splitEntries(text)) pairs.push({ okrsok, entry });
  }
}

const out: Row[] = pairs.map((p) => buildRow(MC, MCNORM, p.okrsok, p.entry));
out.sort((a, b) => a.okrsok - b.okrsok);
writeFileSync("data/ke_stare_mesto_okrsok_streets.json", JSON.stringify(out));
audit(out, 19);
