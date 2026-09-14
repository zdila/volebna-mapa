// Košice MČ whose KOMUNÁLNE VOĽBY 24.10.2026 document is a TABLE with a vertically-centred
// okrsok cell — Staré Mesto, Západ's neighbours Sever aside, Sídlisko KVP, Juh, Nad jazerom and
// Dargovských hrdinov. The shared coordinate reading + centroid DP live in kvTable.ts; this file
// only supplies each MČ's column geometry and says how its cells become street entries.
//
// Two cell shapes appear:
//   "split"  — separate street and house-number columns (Sídlisko KVP, Dargovských hrdinov).
//              Handled by kvTable.emitRows, which keeps the number spec only for streets that
//              are actually split across okrsky.
//   "text"   — one wide "územie" column holding a comma-separated street list, numbers inline
//              (Staré Mesto, Juh, Nad jazerom). Handled by splitEntries + buildKvRow.
import { writeFileSync } from "node:fs";
import { splitEntries, type Row } from "./keCommon.ts";
import { buildKvRow, normalizeEntry } from "./kvCommon.ts";
import {
  assignAnchors,
  auditTable,
  clusterLines,
  colText,
  emitRows,
  pushCell,
  readWords,
  type Anchor,
  type Cell,
  type TextLine,
} from "./kvTable.ts";

/** The block below the table: the "Poznámka:" note about voters with no fixed address, then the
 *  place, date and the mayor's signature. It is NOT part of the table, but its words land in the
 *  table's columns, so without this it becomes phantom cells hanging off the last okrsok. Those
 *  are far worse than they look: the centroid DP balances every block against its anchor, so two
 *  phantom cells at the bottom drag the last block down and the whole partition re-slices above
 *  them — in Sídlisko KVP they moved "Starozagorská 11-43 nepárne" from okrsok 17 to 18.
 *
 *  Matched against the WHOLE line, and the line is skipped rather than ending the parse, so a
 *  document that repeats the note as a per-page footer still reads its remaining pages.
 *
 *  ⚠️ OPT-IN per document (`dropFooter`), never global. Removing a cell is only safe where it
 *  provably helps: in Staré Mesto it re-sliced the DP across half the table (Hlavná 41-119 5→4,
 *  Alžbetina 7→6), and in Juh it left the note's continuation to be folded onto "Krakovská 19-23"
 *  by pushCell. Both keep their junk cells, which parse to street names nothing can match and are
 *  therefore harmless. Verify with a before/after diff of the emitted rows before enabling it. */
const LINE_NOISE =
  /(Pozn(ámka)?\s*[.:]|trval[ýé]m\s+pobyt|zapísan[íý]\s+vo\s+volebnom|\b(Mgr|Ing|JUDr|PhDr|MUDr|doc|prof)\.\s|starost(a|ka)\b|^\s*V\s+Košiciach|^\s*\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\s*$)/i;

/** One side-by-side half of a page (most docs have exactly one). */
type Half = {
  /** [lo, hi) x-range holding the okrsok number. */
  okr: [number, number];
  /** [lo, hi) x-range holding the street text. */
  street: [number, number];
  /** [lo, hi) x-range holding house numbers, when the doc splits them out. */
  num?: [number, number];
};

type Cfg = {
  slug: string;
  mc: string;
  mcNorm: string;
  okrsky: number;
  pdf: string;
  halves: Half[];
  mode: "split" | "text";
  /** Table-internal lines that are not data ("Volebný obvod č. 2", column headers, footers). */
  skip?: RegExp;
  /** Drop the "Poznámka:"/signature block below the table — see LINE_NOISE. Opt-in: it changes
   *  which cells the centroid DP sees, so it must be verified document by document. */
  dropFooter?: boolean;
  /** Ignore every line before the column-header line. Without this the preamble's own numbered
   *  paragraphs ("1. Voľby do orgánov…") land in the okrsok column and become phantom anchors. */
  tableStart?: RegExp;
  /** In "text" mode: each line is already one street entry (don't re-split it on commas). */
  perLine?: boolean;
  /** Where the okrsok number sits relative to its block.
   *
   *  "centre" (default) — the number is vertically centred in a merged cell, so rows above AND
   *  below it belong to that okrsok; recovered by the centroid DP in kvTable.
   *
   *  "top" — the number shares its line with the block's FIRST territory entry and the polling
   *  place sits on the next line down (Nad jazerom). Here a block simply runs from its own
   *  anchor to the next, and the DP is not merely unnecessary but WRONG: it can find a
   *  lower-cost partition than the true one and shift entries between neighbouring okrsky. */
  anchorAt?: "top" | "centre";
};

// `záhradkárs` used to match bare, and killed Dúbravka's real street ZÁHRADKÁRSKA along with
// Čunovo's catch-all "ZÁHRADKÁRSKA OSADA". Now an allotment entry must either name the colony
// (…osada / oblasť / kolónia) or appear in an oblique adjective form ("záhradkárskych osád"),
// which a street name printed alone never does.
const CATCHALL =
  /(občan|osoby s TP|trval[ýé]m? pobyt|bez konkrétnej adresy|bez adresy|záhradkársk(?:ych|ej|ou|ymi|e)\b|záhradkársk\w*\s+(?:osad|oblas|kolón)|zrušen)/i;

const CFGS: Cfg[] = [
  {
    slug: "stare_mesto",
    mc: "Košice-Staré Mesto",
    mcNorm: "stare mesto",
    okrsky: 19,
    pdf: "data/kv_stare_mesto.pdf",
    // Two complete okrsok tables printed side by side on every page.
    halves: [
      { okr: [50, 100], street: [100, 218] },
      { okr: [303, 350], street: [350, 448] },
    ],
    mode: "text",
    perLine: true,
    tableStart: /Číslo okrsku/i,
    // ⚠️ Do NOT add entries to this skip list. The okrsok anchors are recovered by a CENTROID
    // DP, so removing cells is never neutral: it shifts every later cell relative to the anchors
    // and the DP re-slices the blocks, silently moving whole streets one okrsok along (adding a
    // "starts with a digit" rule moved Alžbetina 7->6 and Hlavná 7->3; even dropping the trailing
    // "Volebné obvody" summary moved Thurzova 5->4). Junk cells are harmless — they parse to a
    // street name nothing can match — whereas a shifted block is a silent wrong answer.
    skip: /^(Číslo|Územie|Sídlo|INFORMÁCIA|Mestská časť|Voľby do|Miestom konania)/i,
    // NO dropFooter. Tried it: the stray "20. 07. 2026" sitting in the left half's street column
    // is load-bearing for the DP, and removing it moved Alžbetina and Hlavná 1-39 from okrsok 7
    // to 6 and Hlavná 41-119 from 5 to 4 — all verified wrong. Junk cells stay.
  },
  {
    slug: "sidlisko_kvp",
    mc: "Košice-Sídlisko KVP",
    mcNorm: "sidlisko kvp",
    okrsky: 18,
    pdf: "data/kv_sidlisko_kvp.pdf",
    // Okrsok | Ulica | Čísla | párne/nepárne | Volebná miestnosť — the parity word sits in its
    // own column, so the number cell spans both to keep "2-20 párne" together.
    halves: [{ okr: [60, 130], street: [130, 240], num: [240, 395] }],
    mode: "split",
    tableStart: /patriace do volebného/i,
    skip: /^(Číslo|Územie|Volebná|Volebný obvod|patriace|volebného|okrsku|\(sídlo)/i,
    // Without this the note + signature became two phantom cells on okrsok 18 and the DP moved
    // "Starozagorská 11-43 nepárne" off okrsok 17, leaving it with just three addresses.
    dropFooter: true,
  },
  {
    slug: "dargovskych_hrdinov",
    mc: "Košice-Dargovských hrdinov",
    mcNorm: "dargovskych hrdinov",
    okrsky: 20,
    pdf: "data/kv_dargovskych_hrdinov.pdf",
    // Volebný obvod | Volebný okrsok | Adresa okrsku | Ulica | Číslo. The obvod column is to the
    // LEFT of the okrsok column, so the okrsok range starts past it.
    halves: [{ okr: [110, 165], street: [265, 380], num: [380, 700] }],
    mode: "split",
    // Top-anchored: okrsok 3's number is on "Tokajícka", the FIRST of its three entries — a
    // centred cell would sit on the middle one. Same for okrsok 4 (first of five).
    anchorAt: "top",
    tableStart: /^Volebný obvod\s+Volebný/i,
    skip: /^(Volebný|Mestská časť|OZNÁMENIE|Adresa|Ulica|Číslo|Starosta)/i,
    // Only drops the signature line from okrsok 20; top-anchored, so no block can shift.
    dropFooter: true,
  },
  {
    slug: "juh",
    mc: "Košice-Juh",
    mcNorm: "juh",
    okrsky: 18,
    pdf: "data/kv_juh.pdf",
    // Číslo okrsku | Územie patriace do volebného okrsku | Volebná miestnosť.
    halves: [{ okr: [50, 100], street: [125, 620] }],
    mode: "text",
    tableStart: /Územie patriace do volebného/i,
    skip: /^(Volebný obvod|Číslo|Územie|Volebná|STAROSTKA|V súlade|okrsku|na sobotu|určuje|volebné okrsky)/i,
  },
  {
    slug: "sever",
    mc: "Košice-Sever",
    mcNorm: "sever",
    okrsky: 18,
    pdf: "data/kv_sever.pdf",
    // VOLEBNÝ OKRSOK | ÚZEMIE MESTSKEJ ČASTI | VOLEBNÁ MIESTNOSŤ. Read by COORDINATES rather than
    // from -layout text: the street list is long enough that on some lines only ONE space
    // separates it from the polling place, so a whitespace column split glues them together
    // ("Slovenskej jednoty 1-15 (nepárne) Tomášikova 31" — which then matches nothing and loses
    // those houses). The x boundary is unambiguous: street text ends by ~560, polling starts ~606.
    halves: [{ okr: [60, 105], street: [105, 600] }],
    mode: "text",
    anchorAt: "top",
    // Safe to extend, unlike the centred-anchor tables: with anchorAt:"top" a block runs from
    // its own anchor to the next, so dropping a cell cannot shift block boundaries.
    // "Košice, 29.07.2026" is the signature date and lands in the street column, where it glued
    // onto the last street of okrsok 18 ("Vihorlatská 29.07.2026") and lost its 75 addresses.
    skip: /^(VOLEBNÝ|ÚZEMIE|VOLEBNÁ|OZNÁMENIE|Starosta|určuje|volebné okrsky|pre voľby|ktoré sa|dňa |V Košiciach|Košice,|Ing\.|Mgr\.|\d{1,2}\.\d{1,2}\.\d{4})/i,
  },
  {
    slug: "nad_jazerom",
    mc: "Košice-Nad jazerom",
    mcNorm: "nad jazerom",
    okrsky: 20,
    pdf: "data/kv_nad_jazerom.pdf",
    // "Číslo volebného okrsku a volebná miestnosť" | "Územný obvod". The okrsok number and the
    // polling-place address share the left column, so only a bare-number line is an anchor.
    halves: [{ okr: [60, 270], street: [270, 700] }],
    mode: "text",
    perLine: true,
    anchorAt: "top",
    tableStart: /Územný obvod/i,
    // ⚠️ "Poludníková" was in this list to drop the MČ office letterhead ("Poludníková 7, 040 12
    // Košice") — but it is ALSO a real street here, and the rule deleted both, losing 7 addresses.
    // It is unnecessary anyway: the letterhead sits at x≈169, outside the street column [270,700].
    // The same trap cost Vyšné Opátske its Nižná úvrať (56 addresses). Never put a bare street
    // name in a skip list.
    skip: /^(Číslo|Územný|MESTSKÁ|Miestny|Oddelenie|Vytvorenie|V súlade|a určenie|okrsky a|Poznámka|V Košiciach|Ing\.|Mgr\.|starostka|- Nad jazerom)/i,
  },
];

const parse = (cfg: Cfg): Row[] => {
  const lines = clusterLines(readWords(cfg.pdf));
  const out: Row[] = [];

  for (const half of cfg.halves) {
    const anchors: Anchor[] = [];
    const cells: (Cell & { okrsok: number })[] = [];

    let armed = !cfg.tableStart;
    for (const l of lines) {
      if (!armed) {
        if (cfg.tableStart!.test(l.words.map((w) => w.text).join(" "))) armed = true;
        continue;
      }
      const okrCell = colText(l, half.okr[0], half.okr[1]);
      const street = colText(l, half.street[0], half.street[1]);
      const numspec = half.num ? colText(l, half.num[0], half.num[1]) : "";

      // Tested on THIS half's columns only. Staré Mesto prints two complete tables side by side,
      // so matching the whole line would drop a real cell in one half whenever the other half
      // happens to carry the signature block on the same baseline.
      if (cfg.dropFooter && LINE_NOISE.test(`${okrCell} ${street} ${numspec}`)) continue;

      // Test BOTH columns: a "Volebný obvod č. N" banner is centred over the table and can land
      // in the number column with the street column empty, where it would otherwise be folded
      // into the street above as if it were a wrapped house-number list. Dropping such a line
      // before the anchor test also stops its "N" becoming a phantom anchor — and a phantom
      // anchor is worse than a phantom cell, since assignAnchors gives every anchor a non-empty
      // block and one extra re-slices the entire partition.
      if (cfg.skip?.test(street) || cfg.skip?.test(numspec)) continue;

      // A bare number in the okrsok column anchors a block. (Trailing "." is common.) Note this
      // runs BEFORE the empty-cell test: the vertically-centred okrsok number usually sits alone
      // on its own line, with no street text beside it.
      const m = okrCell.match(/^(\d{1,3})\.?$/);
      if (m) anchors.push({ num: +m[1], gy: l.gy });

      if (!street && !numspec) continue;
      pushCell(cells, { gy: l.gy, street, numspec, okrsok: -1 } as Cell & { okrsok: number });
    }

    if (cfg.anchorAt === "top") {
      // Each cell belongs to the nearest anchor at or above it.
      const sorted = [...anchors].sort((a, b) => a.gy - b.gy);
      for (const c of cells) {
        let cur = -1;
        for (const a of sorted) {
          if (a.gy <= c.gy + 0.5) cur = a.num;
          else break;
        }
        c.okrsok = cur;
      }
    } else {
      const assigned = assignAnchors(cells, anchors);
      cells.forEach((c, i) => {
        c.okrsok = assigned[i];
      });
    }

    if (cfg.mode === "split") {
      out.push(...emitRows(cfg, cells.filter((c) => c.okrsok > 0)));
      continue;
    }

    // "text" mode: the street column is a comma list that wraps across lines, so join each
    // okrsok's lines with a space and let splitEntries find the real street boundaries.
    const byOkr = new Map<number, string[]>();
    for (const c of cells) {
      if (c.okrsok <= 0) continue;
      (byOkr.get(c.okrsok) ?? byOkr.set(c.okrsok, []).get(c.okrsok)!).push(c.street);
    }
    for (const [okrsok, parts] of [...byOkr].sort((a, b) => a[0] - b[0])) {
      const raw = cfg.perLine ? parts : splitEntries(parts.join(" "));
      for (const e of raw.flatMap(normalizeEntry)) {
        const entry = e.trim().replace(/[.,;]\s*$/, "");
        if (!entry || CATCHALL.test(entry)) continue;
        out.push(buildKvRow(cfg.mc, cfg.mcNorm, okrsok, entry));
      }
    }
  }

  out.sort((a, b) => a.okrsok - b.okrsok);
  return out;
};

const only = process.argv[2];
for (const cfg of CFGS) {
  if (only && cfg.slug !== only) continue;
  const out = parse(cfg);
  writeFileSync(`data/kv_ke_${cfg.slug}_okrsok_streets.json`, JSON.stringify(out));
  auditTable(out, cfg.okrsky, cfg.mc);
}
