// Košice-Krásna — 2026 referendum street→okrsok assignment (2 okrsky).
//
// SOURCE NOTE: MČ Krásna did NOT publish a standalone 2026-referendum street list (its site
// has only a generic voter-info leaflet + the presidential decision + result zápisnice). The
// live page confirms "Pre referendum 4.7.2026 ... utvorených 2 volebné okrsky". The 2-okrsok
// street composition is STABLE: the 2023-referendum "Oznámenie o určení času a miesta konania
// referenda" and the 2024-EP "Oznámenie" have BYTE-IDENTICAL street lists (48 streets in okr1,
// 38 in okr2, verified diff = 0), and 2026 keeps the same 2 okrsky. We therefore build from the
// most recent authoritative 2-okrsok list (2024 EP). Streets are names-only → all WHOLE.
//
// Format: prose blocks "(okrsok č. N tvoria ulice: Ulica1, Ulica2, ... )" ending at ')'; okr2
// trails an admin catch-all ("obč. s TP v MČ ... v zmysle § 5 ...") which is stripped.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

const PDF = "data/ke_krasna_okrsky_ep2024.pdf";
const SRC = "https://www.kosicekrasna.sk/files/2024-03-07-130301-EP_2024okrsky_a_vol._miestnosti.pdf" +
  " (2-okrsok list, verified == 2023 referendum; no standalone 2026 street list published)";

const text = execFileSync("pdftotext", ["-layout", PDF, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");

const rows = [] as any[];
for (const m of text.matchAll(/okrsok\s*č\.\s*(\d+)\s*tvoria ulice:\s*(.*?)\)/gi)) {
  const okrsok = +m[1];
  const body = m[2].replace(/\s*(obč\.|v zmysle).*$/i, ""); // drop trailing admin note
  for (const rawStreet of body.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!/[a-záčďéíĺľňóôŕšťúýž]/i.test(rawStreet)) continue; // must contain a letter
    const parsed = parseStreetSpec(rawStreet);
    rows.push({
      mc: "Košice-Krásna",
      mcNorm: "krasna",
      okrsok,
      obvod: 0,
      street: parsed.street || rawStreet,
      streetNorm: parsed.streetNorm || norm(rawStreet),
      parity: parsed.parity,
      cls: parsed.cls,
      numberKind: parsed.numberKind,
      spec: parsed.spec,
      srcSpadove: rawStreet,
    });
  }
}

writeFileSync("data/ke_krasna_okrsok_streets.json", JSON.stringify(rows));

// Audit
const okrs = [...new Set(rows.map((r) => r.okrsok))].sort((a, b) => a - b);
console.log(`src: ${SRC}`);
console.log(`rows: ${rows.length}   okrsky: ${okrs.length} [${okrs.join(",")}]`);
console.log(`cls: ${Object.entries(Object.groupBy(rows, (r) => r.cls)).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
const per = okrs.map((o) => `${o}:${rows.filter((r) => r.okrsok === o).length}`).join(" ");
console.log(`streets per okrsok: ${per}`);
