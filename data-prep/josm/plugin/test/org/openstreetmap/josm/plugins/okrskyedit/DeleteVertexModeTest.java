package org.openstreetmap.josm.plugins.okrskyedit;

import org.openstreetmap.josm.data.coor.LatLon;
import org.openstreetmap.josm.data.osm.DataSet;
import org.openstreetmap.josm.data.osm.Node;
import org.openstreetmap.josm.data.osm.Way;
import org.openstreetmap.josm.spi.preferences.Config;
import org.openstreetmap.josm.spi.preferences.MemoryPreferences;
import java.util.Arrays;

/** Headless check of the degree-2 rule against the topologies it must handle. */
public final class DeleteVertexModeTest {
    static int failures;

    static void check(String what, boolean actual, boolean expected) {
        boolean ok = actual == expected;
        if (!ok) failures++;
        System.out.printf("  [%s] %-58s expected=%s actual=%s%n", ok ? "PASS" : "FAIL", what, expected, actual);
    }

    static Node n(DataSet ds, double lat, double lon) {
        Node node = new Node(new LatLon(lat, lon));
        ds.addPrimitive(node);
        return node;
    }

    static Way way(DataSet ds, Node... nodes) {
        Way w = new Way();
        ds.addPrimitive(w);
        w.setNodes(Arrays.asList(nodes));
        return w;
    }

    public static void main(String[] args) {
        // OsmPrimitive reads preferences during class init; a memory-backed instance is enough.
        Config.setPreferencesInstance(new MemoryPreferences());
        DataSet ds = new DataSet();

        // 1. Interior vertex of a border SHARED by two precincts: both ways run through the same
        //    two neighbours, so the pooled neighbour set is still {a, b} -> deletable.
        Node a = n(ds, 48.10, 17.10), v = n(ds, 48.11, 17.11), b = n(ds, 48.12, 17.12);
        way(ds, a, v, b);
        way(ds, a, v, b);
        check("shared border vertex, 2 ways, 2 neighbours", DeleteVertexMode.isDeletable(v), true);
        check("  pooled neighbour count is 2", DeleteVertexMode.neighbours(v).size() == 2, true);

        // 2. Triple point where three precincts meet: three distinct neighbours -> protected.
        Node c = n(ds, 48.20, 17.20), p = n(ds, 48.21, 17.21), q = n(ds, 48.22, 17.22), r = n(ds, 48.23, 17.23);
        way(ds, p, c, q);
        way(ds, q, c, r);
        way(ds, r, c, p);
        check("Y junction, 3 neighbours", DeleteVertexMode.isDeletable(c), false);
        check("  pooled neighbour count is 3", DeleteVertexMode.neighbours(c).size() == 3, true);

        // 3. Vertex of a single unshared way (outer perimeter) -> still fine.
        Node d = n(ds, 48.30, 17.30), e = n(ds, 48.31, 17.31), f = n(ds, 48.32, 17.32);
        way(ds, d, e, f);
        check("plain way vertex", DeleteVertexMode.isDeletable(e), true);

        // 4. End node of an open way: only one neighbour -> refused (nothing to dissolve).
        check("way end node", DeleteVertexMode.isDeletable(d), false);

        // 5. Closed ring: getNeighbours must treat first==last correctly.
        Node r1 = n(ds, 48.40, 17.40), r2 = n(ds, 48.41, 17.41), r3 = n(ds, 48.42, 17.42);
        way(ds, r1, r2, r3, r1);
        check("closed ring, start/end node", DeleteVertexMode.isDeletable(r1), true);
        check("closed ring, middle node", DeleteVertexMode.isDeletable(r2), true);

        // 6. An address point from the export: standalone and tagged -> never touched.
        Node seed = n(ds, 48.50, 17.50);
        seed.put("kind", "seed");
        seed.put("okrsok", "12");
        check("tagged standalone address point", DeleteVertexMode.isDeletable(seed), false);

        // 7. A tagged node that IS part of a way still carries data -> protected.
        Node t1 = n(ds, 48.60, 17.60), t2 = n(ds, 48.61, 17.61), t3 = n(ds, 48.62, 17.62);
        way(ds, t1, t2, t3);
        t2.put("kind", "something");
        check("tagged vertex inside a way", DeleteVertexMode.isDeletable(t2), false);

        System.out.println(failures == 0 ? "\nALL PASS" : "\n" + failures + " FAILURE(S)");
        System.exit(failures == 0 ? 0 : 1);
    }
}
