// Košice-Sever 2026 REFERENDUM okrsok→street assignment.
// Source: kosicesever.sk evt_file.php?file=1601 = "OZNÁMENIE o určení volebných okrskov a
// volebných miestností ... pre referendum, ktoré sa bude konať dňa 4. júla 2026". 12 okrsky.
//
// Clean single-column PDF (pdftotext -layout): each okrsok is "N.  <comma street list>"
// wrapping across lines, with the polling place (VOLEBNÁ MIESTNOSŤ) in a right-hand column
// that bleeds onto the first street lines (separated by a wide gap) and also occupies its own
// far-right lines. We keep field[0] of a >=2-space split (drops the bleed) and skip lines whose
// text sits far right (polling-place-only). House ranges carry a parenthesized parity word.
import { readFileSync, writeFileSync } from "node:fs";
import { audit, buildRow, splitEntries, type Row } from "./keCommon.ts";

const MC = "Košice-Sever";
const MCNORM = "sever";

const lines = readFileSync("data/ke_sever.txt", "utf8").split("\n");

// street text (col 0) is left of the polling-place column; a run of >=2 spaces separates them.
const streetPart = (s: string): string => s.split(/\s{2,}/)[0].trim();

type Bucket = { okrsok: number; text: string };
const buckets: Bucket[] = [];
let cur: Bucket | null = null;
let started = false;

for (const raw of lines) {
  const line = raw.replace(/\s+$/, "");
  const t = line.trim();
  if (!t) continue;
  const head = t.match(/^(\d+)\.\s+(.+)$/);
  if (head) {
    started = true;
    cur = { okrsok: +head[1], text: streetPart(head[2]) };
    buckets.push(cur);
    continue;
  }
  if (!started || !cur) continue;
  if (/^(Košice,|Ing\.|starosta)/i.test(t)) break; // footer
  // Polling-place-only continuation lines sit far to the right (deep leading indent).
  const indent = line.length - line.trimStart().length;
  if (indent > 40) continue;
  // Join wrapped lines with a SPACE, not a comma: commas already delimit streets, and a
  // street name can wrap mid-name ("…Vonkajší" + "Červený breh…"). A trailing comma at a
  // line end is preserved, so real street boundaries survive.
  cur.text += " " + streetPart(t);
}

// Two space-glued streets in okr9 ("Pod šiancom Vodárenská") lack their separating comma.
const FIXES: [RegExp, string][] = [[/Pod šiancom Vodárenská/g, "Pod šiancom, Vodárenská"]];

const out: Row[] = [];
for (const b of buckets) {
  let text = b.text;
  for (const [re, rep] of FIXES) text = text.replace(re, rep);
  for (const entry of splitEntries(text)) out.push(buildRow(MC, MCNORM, b.okrsok, entry));
}

writeFileSync("data/ke_sever_okrsok_streets.json", JSON.stringify(out));
audit(out, 12);
