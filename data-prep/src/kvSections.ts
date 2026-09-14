// Section-scanning engine shared by the KOMUNÁLNE VOĽBY 24.10.2026 parsers.
//
// Most okrsok documents are prose, not tables: an okrsok header line, then that okrsok's streets
// either as a comma-separated list that wraps across lines or one street per line. What differs
// between MČ is only which line opens a section, which line starts the street list, and what
// counts as chrome — so those are configuration, not code. Documents whose okrsok cell is
// vertically centred in a real table need the coordinate reader in kvTable.ts instead.
import { readFileSync } from "node:fs";
import { splitEntries, type Row } from "./keCommon.ts";
import { buildKvRow, normalizeEntry } from "./kvCommon.ts";

export type Cfg = {
  /** Override the output path. Nové Mesto needs it: it also has an authoritative per-address
   *  parser writing the default name, and whichever ran last used to win. */
  out?: string;
  slug: string;
  mc: string;
  mcNorm: string;
  okrsky: number;
  src: string;
  /** Ignore everything before this line — for pages whose navigation/news text above the notice
   *  contains lines that would otherwise look like okrsok headers. */
  startAfter?: RegExp;
  /** Starts a new okrsok section; group 1 is the okrsok number. */
  header: RegExp;
  /** Inside a section, only collect street text after this line (the "Zoznam ulíc:" cue). */
  streetsAfter?: RegExp;
  /** One street per line (else the section text is one big comma-separated list). */
  perLine?: boolean;
  /** Take field[0] of a >=2-space split, dropping a right-hand polling-place column. */
  colSplit?: boolean;
  /** Stop parsing entirely (document footer). Only tested once a section has opened, so it may
   *  safely match wording that also appears in the document's preamble ("starosta …"). */
  stop?: RegExp;
  /** Lines to ignore inside a section (page chrome, polling-place lines, catch-all entries). */
  skip?: RegExp;
  /** Closes the current section without ending the parse — for docs that put each okrsok on its
   *  own page and repeat the signature block and preamble every time (Šaca). */
  endSection?: RegExp;
  /** A line matching this CONTINUES the previous street entry instead of starting a new one —
   *  for docs that wrap a long house-number list onto its own line ("45, 47, 49, …"). */
  contLine?: RegExp;
  /** Page holds TWO independent okrsok columns side by side; segments starting at or after this
   *  character column belong to the right-hand one. Each column tracks its own current okrsok. */
  twoUpAt?: number;
};


// "občania s trvalým pobytom na obci / bez konkrétnej adresy" and similar catch-all entries name
// no real street — they are the administrative address of the MČ office and carry no geometry.
/**
 * Document footers that end the street list in EVERY document, whatever the per-MČ config says.
 *
 * "Poznámka: Voliči s trvalým pobytom … sú zapísaní vo volebnom okrsku č. N" closes the last
 * okrsok in five of the Košice documents. Without this it is appended to the final street of the
// `záhradkárs` used to match bare, and killed Dúbravka's real street ZÁHRADKÁRSKA along with
// Čunovo's catch-all "ZÁHRADKÁRSKA OSADA". Now an allotment entry must either name the colony
// (…osada / oblasť / kolónia) or appear in an oblique adjective form ("záhradkárskych osád"),
// which a street name printed alone never does.
 * list (no comma separates them), and because the sentence contains "trvalým pobytom" the CATCHALL
 * filter then discards the whole entry — silently taking that street with it. Krásna lost
 * Urbárska this way, Barca lost Zinková.
 */
const FOOTER = /^Pozn(ámka)?\s*[.:]/i;

/** A whole line that is a catch-all entry, not a street. Anchored, unlike CATCHALL, which is
 *  matched against a single already-split entry and so may fire anywhere inside it. */
export const CATCHALL_LINE =
  /^[+•*-]?\s*(občan|osoby s TP|voliči s trval|voliči bez|bez adresy|bez ulice|bez konkrétnej adresy)/i;

export const CATCHALL =
  /(občan|osoby s TP|trval[ýé]m? pobyt|bez konkrétnej adresy|bez adresy|bez ulice|záhradkársk(?:ych|ej|ou|ymi|e)\b|záhradkársk\w*\s+(?:osad|oblas|kolón)|zrušen)/i;

type Bucket = { okrsok: number; parts: string[] };

/** Split a line into its whitespace-separated segments, each tagged with its start column. */
const segments = (line: string): { col: number; text: string }[] => {
  const out: { col: number; text: string }[] = [];
  const re = /\S(?:.*?\S)?(?=\s{3,}|$)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.push({ col: m.index, text: m[0] });
  return out;
};

export const parseSections = (cfg: Cfg): Row[] => {
  const lines = readFileSync(cfg.src, "utf8").split("\n");
  const buckets: Bucket[] = [];
  // One open section per column ("left"/"right"); single-column docs only ever use index 0.
  const cur: (Bucket | null)[] = [null, null];
  const collecting = [false, false];
  let started = false;
  let armed = !cfg.startAfter;

  // Feed one piece of text into the section owned by column `side`.
  const take = (side: number, text: string) => {
    const t = text.trim();
    if (!t) return;

    const h = t.match(cfg.header);
    if (h) {
      cur[side] = { okrsok: +h[1], parts: [] };
      buckets.push(cur[side]!);
      collecting[side] = !cfg.streetsAfter;
      started = true;
      const rest = t.slice(h[0].length).trim();
      if (collecting[side] && rest) {
        cur[side]!.parts.push(cfg.colSplit ? rest.split(/\s{2,}/)[0].trim() : rest);
      }
      return;
    }
    if (!cur[side]) return;

    if (cfg.endSection?.test(t)) {
      collecting[side] = false;
      cur[side] = null;
      return;
    }

    if (cfg.streetsAfter && !collecting[side]) {
      const s = t.match(cfg.streetsAfter);
      if (!s) return;
      collecting[side] = true;
      const rest = t.slice(s.index! + s[0].length).trim();
      if (rest) cur[side]!.parts.push(rest);
      return;
    }
    if (!collecting[side] || cfg.skip?.test(t)) return;
    const cell = cfg.colSplit ? t.split(/\s{2,}/)[0].trim() : t;
    if (!cell) return;
    const parts = cur[side]!.parts;
    if (cfg.contLine?.test(cell) && parts.length) {
      // Join with a comma only when the entry already holds numbers; a bare street name must be
      // joined with a SPACE, or "Bleduľová" + "1, 2, 3" becomes the street "Bleduľová," and never
      // matches anything in Register adries.
      const prev = parts[parts.length - 1];
      parts[parts.length - 1] = prev + (/[\d,]\s*$/.test(prev) ? ", " : " ") + cell;
    } else {
      parts.push(cell);
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (!armed) {
      if (cfg.startAfter!.test(line.trim())) armed = true;
      continue;
    }
    // `stop` is only armed once a section has opened, so footer wording that also appears in
    // the preamble ("Starosta … určuje") can't abort the parse before it begins.
    if (started && (FOOTER.test(line.trim()) || cfg.stop?.test(line.trim()))) break;

    // A line that OPENS with a catch-all marker is never part of the street list. It has to go
    // before it reaches `parts`, not after: the parts of a section are joined with a space and
    // split on COMMAS, and there is no comma between the last street and this line, so the two
    // fuse into one entry ("Zdravotnícka + občania prihlásení na obec Bratislava-Rusovce") which
    // CATCHALL then deletes whole — taking the street with it. Exactly how Košice lost Urbárska
    // and Zinková to a "Poznámka:" footer.
    if (started && CATCHALL_LINE.test(line.trim())) continue;

    if (cfg.twoUpAt !== undefined) {
      for (const s of segments(line)) take(s.col >= cfg.twoUpAt ? 1 : 0, s.text);
      continue;
    }
    // Polling-place continuation lines sit far right in the two-column-with-bleed docs.
    if (cfg.colSplit && line.length - line.trimStart().length > 40 && !cfg.header.test(line.trim())) {
      continue;
    }
    take(0, line.trim());
  }

  const out: Row[] = [];
  for (const b of buckets) {
    // Comma-joined docs wrap mid-list, so join with a space and let splitEntries find the
    // commas; per-line docs are already one entry per element.
    const entries = cfg.perLine ? b.parts : splitEntries(b.parts.join(" "));
    for (const e of entries.flatMap(normalizeEntry)) {
      const entry = e.trim().replace(/[.,;]\s*$/, "");
      if (!entry || CATCHALL.test(entry)) continue;
      out.push(buildKvRow(cfg.mc, cfg.mcNorm, b.okrsok, entry));
    }
  }
  return out;
};

