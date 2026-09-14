// Parse the Košice-Sídlisko KVP 2026 REFERENDUM okrsky PDF (pres. rozh. 60/2026 Z.z.,
// referendum 4. júla 2026) into okrsok_streets rows.
//
// Source: mckvp.sk .../referendum26/okrsky/Volebné okrsky_2026 (data/ke_kvp_src.pdf), a
// 5-column table on page 2: okrsok№ | ulica | čísla | (ne)párne/všetky | volebná miestnosť.
// Each street sits on its own line; the okrsok number is VERTICALLY CENTERED in its block
// (streets appear both above and below it), so a naive top-down carry-forward misassigns —
// we read word coordinates from `pdftotext -layout -tsv` and bucket each content line into the
// okrsok whose centered number is nearest (midpoint boundaries between consecutive numbers).
// Column x-bands (page 2): okrsok≈98, street≈142-200, čísla≈246-310, parity≈324, miestnosť≥400.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { norm, streetKey } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const PDF = "data/ke_kvp_src.pdf";
const MC = "Košice-Sídlisko KVP";
const MCNORM = "sidlisko kvp";
const N_OKRSKY = 18;

type Word = { page: number; left: number; top: number; text: string };

// pdftotext -tsv → word rows with bounding boxes. Columns:
// level page par block line word left top width height conf text
const tsv = execFileSync("pdftotext", ["-layout", "-tsv", PDF, "-"], { encoding: "utf8" });
const words: Word[] = [];
for (const line of tsv.split("\n")) {
  const c = line.split("\t");
  if (c.length < 12) continue;
  const text = c[11];
  if (!text || text.startsWith("###") || text === "-1") continue;
  if (!Number.isFinite(+c[1]) || !Number.isFinite(+c[6])) continue; // skip TSV header row
  words.push({ page: +c[1], left: +c[6], top: +c[7], text });
}

// The table lives on the last page (page 2). okrsok numbers: integer 1..N in the left column.
const page = Math.max(...words.map((w) => w.page));
const pageWords = words.filter((w) => w.page === page);

const okrNums = pageWords
  .filter((w) => /^\d+$/.test(w.text) && +w.text >= 1 && +w.text <= N_OKRSKY && w.left >= 88 && w.left <= 112)
  .map((w) => ({ okr: +w.text, top: w.top }))
  .sort((a, b) => a.top - b.top);

// Group content words (exclude okrsok column <105 and miestnosť column ≥395) into lines by `top`.
const contentWords = pageWords
  // Lower bound sits between the column header (ends ~15px above) and okr1's first street, which
  // sits ABOVE okr1's centered number; upper bound drops the trailing "Poznámka" footer prose.
  .filter((w) => w.left > 105 && w.left < 395 && w.top >= okrNums[0].top - 18 && w.top <= okrNums[okrNums.length - 1].top + 30)
  .sort((a, b) => a.top - b.top || a.left - b.left);

type Line = { top: number; words: Word[] };
const lines: Line[] = [];
for (const w of contentWords) {
  const last = lines[lines.length - 1];
  if (last && Math.abs(w.top - last.top) < 5) last.words.push(w);
  else lines.push({ top: w.top, words: [w] });
}

// Assign each content line to an okrsok. The okrsok number is VERTICALLY CENTERED in its block
// (streets both above and below it) — confirmed against the ruled table image — so a nearest-number
// / midpoint rule mis-steals boundary rows into singleton blocks. Instead partition the ordered
// lines into K contiguous non-empty blocks minimising Σ|centre(block) − numberTop|, where
// centre = (firstTop+lastTop)/2. DP over lines × okrsky, then backtrack.
const t = lines.map((l) => l.top);
const n = okrNums.map((o) => o.top);
const m = t.length, K = n.length;
const INF = 1e18;
const cost = (i: number, j: number, k: number) => Math.abs((t[i] + t[j]) / 2 - n[k]); // rows i..j (sorted)
const dp: number[][] = Array.from({ length: K + 1 }, () => Array(m + 1).fill(INF));
const back: number[][] = Array.from({ length: K + 1 }, () => Array(m + 1).fill(-1));
dp[0][0] = 0;
for (let k = 1; k <= K; k++)
  for (let i = k; i <= m; i++)
    for (let j = k - 1; j < i; j++) {
      const c = dp[k - 1][j] + cost(j, i - 1, k - 1);
      if (c < dp[k][i]) { dp[k][i] = c; back[k][i] = j; }
    }
const lineOkr: number[] = Array(m).fill(0);
let ii = m;
for (let k = K; k >= 1; k--) { const j = back[k][ii]; for (let x = j; x < ii; x++) lineOkr[x] = okrNums[k - 1].okr; ii = j; }

const isParity = (s: string) => /^(ne)?párne$|^všetky$/i.test(s);
const isNum = (s: string) => /^\d/.test(s);

type Raw = { okrsok: number; street: string; numbers: string; parity: string };
const raws: Raw[] = [];
lines.forEach((ln, idx) => {
  const ws = ln.words.sort((a, b) => a.left - b.left);
  const streetW: string[] = [];
  const numW: string[] = [];
  let parityW = "";
  for (const w of ws) {
    if (isParity(w.text)) parityW = w.text.toLowerCase();
    else if (isNum(w.text) || numW.length) numW.push(w.text);
    else streetW.push(w.text);
  }
  const street = streetW.join(" ").trim();
  const numbers = numW.join(" ").trim();
  if (!street || !numbers) return; // miestnosť-only / okrsok-marker line
  raws.push({ okrsok: lineOkr[idx], street, numbers, parity: parityW });
});

// Split-street rule: a street present in >1 okrsok keeps its per-okrsok RANGE/ENUM; a street in a
// single okrsok collapses to WHOLE (drops house numbers — robust to RA carrying extra numbers).
const okrOfKey = new Map<string, Set<number>>();
for (const r of raws) {
  const k = streetKey(norm(r.street));
  (okrOfKey.get(k) ?? okrOfKey.set(k, new Set()).get(k)!).add(r.okrsok);
}
// Emit at most one WHOLE row per (street, okrsok) for single-okrsok streets.
const wholeDone = new Set<string>();

const parityWord = (p: string) => (p === "párne" ? " (párne)" : p === "nepárne" ? " (nepárne)" : "");

const out = raws.flatMap((r) => {
  const k = streetKey(norm(r.street));
  const split = (okrOfKey.get(k)?.size ?? 1) > 1;
  let input: string;
  let src: string;
  if (!split) {
    const dk = `${k}|${r.okrsok}`;
    if (wholeDone.has(dk)) return [];
    wholeDone.add(dk);
    input = r.street;
    src = `${r.street} ${r.numbers}${r.parity ? " " + r.parity : ""}`.trim();
  } else {
    input = `${r.street} ${r.numbers}${parityWord(r.parity)}`;
    src = `${r.street} ${r.numbers}${r.parity ? " " + r.parity : ""}`.trim();
  }
  const parsed = parseStreetSpec(input);
  return [{
    mc: MC,
    mcNorm: MCNORM,
    okrsok: r.okrsok,
    obvod: 0,
    street: parsed.street || r.street,
    streetNorm: parsed.streetNorm || norm(r.street),
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    srcSpadove: src,
  }];
});

writeFileSync("data/ke_sidlisko_kvp_okrsok_streets.json", JSON.stringify(out));

// Audit
const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
console.log(`rows: ${out.length}   okrsky: ${okrs.length} (${okrs[0]}-${okrs[okrs.length - 1]})`);
const missing = [...Array(N_OKRSKY)].map((_, i) => i + 1).filter((n) => !okrs.includes(n));
console.log(`missing okrsky 1-${N_OKRSKY}: ${missing.length ? missing.join(",") : "none"}`);
console.log(`cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
console.log(`rows/okrsok: ${okrs.map((o) => `${o}:${out.filter((r) => r.okrsok === o).length}`).join(" ")}`);
console.log("samples:");
for (const r of [out[0], out[Math.floor(out.length / 2)], out[out.length - 1]]) console.log("  " + JSON.stringify(r));
