# Glass shards

Shop-pane breaks and the fenestra vessel shatter were `BoxGeometry` chunks. They are thin glass facets now (`noctuary/glass-shards.js`).

Second pass, so the pile reads as broken glass from the quay rather than as acrylic prisms:

- Outlines are jagged convex splinters and flakes (long edge, needle tip). The hull stays sharp. There is no bevel.
- Thickness is about 1.4–2.2% of the span (about 0.0024–0.005). The cannon body is that same outer prism, not a thicker stand-in.
- The face is clear in the middle (low alpha, almost no emissive, no clearcoat). A narrow cool rim along the real boundary carries the highlight. Side faces are the glass edge, flat-shaded.
- Mass and quay friction are unchanged. `invInertia` stays capped. A facet that steps through the quay slab is sat back on the deck. Basin shards are not pulled back. Buoyancy stays off.

How many pieces:

Scene units are not feet. The shop door opening is 0.60 scene units (sill at y = 0.10, head at y = 0.70), and a shop door is 7 feet, so **1 scene unit = 7 / 0.60 ≈ 11.67 feet**. The ground storey (the 0.76 window cell) is then about 8.9 ft. The tallest quay crate (0.24) is about 2.8 ft, under half that door. An earlier 7 ft/unit made the same door about 4.2 ft and the storey about 5.3 ft, which is too small next to those props. The walk eye (0.58) sits near the lintel, so it is not the anchor.

```
width_ft = width_scene × (7 / 0.60)
height_ft = height_scene × (7 / 0.60)
area_sqft = width_ft × height_ft
count = round(0.5 × area_sqft)
```

One shard for every two square feet. A miss is 0 and spawns nothing. There is no clamp.

- Shop front: one ground-floor cell. Glazed width drops the shop mullions (0.04 of the cell on each edge that is present). Pane height runs from the sill clearance at y = 0.12 to the top mullion, 0.606 scene units. A full cell is 0.699 × 0.606 scene units ≈ 8.2 ft × 7.1 ft. Area in the scene is 0.424; square footage is 57.7 → 29 shards.
- Fenestra vessel: the largest face of the glass block, read off the mesh, 0.28 × 0.38 scene units ≈ 3.3 ft × 4.4 ft. Area in the scene is 0.106; square footage is 14.5 → 7 shards. The mullion cross is a bar on the glass, not extra area, and the other faces of the box are not unfolded.

Prop-wear atlases and the street-ground sheet are untouched.
