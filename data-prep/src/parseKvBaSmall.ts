// Bratislava MČ whose KOMUNÁLNE VOĽBY 24.10.2026 document is a SCAN with no text layer, read off
// the page images and transcribed here. Both are small enough that transcription is safer than
// OCR — an OCR slip in a street name silently drops that street's addresses from the okrsok.
//
//   Vajnory            vajnory.sk/sites/default/files/2026-07/Oznámenie utvorení volebných
//                      okrskov a určení volebných miestností.pdf — 5 okrsky, colour-banded table,
//                      street names only. Signed 29. júla 2026.
//   Záhorská Bystrica  zahorskabystrica.sk/wp-content/uploads/2026/07/Utvorenie-vol.-okrskov.pdf
//                      — 5 okrsky, numbered street lists under "Ulice patriace do volebného
//                      okrsku č. N". Signed 08.07.2026.
//
// Catch-all entries that name no street ("lokalita Vajnorské jazerá" is a locality, not an
// address range) are kept only where they correspond to a real Register-adries street name.
import { writeFileSync } from "node:fs";
import { audit, type Row } from "./keCommon.ts";
import { buildKvRow } from "./kvCommon.ts";

type Mc = {
  slug: string;
  mc: string;
  mcNorm: string;
  streets: Record<number, string[]>;
};

const MCS: Mc[] = [
  {
    slug: "vajnory",
    mc: "Bratislava-Vajnory",
    mcNorm: "vajnory",
    streets: {
      1: [
        "Alviano", "Dorastenecká", "Pod krížom", "Pri majeri", "Pri nadjazde", "Pri pasienku",
        "Pri pekárni", "Pri potoku", "Pri rybníku", "Pri starom letisku", "Pri šanci",
        "Regrútska", "Rybničná", "Šutráková", "Tibenského", "Tuhovská",
      ],
      2: [
        "Buzalkova", "Pračanská", "Pri mlyne", "Príjazdná", "Šachorová",
        "Šinkovské", "Široká", "Za mlynom", "Zbrody",
      ],
      3: [
        "Čierny chodník", "Kúkoľová", "Nové Šuty", "Šuty",
        "Tomanova", "Uhliská", "Veľké Štepnice",
      ],
      4: [
        "Hospodárska", "Kataríny Brúderovej", "Na jarku", "Ochotnícka",
        "Roľnícka", "Za humnami", "Vajnorské jazerá",
      ],
      5: [
        "Baničova", "Jačmenná", "Koncová", "Koniarkova", "Kratiny", "Na doline", "Nad jazierkom",
        "Nad Válkom", "Nemecká dolina", "Osloboditeľská", "Pod lipami", "Pod Válkom",
        "Pri pastierni", "Pri Struhe", "Skuteckého", "Šaldova", "Za farou", "Zátureckého",
      ],
    },
  },
  {
    slug: "zahorskabystrica",
    mc: "Bratislava-Záhorská Bystrica",
    mcNorm: "zahorskabystrica",
    streets: {
      1: [
        "Antona Floreka", "Bratislavská", "Čsl. tankistov", "Gbelská", "Hodonínska", "Málová",
        "Námestie sv. Petra a Pavla", "Pavla Blaha", "Plk. Prvoniča", "Sv. Pia X.", "Strminová",
        "Štefana Rosívala", "Na Hliníku",
      ],
      2: [
        "Hargašova", "Kollárova", "Kučovanická", "Leopoldov majer", "Na Holom vrchu",
        "Na Vlkovkách", "Plavecká", "Pútnická", "Sekýľska", "Tatranská", "Tešedíkova",
        "Vrbánska", "Zákutie", "Zárubova",
      ],
      3: [
        "Brumovická", "Čerencová", "Gajarská", "Jána Raka", "Jozefa Vachovského", "Kútska",
        "Lozornianska", "Námestie Rodiny", "Ostriežová", "Plánky", "Rošického",
        "Štefana Majera", "Trstínska", "Záhorská", "Záhumenská",
      ],
      4: [
        "Barancová", "Donská", "Chvojnícka", "Kapsohradská", "Lančárska", "Na Krčoch",
        "Nevská", "Ollareková", "Orešianková", "Prídavková", "Rudavská", "Skalníková",
        "Strmý vŕšok", "Vislianska",
      ],
      5: [
        "Belicová", "Bystrické sady", "Čerešňový sad", "Devínske jazero", "Hruškový sad",
        "Jabloňový sad", "Kunovská", "Ota Holúska", "Podkerepušky", "Pri Vápenickom potoku",
        "Slivkový sad", "Hadincová", "Dobrienková", "Hrabovinská", "Trebuľková",
      ],
    },
  },
];

for (const m of MCS) {
  const out: Row[] = [];
  for (const [okrsok, streets] of Object.entries(m.streets)) {
    for (const s of streets) out.push(buildKvRow(m.mc, m.mcNorm, +okrsok, s));
  }
  writeFileSync(`data/kv_ba_${m.slug}_okrsok_streets.json`, JSON.stringify(out));
  console.log(`\n=== ${m.mc} (transcribed from scan) ===`);
  audit(out, Object.keys(m.streets).length);
}
