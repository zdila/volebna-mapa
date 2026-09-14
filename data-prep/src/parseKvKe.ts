// Košice per-MČ okrsok→street assignment for the KOMUNÁLNE VOĽBY 24.10.2026
// (voľby do orgánov samosprávy obcí + samosprávnych krajov, decree 145/2026 Z. z.).
//
// Sources were discovered from the city-wide index PDF
// static.kosice.sk/files/manual/volby/volby2026_volebne_okrsky.pdf, which lists every MČ, its
// okrsok count and a direct link to that MČ's own "Utvorenie volebných okrskov" document.
// Raw downloads + `pdftotext -layout` output live in data/kv2026/; the staged text this script
// reads is data/kv_ke_<slug>.txt.
//
// This file covers the MČ whose documents are plain "okrsok header, then a street list" prose —
// the shape differs only in which line starts the list and whether streets are comma-joined or
// one-per-line, so they are driven by a config table rather than one script each. The
// coordinate-table MČ (Staré Mesto, Sídlisko KVP, Sídlisko Ťahanovce, Dargovských hrdinov) and
// the single-okrsok MČ are handled elsewhere — see parseKvKeTable.ts / parseKvKeSmall.ts.
import { writeFileSync } from "node:fs";
import { audit } from "./keCommon.ts";
import { parseSections, type Cfg } from "./kvSections.ts";

const CFGS: Cfg[] = [
  {
    slug: "barca",
    mc: "Košice-Barca",
    mcNorm: "barca",
    okrsky: 3,
    src: "data/kv_ke_barca.txt",
    header: /^okrsok č\.\s*(\d+)\s*$/i,
    streetsAfter: /^Zoznam ulíc\s*:/i,
    stop: /^Ing\. Gabriel Krištof|^starosta/i,
    skip: /^Volebná miestnosť|^\s*Abovská č\.|^\s*Barčianska č\./i,
  },
  {
    slug: "krasna",
    mc: "Košice-Krásna",
    mcNorm: "krasna",
    okrsky: 4,
    src: "data/kv_ke_krasna.txt",
    header: /^Okrsok č\.\s*(\d+)\s*:/i,
    streetsAfter: /tvoria ulice\s*:/i,
    stop: /^V Košiciach|starosta/i,
  },
  {
    slug: "kosicka_nova_ves",
    mc: "Košice-Košická Nová Ves",
    mcNorm: "kosicka nova ves",
    okrsky: 2,
    src: "data/kv_ke_kosicka_nova_ves.txt",
    header: /^Volebný okrsok č\.\s*(\d+)\s*[–-]/i,
    streetsAfter: /^Pre občanov s trvalým pobytom na uliciach\s*:/i,
    stop: /^V Košiciach|starosta/i,
  },
  {
    slug: "saca",
    mc: "Košice-Šaca",
    mcNorm: "saca",
    okrsky: 3,
    src: "data/kv_ke_saca.txt",
    // Each okrsok gets its own page: a centred "volebný okrsok č. N" heading, the street list
    // after "pre ulice:", then a signature block — after which the whole preamble repeats. So
    // the footer must CLOSE the section, not end the parse.
    header: /^volebný okrsok č\.\s*(\d+)\s*$/i,
    streetsAfter: /pre ulice\s*:/i,
    endSection: /^V Košiciach/i,
  },
  {
    slug: "myslava",
    mc: "Košice-Myslava",
    mcNorm: "myslava",
    okrsky: 2,
    src: "data/kv_ke_myslava.txt",
    header: /^VOLEBNÝ OKRSOK\s*(\d+)\s*$/i,
    streetsAfter: /^Ulice\s*:/i,
    perLine: true,
    stop: /^V Košiciach|starosta/i,
  },
  {
    slug: "vysne_opatske",
    mc: "Košice-Vyšné Opátske",
    mcNorm: "vysne opatske",
    okrsky: 3,
    src: "data/kv_ke_vysne_opatske.txt",
    // The street lists come as their own "ZOZNAM ULÍC OKRSOK č. N" sections after the
    // okrsok/polling-place summary table at the top.
    // Two okrsok columns per page: 1 | 2 on the first, then 3 alone in the right-hand column.
    header: /^ZOZNAM ULÍC OKRSOK č\.\s*(\d+)/i,
    perLine: true,
    twoUpAt: 100,
    // ⚠️ "Nižná úvrať" is BOTH the MČ office's letterhead address and a real street here, so the
    // letterhead must be matched WITH its house number — a bare /^Nižná úvrať/ silently deleted
    // the street and left all 56 of its addresses reporting no-street.
    // The footer is a table, so twoUpAt splits its labels and VALUES into different columns:
    // skip the values (phone, web, IČO) as well as the labels.
    skip: /^Mestská časť|^Nižná úvrať \d|^_+$|^Určenie volebných|^Okrsok č\.|^Telefón|^\+421|^055[\s\/]|podatelna@|^www\.|^Fax\b|^IČO|^Internet|^E-mail|^\d{4} \d{2} \d{2}$|^Spoločenská sála|^Spojená škola|^Kaviareň/i,
  },
  {
    slug: "zapad",
    mc: "Košice-Západ",
    mcNorm: "zapad",
    okrsky: 31,
    // HTML page, not a PDF (kosicezapad.sk mid_579803), staged via tag-strip to one block/line.
    // Each okrsok is "N. <polling place>" followed by its streets one per line — so the header
    // regex swallows the WHOLE line (the polling place is not a street).
    src: "data/kv_ke_zapad.txt",
    startAfter: /utváram volebné okrsky/i,
    header: /^(\d+)\.\s+\D.*$/,
    perLine: true,
    stop: /^Pozn\.|^V Košiciach|^Mgr\.|^Zverejnené/i,
  },
  {
    slug: "tahanovce",
    mc: "Košice-Ťahanovce",
    mcNorm: "tahanovce",
    okrsky: 2,
    // HTML page (tahanovce.eu). Three-column table flattened to one cell per line: a bare okrsok
    // number, then its streets, then the polling-place address lines.
    src: "data/kv_ke_tahanovce.txt",
    startAfter: /^VOLEBNÁ MIESTNOSŤ$/,
    header: /^(\d+)$/,
    perLine: true,
    stop: /^UPOZORNENIE/i,
    skip: /^(Kultúrny dom|Základná škola)|^\d{3} \d{2} |^\S+ \d+[A-Za-z]?$/,
  },
];

const only = process.argv[2];
for (const cfg of CFGS) {
  if (only && cfg.slug !== only) continue;
  const out = parseSections(cfg);
  writeFileSync(`data/kv_ke_${cfg.slug}_okrsok_streets.json`, JSON.stringify(out));
  console.log(`\n=== ${cfg.mc} (expect ${cfg.okrsky} okrsky) ===`);
  audit(out, cfg.okrsky);
}
