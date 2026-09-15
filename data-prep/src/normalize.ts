// Shared normalization: diacritic-strip + lowercase + collapse whitespace.
// Used for both mestská časť and street keys so the results/geometry joins are stable.
export const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    // Sources ASCII-encode the soft consonants ľ/ď/ť/ň as l'/d'/t'/n' (e.g. "Rehol'ná" =
    // "Rehoľná"); after diacritic-strip both sides want the bare letter, so drop the apostrophe.
    .replace(/['’`´]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Košice MČ raw names are "Mestská časť Košice - Šaca"; key on the tail.
export const mcName = (raw: string): string =>
  raw.replace(/^Mestská časť\s+Košice\s*-\s*/i, "").trim();

// Register adries abbreviates street-type words ("Nám. Oceliarov" = "Námestie
// oceliarov"); the source assignment spells them out. Expand a small dictionary so
// both sides key the same. Applied token-wise to an already-normalized string.
const STREET_ABBR: Record<string, string> = {
  nam: "namestie",
  ul: "ulica",
  gen: "generala",
  kpt: "kapitana",
  sv: "svateho",
  dr: "doktora",
  mjr: "majora",
  plk: "plukovnika",
  pplk: "podplukovnika",
  arm: "armadneho",
  akad: "akademika",
  prof: "profesora",
  nabr: "nabrezie",
};

// Verified source-typo corrections: the assignment document misspells a street that RA spells
// correctly (confirmed against RA points in the same MČ). Keyed/valued in final streetKey form;
// applied to both sides so the correct RA spelling and the typo'd assignment collapse together.
const STREET_FIX: Record<string, string> = {
  "pri vagoni": "pri vagovni", // Košice-Barca — assignment typo, RA "Pri Vagovni" (14 pts)
  szakayho: "szakkayho", //       Košice-Sever — assignment single-k, RA "Szakkayho"
  vrajunska: "vrakunska", //      Podunajské Biskupice — assignment typo (okr6), RA "Vrakunská"
  pcl: "povstania ceskeho ludu", // Košice-Dargovských hrdinov — the 2026 komunálne doc writes
  //                                the MČ's main street as the initialism "PČL" (it is also the
  //                                miestny úrad's own address); RA has it spelled out in full.
  //                                Without this okrsok 9, whose only street it is, gets no seeds.
  "m schneidera-trnavskeho": "m schneidra trnavskeho",
  //                              Bratislava-Dúbravka — the decree writes the composer's name
  //                              "M. SCHNEIDERA-TRNAVSKÉHO" (extra -e-, hyphenated); RA has
  //                              "M. Schneidra Trnavského". Only one such street in the MČ.
  "laury henckel": "laury henckelovej",
  //                              Bratislava-Rusovce — the decree drops the feminine ending,
  //                              "Laury Henckel"; RA has "Laury Henckelovej". Only one match.
  vlastenecke: "vlastenecke namestie",
  //                              Bratislava-Petržalka — the decree's table column is narrow and
  //                              writes the square as bare "VLASTENECKÉ"; RA has "Vlastenecké
  //                              námestie". Only one street in the MČ starts that way, and the
  //                              polling place for okrsky 11-14 is "ZŠI Vlastenecké nám. 1".
  // NB: do NOT map "brigadnnicka"→"brigadnicka" — Západ's assignment has *both* spellings on
  // different okrsky (9 vs 10) with overlapping numbers, so merging them creates a real collision.
};

// Canonical street match key: normalized + abbreviations expanded + dots removed +
// the generic word "ulica" dropped (RA writes "Ulica 1. mája" / "Lorinčícka ulica",
// the assignment omits it). Keep the word only if it's the entire name.
export const streetKey = (normed: string): string => {
  const toks = normed
    .replace(/\./g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => STREET_ABBR[t] ?? t);
  const kept = toks.filter((t) => t !== "ulica");
  const k = (kept.length ? kept : toks).join(" ");
  return STREET_FIX[k] ?? k;
};
