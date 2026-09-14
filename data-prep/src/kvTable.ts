// Reusable machinery for okrsok tables whose okrsok-number cell is VERTICALLY CENTERED.
//
// Word/Excel tables merge the okrsok cell across all of that okrsok's street rows and centre the
// number in it, so `pdftotext -layout` prints the number beside a MIDDLE street row — rows both
// ABOVE and BELOW it belong to that okrsok. Any "a number starts a new block" reader therefore
// mis-assigns the rows above each anchor. keOkrskyTable.ts solved this for the one 3-column
// "Okrsok | Názov ulice | Orientačné číslo" layout; the 2026 municipal-election documents use
// several different column sets, so the shared parts live here and each MČ only supplies its own
// column mapping.
import { execFileSync } from "node:child_process";
import { norm, streetKey } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";
import { proseRange } from "./kvCommon.ts";
import type { Row } from "./keCommon.ts";

export type Word = { page: number; x: number; y: number; text: string };
export type TextLine = { page: number; y: number; gy: number; words: Word[] };

export const readWords = (pdf: string): Word[] => {
  const tsv = execFileSync("pdftotext", ["-tsv", pdf, "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const out: Word[] = [];
  for (const ln of tsv.split("\n")) {
    const c = ln.split("\t");
    if (c[0] !== "5") continue; // word level
    const text = c[11]?.trim();
    if (!text) continue;
    out.push({ page: +c[1], x: +c[6], y: +c[7], text });
  }
  return out;
};

/** Global y ordering across pages, so a run of rows can span a page break. */
const gkey = (page: number, y: number) => page * 100000 + y;

/** Cluster words into visual lines (y tolerance ~5px), left-to-right, in reading order. */
export const clusterLines = (words: Word[]): TextLine[] => {
  const byPage = new Map<number, Word[]>();
  for (const w of words) (byPage.get(w.page) ?? byPage.set(w.page, []).get(w.page)!).push(w);
  const lines: TextLine[] = [];
  for (const [page, ws] of byPage) {
    ws.sort((a, b) => a.y - b.y || a.x - b.x);
    let cur: Word[] = [];
    let cy = -1e9;
    const flush = () => {
      if (!cur.length) return;
      cur.sort((a, b) => a.x - b.x);
      const y = cur.reduce((s, w) => s + w.y, 0) / cur.length;
      lines.push({ page, y, gy: gkey(page, y), words: cur });
      cur = [];
    };
    for (const w of ws) {
      if (Math.abs(w.y - cy) > 5) {
        flush();
        cy = w.y;
      }
      cur.push(w);
      cy = (cy * (cur.length - 1) + w.y) / cur.length;
    }
    flush();
  }
  return lines.sort((a, b) => a.gy - b.gy);
};

/** Join the words of a line whose x falls in [lo, hi). */
export const colText = (line: TextLine, lo: number, hi: number): string =>
  line.words.filter((w) => w.x >= lo && w.x < hi).map((w) => w.text).join(" ").trim();

export type Cell = { gy: number; street: string; numspec: string };
export type Anchor = { num: number; gy: number };

/**
 * Add a table row to `cells`, folding a house-number CONTINUATION into the row above.
 *
 * A long "Čísla domov" list wraps onto further lines that carry no street name. Left as rows of
 * their own they are not merely empty — they shift every later row relative to the okrsok
 * anchors, so the contiguous DP slices the blocks in the wrong places and whole okrsky end up
 * holding nothing but a fragment of their neighbour's number list.
 *
 * A súpisné-only row ("s. č. 2669") is NOT a continuation: those are real addresses with no
 * street, and emitRows collects them per okrsok.
 */
export const pushCell = (cells: Cell[], cell: Cell): void => {
  const prev = cells[cells.length - 1];
  const isContinuation =
    !cell.street && cell.numspec && !/^s\.?\s*č\.?/i.test(cell.numspec.trim()) && prev?.street;
  if (isContinuation) prev.numspec = `${prev.numspec}, ${cell.numspec}`.replace(/,\s*,/g, ",");
  else cells.push(cell);
};

/**
 * Assign each cell to an okrsok anchor with a CONTIGUOUS partition that minimises
 * Σ |mean(y of the cells in a block) − y of that block's anchor|.
 *
 * Because the anchor sits at the vertical centre of its block, the true grouping is the one whose
 * block centroids land on the anchors — which is what this recovers, regardless of how many rows
 * sit above vs below each number.
 */
export const assignAnchors = (cells: Cell[], anchors: Anchor[]): number[] => {
  const anc = [...anchors].sort((a, b) => a.gy - b.gy);
  const M = cells.length;
  const N = anc.length;
  if (!M || !N) return new Array(M).fill(-1);

  const pref = [0];
  for (let i = 0; i < M; i++) pref.push(pref[i] + cells[i].gy);
  const cost = (i: number, j: number, k: number) => Math.abs((pref[j] - pref[i]) / (j - i) - anc[k].gy);

  const INF = 1e18;
  const dp = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(INF));
  const bk = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(-1));
  dp[0][0] = 0;
  for (let k = 1; k <= N; k++) {
    for (let j = k; j <= M - (N - k); j++) {
      for (let i = k - 1; i < j; i++) {
        const c = dp[k - 1][i] + cost(i, j, k - 1);
        if (c < dp[k][j]) {
          dp[k][j] = c;
          bk[k][j] = i;
        }
      }
    }
  }

  const assign = new Array<number>(M).fill(-1);
  let j = M;
  for (let k = N; k >= 1; k--) {
    const i = bk[k][j];
    if (i < 0) break;
    for (let r = i; r < j; r++) assign[r] = anc[k - 1].num;
    j = i;
  }
  return assign;
};

/** Normalise an "orientačné číslo" cell into parseStreetSpec's number syntax. */
export const normNum = (raw: string): string => {
  // NB: \b is ASCII-only so it never matches around "čísla"/diacritics — use plain patterns.
  // A cell naming BOTH parities ("1-19 nepárne, 2-20 párne") cannot be reduced to one parity
  // word: parseStreetSpec would bind it to the last range only, and its contradiction guard then
  // widens both ranges to "both" — the okrsok would claim both sides of both ranges and every
  // point shared with the neighbouring okrsok would go ambiguous. Leave such a cell alone and let
  // expandMultiSpec split it into one spec per parity.
  const both = /nepár/i.test(raw) && /(?:^|[^e])pár/i.test(raw.replace(/nepár/gi, ""));
  let par = "";
  if (both) par = "";
  else if (/nepár/i.test(raw)) par = " (nepárne)";
  else if (/pár/i.test(raw)) par = " (párne)";
  if (both) return raw.replace(/\s*[-–]\s*/g, "-").replace(/\s+/g, " ").trim();
  const s = raw
    .replace(/čísla?/gi, " ")
    .replace(/všetky/gi, " ")
    .replace(/(?:ne)?párne/gi, " ")
    .replace(/\s*[-–]\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (s + par).trim();
};

const isSup = (numspec: string) => /^s\.?\s*č\.?/i.test(numspec.trim());

/**
 * Turn (okrsok, street, numspec) cells into output rows.
 *
 * A street confined to ONE okrsok becomes WHOLE — deliberately ignoring the document's house
 * list, which is routinely incomplete (new builds, vacant addresses) and would otherwise leave
 * real RA points unmatched. A street SPLIT across okrsky keeps its per-okrsok number spec,
 * because there the numbers are what decides who gets which houses.
 */
export const emitRows = (
  opts: { mc: string; mcNorm: string },
  cells: { okrsok: number; street: string; numspec: string }[],
): Row[] => {
  const okrOfKey = new Map<string, Set<number>>();
  const supByOkr = new Map<number, string[]>();
  for (const c of cells) {
    if (c.okrsok < 0) continue;
    if (c.street && !isSup(c.numspec)) {
      const k = streetKey(norm(c.street));
      (okrOfKey.get(k) ?? okrOfKey.set(k, new Set()).get(k)!).add(c.okrsok);
    } else if (isSup(c.numspec) || (!c.street && /^\d/.test(c.numspec))) {
      // A cell may list several ("s. č. 2669, 2671, 2680") — keeping only the first silently
      // leaves those buildings with no seed.
      for (const m of c.numspec.matchAll(/\d+/g)) {
        if (+m[0] !== 0) (supByOkr.get(c.okrsok) ?? supByOkr.set(c.okrsok, []).get(c.okrsok)!).push(m[0]);
      }
    }
  }

  const out: Row[] = [];
  const seenWhole = new Set<string>();
  for (const c of cells) {
    if (c.okrsok < 0 || !c.street || isSup(c.numspec)) continue;
    const k = streetKey(norm(c.street));
    const split = (okrOfKey.get(k)?.size ?? 1) > 1;
    let input: string;
    if (split) {
      const nn = normNum(c.numspec);
      input = nn ? `${c.street} ${nn}` : c.street;
    } else {
      const wkey = `${c.okrsok}|${k}`;
      if (seenWhole.has(wkey)) continue; // one WHOLE row per (okrsok, street)
      seenWhole.add(wkey);
      input = c.street;
    }
    const p = parseStreetSpec(proseRange(input));
    out.push({
      mc: opts.mc,
      mcNorm: opts.mcNorm,
      okrsok: c.okrsok,
      obvod: 0,
      street: p.street || c.street,
      streetNorm: p.streetNorm || norm(c.street),
      parity: p.parity,
      cls: p.cls,
      numberKind: p.numberKind,
      spec: p.spec,
      srcSpadove: `${c.street} ${c.numspec}`.trim(),
    });
  }

  // Súpisné-only addresses (buildings with no street number) collapse to one ENUM row per okrsok.
  for (const [okrsok, list] of [...supByOkr].sort((a, b) => a[0] - b[0])) {
    const p = parseStreetSpec(`Súpisne čísla ${list.join(", ")}`);
    out.push({
      mc: opts.mc,
      mcNorm: opts.mcNorm,
      okrsok,
      obvod: 0,
      street: "",
      streetNorm: "",
      parity: p.parity,
      cls: p.cls,
      numberKind: p.numberKind,
      spec: p.spec,
      srcSpadove: list.map((n) => `s. č. ${n}`).join(", "),
    });
  }

  out.sort((a, b) => a.okrsok - b.okrsok);
  return out;
};

export const auditTable = (out: Row[], expected: number, label: string): void => {
  const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
  const miss = [...Array(expected)].map((_, i) => i + 1).filter((n) => !okrs.includes(n));
  console.log(`\n=== ${label} (expect ${expected}) ===`);
  console.log(`rows: ${out.length}   okrsky: ${okrs.length}`);
  console.log(
    `cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`,
  );
  console.log(`missing (of 1-${expected}): ${miss.length ? miss.join(",") : "none"}`);
};
