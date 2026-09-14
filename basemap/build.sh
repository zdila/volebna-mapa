#!/usr/bin/env bash
# Extract the two basemap tilesets from the Protomaps planet.
# See README.md for the why. Requires go-pmtiles (`pmtiles`) on PATH.
#
#   ./build.sh [PLANET_URL]
#
# Kept as TWO separate files on purpose — do NOT merge them (a merged file would
# declare one global maxzoom and blank out over missing high-zoom tiles abroad).
set -euo pipefail

# Protomaps daily planet build. Pick a recent date from https://build.protomaps.com/
PLANET="${1:-https://build.protomaps.com/20260714.pmtiles}"

ZSPLIT=6                       # world overview maxzoom (overzooms above → never blank)
ZMAX=14                        # Slovakia detail maxzoom (13 to ~halve size)
BBOX=16.4,47.4,23.0,50.0       # SK bbox + ~0.4deg padding (WSEN, EPSG:4326)

cd "$(dirname "$0")"
mkdir -p build

echo "==> world  z0..$ZSPLIT  (whole world)"
pmtiles extract "$PLANET" build/world.pmtiles --maxzoom="$ZSPLIT"
# `|| true`: pmtiles show gets SIGPIPE (141) when head closes early; don't let
# `set -o pipefail` abort the script over it.
pmtiles show build/world.pmtiles 2>&1 | head -20 || true

echo "==> slovakia  z0..$ZMAX  bbox=$BBOX"
pmtiles extract "$PLANET" build/slovakia.pmtiles --bbox="$BBOX" --maxzoom="$ZMAX"
pmtiles show build/slovakia.pmtiles 2>&1 | head -20 || true

echo "==> done: build/world.pmtiles + build/slovakia.pmtiles"
