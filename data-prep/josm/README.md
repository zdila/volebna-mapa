# JOSM editing kit

Two pieces for hand-finishing okrsok polygons exported by `node src/exportOkrskyJosm.ts <mc>`.

## 1. Map paint style — `volebne-okrsky.mapcss`

Install: **Preferences (F12) → Map Paint Styles → + →** this file. Turn the other active styles
**off**, or their defaults paint over it.

Colours a precinct and the address points assigned to it with the **same** hue, using the same
golden-angle formula as the web map (`okrsok × 137.508°`) — so a precinct looks the same here as
in the app, and, more usefully, **a point whose colour differs from the area it sits in is exactly
what needs attention**: either the address matched the wrong okrsok or the border is wrong.

Options (right-click the style in that list, or the gear icon):

| option | default | |
|---|---|---|
| Colour by mestská časť (instead of by okrsok) | off | flat colour per MČ — the readable mode for a full Košice export, whose okrsok numbers restart in every MČ |
| Fill okrsok areas | on | semi-transparent (0.22) so imagery stays readable |
| Show address points | on | |
| Show ONLY unmatched address points | off | |
| Label okrsok numbers | on | |
| Label address points (street + number) | off | |

Unmatched points are drawn as loud triangles, coloured by failure reason — red `no-street`,
orange `no-number`, purple `ambiguous` — because the fix differs for each. They are usually the
fastest way to spot a wrong border.

Verified by rendering headlessly against real data:
`josm render -i <file>.osm -s volebne-okrsky.mapcss --setting color_by_mc:true -o out.png`.

## 2. Plugin — `plugin/` → "Delete vertex" map mode (`K`)

```bash
cd plugin && ./build.sh      # compile + test + install to ~/.josm/plugins/
```
Then restart JOSM and tick **okrskyedit** in Preferences → Plugins.

Click-to-delete for border vertices, with the safety rule that makes it usable on a tiling:

> A node is deleted only if — pooled across **every** way it belongs to — it has exactly **two
> distinct neighbour nodes**.

On a welded tiling an interior border vertex belongs to two ways (one per neighbouring precinct)
and both run through the same two neighbours, so the pooled count is still 2 → deleted, from all
its parent ways at once, so the precincts stay welded and no gap opens. At a **triple point** the
three ways contribute three different neighbours → count is 3 → refused, so the Y survives.

Tagged nodes and nodes with no parent way are never touched, which keeps the exported address
points safe: clicking one does nothing.

Feedback: the vertex under the cursor is circled **green** if it will go, **red with a slash** if
it is a junction. One undo step per click.

`build.sh` runs a headless topology test before packaging (shared border, Y junction, closed ring
start/end node, tagged address point). It reads `Plugin-Mainversion` off the installed josm.jar,
so it keeps working across JOSM upgrades. Override with `JOSM_JAR=/path/to/josm.jar`.

## 3. Seeing what a re-label changed — `src/exportSeedDiff.ts`

If the parsers improve while you are mid-edit, you want to know which points moved without
re-exporting over your work. Snapshot BEFORE re-labelling:

```bash
psql volebna -c "drop table if exists before_seeds_kosice;
                 create table before_seeds_kosice as select ra_id, mcnorm, okrsok from seeds_kosice;"
psql volebna -c "drop table if exists before_unmatched_kosice;
                 create table before_unmatched_kosice as select * from unmatched_kosice;"
# ... re-run the parsers and labelKosice ...
node src/exportSeedDiff.ts kosice     # -> edit/kosice_seed_diff.geojson
```

Open it as a SECOND JOSM layer next to the file you are editing — it touches nothing in yours.

| tag | meaning | outline |
|---|---|---|
| `change=new` | was unmatched, now seeds an okrsok — a border near a cluster of these was drawn blind | green |
| `change=moved` | matched before, now a DIFFERENT okrsok — influence moved between two precincts | magenta |

The fill stays the okrsok colour, so they read against the precinct they now belong to.

**Always check `change=moved` is 0 unless you expected it.** A non-zero count after a parser
change usually means a *regression*, not an improvement — see the DP warning below.

## ⚠️ The centroid DP is sensitive to cell removal

`kvTable.ts` recovers the vertically-centred okrsok cell with a contiguous DP over cell
centroids. **Removing cells is never neutral**: it shifts every later cell relative to the anchors
and the DP re-slices the blocks, silently moving whole streets one okrsok along. Adding a
"skip lines starting with a digit" rule to Košice-Staré Mesto moved Alžbetina 7→6 and Hlavná 7→3;
even dropping the trailing "Volebné obvody" summary moved Thurzova 5→4. Junk cells are harmless —
they parse to a street name nothing can match — whereas a shifted block is a silent wrong answer.
So do not extend those `skip` lists, and if you must, verify with `exportSeedDiff` that
`change=moved` stays 0.

### Why this is not built in

JOSM's own **Improve Way Accuracy** (`W`) has `Alt`+click delete, but on ways that share a node it
detaches the node from one way rather than dissolving the vertex, which tears a shared border.
**Delete Mode** (`Ctrl`+`Delete`) deletes ways as readily as nodes. Neither knows about junctions.
