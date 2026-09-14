// Parse the Košice-Juh 2026 REFERENDUM okrsky PDF (pres. rozh. 60/2026 Z.z., referendum
// 4. júla 2026) into okrsok_streets rows.
//
// Source: kosicejuh.sk/download/42981/ (data/ke_juh_src.pdf). Three columns:
//   Číslo okrsku (x≈64) | Územie = free-text comma street list (x≈133-610) | Volebná miestnosť (x≥643)
// The Územie list wraps across several lines and the okrsok number is VERTICALLY CENTERED in its
// block, so we read `pdftotext -layout -tsv` word boxes, keep only the middle column, group words
// into lines, and partition the ordered lines into 17 contiguous blocks each centered on an okrsok
// number (DP). Each okrsok's list is then tokenised into (street, house-range, parity) rows: parity
// words trail the numbers ("26-36 párne"), "párne i/a nepárne" means BOTH, and a connector "a"/"i"
// before a further number starts a new range of the same street ("1-5 nepárne a 16-38 párne").
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { norm, streetKey } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const PDF = "data/ke_juh_src.pdf";
const MC = "Košice-Juh";
const MCNORM = "juh";
const N_OKRSKY = 17;

type Word = { left: number; top: number; text: string };
const tsv = execFileSync("pdftotext", ["-layout", "-tsv", PDF, "-"], { encoding: "utf8" });
const words: Word[] = [];
for (const line of tsv.split("\n")) {
  const c = line.split("\t");
  if (c.length < 12) continue;
  const text = c[11];
  if (!text || text.startsWith("###") || text === "-1") continue;
  if (!Number.isFinite(+c[6]) || !Number.isFinite(+c[7])) continue; // skip TSV header row
  words.push({ left: +c[6], top: +c[7], text });
}

// okrsok numbers: integer 1..N in the left column (x 55-90), below the table header.
const okrNums = words
  .filter((w) => /^\d+$/.test(w.text) && +w.text >= 1 && +w.text <= N_OKRSKY && w.left >= 55 && w.left <= 92 && w.top > 270)
  .map((w) => ({ okr: +w.text, top: w.top }))
  .sort((a, b) => a.top - b.top);

// Street-list words: middle column only (drops okrsok№ on the left and miestnosť on the right),
// between the header (~270) and the "UPOZORNENIE" footer (~1063).
const streetWords = words
  .filter((w) => w.left >= 115 && w.left < 640 && w.top > 270 && w.top < 1050)
  .sort((a, b) => a.top - b.top || a.left - b.left);

type Line = { top: number; words: Word[] };
const lines: Line[] = [];
for (const w of streetWords) {
  const last = lines[lines.length - 1];
  if (last && Math.abs(w.top - last.top) < 6) last.words.push(w);
  else lines.push({ top: w.top, words: [w] });
}
for (const l of lines) l.words.sort((a, b) => a.left - b.left);

// Assign each line to the okrsok whose centred number is nearest (midpoint boundaries between
// consecutive number tops). Juh's blocks are cleanly centred and this reproduces the ruled table.
const bnd = okrNums.slice(0, -1).map((o, i) => (o.top + okrNums[i + 1].top) / 2);
const okrForTop = (top: number) => { let i = 0; while (i < bnd.length && top >= bnd[i]) i++; return okrNums[i].okr; };

// Join an okrsok's lines into one street list. A line wrap is a plain space when it continues the
// previous token (next line starts with a digit/lowercase = number or parity continuation, or the
// previous line ended on a two-word-street adjective like "Nižné"/"Moldavská"), else the source
// dropped a comma between two streets at the wrap ("Vojvodská" / "Tichá") and we reinsert it.
const PREFIX = new Set(["Nižné", "Vyšné", "Nižná", "Vyšná", "Dolné", "Horné", "Malé", "Veľké", "Malá",
  "Veľká", "Nová", "Stará", "Ul.", "Pri", "Kpt.", "Sv.", "Námestie", "Moldavská", "Sečovská",
  "Pasteurovo", "Červený", "Nad", "Pod"]);
const isCap = (s: string) => s[0] !== s[0].toLowerCase() && s[0] === s[0].toUpperCase();
const joinLines = (ls: Line[]): string => {
  let out = "";
  for (let i = 0; i < ls.length; i++) {
    const txt = ls[i].words.map((w) => w.text).join(" ");
    if (i === 0) { out = txt; continue; }
    const prevLast = ls[i - 1].words[ls[i - 1].words.length - 1].text;
    const first = ls[i].words[0].text;
    const cont = /,$/.test(prevLast) || !isCap(first) || PREFIX.has(prevLast.replace(/,$/, ""));
    out += (cont ? " " : ", ") + txt;
  }
  return out;
};

const okrLines = new Map<number, Line[]>();
for (const l of lines) (okrLines.get(okrForTop(l.top)) ?? okrLines.set(okrForTop(l.top), []).get(okrForTop(l.top))!).push(l);
const okrText = new Map<number, string>();
for (const [o, ls] of okrLines) okrText.set(o, joinLines(ls));

// ---- street-list tokeniser ----
const isParity = (s: string) => /^(ne)?párne$/i.test(s);
// digit-initial token, or a lone SECTION letter ("Skladná 1A, B, C") — but NOT the connectors a/i.
const isNumTok = (s: string) => /^\d/.test(s) || (/^[a-z]$/i.test(s) && s !== "a" && s !== "i");
const parityMark = (p: string) => (p === "odd" ? " (nepárne)" : p === "even" ? " (párne)" : "");

type Row = { street: string; input: string; src: string };
const parseList = (raw0: string): Row[] => {
  // normalise dashes and glue spaced/­wrapped ranges: "26 - 36" / "3 -7" / "15- 25" -> "26-36"
  const raw = raw0.replace(/[–—]/g, "-").replace(/\s+/g, " ").replace(/\s*-\s*/g, "-").trim();
  // fragment on commas; a fragment starting with a digit or lone letter continues the prev street
  const entries: string[] = [];
  for (const frag of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    // digit- or lone-uppercase-letter-initial fragment continues the previous street's number list
    if (/^(?:\d|[A-Z]$)/.test(frag) && entries.length) entries[entries.length - 1] += ", " + frag;
    else entries.push(frag);
  }
  const rows: Row[] = [];
  for (const entry of entries) {
    const toks = entry.replace(/,/g, " , ").split(/\s+/).filter(Boolean);
    // street name = leading alphabetic tokens (not parity/connector), until first number/parity
    const nameToks: string[] = [];
    let p = 0;
    while (p < toks.length) {
      const tk = toks[p];
      if (isNumTok(tk) || isParity(tk) || tk === "a" || tk === "i" || tk === ",") break;
      nameToks.push(tk);
      p++;
    }
    const street = nameToks.join(" ").trim();
    if (!street) continue;
    const rest = toks.slice(p);
    if (!rest.some((x) => isNumTok(x))) {
      // whole street, optional whole-street parity ("Moldavská cesta párne")
      const par = rest.find(isParity);
      const parity = par ? (/nepár/i.test(par) ? "odd" : "even") : "both";
      rows.push({ street, input: `${street}${parityMark(parity)}`, src: entry });
      continue;
    }
    // parse numbers into (nums, parity) groups
    type Grp = { nums: string[]; parity: string };
    const groups: Grp[] = [];
    let nums: string[] = [];
    let par: string | null = null; // null = unset, else odd/even/both
    const flush = () => { if (nums.length) { groups.push({ nums, parity: par ?? "both" }); nums = []; par = null; } };
    for (let q = 0; q < rest.length; q++) {
      const tk = rest[q];
      if (isNumTok(tk)) {
        if (par !== null) flush(); // a new number after a resolved parity => new range
        nums.push(tk);
      } else if (isParity(tk)) {
        const pv = /nepár/i.test(tk) ? "odd" : "even";
        par = par === null ? pv : "both"; // second parity ("párne i nepárne") => both
      } else if (tk === "a" || tk === "i") {
        const nxt = rest[q + 1];
        if (nxt && isNumTok(nxt)) flush(); // connector before a number => new range
        // connector before a parity word => both-combiner, handled when the parity word is read
      } // ignore stray "," tokens
    }
    flush();
    for (const g of groups) {
      rows.push({ street, input: `${street} ${g.nums.join(",")}${parityMark(g.parity)}`, src: entry });
    }
  }
  return rows;
};

type Raw = Row & { okrsok: number };
const raws: Raw[] = [];
for (let okr = 1; okr <= N_OKRSKY; okr++)
  for (const r of parseList(okrText.get(okr) ?? "")) raws.push({ ...r, okrsok: okr });

// Split-street rule: street in >1 okrsok keeps per-okrsok RANGE/ENUM; single-okrsok -> WHOLE.
const okrOfKey = new Map<string, Set<number>>();
for (const r of raws) {
  const k = streetKey(norm(r.street));
  (okrOfKey.get(k) ?? okrOfKey.set(k, new Set()).get(k)!).add(r.okrsok);
}
const wholeDone = new Set<string>();

const out = raws.flatMap((r) => {
  const k = streetKey(norm(r.street));
  const split = (okrOfKey.get(k)?.size ?? 1) > 1;
  let input = r.input;
  if (!split) {
    const dk = `${k}|${r.okrsok}`;
    if (wholeDone.has(dk)) return [];
    wholeDone.add(dk);
    input = r.street; // collapse to WHOLE (drop numbers/parity)
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
    srcSpadove: r.src,
  }];
});

writeFileSync("data/ke_juh_okrsok_streets.json", JSON.stringify(out));

// Audit
const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
console.log(`rows: ${out.length}   okrsky: ${okrs.length} (${okrs[0]}-${okrs[okrs.length - 1]})`);
const missing = [...Array(N_OKRSKY)].map((_, i) => i + 1).filter((n) => !okrs.includes(n));
console.log(`missing okrsky 1-${N_OKRSKY}: ${missing.length ? missing.join(",") : "none"}`);
console.log(`cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
console.log(`rows/okrsok: ${okrs.map((o) => `${o}:${out.filter((r) => r.okrsok === o).length}`).join(" ")}`);
console.log("samples:");
for (const r of [out[0], out[Math.floor(out.length / 2)], out[out.length - 1]]) console.log("  " + JSON.stringify(r));
