// Theme / Protomaps flavor.
//
// light = WHITE flavor, dark = BLACK flavor, auto = follow the OS. The flavor is
// baked into the initial style (so a dark reload paints dark immediately) and
// swapped live on change by re-applying each basemap layer's paint/layout.

import { BLACK, type Flavor, WHITE } from "@protomaps/basemaps";

export type Theme = "light" | "dark" | "auto";
export type FlavorKey = "light" | "dark";

export const FLAVORS: Record<FlavorKey, { flavor: Flavor; name: string }> = {
  light: { flavor: WHITE, name: "white" },
  dark: { flavor: BLACK, name: "black" },
};

export const systemDark = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

export const resolveFlavorKey = (t: Theme): FlavorKey =>
  t === "auto" ? (systemDark() ? "dark" : "light") : t;

// Overlay colours (okrsky/flourish lines + labels + selection highlight) tuned
// per theme. In dark mode the outlines go white, so the selection uses amber to
// still stand out against them.
export const overlay = (dark: boolean) => ({
  line: dark ? "#ffffff" : "#37474f",
  labelText: dark ? "#eceff1" : "#1a1a1a",
  labelHalo: dark ? "#000000" : "#ffffff",
  highlight: dark ? "#ffd479" : "#111827",
});
