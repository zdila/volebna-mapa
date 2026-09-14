// License: GPL. For details, see LICENSE file.
package org.openstreetmap.josm.plugins.okrskyedit;

import static org.openstreetmap.josm.tools.I18n.tr;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.Point;
import java.awt.RenderingHints;
import java.awt.event.KeyEvent;
import java.awt.event.MouseEvent;
import java.awt.geom.Ellipse2D;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

import org.openstreetmap.josm.actions.mapmode.MapMode;
import org.openstreetmap.josm.command.DeleteCommand;
import org.openstreetmap.josm.data.Bounds;
import org.openstreetmap.josm.data.UndoRedoHandler;
import org.openstreetmap.josm.data.osm.Node;
import org.openstreetmap.josm.data.osm.OsmPrimitive;
import org.openstreetmap.josm.data.osm.Way;
import org.openstreetmap.josm.gui.MainApplication;
import org.openstreetmap.josm.gui.MapFrame;
import org.openstreetmap.josm.gui.MapView;
import org.openstreetmap.josm.gui.layer.MapViewPaintable;
import org.openstreetmap.josm.gui.layer.OsmDataLayer;
import org.openstreetmap.josm.gui.layer.Layer;
import org.openstreetmap.josm.tools.ImageProvider;
import org.openstreetmap.josm.tools.Shortcut;

/**
 * Click a vertex to delete it — but only where deleting it cannot change the topology.
 *
 * <p>Built for editing a precinct (okrsok) tiling, where polygons share their borders. Two rules
 * follow from that:
 *
 * <ul>
 *   <li><b>Only degree-2 nodes.</b> A node is deleted only if, counting across every way it
 *       belongs to, it has exactly <b>two distinct neighbour nodes</b>. Such a node is an interior
 *       vertex of a border and dissolving it just straightens that border. A node with three or
 *       more neighbours is a junction where three precincts meet — the "Y" — and deleting it would
 *       destroy the shared corner, so it is refused.
 *   <li><b>Never tagged nodes, never lone nodes.</b> That keeps the address points in the export
 *       (standalone, tagged) safe: clicking one does nothing.
 * </ul>
 *
 * <p>The node is removed from <em>all</em> of its parent ways in a single command, so neighbouring
 * precincts stay welded and no gap can open between them. One undo step per click.
 *
 * <p>The vertex under the cursor is circled: green when it will be deleted, red when it is a
 * junction that will not.
 */
public class DeleteVertexMode extends MapMode implements MapViewPaintable {

    private static final Color OK_COLOR = new Color(0x1f, 0xc0, 0x4a);
    private static final Color BLOCKED_COLOR = new Color(0xe0, 0x1b, 0x24);

    /** Vertex currently under the cursor, or null. */
    private transient Node candidate;
    /** Whether {@link #candidate} passes the degree-2 test. */
    private boolean candidateDeletable;

    public DeleteVertexMode() {
        super(tr("Delete vertex"), "deletevertex", tr("Delete a shared border vertex (degree-2 nodes only)"),
                Shortcut.registerShortcut("mapmode:deletevertex", tr("Mode: {0}", tr("Delete vertex")),
                        KeyEvent.VK_K, Shortcut.DIRECT),
                ImageProvider.getCursor("crosshair", "delete_node"));
    }

    @Override
    public void enterMode() {
        super.enterMode();
        MapFrame map = MainApplication.getMap();
        map.mapView.addMouseListener(this);
        map.mapView.addMouseMotionListener(this);
        map.mapView.addTemporaryLayer(this);
    }

    @Override
    public void exitMode() {
        super.exitMode();
        MapFrame map = MainApplication.getMap();
        map.mapView.removeMouseListener(this);
        map.mapView.removeMouseMotionListener(this);
        map.mapView.removeTemporaryLayer(this);
        candidate = null;
        map.mapView.repaint();
    }

    @Override
    public boolean layerIsSupported(Layer l) {
        return l instanceof OsmDataLayer;
    }

    /**
     * Distinct neighbour nodes of {@code n}, pooled over every way it belongs to.
     *
     * <p>Pooling is what makes this correct on a welded tiling. An interior border vertex belongs
     * to two ways — one per neighbouring precinct — and both of them run through the same two
     * neighbours, so the union still has size 2. At a triple point the three ways contribute three
     * different neighbours, so the union has size 3 and the node is protected.
     *
     * <p>{@link Way#getNeighbours} is used rather than index arithmetic because it already handles
     * a closed way, where the first and last node are the same object.
     */
    static Set<Node> neighbours(Node n) {
        Set<Node> result = new HashSet<>();
        for (Way w : n.getParentWays()) {
            if (!w.isDeleted()) {
                result.addAll(w.getNeighbours(n));
            }
        }
        return result;
    }

    static boolean isDeletable(Node n) {
        return n != null
                && !n.isDeleted()
                && n.isSelectable()
                && !n.isTagged()                    // an address point carries data — leave it alone
                && !n.getParentWays().isEmpty()     // ... and so does a lone node
                && neighbours(n).size() == 2;       // interior vertex, not a junction
    }

    private void updateCandidate(Point p) {
        MapView mv = MainApplication.getMap().mapView;
        Node n = mv.getNearestNode(p, OsmPrimitive::isSelectable);
        boolean deletable = isDeletable(n);
        if (n != candidate || deletable != candidateDeletable) {
            candidate = n;
            candidateDeletable = deletable;
            mv.repaint();
        }
    }

    @Override
    public void mouseMoved(MouseEvent e) {
        if (MainApplication.getLayerManager().getEditDataSet() != null) {
            updateCandidate(e.getPoint());
        }
    }

    @Override
    public void mouseDragged(MouseEvent e) {
        mouseMoved(e);
    }

    @Override
    public void mouseReleased(MouseEvent e) {
        if (e.getButton() != MouseEvent.BUTTON1
                || MainApplication.getLayerManager().getEditDataSet() == null) {
            return;
        }
        updateCandidate(e.getPoint());
        if (!candidateDeletable || candidate == null) {
            return;
        }
        // silent=true: no confirmation dialog, this is meant to be clicked repeatedly.
        UndoRedoHandler.getInstance().add(
                DeleteCommand.delete(Collections.singleton(candidate), true, true));
        candidate = null;
        candidateDeletable = false;
        MainApplication.getMap().mapView.repaint();
    }

    @Override
    public void paint(Graphics2D g, MapView mv, Bounds bbox) {
        if (candidate == null || candidate.isDeleted()) {
            return;
        }
        Point p = mv.getPoint(candidate);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setColor(candidateDeletable ? OK_COLOR : BLOCKED_COLOR);
        g.setStroke(new BasicStroke(2.5f));
        double r = 7;
        g.draw(new Ellipse2D.Double(p.x - r, p.y - r, 2 * r, 2 * r));
        if (!candidateDeletable) {
            // a slash through the circle: this one is a junction and will not be removed
            g.drawLine((int) (p.x - r * 0.7), (int) (p.y + r * 0.7),
                       (int) (p.x + r * 0.7), (int) (p.y - r * 0.7));
        }
    }
}
