// Parse the "spádové ulice" free-text field into (street name, house-number spec).
// One source string = one street assignment for one okrsok.
import { norm } from "./normalize.ts";

export type Parity = "odd" | "even" | "both";
export type Cls = "WHOLE" | "RANGE" | "ENUM" | "INSTITUTION";
export type NumberKind = "orientacne" | "supisne";

export type Spec = {
  // Each range carries its OWN parity. A trailing "(nepárne)" binds only to the range
  // it follows, so "1-7, 9-31 (nepárne)" = [1,7,both] + [9,31,odd] (houses 1..7 both
  // sides, then odd 9..31) — not the whole list odd.
  ranges: [number, number, Parity][];
  // singles carry the raw token so section letters survive: 40, "40/A", "9A".
  singles: (number | string)[];
  raw: string;
} | null;

export type Parsed = {
  street: string;
  streetNorm: string;
  parity: Parity;
  cls: Cls;
  spec: Spec;
  numberKind: NumberKind;
};

const parity = (raw: string): Parity =>
  /nepár/i.test(raw) ? "odd" : /pár/i.test(raw) ? "even" : "both";

// Institutions: voters but no street geometry (Nemocnica Šaca, its rehab ward, ÚVTOS).
// All three carry a "/word .../" location note (e.g. "/Budovateľská ul./"); a real
// street like "Pri nemocnici" has none, and a bare section letter "57/A" has <2
// letters between the slashes, so this matches institutions only.
const INST_SLASH_RE = /\/[^/]*[a-záčďéíĺľňóôŕšťúýž]{2,}[^/]*\//i;

// One house-number token: 40, 40A, 40/A, or a lone letter (Skladná "1A, B, C").
const TOKEN = String.raw`(?:\d+[a-z]?(?:\/[a-z])?|[a-z])`;
const RANGE_OR_SINGLE = new RegExp(
  String.raw`^${TOKEN}(?:\s*-\s*\d+[a-z]?)?$`,
  "i",
);

// `marked` is the trailing parity qualifier; it applies ONLY to the last range.
const parseTokenList = (body: string, marked: Parity = "both"): Spec => {
  const raw = body;
  const ranges: [number, number, Parity][] = [];
  const singles: (number | string)[] = [];
  let lastNumber = 0; // for lone-letter tokens like "B" meaning "<lastNumber>B"

  for (const partRaw of body.split(",")) {
    const part = partRaw.trim();
    if (!part) continue;
    const rangeM = part.match(/^(\d+)[a-z]?\s*-\s*(\d+)[a-z]?$/i);
    if (rangeM) {
      ranges.push([+rangeM[1], +rangeM[2], "both"]);
      lastNumber = +rangeM[2];
      continue;
    }
    const numM = part.match(/^(\d+)/);
    if (numM) {
      lastNumber = +numM[1];
      // keep letter/section suffix verbatim, else store as int
      singles.push(/^\d+$/.test(part) ? +part : part);
      continue;
    }
    // lone letter: "B" after "1A" -> "1B"
    if (/^[a-z]$/i.test(part)) singles.push(`${lastNumber}${part.toUpperCase()}`);
  }

  // Bind the parity marker to the last range only. Contradiction guard: if that range
  // lies wholly on the OPPOSITE parity ("11-43 (párne)" is all odd), the label is
  // unreliable — widen to both rather than reject the real (odd) houses.
  if (marked !== "both" && ranges.length) {
    const last = ranges[ranges.length - 1];
    const [a, b] = last;
    last[2] = a % 2 === b % 2 && (a % 2 === 1) === (marked === "even") ? "both" : marked;
  }
  return { ranges, singles, raw };
};

export const parseStreetSpec = (input: string): Parsed => {
  const s0 = input.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

  // súpisné-číslo enumeration ("Súpisne čísla 2669, 2671, ...")
  const supM = s0.match(/^Súpis[a-z]*\s+čísl[a-z]*\s+(.+)$/i);
  if (supM) {
    const spec = parseTokenList(supM[1]);
    return {
      street: "",
      streetNorm: "",
      parity: "both",
      cls: "ENUM",
      spec,
      numberKind: "supisne",
    };
  }

  // Institutions — no geometry, assign by hand to the okrsok area.
  if (INST_SLASH_RE.test(s0)) {
    return {
      street: s0,
      streetNorm: norm(s0.replace(/\s*\/[^/]*\/\s*/g, " ")),
      parity: "both",
      cls: "INSTITUTION",
      spec: null,
      numberKind: "orientacne",
    };
  }

  // Trailing parity marker "(párne)" / "(nepárne)".
  let s = s0;
  let par: Parity = "both";
  const parM = s.match(/\((?:ne)?párne\)\s*$/i);
  if (parM) {
    par = parity(parM[0]);
    s = s.slice(0, parM.index).trim();
  }

  // Split trailing number spec from the street name. The spec starts at the first
  // digit that is either preceded by whitespace or directly glued to a letter
  // ("Fábryho12-16"). Ordinal names ("1. mája") have their digit at position 0 and
  // are never followed by a further numeric spec, so they fall through to WHOLE.
  const m = s.match(/^(.+?)(?:\s+|(?<=[a-zľščťžýáíéúäôňďĺ]))(\d.*)$/i);
  if (!m) {
    // No number spec: whole street (possibly parity-restricted, e.g. "Zimná (párne)").
    return {
      street: s,
      streetNorm: norm(s),
      parity: par,
      cls: "WHOLE",
      spec: null,
      numberKind: "orientacne",
    };
  }

  const street = m[1].trim();
  const body = m[2].trim();

  // Validate every comma-part looks like a number token/range; if not, it's really
  // part of the name -> treat whole thing as WHOLE (defensive).
  const parts = body.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.every((p) => RANGE_OR_SINGLE.test(p))) {
    return {
      street: s,
      streetNorm: norm(s),
      parity: par,
      cls: "WHOLE",
      spec: null,
      numberKind: "orientacne",
    };
  }

  const spec = parseTokenList(body, par);
  const cls: Cls = spec.ranges.length && !spec.singles.length ? "RANGE" : "ENUM";

  return {
    street,
    streetNorm: norm(street),
    parity: par,
    cls,
    spec,
    numberKind: "orientacne",
  };
};
