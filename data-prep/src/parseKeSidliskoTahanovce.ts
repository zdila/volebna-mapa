// Košice-Sídlisko Ťahanovce — 2026 referendum street→okrsok assignment.
// Source: tahanovce.sk "Utvorenie volebných okrskov a určenie volebných miestností" (č. j.
// 525/2026/OPS/928, REFERENDUM 4. JÚLA 2026, Rozhodnutie prezidenta č. 60/2026 Z. z.), the
// standard KE per-MČ "VOLEBNÉ OKRSKY" table PDF. 18 okrsky. Parsed via keOkrskyTable.
// PDF: scratch_ke/tahanovce.pdf (downloaded from the URL below).
import { buildKeOkrskyTable } from "./keOkrskyTable.ts";

buildKeOkrskyTable({
  pdf: "data/ke_sidlisko_tahanovce_okrsky.pdf",
  mc: "Košice-Sídlisko Ťahanovce",
  mcNorm: "sidlisko tahanovce",
  slug: "sidlisko_tahanovce",
  expectedOkrsky: 18,
  srcUrl: "https://tahanovce.sk/wp-content/uploads/dokumenty/volby/utvorenie-volebnych-okrskov-d353z5.pdf",
});
