// Parse the Staré Mesto 2026 referendum "Oznámenie" PDF (pdftotext -layout) into okrsok_streets
// rows. Block layout per okrsok:
//   Miestom konania referenda okrsku č. N je:
//   <polling place>            (may wrap onto a 2nd line)
//   pre občanov oprávnených ... bývajúcich na uliciach a v domoch:
//   <StreetName>   <celá|celé | comma-separated house-number list>
// Number lists wrap onto indented continuation lines that begin with a digit (street names always
// begin with an uppercase letter, so a leading digit unambiguously marks a wrap). "celá"/"celé" =
// whole street. 19 okrsky (the current post-2026-reorganisation set).
import { readFileSync, writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const lines = readFileSync("data/staremesto_ref2026.txt", "utf8").split("\n");

type Entry = { okrsok: number; street: string; spec: string }; // spec="" => whole street
const entries: Entry[] = [];
let okrsok = 0;
let mode: "idle" | "polling" | "streets" = "idle";

for (const raw of lines) {
  const t = raw.trim();
  if (!t) continue;
  if (/Informácia pre voliča/.test(t)) break; // legal boilerplate follows the last okrsok

  const okrM = t.match(/^Miestom konania referenda okrsku č\.\s*(\d+)/);
  if (okrM) { okrsok = +okrM[1]; mode = "polling"; continue; }
  if (/^pre občanov oprávnených/.test(t)) { mode = "streets"; continue; }
  if (mode !== "streets") continue;           // skip polling-place lines
  if (/^Strana č\./.test(t)) continue;        // page footer

  if (/^\d/.test(t)) {                         // continuation of the previous street's number list
    if (entries.length) entries[entries.length - 1].spec += "," + t;
    continue;
  }
  const whole = t.replace(/\s+cel[áé]\s*$/i, "");
  if (whole !== t) { entries.push({ okrsok, street: whole.trim(), spec: "" }); continue; }
  // The house spec is the trailing pure comma-list of number tokens; requiring it to run to EOL
  // keeps an ordinal in the street name (e.g. "29. augusta") from being split off as a number.
  const m = t.match(/^(.+?)\s+(\d+[A-Za-z]?(?:\s*,\s*\d+[A-Za-z]?)*,?)$/); // trailing ',' = wrap
  if (m) { entries.push({ okrsok, street: m[1].trim(), spec: m[2].trim() }); continue; }
  entries.push({ okrsok, street: t, spec: "" }); // defensive: bare street name
}

const out = entries.map((e) => {
  // Parse the number list against a digit-free placeholder so a date-named street ("29. augusta")
  // isn't re-mangled by parseStreetSpec's name/number split; then restore the real street name.
  const parsed = parseStreetSpec(e.spec ? `Ulica ${e.spec}` : e.street);
  return {
    mc: "Staré Mesto",
    mcNorm: "staremesto",
    okrsok: e.okrsok,
    obvod: 0,
    street: e.spec ? e.street : parsed.street || e.street,
    streetNorm: norm(e.spec ? e.street : parsed.street || e.street),
    parity: parsed.parity,
    cls: parsed.cls,
    numberKind: parsed.numberKind,
    spec: parsed.spec,
    srcSpadove: e.spec ? `${e.street} ${e.spec}` : e.street,
  };
});

writeFileSync("data/staremesto_okrsok_streets.json", JSON.stringify(out));

// Audit
const okrs = new Set(out.map((r) => r.okrsok));
console.log(`rows: ${out.length}   okrsky: ${okrs.size}   (range ${Math.min(...okrs)}-${Math.max(...okrs)})`);
console.log(`cls: ${Object.entries(Object.groupBy(out, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
const missing = [...Array(19)].map((_, i) => i + 1).filter((n) => !okrs.has(n));
console.log(`okrsky 1-19 with no streets: ${missing.length ? missing.join(",") : "none"}`);
console.log("\nnon-whole entries (first 25):");
for (const r of out.filter((r) => r.cls !== "WHOLE").slice(0, 25)) console.log(`  okr${r.okrsok} ${r.street} [${r.cls}] n=${(r.spec?.singles?.length ?? 0) + (r.spec?.ranges?.length ?? 0)}  «${r.srcSpadove.slice(0, 60)}»`);
