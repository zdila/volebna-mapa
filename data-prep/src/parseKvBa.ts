// Bratislava mestské časti whose KOMUNÁLNE VOĽBY 24.10.2026 document is prose — an okrsok
// header followed by that okrsok's street list. Driven by the shared engine in kvSections.ts.
//
// Unlike Košice there is no city-wide registry: bratislava.sk publishes only the volebné OBVODY
// and states that okrsky are "v kompetencii jednotlivých mestských častí", so each document was
// located on its own MČ site. Sources (all verified to cite decree 145/2026 Z. z. / 24.10.2026):
//   Staré Mesto          data.moderneobce.sk/data/uploads/staremesto.sk/volby2026/oznamenie_26_1103.pdf
//   Nové Mesto           data.moderneobce.sk/data/uploads/banm.sk/volebne_okrsky_vymedzenie_f_1.pdf
//   Rača                 raca.sk/wp-content/uploads/2026/07/Oznamenie-o-utvoreni-volebnych-obvodov-poctu-poslancov-a-urceni-volebnych-okrskov-2026.pdf
//   Vrakuňa              vrakuna.sk/data/page/vrakuna.sk/31466/volebne-okrsky-a-volebne-miestnosti.pdf
//   Podunajské Biskupice biskupice.sk/evt_file.php?file=15320
//   Lamač                lamac.sk/files/documents/zverejnovanie/volby/komunalne/2026/oznamenie_o_urceni_volebnych_okrskov.pdf
//   Rusovce              bratislava-rusovce.sk/media/files/volby/2026__spojene_samospravne_volby_/2026-07-30/okrsky_v_mc_bratislava-rusovce_…pdf
//   Čunovo               cunovo.eu/files/2026-07-31-120505-ur__enie_okrskov.pdf
//   Jarovce              jarovce.sk/dokumenty/volby/kom2026/Urcenie volebnych okrskov.pdf
import { writeFileSync } from "node:fs";
import { audit } from "./keCommon.ts";
import { parseSections, type Cfg } from "./kvSections.ts";

const CFGS: Cfg[] = [
  {
    slug: "staremesto",
    mc: "Bratislava-Staré Mesto",
    mcNorm: "staremesto",
    okrsky: 34,
    src: "data/kv_ba_staremesto.txt",
    // "Miestom konania volieb okrsku č. N je:" / polling place / "pre oprávnených voličov …:" /
    // then one street per line as "Názov  <čísla|celá>". The trailing "celá" is dropped by
    // proseRange, so each line is already a complete entry — don't re-split on commas, or a
    // house list like "Kozia 23,25,27,29" would break into four bogus streets.
    header: /^Miestom konania volieb okrsku č\.\s*(\d+)\s*je\s*:/i,
    streetsAfter: /^pre oprávnených voličov/i,
    perLine: true,
    // A long house list wraps onto its own line; without this each continuation became a
    // separate "street" whose name is a bare number list, and the street above lost those houses.
    contLine: /^\d/,
    stop: /^Informácia pre voliča|^V Bratislave|^Ing\. |^starosta|^Volič |dopustí priestupku/i,
  },
  {
    slug: "novemesto",
    mc: "Bratislava-Nové Mesto",
    mcNorm: "novemesto",
    okrsky: 32,
    src: "data/kv_ba_novemesto.txt",
    // Written to its OWN file. Nové Mesto is the one MČ with an authoritative per-address export
    // (parseKvBaNovemesto.ts), and that writes kv_ba_novemesto_okrsok_streets.json. Sharing the
    // name meant whichever parser ran last won: running this one alone silently replaced 160 ENUM
    // rows with whole-street rows, so eleven okrsky each claimed all of Račianska and every
    // address on it became `ambiguous` — Nové Mesto fell to 57.9% matched with 2071 ambiguous,
    // and nothing in the pipeline said a word. The prose parse stays useful as a cross-check.
    out: "data/kv_ba_novemesto_prose_okrsok_streets.json",
    header: /^Volebný okrsok č\.\s*(\d+)\s*$/i,
    streetsAfter: /Vymedzenie územia okrsku\s*:/i,
    stop: /^V Bratislave|^Mgr\. |^starosta/i,
  },
  {
    slug: "raca",
    mc: "Bratislava-Rača",
    mcNorm: "raca",
    okrsky: 0, // filled from the document itself; Rača's count is not stated up front
    src: "data/kv_ba_raca.txt",
    // ⚠️ The PDF's signature line reads "V Bratislave, dňa 20.7.2022" — a stale copy-paste in the
    // source. The document IS the 2026 one: it is filed under raca.sk/wp-content/uploads/2026/07/,
    // headed "pre voľby do orgánov samosprávy obcí 24. októbra 2026", and cites uznesenie
    // č. 514/23/06/26/P of 23.6.2026. 19 okrsky (the 2026 referendum had 9).
    header: /^Volebný okrsok\s*(\d+)\b/i,
    streetsAfter: /^ulice\s*:/i,
    stop: /^V Bratislave|^Mgr\. |^starosta|^Príloha/i,
    // The obvod summary sentences are not streets; without this they glue onto the last street of
    // the preceding okrsok ("Dopravná sa volia 2 poslanci") and that okrsok gets no seeds.
    // ^\d{1,3}$ drops the bare page-number line: Rača is comma-joined, so it would otherwise be
    // appended to the last street ("Žitná od 17 do 66 1") and defeat proseRange's end-anchored
    // range rule, losing the street.
    skip: /^(sa vol[ií]|Vo volebnom obvode|Počet volených poslancov|\d{1,3}$)/i,
  },
  {
    slug: "vrakuna",
    mc: "Bratislava-Vrakuňa",
    mcNorm: "vrakuna",
    okrsky: 14,
    src: "data/kv_ba_vrakuna.txt",
    header: /^Volebný okrsok č\.\s*(\d+)\s*$/i,
    streetsAfter: /^ulice\s*:/i,
    stop: /^V Bratislave|^Ing\. |^starosta/i,
    // Same trap as Rača: the obvod banner sits between okrsky and would otherwise be appended to
    // the previous okrsok's last street.
    skip: /^(VOLEBNÝ OBVOD|Počet volených poslancov|Volebná miestnosť)/i,
  },
  {
    slug: "podunajskebiskupice",
    mc: "Bratislava-Podunajské Biskupice",
    mcNorm: "podunajskebiskupice",
    okrsky: 16,
    src: "data/kv_ba_podunajskebiskupice.txt",
    // Four-column table: okrsok "01" | streets one per line | sídlo miestnosti | komisia size.
    // colSplit keeps field[0], and the deep-indent guard drops the sídlo column's own lines.
    header: /^(\d{2})\s+(?=\S)/,
    colSplit: true,
    perLine: true,
    stop: /^V Bratislave|^Ing\. |^starosta|^Rozhodnutie č\./i,
    skip: /^(VOLEBNÝ OBVOD|okrsok|číslo|zahrňujúci|bývajúcich|sídlo|na hlasovanie|členov|komisie)/i,
  },
  {
    slug: "lamac",
    mc: "Bratislava-Lamač",
    mcNorm: "lamac",
    okrsky: 6,
    src: "data/kv_ba_lamac.txt",
    // Okrsky printed two per row: 1|4, 2|5, 3|6. First street shares the "Ulice:" line.
    header: /^VOLEBNÝ OKRSOK č\.\s*(\d+)\s*:/i,
    streetsAfter: /^Ulic[ea]\s*:/i,
    perLine: true,
    twoUpAt: 50,
    // The closing sentence names the polling place and wraps onto a second line ("... Základnej
    // školy, Malokarpatské nám. 1," / "Bratislava."), and both halves were becoming street rows.
    // Safe to stop on in a PROSE parser: sections are delimited by headers, so dropping trailing
    // lines cannot shift anything — unlike the centroid-DP tables, where a junk cell is
    // load-bearing and removing it re-slices the blocks.
    stop: /^V Bratislave|^Ing\. |^starosta|^Volebné miestnosti sa nachádzajú/i,
  },
  {
    slug: "rusovce",
    mc: "Bratislava-Rusovce",
    mcNorm: "rusovce",
    okrsky: 4,
    src: "data/kv_ba_rusovce.txt",
    header: /^Okrsok č\.\s*(\d+)\s*$/i,
    streetsAfter: /^Prislúchajúce ulice\s*:/i,
    // The decree closes with "Bratislava-Rusovce 30.07.2026" — no "V Bratislave", no title. It was
    // joining onto the last street of the last okrsok ("Zdravotnícka Bratislava-Rusovce
    // 30.07.2026"), which matched nothing and lost the street. Kept per-document on purpose: a
    // blanket "line ending in a date" rule in FOOTER truncated Šaca and Devínska Nová Ves, whose
    // pages carry dated headers mid-document.
    stop: /^V Bratislave|^Ing\. |^starosta|^Bratislava-Rusovce\s+\d/i,
  },
  {
    slug: "cunovo",
    mc: "Bratislava-Čunovo",
    mcNorm: "cunovo",
    okrsky: 2,
    src: "data/kv_ba_cunovo.txt",
    header: /^Volebný okrsok č\.\s*(\d+)\s*:/i,
    streetsAfter: /^Prislúchajúce ulice\s*:/i,
    stop: /^V Bratislave|^Ing\. |^starostka|^JUDr\./i,
  },
  {
    slug: "jarovce",
    mc: "Bratislava-Jarovce",
    mcNorm: "jarovce",
    okrsky: 3,
    src: "data/kv_ba_jarovce.txt",
    header: /^Volebný okrsok č\.\s*(\d+)\s*:/i,
    streetsAfter: /^Prislúchajúce ulice\s*:/i,
    stop: /^V Bratislave|^Ing\. |^starosta/i,
  },
  {
    slug: "karlovaves",
    mc: "Bratislava-Karlova Ves",
    mcNorm: "karlovaves",
    okrsky: 30,
    src: "data/kv_ba_karlovaves.txt",
    // Per-okrsok blocks: "Volebný okrsok N" / "Volebná miestnosť …" / an "Ulica | Orientačné
    // číslo" column header / then "Názov  <čísla|všetky>" rows. Long number lists wrap onto a
    // line of their own, which contLine folds back into the street above.
    header: /^Volebný okrsok\s+(\d+)\s*$/i,
    streetsAfter: /^Ulica\s+Orientačné/i,
    perLine: true,
    contLine: /^\d/,
    stop: /^V Bratislave|^Dana Čahojová|^starostka/i,
    // ^\d{1,3}$ drops the bare page-number line printed at the foot of each page. With contLine
    // folding any digit-leading line into the street above, it became part of that street's entry
    // ("Šaštínska všetky 2"), which then no longer ends in "všetky" — so proseRange could not strip
    // it, the street was filed as "Šaštínska všetky" with an ENUM of {2}, and every address on it
    // reported no-street. Four streets and 79 addresses in Karlova Ves. A wrapped number list
    // always carries commas or several numbers, so a line that is ONLY 1-3 digits is never data.
    skip: /^(Volebná miestnosť|Rozhodnutie|Podľa § 8|Vec\b|Do volebného obvodu|\d{1,3}$)/i,
  },
  {
    slug: "devinskanovaves",
    mc: "Bratislava-Devínska Nová Ves",
    mcNorm: "devinskanovaves",
    okrsky: 15,
    src: "data/kv_ba_devinskanovaves.txt",
    // "Obvod č. N" groups, then "N <volebná miestnosť>" opens an okrsok, then a street NAME on
    // its own line followed by indented house-number lines (folded back by contLine).
    // The header regex swallows the WHOLE line: after the okrsok number comes the polling
    // place, which must not be mistaken for a street.
    header: /^(\d{1,2})\s+\D.*$/,
    perLine: true,
    contLine: /^(?:\d|súp\.)/,
    stop: /^V Bratislave|^Dárius Krajčír|^starosta/i,
    // Same page-number hazard as Karlova Ves — see the note there.
    skip: /^(Obvod č\.|Komunálne voľby|Dátum\b|\d{1,3}$)/i,
  },
];

const only = process.argv[2];
for (const cfg of CFGS) {
  if (only && cfg.slug !== only) continue;
  const out = parseSections(cfg);
  writeFileSync(cfg.out ?? `data/kv_ba_${cfg.slug}_okrsok_streets.json`, JSON.stringify(out));
  const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
  console.log(`\n=== ${cfg.mc} (expect ${cfg.okrsky || "?"}) ===`);
  audit(out, cfg.okrsky || Math.max(0, ...okrs));
}
