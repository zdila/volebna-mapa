// Košice-Nad jazerom — 2026 referendum street→okrsok assignment (~20 okrsky).
//
// ⚠️ SOURCE UNAVAILABLE (2026-07-16): the okrsky PDF existed at the MČ landing page
// https://www.jazerokosice.sk/referendum-2026.html (doc "Volebné okrsky a volebné miestnosti",
// ~131 kB, 20 okrsky) but the MČ REMOVED the referendum article content after the 4.7.2026
// referendum — the live page now renders with zero okrsok content (confirmed raw + JS-rendered).
// The doc is also mirrored on the central board CUET (cuet.slovensko.sk/sk/priloha/zobraz/
// 1432e120-af36-4821-9913-8f14437449db, "Referendum 2026") but CUET attachments are expired
// (the display period ended) and no longer downloadable. The Wayback Machine has no capture.
//
// This MČ uses the SAME "REFERENDUM 4.7.2026 / VOLEBNÉ OKRSKY" 3-column table template as
// Sídlisko Ťahanovce, so once the PDF is obtained (re-request from the MČ office, or a live
// CUET session), drop it at the path below and run `node src/parseKeNadJazerom.ts` — the shared
// keOkrskyTable parser handles it with no changes. Nothing is fabricated: no output JSON is
// written until the real PDF is present.
import { existsSync } from "node:fs";
import { buildKeOkrskyTable } from "./keOkrskyTable.ts";

const PDF = "data/ke_nad_jazerom_okrsky.pdf";

if (!existsSync(PDF)) {
  console.error(
    `SOURCE PDF MISSING: ${PDF}\n` +
      "The 2026 Nad-jazerom okrsky doc was removed from jazerokosice.sk post-referendum and the\n" +
      "CUET mirror is expired. Obtain the PDF (MČ office / live CUET session) and place it at the\n" +
      "path above, then re-run. No JSON generated (not fabricating).",
  );
  process.exit(2);
}

buildKeOkrskyTable({
  pdf: PDF,
  mc: "Košice-Nad jazerom",
  mcNorm: "nad jazerom",
  slug: "nad_jazerom",
  expectedOkrsky: 20,
  srcUrl: "https://www.jazerokosice.sk/referendum-2026.html (okrsky PDF; removed post-referendum)",
});
