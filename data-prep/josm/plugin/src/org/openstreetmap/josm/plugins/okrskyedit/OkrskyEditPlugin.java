// License: GPL. For details, see LICENSE file.
package org.openstreetmap.josm.plugins.okrskyedit;

import org.openstreetmap.josm.gui.IconToggleButton;
import org.openstreetmap.josm.gui.MapFrame;
import org.openstreetmap.josm.plugins.Plugin;
import org.openstreetmap.josm.plugins.PluginInformation;

/**
 * Adds the "Delete vertex" map mode — click-to-delete for border vertices that cannot change the
 * topology of a polygon tiling. See {@link DeleteVertexMode}.
 */
public class OkrskyEditPlugin extends Plugin {

    public OkrskyEditPlugin(PluginInformation info) {
        super(info);
    }

    @Override
    public void mapFrameInitialized(MapFrame oldFrame, MapFrame newFrame) {
        if (newFrame != null) {
            newFrame.addMapMode(new IconToggleButton(new DeleteVertexMode()));
        }
    }
}
