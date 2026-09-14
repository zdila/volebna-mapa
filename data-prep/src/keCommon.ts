// Shared helpers for the 2026 REFERENDUM Košice mestská-časť okrsok→street parsers
// (Staré Mesto / Západ / Sever). Each MČ doc lists "spádové ulice" per okrsok with
// inline house-number ranges + Slovak parity words ("párne"/"nepárne"). We normalize a
// street entry into parseStreetSpec syntax (trailing "(párne)"/"(nepárne)") and build one
// output row per (okrsok, street) entry. See parseVrakuna.ts for the sibling BA pattern.
import { norm } from "./normalize.ts";
import { parseStreetSpec, type Spec } from "./houseSpec.ts";

// Split a comma-joined street list into per-street entries. Commas separate BOTH streets
// and number/parity tokens, so a comma-fragment that merely continues the previous street's
// spec re-attaches to it: a fragment that starts with a digit ("40/B", "19", "2/B") or is a
// lone trailing parity word ("párne"/"nepárne", as in "Ružová 45-50 párne, nepárne").
export const splitEntries = (text: string): string[] => {
  const prepped = text.replace(/\.\s*$/, "").trim();
  const entries: string[] = [];
  for (const fragRaw of prepped.split(",")) {
    const frag = fragRaw.trim();
    if (!frag) continue;
    if (entries.length && (/^\d/.test(frag) || /^\(?(ne)?párne\)?$/i.test(frag))) {
      entries[entries.length - 1] += ", " + frag;
    } else {
      entries.push(frag);
    }
  }
  return entries;
};

// Normalize one raw street entry into parseStreetSpec input syntax. Košice docs write the
// parity word WITHOUT parentheses and in either order relative to the numbers, plus a couple
// of oddities handled here.
export const toSpecInput = (entry: string): string => {
  let e = entry.replace(/\s+/g, " ").trim();
  // "okrem č. N" ("except no. N") — the spec system can't express an exclusion; keep the
  // whole street (the excluded house is picked up by whichever other okrsok enumerates it).
  e = e.replace(/\s+okrem\s+č\.?\s*\d+.*$/i, "").trim();
  // "3/A-3/G" building-section span of a single house number == that number ("3").
  e = e.replace(/(\d+)\/[a-z]\s*-\s*\1\/[a-z]/gi, "$1");
  // Already-parenthesized parity ("Hlinkova 32-38 (párne)") passes straight through.
  if (/\((ne)?párne\)\s*$/i.test(e)) return e;
  // "X-Y párne, nepárne" == both sides of the range: drop the words, keep the range as both.
  const both = e.match(/^(.+\d[\d\s/,-]*?)\s+(ne)?párne\s*,\s*(ne)?párne\s*$/i);
  if (both) return both[1].trim();
  // Parity BEFORE the numbers: "Czambelova párne 8 - 18" -> "Czambelova 8-18 (párne)".
  const pre = e.match(/^(.+?)\s+(ne)?párne\s+(\d.*)$/i);
  if (pre) return `${pre[1].trim()} ${pre[3].trim()} (${pre[2] ? "nepárne" : "párne"})`;
  // Parity AFTER the numbers: "Komenského 3-33 nepárne" -> "Komenského 3-33 (nepárne)".
  // The trailing [a-z]? keeps a house-number section letter ("Slovenskej jednoty 2-14A párne").
  const post = e.match(/^(.+?\d[\d,\s/-]*[a-z]?)\s+(ne)?párne\s*$/i);
  if (post) return `${post[1].trim()} (${post[2] ? "nepárne" : "párne"})`;
  // Parity word on a whole (number-less) street: "Rampová nepárne" -> "Rampová (nepárne)".
  const whole = e.match(/^(.+?)\s+(ne)?párne\s*$/i);
  if (whole && !/\d/.test(whole[1])) {
    return `${whole[1].trim()} (${whole[2] ? "nepárne" : "párne"})`;
  }
  return e;
};

export type Row = {
  mc: string;
  mcNorm: string;
  okrsok: number;
  obvod: 0;
  street: string;
  streetNorm: string;
  parity: string;
  cls: string;
  numberKind: string;
  spec: Spec;
  srcSpadove: string;
};

// Build one output row from a raw street entry. `srcSpadove` keeps the raw text verbatim.
export const buildRow = (
  mc: string,
  mcNorm: string,
  okrsok: number,
  entry: string,
): Row => {
  const p = parseStreetSpec(toSpecInput(entry));
  return {
    mc,
    mcNorm,
    okrsok,
    obvod: 0,
    street: p.street || entry,
    streetNorm: p.streetNorm || norm(entry),
    parity: p.parity,
    cls: p.cls,
    numberKind: p.numberKind,
    spec: p.spec,
    srcSpadove: entry,
  };
};

// Audit print shared by all three MČ scripts.
export const audit = (out: Row[], expectedOkrsky: number): void => {
  const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
  console.log(`total rows: ${out.length}`);
  console.log(`okrsok count: ${okrs.length} -> ${okrs.join(", ")}`);
  const byCls = Object.groupBy(out, (r) => r.cls);
  console.log(
    `cls: ${Object.entries(byCls).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`,
  );
  const counts = Object.fromEntries(
    okrs.map((o) => [o, out.filter((r) => r.okrsok === o).length]),
  );
  console.log(
    `streets per okrsok: ${okrs.map((o) => `${o}:${counts[o]}`).join(" ")}`,
  );
  const missing = [...Array(expectedOkrsky)].map((_, i) => i + 1).filter((n) => !okrs.includes(n));
  console.log(`missing okrsky (of 1-${expectedOkrsky}): ${missing.length ? missing.join(",") : "none"}`);
};
