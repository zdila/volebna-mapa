// Košice-Západ 2026 REFERENDUM okrsok→street assignment.
// Source: kosicezapad.sk "Utvorenie volebných okrskov a určenie volebných miestností pre
// konanie referenda", tab "Referendum 2026" (module mid_578103). This is an HTML PAGE, not a
// PDF. Published 7.5.2026, updated 3.7.2026, starosta Mgr. Marcel Vrchota. 16 okrsky.
//
// ⚠️ The boilerplate intro of THIS panel mis-cites presidential decision "č. 362/2022 Z. z."
// (a copy-paste leftover from the 2023 referendum); the DIVISION itself is the 2026 one — it
// is filed under the Referendum-2026 tab, timestamped 2026, and matches the ~16-okrsok 2026
// expectation. Verified: Vrchota is the current Košice-Západ starosta and the page was
// published/updated in 2026 for the 4 July 2026 referendum.
//
// The panel lists, per okrsok in order, a polling-place ("Základná škola …") line followed by
// one comma-separated street line (with house ranges + parity words). Okrsky are NOT numbered
// inline — numbering is sequential 1..16 (the page's own note "…zapísaní vo volebnom okrsku č.
// 2" confirms the 2nd block = okrsok 2). House ranges carry a trailing "párne"/"nepárne", and
// "párne, nepárne" means both sides.
import { readFileSync, writeFileSync } from "node:fs";
import { audit, buildRow, splitEntries, type Row } from "./keCommon.ts";

const MC = "Košice-Západ";
const MCNORM = "zapad";

const html = readFileSync("data/ke_zapad.html", "utf8");
const start = html.indexOf('id="mid_578103"');
const nextPanel = html.indexOf('id="mid_', start + 10);
const panel = html.slice(start, nextPanel > 0 ? nextPanel : undefined);

// Panel HTML -> plain text lines (one block per line).
const lines = panel
  .replace(/<[^>]+>/g, "\n")
  .replace(/&nbsp;/g, " ")
  .replace(/[ \t]+/g, " ")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

const IS_MIESTNOST = /^(Základná|Materská|Súkromná|Cirkevná|Súkromn|Gymnázium|Stredná|Kultúr)/i;
const IS_BOILER = /Utvorenie volebných|V súlade s § 8|utváram volebné/i;
const IS_END = /^Pozn\.|^Mgr\.|Zverejnené|Aktualizované|^Späť|Vrchota|^starosta/i;

type Bucket = { okrsok: number; text: string };
const buckets: Bucket[] = [];
let okrsok = 0;
let expectStreets = false;

for (const line of lines) {
  if (IS_END.test(line)) break;
  if (IS_BOILER.test(line)) continue;
  if (IS_MIESTNOST.test(line)) {
    okrsok++;
    expectStreets = true;
    continue;
  }
  if (expectStreets) {
    buckets.push({ okrsok, text: line });
    expectStreets = false;
  }
}

const out: Row[] = [];
for (const b of buckets) {
  for (const entry of splitEntries(b.text)) out.push(buildRow(MC, MCNORM, b.okrsok, entry));
}

writeFileSync("data/ke_zapad_okrsok_streets.json", JSON.stringify(out));
audit(out, 16);
