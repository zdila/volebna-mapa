// Bratislava mestské časti whose KOMUNÁLNE VOĽBY 24.10.2026 document is a TABLE with a
// vertically-centred okrsok cell. Shared coordinate reading + centroid DP live in kvTable.ts.
//
//   Petržalka  petrzalka.sk/wp-content/uploads/2026/08/Okrsky-2026.pdf
//              Okrsok | Volebná miestnosť | Ulica | Čísla domov — a full per-house enumeration.
//   Dúbravka   dubravka.sk/files/documents/samosprava/volby/2026 samospravy/
//              rozhodnutie-starostu-vytvorenie-vo-a-vm-2026-v1.02.pdf
//              Volebný okrsok číslo | Volebná miestnosť — street names only, no house numbers,
//              with the polling place printed in the SAME column as the streets.
import { writeFileSync } from "node:fs";
import { buildKvRow, normalizeEntry } from "./kvCommon.ts";
import type { Row } from "./keCommon.ts";
import {
  assignAnchors, auditTable, clusterLines, colText, emitRows, pushCell, readWords,
  type Anchor, type Cell,
} from "./kvTable.ts";

type Cfg = {
  slug: string; mc: string; mcNorm: string; okrsky: number; pdf: string;
  okr: [number, number]; street: [number, number]; num?: [number, number];
  mode: "split" | "text";
  skip?: RegExp;
  /** Where the okrsok number sits relative to its block — see parseKvKeTables for the full note.
   *  "top" means the block runs from its own anchor to the next, and the centroid DP is not just
   *  unnecessary but WRONG (it can find a lower-cost partition than the true one). */
  anchorAt?: "top" | "centre";
  /** Ignore lines before this one. Dúbravka's page 1 carries a SUMMARY table ("ZŠ Sokolíkova 2 |
   *  1, 2, 3, 4, 5") whose okrsok-number lists would otherwise become phantom anchors and rows;
   *  the real per-street appendix starts on page 2. */
  tableStart?: RegExp;
};

// `záhradkárs` used to match bare, and killed Dúbravka's real street ZÁHRADKÁRSKA along with
// Čunovo's catch-all "ZÁHRADKÁRSKA OSADA". Now an allotment entry must either name the colony
// (…osada / oblasť / kolónia) or appear in an oblique adjective form ("záhradkárskych osád"),
// which a street name printed alone never does.
const CATCHALL = /(občan|osoby s TP|trval[ýé]m? pobyt|bez konkrétnej adresy|bez adresy|záhradkársk(?:ych|ej|ou|ymi|e)\b|záhradkársk\w*\s+(?:osad|oblas|kolón))/i;

const CFGS: Cfg[] = [
  {
    slug: "petrzalka", mc: "Bratislava-Petržalka", mcNorm: "petrzalka", okrsky: 96,
    pdf: "data/kv_ba_petrzalka.pdf",
    okr: [30, 80], street: [218, 335], num: [335, 900], mode: "split",
    // Top-anchored: okrsok 2's number is on HANDLOVSKÁ, the FIRST of its ten entries.
    anchorAt: "top",
    // "…, BRATISLAVA - PETRŽALKA" is the polling place's address wrapping into the street column.
    // Safe to drop here because Petržalka is TOP-anchored: a block runs from its own anchor to the
    // next, so removing a cell cannot move a block boundary. The same edit on a centred-anchor
    // table would re-slice the partition (see Staré Mesto / Sídlisko KVP in parseKvKeTables).
    skip: /^(Volebný obvod|Okrsok|Ulica|Čísla|Zoznam volebných|pre voľby|starosta|Ing\. |BRATISLAVA\b|PETRŽALKA\s*$)/i,
  },
  {
    slug: "dubravka", mc: "Bratislava-Dúbravka", mcNorm: "dubravka", okrsky: 31,
    pdf: "data/kv_ba_dubravka.pdf",
    okr: [135, 200], street: [230, 560], mode: "text",
    tableStart: /Volebné okrsky a volebné miestnosti v mestskej časti/i,
    // The polling place shares the street column, so it has to be filtered by name.
    // "voľby do orgánov samosprávy obcí a do orgánov" is the second line of the page-2 heading. It
    // became a cell 100 pt above the first real street, and since the okrsok number is recovered by
    // a CENTROID DP that phantom dragged okrsok 1's block down — POVAŽANOVA was filed under okrsok 1
    // when the document puts it in 2.
    skip: /^(Volebná miestnosť|Volebný|okrsok|číslo|Z[ŠS] |KC |SP[ŠS]|Gymnázium|Základná|Volebné okrsky|Dúbravka pre|samosprávnych krajov|mestskej časti|krajov,|ktoré sa|voľby do orgánov)/i,
  },
];

const only = process.argv[2];
for (const cfg of CFGS) {
  if (only && cfg.slug !== only) continue;
  const lines = clusterLines(readWords(cfg.pdf));
  const anchors: Anchor[] = [];
  const cells: (Cell & { okrsok: number })[] = [];

  let armed = !cfg.tableStart;
  for (const l of lines) {
    if (!armed) {
      if (cfg.tableStart!.test(l.words.map((w) => w.text).join(" "))) armed = true;
      continue;
    }
    const okrCell = colText(l, cfg.okr[0], cfg.okr[1]);
    const street = colText(l, cfg.street[0], cfg.street[1]);
    const numspec = cfg.num ? colText(l, cfg.num[0], cfg.num[1]) : "";
    // Skip first, so a banner line ("Volebný obvod č. 2") cannot leave a phantom anchor behind —
    // a phantom anchor is worse than a phantom cell, since assignAnchors gives every anchor a
    // non-empty block and one extra re-slices the entire partition.
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
    cells.forEach((c, i) => { c.okrsok = assigned[i]; });
  }

  let out: Row[];
  if (cfg.mode === "split") {
    out = emitRows(cfg, cells.filter((c) => c.okrsok > 0));
  } else {
    out = [];
    for (const c of cells) {
      if (c.okrsok <= 0) continue;
      for (const e of normalizeEntry(c.street)) {
        const entry = e.trim().replace(/[.,;]\s*$/, "");
        if (!entry || CATCHALL.test(entry)) continue;
        out.push(buildKvRow(cfg.mc, cfg.mcNorm, c.okrsok, entry));
      }
    }
    out.sort((a, b) => a.okrsok - b.okrsok);
  }

  writeFileSync(`data/kv_ba_${cfg.slug}_okrsok_streets.json`, JSON.stringify(out));
  auditTable(out, cfg.okrsky, cfg.mc);
  console.log(`anchors: ${anchors.length}  cells: ${cells.length}`);
}
