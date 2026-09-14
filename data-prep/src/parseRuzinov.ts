// Parse the Ružinov 2026 "Zoznam ulíc a okrskov (abecedne)" PDF (pdftotext -layout) into
// okrsok_streets rows. Clean 4-col table: Ulica | Orientačné čísla | Okrsok č. | Adresa volebnej
// miestnosti. Fields separated by ≥2 spaces; a čísla list uses ", " (comma + single space) so it
// never splits. One row per street, or per house-number segment when a street is split across okrsky.
// "celá" = whole street. A long čísla list WRAPS onto extra lines: the street/okrsok/address land on
// ONE anchor line (name vertically centred in the cell) and the surplus number tokens overflow onto
// orphan lines ABOVE and/or BELOW it. Overflow direction is given by the trailing comma: a line that
// ends in a comma continues onto the next line. We reattach each orphan to its anchor by walking that
// comma chain up (prefix) and down (suffix) from the anchor.
import { readFileSync, writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const lines = readFileSync("data/ruzinov_okrsky.txt", "utf8").split("\n");

type Anchor = { i: number; street: string; cisla: string; okrsok: number };
type Kind = "anchor" | "orphan" | "skip";
type Line = { i: number; kind: Kind; raw: string; anchor?: Anchor };

const endsComma = (s: string): boolean => /,\s*$/.test(s.trim());

const classify = (raw: string, i: number): Line => {
  const t = raw.trim();
  if (!t || /Zoznam ulíc|^Ulica\s+Orient|^\d+$/.test(t))
    return { i, kind: "skip", raw };
  const p = t.split(/\s{2,}/);
  // Anchor row: [street, čísla, okrsok, address]; street must not start with a digit.
  if (p.length >= 4 && /^\d{1,3}$/.test(p[2]) && !/^\d/.test(p[0]))
    return { i, kind: "anchor", raw, anchor: { i, street: p[0], cisla: p[1], okrsok: +p[2] } };
  // Orphan overflow: a bare čísla fragment (starts with a digit, no okrsok/address columns).
  if (/^\d/.test(t)) return { i, kind: "orphan", raw: t };
  return { i, kind: "skip", raw };
};

const cls = lines.map(classify);
const kindAt = (i: number): Kind => (i >= 0 && i < cls.length ? cls[i].kind : "skip");

// Build the full čísla list for an anchor: prefix orphans (walking up while each line ends in a
// comma, i.e. flows into the anchor) + the anchor's own čísla + suffix orphans (walking down while
// the previous line ends in a comma). Header/anchor lines break the chain.
const fullCisla = (a: Anchor): string => {
  const parts: string[] = [];
  // prefix: lines above the anchor that end in a comma (chain flowing down into the anchor)
  const pre: string[] = [];
  for (let j = a.i - 1; kindAt(j) === "orphan" && endsComma(cls[j].raw); j--)
    pre.unshift(cls[j].raw);
  parts.push(...pre, a.cisla);
  // suffix: if this line (or the running chain) ends in a comma, keep taking orphan lines below
  let k = a.i;
  while (endsComma(parts.at(-1)!) && kindAt(k + 1) === "orphan") {
    parts.push(cls[k + 1].raw);
    k++;
  }
  return parts.join(", ");
};

const anchors = cls.filter((l): l is Line & { anchor: Anchor } => l.kind === "anchor").map((l) => l.anchor);

const clean = (s: string): string =>
  s.replace(/\s+/g, "").replace(/,+/g, ",").replace(/^,|,$/g, "");

const out = anchors.map((a) => {
  const cislaRaw = fullCisla(a);
  const cisla = clean(cislaRaw);

  // Garden-colony / register-based "Ružinov" súpisné-číslo streets.
  if (/^Ružinov\s*-\s*súpisné/i.test(a.street)) {
    const parsed = parseStreetSpec(`Súpisné čísla ${cisla}`);
    return {
      mc: "Ružinov",
      mcNorm: "ruzinov",
      okrsok: a.okrsok,
      obvod: 0,
      street: "Ružinov",
      streetNorm: norm("Ružinov"),
      parity: parsed.parity,
      cls: parsed.cls,
      numberKind: "supisne" as const,
      spec: parsed.spec,
      srcSpadove: `${a.street} ${cislaRaw}`,
    };
  }

  // Voters registered at the MČ address with no specific street ("Adresa trvalého pobytu: …").
  if (/^Adresa\b/i.test(a.cisla)) {
    return {
      mc: "Ružinov",
      mcNorm: "ruzinov",
      okrsok: a.okrsok,
      obvod: 0,
      street: a.street,
      streetNorm: norm(a.street),
      parity: "both" as const,
      cls: "WHOLE" as const,
      numberKind: "orientacne" as const,
      spec: null,
      srcSpadove: `${a.street} ${a.cisla}`,
    };
  }

  // "celá" or empty → whole street. Otherwise "<street> <numbers>".
  const whole = /^celá$/i.test(cisla) || !cisla;
  const parsed = parseStreetSpec(whole ? a.street : `${a.street} ${cisla}`);
  return {
    mc: "Ružinov",
    mcNorm: "ruzinov",
    okrsok: a.okrsok,
    obvod: 0,
    street: parsed.street || a.street,
    streetNorm: parsed.streetNorm || norm(a.street),
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    srcSpadove: `${a.street} ${cislaRaw}`,
  };
});

writeFileSync("data/ruzinov_okrsok_streets.json", JSON.stringify(out));

// ---- Audit ----
const okrs = new Set(out.map((r) => r.okrsok));
const nums = [...okrs].sort((a, b) => a - b);
console.log(`rows: ${out.length}   okrsky: ${okrs.size}   (range ${nums[0]}-${nums.at(-1)})`);
console.log(`okrsok numbers: ${nums.join(",")}`);
console.log(`cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
const missing = [...Array(35)].map((_, i) => i + 1).filter((n) => !okrs.has(n));
console.log(`okrsky 1-35 with no streets: ${missing.length ? missing.join(",") : "none"}`);
const counts = Object.entries(Object.groupBy(out, (r) => r.okrsok)).map(([k, v]) => [+k, v!.length] as const).sort((a, b) => a[1] - b[1]);
console.log(`thinnest okrsky (rows): ${counts.slice(0, 5).map(([k, n]) => `okr${k}=${n}`).join(" ")}`);
console.log(`súpisné rows: ${out.filter((r) => r.numberKind === "supisne").length}`);
