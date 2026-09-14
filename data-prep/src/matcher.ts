// House-number matcher: given an address (street + orientačné/súpisné číslo), find the
// okrsok row(s) whose spec it falls in. Built from a <mc>_okrsok_streets.json assignment.
import type { Parsed } from "./houseSpec.ts";
import { streetKey } from "./normalize.ts";

export type OkrsokRow = {
  mc: string;
  mcNorm: string;
  okrsok: number;
  obvod: number;
  street: string;
  streetNorm: string;
  parity: Parsed["parity"];
  cls: Parsed["cls"];
  numberKind: Parsed["numberKind"];
  spec: Parsed["spec"];
};

export type Address = {
  mcNorm: string;
  streetNorm: string;
  orient: string | null; // orientačné číslo incl. letter, e.g. "40", "40A"
  supisne: string | null; // súpisné číslo
};

// Normalize a house-number token for ENUM comparison: uppercase, drop the slash in
// "40/A" so "40A" and "40/A" compare equal, strip spaces.
const normHouse = (s: string | number): string =>
  String(s).toUpperCase().replace(/\s+/g, "").replace(/\//g, "");

const numPart = (s: string): number | null => {
  const m = s.match(/\d+/);
  return m ? +m[0] : null;
};

const parityOk = (want: Parsed["parity"], n: number): boolean =>
  want === "both" || (want === "odd") === (n % 2 === 1);

// Index key. Two rows can share a (mc, street) key (e.g. Železiarenská split by range).
// `byKey` is the exact index; `byTail` is a surname fallback (see below).
export type MatchIndex = { byKey: Map<string, OkrsokRow[]>; byTail: Map<string, Set<string>> };
const key = (mcNorm: string, streetNorm: string) => `${mcNorm} ${streetKey(streetNorm)}`;

// Generic street-type words that must never be used as a surname discriminator.
const GENERIC_TAIL = new Set(["cesta", "namestie", "trieda", "nabrezie", "ulica"]);
// Last token of a street key, used to match person-named streets whose given name is
// abbreviated differently between sources (RA "M. Curie Sklodowskej" vs list "Sklodowskej",
// "A. Gwerkovej" vs "Gwerkovej"). Only distinctive (≥4-char, non-generic) tails qualify.
const tailOf = (streetNorm: string): string | null => {
  const toks = streetKey(streetNorm).split(" ");
  const t = toks[toks.length - 1];
  // ≥4 chars (surnames like "Rašu"); the per-MČ uniqueness check guards against collisions.
  return toks.length && t.length >= 4 && !GENERIC_TAIL.has(t) ? t : null;
};

// Slovak okrsok lists often split a street between precincts by parity but write the ranges
// WITHOUT a párne/nepárne word, letting the endpoints signal it ("2-38" = even side, "1-59" =
// odd side). Parsed naively as "both" these overlap, so every shared house is ambiguous and a
// whole okrsok can end up with zero seeds (Banská Bystrica Tulská: okr55 2-38, okr56 1-59).
// When two "both" ranges of the SAME street in DIFFERENT okrsky overlap numerically, and each
// has same-parity endpoints of OPPOSITE parity to the other, re-read them by their endpoint
// parity — which makes them disjoint. Conservative: fires only on a genuine cross-okrsok
// contradiction that the parity reading actually resolves; never touches the documented
// same-okrsok "1-7 both sides" case (no cross-okrsok overlap there).
const endpointParity = (a: number, b: number): Parsed["parity"] | null =>
  a % 2 === b % 2 ? (a % 2 === 1 ? "odd" : "even") : null;

export const resolveSplitParity = (rows: OkrsokRow[]): void => {
  const byStreet = new Map<string, OkrsokRow[]>();
  for (const r of rows) {
    if (!r.streetNorm || !r.spec?.ranges.length) continue;
    const k = key(r.mcNorm, r.streetNorm);
    (byStreet.get(k) ?? byStreet.set(k, []).get(k)!).push(r);
  }
  for (const group of byStreet.values()) {
    if (new Set(group.map((r) => r.okrsok)).size < 2) continue; // not split across okrsky
    const items = group.flatMap((r) => r.spec!.ranges.map((rg) => ({ okr: r.okrsok, rg })));
    for (const A of items) for (const B of items) {
      if (A.okr >= B.okr) continue; // ordered, distinct okrsky only
      if (A.rg[2] !== "both" && B.rg[2] !== "both") continue;
      const [a1, b1] = A.rg, [a2, b2] = B.rg;
      if (!(a1 <= b2 && a2 <= b1)) continue; // no numeric overlap
      const ep1 = endpointParity(a1, b1), ep2 = endpointParity(a2, b2);
      if (ep1 && ep2 && ep1 !== ep2) { A.rg[2] = ep1; B.rg[2] = ep2; } // disjoint after reparity
    }
  }
};

export const buildIndex = (rows: OkrsokRow[]): MatchIndex => {
  resolveSplitParity(rows);
  const byKey = new Map<string, OkrsokRow[]>();
  const byTail = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.streetNorm) continue; // institutions / bare súpisné handled separately
    const k = key(r.mcNorm, r.streetNorm);
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
    const t = tailOf(r.streetNorm);
    if (t) {
      const tk = `${r.mcNorm} ${t}`;
      (byTail.get(tk) ?? byTail.set(tk, new Set()).get(tk)!).add(k);
    }
  }
  return { byKey, byTail };
};

const rowMatches = (r: OkrsokRow, addr: Address): boolean => {
  if (r.cls === "INSTITUTION") return false;

  const houseRaw = r.numberKind === "supisne" ? addr.supisne : addr.orient;
  if (r.cls === "WHOLE") {
    // Whole street, possibly parity-restricted. Need the orientačné parity to test.
    if (r.parity === "both") return true;
    const n = addr.orient ? numPart(addr.orient) : null;
    return n === null ? false : parityOk(r.parity, n);
  }
  if (!houseRaw) return false;
  const n = numPart(houseRaw);
  if (n === null) return false;

  // Each range enforces its own parity (a "(nepárne)" marker binds per-range).
  const inRanges = () =>
    r.spec?.ranges.some(([a, b, p]) => n >= a && n <= b && parityOk(p, n)) ?? false;

  if (r.cls === "RANGE") return inRanges();

  // ENUM: exact membership. Compare both the full token (letters) and the bare int.
  if (r.cls === "ENUM") {
    const h = normHouse(houseRaw);
    for (const s of r.spec?.singles ?? []) {
      const sn = normHouse(s);
      if (sn === h) return true;
      if (/^\d+$/.test(sn) && +sn === n) return true; // int single vs "40A"? no — only exact int
    }
    // ENUM may also carry ranges (mixed "1-19, 21, 23")
    return inRanges();
  }
  return false;
};

export type MatchResult =
  | { status: "ok"; row: OkrsokRow }
  | { status: "ambiguous"; rows: OkrsokRow[] }
  | { status: "no-street" } // street not in this MČ's assignment
  | { status: "no-number" }; // street known but number fits no spec

const okrsokKey = (r: OkrsokRow) => `${r.mcNorm}#${r.okrsok}`;

export const match = (idx: MatchIndex, addr: Address): MatchResult => {
  let cands = idx.byKey.get(key(addr.mcNorm, addr.streetNorm));
  if (!cands || cands.length === 0) {
    // Surname fallback: RA may spell a person-named street's given name in full while the
    // assignment abbreviates or drops it. Match on the distinctive tail if it is unambiguous.
    const t = tailOf(addr.streetNorm);
    const keys = t && idx.byTail.get(`${addr.mcNorm} ${t}`);
    if (keys && keys.size === 1) cands = idx.byKey.get([...keys][0]);
    if (!cands || cands.length === 0) return { status: "no-street" };
  }
  let hits = cands.filter((r) => rowMatches(r, addr));
  if (hits.length === 0) return { status: "no-number" };

  // A lettered address ("1A") that exactly matches an ENUM section token belongs to
  // that okrsok, not to a RANGE that merely covers its integer part ("1-7").
  if (addr.orient && /[a-z]/i.test(addr.orient) && hits.length > 1) {
    const h = normHouse(addr.orient);
    const exact = hits.filter(
      (r) => r.cls === "ENUM" && (r.spec?.singles ?? []).some((s) => normHouse(s) === h),
    );
    if (exact.length) hits = exact;
  }

  // Multiple rows of the same okrsok (e.g. range + section-letter enum) = one answer.
  if (new Set(hits.map(okrsokKey)).size === 1) return { status: "ok", row: hits[0] };

  // A specific (RANGE/ENUM) hit beats a WHOLE catch-all on the same street.
  const specific = hits.filter((h) => h.cls !== "WHOLE");
  if (specific.length && new Set(specific.map(okrsokKey)).size === 1)
    return { status: "ok", row: specific[0] };

  return { status: "ambiguous", rows: hits };
};
