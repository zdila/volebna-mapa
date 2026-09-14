// Parse the 2026 REFERENDUM (rozhodnutie prezidenta SR č. 60/2026 Z.z., konané 04.07.2026)
// street->okrsok assignment for four SMALL Košice mestské časti into ke_<slug>_okrsok_streets.json.
//
// Sources (all verified 2026 referendum, reference 60/2026 and/or 04.07.2026):
//   Pereš  — mcperes.sk determination PDF (download_file_f.php?id=2409904), Košice 18.05.2026, 2 okrsky.
//   Barca  — barca.sk "Určenie volebných okrskov.pdf" (e_download editor-1-169-sk_4), 05.05.2026, 3 okrsky.
//   Šaca   — saca.sk referendum-2026 scanned "Oznámenie..." PDF (download_file_f.php?id=2403158), 04.05.2026,
//            3 okrsky (street lists read from the scanned page image — no text layer).
//   Vyšné Opátske — vysneopatske.sk "Určenie okrskov..." PDF (download_file_f.php?id=2403644), 05.05.2026, 3 okrsky.
//
// These docs are street-NAME lists (a few carry house-range + parity qualifiers, and Šaca has three
// institutions). Each entry is fed to parseStreetSpec: bare names -> cls WHOLE; qualified entries carry
// their per-okrsok spec (SPLIT-STREET RULE: a street present in >1 okrsok keeps its per-okrsok range/parity).
// srcSpadove = the raw source string exactly as printed in the document.
import { writeFileSync } from "node:fs";
import { norm } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

// An entry is either a plain street name (raw === parseStreetSpec input) or [raw, specInput] when the
// printed form ("… párne čísla od 2 do 20") must be rewritten to parseStreetSpec syntax ("… 2-20 (párne)").
type Entry = string | [raw: string, specInput: string];

type McDef = {
  mc: string;
  mcNorm: string;
  slug: string;
  okrsky: Record<number, Entry[]>;
};

const defs: McDef[] = [
  {
    mc: "Košice-Pereš",
    mcNorm: "peres",
    slug: "peres",
    okrsky: {
      // "prihlásení na MČ" (voters registered at the MČ office, no geometry) is intentionally omitted.
      1: [
        ["Bystrická (párne)", "Bystrická (párne)"],
        "Krásnohorská",
        "Krompašská",
        "Perešská",
        "Revúcka",
        "Svidnícka",
        "Chatky",
      ],
      2: [
        "Betliarska",
        ["Bystrická (nepárne)", "Bystrická (nepárne)"],
        "Gelnická",
        "Haburská",
        "Jasovská",
        "Jelšavská",
        "Medzevská",
        "Na Košarisku",
        "Sabinovská",
        "Vranovská",
      ],
    },
  },
  {
    mc: "Košice-Barca",
    mcNorm: "barca",
    slug: "barca",
    okrsky: {
      1: [
        "Abovská", "Andraščíkova", "Bahýľova", "Berzeviczyho", "Bielych albatrosov",
        "Gavlovičova", "Janitorova", "K letisku", "Krátka", "Matičná", "Poničanova",
        "Radlinského", "Šimekova ulica", "Timravy", "Zemianska", "Zichyho",
      ],
      2: [
        "Alejová", "Barčianska", "Borodáčova", "Cirbusovej", "Červený rak", "Horovova",
        "Hraničná", "Kapustná", "Kostrova", "Ľanová", "Ovocná", "Pri salaši", "Svetlá",
        "Svetlá pusta", "Teplého", "Turnianska", "Vozárova",
      ],
      3: [
        "Bronzová", "Cínová", "Čkalovova", "Fándlyho", "Hečkova", "Chrómová",
        "Kubíková", "Medená", "Močiarna", "Mosadzná", "Námestie ml. poľnohospodárov",
        "Niklová", "Osloboditeľov", "Platinová", "Podnikateľská", "Pokojná",
        "Pri pošte", "Pri vagovni", "Pri železničnej stanici", "Rusnákova", "Strieborná",
        "Tešedíkova", "Titánová", "Za školou", "Zborovjanova", "Zinková",
      ],
    },
  },
  {
    mc: "Košice-Šaca",
    mcNorm: "saca",
    slug: "saca",
    okrsky: {
      1: [
        "Ranná", "Mierová", "Šemšianská", "Jarková", "Kvetná", "Lúčna", "Smreková",
        "Dúbravská", "Borovicová", "Maloidanská", "Buzinská", "Kamenná", "Ku mlynu",
        "Kaštieľná", "Jabloňová", "Na záhumní", "Nemessányiho", "Pod stavencom",
        "Fakultná nemocnica AGEL Košice – Šaca a.s. /Lúčna ulica/",
        "Kardiocentrum AGEL a.s. /Lúčna ulica/",
        "Ľudvíkov Dvor",
      ],
      2: [
        "Námestie oceliarov",
        ["Železiarenská párne čísla od 2 do 20", "Železiarenská 2-20 (párne)"],
        "Fyziatricko-rehabilitačné oddelenie fakultnej nemocnice AGEL Košice – Šaca a.s. /Železiarenská ul./",
      ],
      3: [
        "Mládežnícka", "Učňovská",
        ["Železiarenská párne čísla 22 až 76", "Železiarenská 22-76 (párne)"],
        ["Železiarenská nepárne čísla od 1 do 43", "Železiarenská 1-43 (nepárne)"],
        "ÚVTOS /Budovateľská ul./",
      ],
    },
  },
  {
    mc: "Košice-Vyšné Opátske",
    mcNorm: "vysne opatske",
    slug: "vysne_opatske",
    okrsky: {
      // admin markers "MČ – zrušený trvalý pobyt" (okr1) and "MČ – chaty" (okr2) omitted (no geometry).
      1: [
        "Alšavská", "Hájnická", "Jačmenná", "Južné nábrežie", "Kukuričná", "Nevädzová",
        "Nižný Heringeš", "Nižná úvrať",
        ["Opatovská cesta 1 – 53 nepárne", "Opatovská cesta 1-53 (nepárne)"],
        "Ovsená", "Pod vinicami", "Prvosienková", "Ražná", "Roľnícka", "Sečovská cesta",
        "Snežienková", "Šarišská", "Tigria", "Zemplínska", "Žatevná", "Žitná",
      ],
      2: [
        "Bažantia", "Dubová", "Jelenia", "Klinčeková", "Kosatcová", "Králičia", "Liesková",
        ["Opatovská cesta – párne", "Opatovská cesta (párne)"],
        ["Opatovská cesta 55-155 nepárne", "Opatovská cesta 55-155 (nepárne)"],
        "Osiková", "Pod hrebienkom", "Príkra", "Pšeničná", "Púpavová", "Slávičia",
        "Šafranová", "Šípková", "Škovránčia", "Včelárska paseka", "Viničná", "V úvoze", "Zajačia",
      ],
      3: [
        "Bazová", "Borievková", "Cédrová", "Cezmínová", "Hlohová", "Hrabová",
        "Jarabinová", "Jelšová", "Píniová",
      ],
    },
  },
];

for (const def of defs) {
  const out = Object.entries(def.okrsky).flatMap(([okStr, entries]) => {
    const okrsok = +okStr;
    return entries.map((e) => {
      const [raw, input] = Array.isArray(e) ? e : [e, e];
      const p = parseStreetSpec(input);
      return {
        mc: def.mc,
        mcNorm: def.mcNorm,
        okrsok,
        obvod: 0,
        street: p.street || raw,
        streetNorm: p.streetNorm || norm(raw),
        parity: p.parity,
        cls: p.cls,
        numberKind: p.numberKind,
        spec: p.spec,
        srcSpadove: raw,
      };
    });
  });

  writeFileSync(`data/ke_${def.slug}_okrsok_streets.json`, JSON.stringify(out));

  // Audit
  const okrs = [...new Set(out.map((r) => r.okrsok))].sort((a, b) => a - b);
  const byCls = Object.groupBy(out, (r) => r.cls);
  console.log(`\n=== ${def.mc} (${def.slug}) ===`);
  console.log(`rows: ${out.length}  okrsky: ${okrs.length} [${okrs.join(", ")}]`);
  console.log(`cls: ${Object.entries(byCls).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`);
  const perOk = okrs.map((o) => `${o}:${out.filter((r) => r.okrsok === o).length}`).join(" ");
  console.log(`per-okrsok rows: ${perOk}`);
  // split streets (same streetNorm in >1 okrsok)
  const byStreet = Object.groupBy(out.filter((r) => r.streetNorm), (r) => r.streetNorm);
  const splits = Object.entries(byStreet).filter(([, v]) => new Set(v!.map((r) => r.okrsok)).size > 1);
  if (splits.length) console.log(`split streets: ${splits.map(([k]) => k).join(", ")}`);
  for (const r of out.filter((r) => r.cls !== "WHOLE")) {
    console.log(`  okr${r.okrsok} [${r.cls}] «${r.srcSpadove}» -> street="${r.street}" parity=${r.parity} ranges=${JSON.stringify(r.spec?.ranges)} singles=${JSON.stringify(r.spec?.singles)}`);
  }
}
