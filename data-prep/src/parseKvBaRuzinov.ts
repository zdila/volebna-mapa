// Bratislava-Ružinov — KOMUNÁLNE VOĽBY 24.10.2026 street→okrsok assignment.
// Source: ruzinov.sk/sk/stranky/view/zoznam-ulic-a-okrskov-abecedne, "Zoznam ulíc a okrskov
// abecedne". Unusually for this dataset it is a clean server-rendered HTML TABLE, not a PDF:
// | Ulica | Orientačné čísla | Okrsok číslo | Adresa volebnej miestnosti |, one row per
// (street, okrsok) pair with "celá" meaning the whole street. Each row already names its okrsok,
// so no okrsok-anchor inference is needed — only the WHOLE-vs-split decision in emitRows.
import { readFileSync, writeFileSync } from "node:fs";
import { auditTable, emitRows } from "./kvTable.ts";

const MC = "Bratislava-Ružinov";
const MCNORM = "ruzinov";

const html = readFileSync("data/kv_ba_ruzinov.html", "utf8");
const cellText = (s: string) =>
  s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const cells: { okrsok: number; street: string; numspec: string }[] = [];
for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const cols = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1]));
  if (cols.length !== 4) continue;
  const [street, numspec, okr] = cols;
  const m = okr.match(/^(\d+)$/);
  if (!m || !street) continue; // header row and any stray non-numeric okrsok cell
  cells.push({ okrsok: +m[1], street, numspec });
}

const out = emitRows({ mc: MC, mcNorm: MCNORM }, cells);
writeFileSync("data/kv_ba_ruzinov_okrsok_streets.json", JSON.stringify(out));
const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
auditTable(out, Math.max(0, ...okrs), MC);
console.log(`source table rows: ${cells.length}`);
