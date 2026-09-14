#!/usr/bin/env bash
# Build the okrsky-edit JOSM plugin and install it into ~/.josm/plugins/.
#
#   ./build.sh          compile + jar + install
#   ./build.sh --no-install   compile + jar only (leaves build/okrskyedit.jar)
#
# Needs only a JDK and josm.jar — no ant/gradle, no JOSM plugin SDK checkout.
# After installing: restart JOSM, then Preferences (F12) > Plugins > search "okrsky" > tick it.
set -euo pipefail
cd "$(dirname "$0")"

JOSM_JAR="${JOSM_JAR:-/usr/share/josm/josm.jar}"
[ -f "$JOSM_JAR" ] || { echo "josm.jar not found at $JOSM_JAR (set JOSM_JAR=...)" >&2; exit 1; }

# Plugin-Mainversion must not exceed the running JOSM, or it refuses to load. Read it off the jar
# rather than hardcoding, so this keeps working across JOSM upgrades.
JOSM_VERSION=$(unzip -p "$JOSM_JAR" META-INF/MANIFEST.MF 2>/dev/null \
  | tr -d '\r' | sed -n 's/^Main-Version: *//p' | head -1)
[ -n "$JOSM_VERSION" ] && JOSM_VERSION=${JOSM_VERSION//[!0-9]/}
[ -n "$JOSM_VERSION" ] || JOSM_VERSION=18000

rm -rf build && mkdir -p build/classes
echo "compiling against $JOSM_JAR (JOSM $JOSM_VERSION)"
javac -nowarn -encoding UTF-8 -cp "$JOSM_JAR" -d build/classes \
      $(find src -name '*.java')

# The degree-2 rule is the whole point of the plugin, so verify it on synthetic topologies
# (shared border, Y junction, closed ring, tagged address point) before packaging.
if [ -d test ]; then
  javac -nowarn -encoding UTF-8 -cp "$JOSM_JAR:build/classes" -d build/test \
        $(find test -name "*.java")
  java -cp "$JOSM_JAR:build/classes:build/test" \
       org.openstreetmap.josm.plugins.okrskyedit.DeleteVertexModeTest || {
    echo "topology tests FAILED — not packaging" >&2; exit 1; }
fi

cat > build/manifest.txt <<EOF
Manifest-Version: 1.0
Plugin-Class: org.openstreetmap.josm.plugins.okrskyedit.OkrskyEditPlugin
Plugin-Description: Delete vertex map mode: click-to-delete border vertices, skipping junctions
Plugin-Version: 1.0
Plugin-Mainversion: $JOSM_VERSION
Plugin-Early: false
Plugin-Canloadatruntime: true
Author: volebna-mapa
EOF

jar cfm build/okrskyedit.jar build/manifest.txt -C build/classes . -C resources .
echo "built build/okrskyedit.jar"

if [ "${1:-}" != "--no-install" ]; then
  mkdir -p ~/.josm/plugins
  cp build/okrskyedit.jar ~/.josm/plugins/okrskyedit.jar
  echo "installed to ~/.josm/plugins/okrskyedit.jar"
  echo "restart JOSM, then Preferences (F12) > Plugins > tick 'okrskyedit'"
fi
