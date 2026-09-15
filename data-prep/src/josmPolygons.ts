// Load the okrsok polygons out of a JOSM working file into the scratch table `_check_poly`.
//
// Shared by checkFile.ts and addNeighbourSeeds.ts so there is ONE definition of what the file's
// precinct geometry is — including how multi-feature precincts are welded together and how an
// unclosed way is reported rather than silently swallowed.
import { execFileSync } from "node:child_process";

export type Feature = {
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates?: unknown };
};

export const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** `mcnorm#okrsok` — the identity of a precinct, however many features it is drawn as. */
export const polyKey = (p: Record<string, unknown>, mc: string) => `${p.mcnorm ?? mc}#${p.okrsok}`;

/**
 * Creates `_check_poly (mcnorm, okrsok, geom, raw)`, one row per precinct.
 *
 * A CLOSED LineString is accepted as a ring. JOSM decides Polygon vs LineString from the tags, and
 * `kind=okrsok` is not a tag it knows to be area-forming, so a perfectly good closed precinct is
 * routinely written out as a LineString — 872 of them in one Bratislava save.
 *
 * Returns only the precincts whose geometry is not an area and cannot be made one: a LineString
 * that is genuinely not closed. st_makevalid on one yields no polygonal component, so without
 * reporting it the precinct would silently become an EMPTY area and every address in it would look
 * like it was outside all precincts.
 */
export const loadPolygons = (fc: { features: Feature[] }, mc: string, db: string) => {
  const parts = new Map<string, string[]>();
  const notArea = new Map<string, Set<string>>();
  // One row per FEATURE as well as one per precinct: a precinct drawn as several ways must be able
  // to say WHICH way is broken, or every part of it gets tagged for one part's fault.
  const partRows: string[] = [];
  for (const [i, f] of fc.features.entries()) {
    if (f.properties?.kind !== "okrsok") continue;
    const k = polyKey(f.properties, mc);
    const g = f.geometry;
    const t = g?.type ?? "missing";
    let geom = g;
    if (t === "LineString") {
      const c = (g?.coordinates ?? []) as number[][];
      const closed =
        c.length >= 4 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];
      if (!closed) {
        (notArea.get(k) ?? notArea.set(k, new Set()).get(k)!).add("unclosed-linestring");
        continue;
      }
      geom = { type: "Polygon", coordinates: [c] };
    } else if (t !== "Polygon" && t !== "MultiPolygon") {
      (notArea.get(k) ?? notArea.set(k, new Set()).get(k)!).add(t);
      continue;
    }
    (parts.get(k) ?? parts.set(k, []).get(k)!).push(JSON.stringify(geom));
    const [mcn, okr] = k.split("#");
    partRows.push(
      `(${i}, ${lit(mcn)}, ${okr}, st_transform(st_setsrid(st_geomfromgeojson(${lit(JSON.stringify(geom))}),4326),5514))`,
    );
  }
  if (parts.size === 0) throw new Error("no okrsok polygons in the file — nothing to check");

  const values = [...parts]
    .map(([k, gs]) => {
      const [mcn, okrsok] = k.split("#");
      const ps = gs
        .map((g) => `st_transform(st_setsrid(st_geomfromgeojson(${lit(g)}),4326),5514)`)
        .join(",");
      // TWO geometries per precinct, and the difference matters.
      //
      // `raw` is st_collect — the parts exactly as drawn. Faults are judged on it, because
      // collecting is what exposes them: parts that overlap or share an edge make the collection
      // invalid even though each way is fine on its own.
      //
      // `geom` is what containment is tested against, and it is st_UNION, not st_collect. Union
      // dissolves overlapping parts into one valid area; collect keeps them as separate
      // components, and a MultiPolygon whose components overlap is invalid — whereupon every
      // `st_isvalid(...) and st_contains(...)` test skips the precinct and reports EVERY address
      // in it as outside all precincts. That turned 5 broken precincts into 803 phantom orphans
      // and buried the real finding.
      //
      // st_makevalid still guards the self-intersecting case (it turns a crossed ring into
      // polygons plus dangling lines, so extract the polygonal components to keep the column type).
      const raw = gs.length > 1 ? `st_collect(array[${ps}])` : ps;
      return `(${lit(mcn)}, ${okrsok}, ${raw})`;
    })
    .join(",\n");

  execFileSync("psql", [db, "-v", "ON_ERROR_STOP=1", "-q"], {
    input: `drop table if exists _check_poly;
            create table _check_poly (mcnorm text, okrsok int, raw geometry, geom geometry(MultiPolygon,5514));
            insert into _check_poly (mcnorm, okrsok, raw) values ${values};
            -- Order matters. st_makevalid FIRST, because st_unaryunion throws a
            -- TopologyException on a self-intersecting ring; then st_unaryunion, which dissolves
            -- overlapping parts into one area (st_makevalid alone leaves them as separate
            -- components, and a MultiPolygon whose components overlap is invalid). Done in place
            -- so the geometry text appears once in the statement, not twice.
            update _check_poly
               set geom = st_multi(st_collectionextract(
                            st_unaryunion(st_collectionextract(st_makevalid(raw), 3)), 3));
            create index on _check_poly using gist(geom);
            drop table if exists _check_part;
            create table _check_part (idx int, mcnorm text, okrsok int, g geometry);
            insert into _check_part values ${partRows.join(",\n")};
            create index on _check_part using gist(g);`,
    stdio: ["pipe", "pipe", "ignore"],
  });
  return { notArea };
};
