import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

const TILES_SRC = resolve(__dirname, "../basemap/build");
// Overlays are small and always shipped. The basemap PMTiles (world/slovakia)
// are huge and only needed for a SELF-HOSTED build — a hosted build (with a
// VITE_PROTOMAPS_KEY) uses api.protomaps.com instead, so they're skipped, which
// keeps dist under GitHub Pages' 100 MB-per-file cap.
const OVERLAY_TILES = ["okrsky.pmtiles", "seeds.pmtiles", "flourish_okrsky.pmtiles"];
const BASEMAP_TILES = ["world.pmtiles", "slovakia.pmtiles"];

// public/tiles is a symlink to ../../basemap/build (663 MB). Vite would copy the
// WHOLE dir into dist on build, re-breaking the Pages size cap, so we disable
// the public-dir copy (build.copyPublicDir:false, below) and stage only the
// tiles we actually want here. Dev still serves the symlink (with range
// requests) via server.fs.allow — copyPublicDir only affects the build.
function stageTiles(hosted: boolean): Plugin {
  return {
    name: "stage-tiles",
    apply: "build",
    closeBundle() {
      const outDir = resolve(__dirname, "dist/tiles");
      mkdirSync(outDir, { recursive: true });
      const wanted = hosted ? OVERLAY_TILES : [...OVERLAY_TILES, ...BASEMAP_TILES];
      for (const f of wanted) {
        const src = resolve(TILES_SRC, f);
        if (existsSync(src)) {
          copyFileSync(src, resolve(outDir, f));
        } else {
          this.warn(`tile not found, skipped: ${f}`);
        }
      }
      this.info(`staged ${wanted.length} tile(s) into dist/tiles (hosted=${hosted})`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const hosted = !!env.VITE_PROTOMAPS_KEY;
  return {
    // GitHub Pages serves from /<repo>/. Build with `--base=/<repo>/` so asset +
    // tiles URLs (via import.meta.env.BASE_URL) resolve under the subpath.
    build: { copyPublicDir: false },
    server: {
      fs: { allow: [".", "../basemap"] },
    },
    plugins: [stageTiles(hosted)],
  };
});
