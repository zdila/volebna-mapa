// Build okrsok_streets.json for FOUR small Košice mestské časti from their 2026 okrsok docs.
// All four are 2-okrsok MČ whose announcements list street NAMES per okrsok (no cross-okrsok
// splits), so every street → WHOLE (parseStreetSpec on the bare name). srcSpadove keeps the raw
// doc string (incl. any house ranges, e.g. Luník IX "Hrebendova 2A, 1-3, 10-12"). The generic
// split-street guard is kept for safety: a street appearing in >1 okrsok would keep a per-okrsok
// spec — none of these four have that.
//
// Sources (see report):
//   Košická Nová Ves — kosickanovaves.sk "Oznámenie o utvorení volebných okrskov" (2026,
//     municipal-elections doc 145/2026; referendum-specific doc was only in a JS-only archive —
//     okrsky identical for a 2-okrsok MČ). uradne.sk/user/tablenews/file/1583578.
//   Luník IX — mclunik9.sk "Určenie volebných okrskov ... pre konanie referenda 04.07.2026"
//     (scanned; transcribed). files/.../2026-05-18-115821-Urcenie_volebnych_okrskov...pdf
//   Myslava — myslava.eu referendum-2026-volebne-okrsky page, "Volebne-okrsky.pdf" (id 2435415).
//   Ťahanovce (village, MČ Košice-Ťahanovce, kód obce 598127) — NO 2026 referendum street-list
//     doc published; used the most recent okrsok doc (2024 prezident "OZNAMENIE-okrsky.pdf",
//     id 1988376), whose 2-okrsok split matches the 2026 referendum's 2 okrsky (confirmed by the
//     2026 zápisnice).
import { writeFileSync } from "node:fs";
import { norm, streetKey } from "./normalize.ts";
import { parseStreetSpec } from "./houseSpec.ts";

type Entry = { okrsok: number; street: string; raw?: string };
type Mc = { mc: string; mcNorm: string; slug: string; entries: Entry[] };

const bare = (okrsok: number, ...streets: string[]): Entry[] =>
  streets.map((street) => ({ okrsok, street }));

const MCS: Mc[] = [
  {
    mc: "Košice-Košická Nová Ves",
    mcNorm: "kosicka nova ves",
    slug: "kosicka_nova_ves",
    entries: [
      ...bare(1, "Agátová", "Brestová", "Buková", "Mliečna", "Na Doline", "Poľná", "Sv. Ladislava", "Vínová"),
      ...bare(2, "Čerešňová", "Furčianska", "Herlianska", "Jaseňová", "Ortvaňová", "Trnková", "Vyšná Úvrať", "Ulica Zelená stráň", "Ulica Ku Gederu"),
    ],
  },
  {
    mc: "Košice-Luník IX",
    mcNorm: "lunik ix",
    slug: "lunik_ix",
    entries: [
      { okrsok: 1, street: "Hrebendova", raw: "Hrebendova 2A, 1-3, 10-12" },
      { okrsok: 2, street: "Krčméryho", raw: "Krčméryho 1-15" },
      { okrsok: 2, street: "Podjavorinskej", raw: "Podjavorinskej 3-13" },
    ],
  },
  {
    mc: "Košice-Myslava",
    mcNorm: "myslava",
    slug: "myslava",
    entries: [
      { okrsok: 1, street: "Myslava", raw: "Myslava (Girbeš, Kamenný potok, Maša)" },
      ...bare(1, "Ku Bangortu", "Na Kope", "Na Kope I", "Na Kope II", "Na Kope III", "Na Kope IV",
        "Na Kope V", "Na Kope VI", "Na Kope VII", "Na Kope VIII", "Na Kope IX", "Na Kope X",
        "Povrazová", "Ulica na Grunte", "Vrchná", "Chmeľníky", "Ku hájovni", "Pod Gruntom",
        "Pod horou", "Ulica nad Bangortami"),
      ...bare(2, "Ku potoku", "Myslavská", "Nižné Chmeľníky", "Pod Hrabinou", "Za Dolným mlynom", "Za priekopou"),
    ],
  },
  {
    mc: "Košice-Ťahanovce",
    mcNorm: "tahanovce",
    slug: "tahanovce",
    entries: [
      ...bare(1, "Brusnicová", "Jazvečia", "Na hájiku", "Ťahanovská"),
      ...bare(2, "Madridská", "Magnezitárska", "Na sihoti", "Pri Hrušove", "Repná", "Želiarska"),
    ],
  },
];

for (const m of MCS) {
  // okrsok set per street key (to apply the split-street rule)
  const okrOfKey = new Map<string, Set<number>>();
  for (const e of m.entries) {
    const k = streetKey(norm(e.street));
    (okrOfKey.get(k) ?? okrOfKey.set(k, new Set()).get(k)!).add(e.okrsok);
  }

  const rows = m.entries.map((e) => {
    const split = (okrOfKey.get(streetKey(norm(e.street)))?.size ?? 1) > 1;
    // No split streets here; if there were, feed the raw (name + numbers) so parseStreetSpec
    // yields a per-okrsok RANGE/ENUM. Single-okrsok → parse the bare name → WHOLE.
    const input = split ? (e.raw ?? e.street) : e.street;
    const parsed = parseStreetSpec(input);
    return {
      mc: m.mc,
      mcNorm: m.mcNorm,
      okrsok: e.okrsok,
      obvod: 0,
      street: parsed.street || e.street,
      streetNorm: parsed.streetNorm || norm(e.street),
      parity: parsed.parity,
      cls: parsed.cls,
      numberKind: parsed.numberKind,
      spec: parsed.spec,
      srcSpadove: e.raw ?? e.street,
    };
  });

  writeFileSync(`data/ke_${m.slug}_okrsok_streets.json`, JSON.stringify(rows));

  const okrs = [...new Set(rows.map((r) => r.okrsok))].sort((a, b) => a - b);
  const byCls = Object.groupBy(rows, (r) => r.cls);
  console.log(
    `${m.slug}: rows=${rows.length} okrsky=${okrs.length} [${okrs.join(",")}] ` +
      `cls: ${Object.entries(byCls).map(([k, v]) => `${k}=${v!.length}`).join(" ")}`,
  );
}
