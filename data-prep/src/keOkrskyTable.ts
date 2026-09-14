// Shared parser for the Košice per-MČ "REFERENDUM 4.7.2026 / VOLEBNÉ OKRSKY" table PDF.
// Layout is a 3-column Word table: | Okrsok | Názov ulice | Orientačné číslo |. The okrsok
// number is VERTICALLY CENTERED in its cell, so a naive "number labels the line it sits on"
// fails (its street rows sit above AND below it). We read exact word coordinates from
// `pdftotext -tsv`, cluster words into lines, split each line into the 3 columns by x, then
// assign the (already street+number-paired) data rows to okrsok anchors with a contiguous
// DP that minimises |mean(cell rows y) - anchor y| — recovering the true (image-verified) grouping.
//
// Number-spec grammar in these docs: "5,7" / "1,3,5,7,9,11" (enum), "1 - 7 všetky čísla"
// (range both), "2-48 párne čísla" / "1 - 31 nepárne čísla" (range with parity), and
// "s. č. NNNN" (súpisné — building-only addresses, collected per okrsok).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { norm, streetKey } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

export type Word = { page: number; x: number; y: number; text: string };
type Line = { page: number; y: number; okr?: number; street: string; numspec: string };

const readWords = (pdf: string): Word[] => {
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

// Cluster words on one page into lines by y (tolerance ~5px), left-to-right.
const clusterLines = (words: Word[]): { page: number; y: number; words: Word[] }[] => {
  const byPage = new Map<number, Word[]>();
  for (const w of words) (byPage.get(w.page) ?? byPage.set(w.page, []).get(w.page)!).push(w);
  const lines: { page: number; y: number; words: Word[] }[] = [];
  for (const [page, ws] of byPage) {
    ws.sort((a, b) => a.y - b.y || a.x - b.x);
    let cur: Word[] = [];
    let cy = -1e9;
    const flush = () => {
      if (!cur.length) return;
      cur.sort((a, b) => a.x - b.x);
      lines.push({ page, y: cur.reduce((s, w) => s + w.y, 0) / cur.length, words: cur });
      cur = [];
    };
    for (const w of ws) {
      if (Math.abs(w.y - cy) > 5) { flush(); cy = w.y; }
      cur.push(w);
      cy = (cy * (cur.length - 1) + w.y) / cur.length;
    }
    flush();
  }
  return lines;
};

// Normalise a "Orientačné číslo" cell into parseStreetSpec's number syntax.
const normNum = (raw: string): string => {
  // NB: \b is ASCII-only, so it never matches around "čísla"/diacritics — use plain patterns.
  let par = "";
  if (/nepár/i.test(raw)) par = " (nepárne)";
  else if (/pár/i.test(raw)) par = " (párne)";
  let s = raw
    .replace(/čísla?/gi, " ")
    .replace(/všetky/gi, " ")
    .replace(/(?:ne)?párne/gi, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (s + par).trim();
};

export type KeRow = {
  mc: string; mcNorm: string; okrsok: number; obvod: 0;
  street: string; streetNorm: string; parity: string; cls: string;
  numberKind: string; spec: unknown; srcSpadove: string;
};

export const buildKeOkrskyTable = (opts: {
  pdf: string; mc: string; mcNorm: string; slug: string; expectedOkrsky?: number;
  srcUrl: string;
  /** Output file stem: data/<outPrefix><slug>_okrsok_streets.json. Defaults to the referendum
   *  vintage ("ke_"); the komunálne-2026 parsers pass "kv_ke_". */
  outPrefix?: string;
}): KeRow[] => {
  const words = readWords(opts.pdf);
  const rawLines = clusterLines(words);

  // Locate the table header on each page to derive column x-boundaries, then collect data lines.
  const dataLines: Line[] = [];
  const anchors: { num: number; y: number; page: number }[] = [];
  const pages = [...new Set(rawLines.map((l) => l.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const pls = rawLines.filter((l) => l.page === page).sort((a, b) => a.y - b.y);
    // header line: has "Okrsok" and "Orientačné"
    const hdrIdx = pls.findIndex((l) => {
      const t = l.words.map((w) => w.text).join(" ");
      return /Okrsok/i.test(t) && /Orienta/i.test(t);
    });
    if (hdrIdx < 0) continue;
    const hdr = pls[hdrIdx];
    const xOf = (re: RegExp) => hdr.words.find((w) => re.test(w.text))?.x ?? NaN;
    const xOkr = xOf(/Okrsok/i);
    const xNazov = xOf(/N[áa]zov/i);
    const xOrient = xOf(/Orienta/i);
    const b1 = (xOkr + xNazov) / 2; // okrsok | street
    const b2 = (xNazov + xOrient) / 2; // street | number
    for (const l of pls.slice(hdrIdx + 1)) {
      const okrWords = l.words.filter((w) => w.x < b1);
      const streetWords = l.words.filter((w) => w.x >= b1 && w.x < b2);
      const numWords = l.words.filter((w) => w.x >= b2);
      const street = streetWords.map((w) => w.text).join(" ").trim();
      const numspec = numWords.map((w) => w.text).join(" ").trim();
      // okrsok number token
      const okrTok = okrWords.map((w) => w.text).join("").match(/^(\d{1,2})\.?$/);
      const okr = okrTok ? +okrTok[1] : undefined;
      if (okr !== undefined) anchors.push({ num: okr, y: l.y, page });
      if (street || numspec) dataLines.push({ page, y: l.y, okr, street, numspec });
    }
  }

  // Global y ordering across pages (page then y). Give each page a large y offset.
  const key = (p: number, y: number) => p * 100000 + y;
  const anc = anchors.map((a) => ({ num: a.num, gy: key(a.page, a.y) })).sort((x, y) => x.gy - y.gy);
  const rows = dataLines.map((d) => ({ ...d, gy: key(d.page, d.y) })).sort((x, y) => x.gy - y.gy);

  // Contiguous DP: assign rows[0..M) to anchors[0..N) minimising sum |mean(cell y) - anchor y|.
  const M = rows.length, N = anc.length;
  const pref = [0];
  for (let i = 0; i < M; i++) pref.push(pref[i] + rows[i].gy);
  const cost = (i: number, j: number, k: number) => {
    const mean = (pref[j] - pref[i]) / (j - i);
    return Math.abs(mean - anc[k].gy);
  };
  const INF = 1e18;
  const dp = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(INF));
  const bk = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(-1));
  dp[0][0] = 0;
  for (let k = 1; k <= N; k++)
    for (let j = k; j <= M - (N - k); j++)
      for (let i = k - 1; i < j; i++) {
        const c = dp[k - 1][i] + cost(i, j, k - 1);
        if (c < dp[k][j]) { dp[k][j] = c; bk[k][j] = i; }
      }
  // backtrack cell boundaries
  const assign = new Array<number>(M).fill(-1);
  let j = M;
  for (let k = N; k >= 1; k--) {
    const i = bk[k][j];
    for (let r = i; r < j; r++) assign[r] = anc[k - 1].num;
    j = i;
  }

  // street key -> set of okrsky (to decide WHOLE vs keep-spec) — súpisné rows excluded.
  const isSup = (numspec: string) => /^s\.?\s*č\.?/i.test(numspec.trim());
  const okrOfKey = new Map<string, Set<number>>();
  const supByOkr = new Map<number, string[]>();
  rows.forEach((r, idx) => {
    const okr = assign[idx];
    if (r.street && !isSup(r.numspec)) {
      const k = streetKey(norm(r.street));
      (okrOfKey.get(k) ?? okrOfKey.set(k, new Set()).get(k)!).add(okr);
    } else if (isSup(r.numspec) || (!r.street && /^\d/.test(r.numspec))) {
      const m = r.numspec.match(/(\d+)/);
      if (m && +m[1] !== 0) (supByOkr.get(okr) ?? supByOkr.set(okr, []).get(okr)!).push(m[1]);
    }
  });

  const out: KeRow[] = [];
  const seenWhole = new Set<string>();
  rows.forEach((r, idx) => {
    const okrsok = assign[idx];
    if (!r.street || isSup(r.numspec)) return; // súpisné handled below
    const k = streetKey(norm(r.street));
    const split = (okrOfKey.get(k)?.size ?? 1) > 1;
    let input: string;
    if (split) {
      const nn = normNum(r.numspec);
      input = nn ? `${r.street} ${nn}` : r.street;
    } else {
      const wkey = `${okrsok}|${k}`;
      if (seenWhole.has(wkey)) return; // one WHOLE row per (okrsok, street)
      seenWhole.add(wkey);
      input = r.street; // single-okrsok street -> WHOLE (robust to RA extras)
    }
    const parsed = parseStreetSpec(input);
    out.push({
      mc: opts.mc, mcNorm: opts.mcNorm, okrsok, obvod: 0,
      street: parsed.street || r.street, streetNorm: parsed.streetNorm || norm(r.street),
      parity: parsed.parity, cls: parsed.cls, numberKind: parsed.numberKind,
      spec: parsed.spec,
      srcSpadove: `${r.street} ${r.numspec}`.trim(),
    });
  });
  // súpisné ENUM row per okrsok
  for (const [okrsok, list] of [...supByOkr].sort((a, b) => a[0] - b[0])) {
    const parsed = parseStreetSpec(`Súpisne čísla ${list.join(", ")}`);
    out.push({
      mc: opts.mc, mcNorm: opts.mcNorm, okrsok, obvod: 0,
      street: "", streetNorm: "", parity: parsed.parity, cls: parsed.cls,
      numberKind: parsed.numberKind, spec: parsed.spec,
      srcSpadove: list.map((n) => `s. č. ${n}`).join(", "),
    });
  }
  out.sort((a, b) => a.okrsok - b.okrsok);

  writeFileSync(`data/${opts.outPrefix ?? "ke_"}${opts.slug}_okrsok_streets.json`, JSON.stringify(out));

  // Audit
  const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
  console.log(`src: ${opts.srcUrl}`);
  console.log(`rows: ${out.length}   okrsky: ${okrs.length} [${okrs.join(",")}]`);
  console.log(`cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
  if (opts.expectedOkrsky) {
    const miss = [...Array(opts.expectedOkrsky)].map((_, i) => i + 1).filter((n) => !okrs.includes(n));
    console.log(`missing (of 1-${opts.expectedOkrsky}): ${miss.length ? miss.join(",") : "none"}`);
  }
  const split = [...okrOfKey].filter(([, s]) => s.size > 1).map(([k]) => k);
  console.log(`split streets (${split.length}): ${split.join(", ")}`);
  return out;
};
