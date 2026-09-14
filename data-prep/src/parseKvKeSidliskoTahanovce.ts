// Košice-Sídlisko Ťahanovce — KOMUNÁLNE VOĽBY 24.10.2026 street→okrsok assignment.
// Source: tahanovce.sk "Utvorenie volebných okrskov a určenie volebných miestností" (24.10.2026,
// decree 145/2026 Z. z.), the standard KE per-MČ "VOLEBNÉ OKRSKY" table PDF — same
// "Okrsok | Názov ulice | Orientačné číslo" layout as its referendum predecessor, so it reuses
// keOkrskyTable unchanged. 18 okrsky, all polling in ZŠ Belehradská 21.
import { buildKeOkrskyTable } from "./keOkrskyTable.ts";

buildKeOkrskyTable({
  pdf: "data/kv_sidlisko_tahanovce.pdf",
  mc: "Košice-Sídlisko Ťahanovce",
  mcNorm: "sidlisko tahanovce",
  slug: "sidlisko_tahanovce",
  expectedOkrsky: 18,
  outPrefix: "kv_ke_",
  srcUrl: "https://tahanovce.sk/wp-content/uploads/2026/06/Utvorenie-volebnych-okrskov-a-urcenie-volebnych-miestnosti.pdf",
});
