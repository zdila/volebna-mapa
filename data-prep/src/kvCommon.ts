// Shared helpers for the KOMUNÁLNE VOĽBY 24.10.2026 parsers (Košice + Bratislava).
// Builds on keCommon.ts (splitEntries / toSpecInput / buildRow / audit); this module adds the
// normalisations that the 2026 municipal-election documents need and the referendum ones didn't.
//
// All of it exists for one reason: a house-number spec that fails to parse does not fail loudly —
// parseStreetSpec falls back to WHOLE and files the row under a nonsense street name. The street
// then disappears from the match index entirely, and its addresses surface later as `no-street`
// or `no-number`, which look like source gaps rather than parser bugs.
import { buildRow as keBuildRow, toSpecInput, type Row } from "./keCommon.ts";
import { norm } from "./normalize.ts";

// A range may be written "od 2 do 20", "2 až 20", "2-20" or "2 – 20", with or without "čísla".
const RANGE_WORD = String.raw`(?:od\s+)?(\d+\s*[A-Za-z]?)\s*(?:do|až|-|–|—)\s*(\d+\s*[A-Za-z]?)`;

/** Slovak capital letters — a bare `[A-Z]` would miss Žitná, Čerešňová, Ľubovníková… */
const UPPER = "A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ";

/**
 * Rewrite one entry into the "street A-B (parity)" syntax parseStreetSpec understands.
 *
 * Slovak documents spell ranges out in prose — "Železiarenská párne čísla od 2 do 20",
 * "Kadnárova od 209 do 340", "DROBNÉHO 2 AŽ 22" — and left as-is each becomes a WHOLE street,
 * which is actively harmful for a street SPLIT across okrsky: both okrsky then claim every house
 * and every point on it goes ambiguous.
 */
export const proseRange = (entry: string): string => {
  let e = entry.replace(/\s+/g, " ").trim();

  // --- cleanups first, so the range rules below see a bare "<street> <range>" ------------------

  // Inline "súp. č. NNNN" items (Devínska Nová Ves mixes súpisné-only buildings into a street's
  // orientačné list). A spec holds one number KIND, not both; buildings that also have an
  // orientačné číslo still match on it, and a súpisné-only entry has no street position anyway.
  e = e.replace(/súp\.\s*č\.\s*\d+[A-Za-z]?\s*,?\s*/gi, "").replace(/,\s*,/g, ",").trim();
  e = e.replace(/^,\s*|\s*,$/g, "").trim();

  // A trailing parenthetical that repeats the street name is an EXPLICIT HOUSE LIST, and it wins
  // over the range printed beside it — it is narrower, and that is the point of printing it.
  //
  // Rača: "Kadnárova od 27 do 88 (Kadnárova 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, …, 88)".
  // Read as the range, okrsok 13 collides with okrsok 15 ("Kadnárova od 1 do 40") over 27-40 and
  // with okrsok 10 ("od 83 do 108") over 83-88, and every house in both overlaps becomes
  // `ambiguous` — 20 addresses on Kadnárova alone. Read as the list, there is no collision: the
  // list takes only the ODD numbers up to 41 and only the EVEN ones from 74, leaving exactly the
  // complement to its neighbours. The document is consistent; the range alone is just imprecise.
  //
  // A parity note "(párne)" starts lower-case and carries no digits, so it is untouched.
  const paren = e.match(new RegExp(String.raw`^(.*?)\s*\(([${UPPER}][^)]*)\)\s*$`));
  if (paren) {
    const head = paren[1].replace(/\s+(?:od\s+)?\d.*$/, "").trim();
    const inner = paren[2].trim();
    e = head && /\d/.test(inner) && inner.toLowerCase().startsWith(head.toLowerCase())
      ? inner // the list replaces the range it annotates
      : paren[1].trim(); // not a house list — drop it, as before
  }

  // Obvod prose glued onto the last street of a block ("Žitná od 1 do 40 sa volí 10 poslancov").
  e = e.replace(/\s+sa vol[ií]\b.*$/i, "").trim();

  // The mayor's signature, wrapped onto the last street of the table ("Zeleninová JUDr. Mgr.
  // Jozef Uhler", "Rajčianska JUDr. Ing. Martin Kuruc"). Without this the row is filed under a
  // name nothing can match and the street silently loses EVERY address it should have claimed —
  // the same cost as the prefix-glue that fixGluedStreetsKosice repairs, in the other direction.
  // Safe as a blanket rule: a Slovak street name never contains an academic title.
  e = e.replace(/\s+(?:JUDr|Mgr|Ing|PhDr|MUDr|RNDr|PaedDr|MVDr|ThDr|Bc|doc|prof)\s*\..*$/i, "").trim();

  // "X-Y párne i nepárne" and "(párne, nepárne)" both mean BOTH sides — i.e. no parity filter.
  e = e.replace(/\s+(?:ne)?párne\s+i\s+(?:ne)?párne/gi, "").trim();
  e = e.replace(/\s*\(\s*(?:ne)?párne\s*[,–—-]\s*(?:ne)?párne\s*\)/gi, "").trim();

  // "<Street> – párne" means the whole street, EVEN numbers — a parity with no range at all.
  // keCommon.toSpecInput already understands "Rampová nepárne", but the dash defeats it and the
  // entry becomes a street literally named "Opatovská cesta -", which matches nothing. Vyšné
  // Opátske writes every even house of Opatovská cesta that way: 42 addresses.
  e = e.replace(/\s*[-–—]\s*((?:ne)?párne)\s*$/i, " $1").trim();

  // "9A-D" / "9A - D" = building sections A..D of house 9 — collapse to the house number, the
  // same way keCommon.toSpecInput collapses the "3/A-3/G" form.
  e = e.replace(/(\d+)\s*[A-Za-z]\s*[-–—]\s*[A-Za-z](?![A-Za-z0-9])/g, "$1");

  // "1- 3" / "5 – 17" -> "1-3", "5-17".
  e = e.replace(/(\d)\s*[–—-]\s*(\d)/g, "$1-$2");

  // --- then the range rules -------------------------------------------------------------------

  // Parity word BEFORE the range: "… párne čísla od 2 do 20", "… nepárne 1-59".
  const mPre = e.match(
    new RegExp(String.raw`^(.+?)\s+(ne)?párne(?:\s+čísla)?\s+${RANGE_WORD}\s*$`, "i"),
  );
  if (mPre) {
    const parity = mPre[2] ? "nepárne" : "párne";
    return `${mPre[1].trim()} ${mPre[3].replace(/\s+/g, "")}-${mPre[4].replace(/\s+/g, "")} (${parity})`;
  }

  // Parity word AFTER the range: "… čísla od 2 do 20 párne", "… 1 až 59 nepárne".
  const mPost = e.match(
    new RegExp(String.raw`^(.+?)\s+(?:čísla\s+)?${RANGE_WORD}\s+(ne)?párne\s*$`, "i"),
  );
  if (mPost) {
    const parity = mPost[4] ? "nepárne" : "párne";
    return `${mPost[1].trim()} ${mPost[2].replace(/\s+/g, "")}-${mPost[3].replace(/\s+/g, "")} (${parity})`;
  }

  // No parity word, spelled out: "Kadnárova od 209 do 340", "DROBNÉHO 2 AŽ 22". A bare "2-20" is
  // left alone — parseStreetSpec already reads that form.
  const mPlain = e.match(
    new RegExp(String.raw`^(.+?)\s+(?:čísla\s+)?(?:od\s+)?(\d+\s*[A-Za-z]?)\s*(?:do|až)\s*(\d+\s*[A-Za-z]?)\s*$`, "i"),
  );
  if (mPlain) {
    return `${mPlain[1].trim()} ${mPlain[2].replace(/\s+/g, "")}-${mPlain[3].replace(/\s+/g, "")}`;
  }

  // "všetky čísla" / "celá" / "celé" = the whole street; drop the word so only the name remains.
  e = e.replace(/\s+(všetky\s+čísla|všetky|cel[áé])\s*$/i, "").trim();

  return e;
};

const PARITY_WORD = /(?:^|\s)(ne)?párne(?:\s|$)/i;

/**
 * Split an entry that gives one street SEVERAL specs at once, one entry per spec:
 *   "Czambelova párne 8-18, nepárne 7-9"     two specs, one per parity
 *   "Šoltésovej 1-5 nepárne a 16-38 párne"   two specs joined by "a"
 *   "Južná trieda 2-10 a 20-22 párne"        two ranges sharing ONE stated parity
 *   "Južná trieda 1-9 nepárne, 19-27"        ... which may be stated on the FIRST fragment
 *
 * parseStreetSpec holds a single parity/range pair, so without this the entry falls back to WHOLE.
 * Entries that are a plain street name, or whose fragments are just more of one number list
 * ("Moyzesova 17, 19"), are returned unchanged.
 */
export const expandMultiSpec = (entry: string): string[] => {
  const e = entry.replace(/\s+/g, " ").trim();

  // Where does the house-number spec begin? Everything before it is the street name. An ordinal
  // followed by a lower-case word is part of the NAME ("29. augusta", "6. apríla"), not the spec.
  const ORDINAL = /\d+\.\s*[a-záäčďéíĺľňóôŕšťúýž]/;
  let at = -1;
  for (let i = 0; i < e.length; i++) {
    if (!/\d/.test(e[i])) continue;
    if (i > 0 && !/\s/.test(e[i - 1])) continue;
    if (ORDINAL.test(e.slice(i))) continue; // ordinal in the street name — keep looking
    at = i;
    break;
  }
  if (at < 0) return [entry];

  // A parity word sitting immediately before the numbers belongs to the SPEC, not to the name:
  // "Czambelova párne 8-18, nepárne 7-9" must yield the street "Czambelova", never
  // "Czambelova párne" (which matches nothing and loses the street).
  const before = e.slice(0, at).trimEnd();
  const parityPrefix = before.match(/(?:^|\s)((?:ne)?párne)$/i);
  if (parityPrefix) at = before.length - parityPrefix[1].length;
  const street = e.slice(0, at).trim();
  const tail = e.slice(at).trim();
  if (!street) return [entry];

  // Fragment separators: a comma before a parity word, a comma before another RANGE, or the
  // conjunction "a" before a number. A comma before a plain number stays inside one enum.
  const frags = tail
    .split(/\s*,\s*(?=(?:ne)?párne\s)|\s*,\s*(?=\d+\s*[-–—]\s*\d)|\s+a\s+(?=\d)/i)
    .map((s) => s.trim().replace(/^,|,$/g, "").trim())
    .filter(Boolean);
  if (frags.length < 2) return [entry];

  // A parity word stated on ONE fragment governs the others — documents put it on the last
  // ("2-10 a 20-22 párne") as readily as on the first ("1-9 nepárne, 19-27"). Only inherit when
  // the entry names a single parity; if it names both, each fragment already carries its own.
  const parities = new Set(
    frags.map((f) => f.match(PARITY_WORD)?.[0].trim().toLowerCase()).filter(Boolean),
  );
  const shared = parities.size === 1 ? [...parities][0] : undefined;
  return frags.map((f) => {
    const withParity = PARITY_WORD.test(f) || !shared ? f : `${f} ${shared}`;
    return `${street} ${withParity}`;
  });
};

/**
 * Split two streets that the SOURCE ran together without a comma:
 *   "Rázusova 1-33 párne i nepárne Dunajská" -> ["Rázusova 1-33 párne i nepárne", "Dunajská"]
 *
 * Košice-Juh's document really is missing that comma, and the cost is not cosmetic: glued, the
 * entry has no trailing number spec, so it becomes a WHOLE street named "Rázusova 1-33 Dunajská".
 * BOTH streets then vanish from the index — Rázusova 1–33 reports `no-number` (only the 34-60 /
 * 35-63 rows are left under "razusova") and Dunajská reports `no-street`.
 *
 * Deliberately conservative: the tail must contain NO digits. That splits a bare street name off
 * ("Dunajská", "Odborárska", "Smetanova") but leaves a trailing polling place ("… Tomášikova 31")
 * glued, rather than inventing a claim on house 31 for the wrong okrsok. Street names that merely
 * contain a number are untouched, because their remainder is lower-case ("Ulica 29. augusta").
 */
export const splitGluedStreets = (entry: string): string[] => {
  const m = entry.match(new RegExp(String.raw`^(.*\d[^${UPPER}]*?)\s+([${UPPER}][^\d]{2,})$`));
  if (!m) return [entry];
  const head = m[1].trim();
  const tail = m[2].trim();
  return head && tail ? [head, tail] : [entry];
};

/**
 * Everything one raw entry goes through before it becomes rows: unglue streets the source ran
 * together, then split an entry carrying several specs. Order matters — ungluing first keeps each
 * parity word next to its own numbers.
 */
export const normalizeEntry = (entry: string): string[] =>
  splitGluedStreets(entry).flatMap(expandMultiSpec);

/**
 * Date-named streets: in "Ul. 29. augusta 1A,2,2A" the 29 belongs to the NAME, not the house list.
 * Group 1 is the name, group 2 whatever follows it.
 */
const DATE_STREET =
  /^((?:ul(?:ica)?\.?|n[áa]m(?:estie)?\.?)?\s*\d+\.\s*[a-záäčďéíĺľňóôŕšťúýž]+)\s*(.*)$/i;

/** buildRow with the prose normalisation applied first. `srcSpadove` keeps the raw text. */
export const buildKvRow = (mc: string, mcNorm: string, okrsok: number, entry: string): Row => {
  const normalized = proseRange(entry);

  const date = normalized.match(DATE_STREET);
  if (date && date[2]) {
    // Parse "<digit-free placeholder> <numbers>" so the spec is read off the house list alone,
    // then restore the real name — otherwise parseStreetSpec reads the "29" of "29. augusta" as
    // the start of the spec and the entire string ends up as the street name.
    const row = keBuildRow(mc, mcNorm, okrsok, `Ulica ${date[2]}`);
    const name = date[1].replace(/\s+/g, " ").trim();
    row.street = name;
    row.streetNorm = norm(name);
    row.srcSpadove = entry;
    return row;
  }

  const row = keBuildRow(mc, mcNorm, okrsok, normalized);
  row.srcSpadove = entry;
  return row;
};

export { toSpecInput, type Row };
