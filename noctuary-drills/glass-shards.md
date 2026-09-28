# Glass shards

Shop-pane breaks and the fenestra vessel shatter were `BoxGeometry` chunks. They are thin glass facets now (`noctuary/glass-shards.js`).

Second pass, so the pile reads as broken glass from the quay rather than as acrylic prisms:

- Outlines are jagged convex splinters and flakes (long edge, needle tip). The hull stays sharp. There is no bevel.
- Thickness is about 1.4–2.2% of the span (about 0.0024–0.005). The cannon body is that same outer prism, not a thicker stand-in.
- The face is clear in the middle (low alpha, almost no emissive, no clearcoat). A narrow cool rim along the real boundary carries the highlight. Side faces are the glass edge, flat-shaded.
- Mass and quay friction are unchanged. `invInertia` stays capped. A facet that steps through the quay slab is sat back on the deck. Basin shards are not pulled back. Buoyancy stays off.

How many pieces:

Scene units are not feet. The ground-floor window cell is 0.76 scene units, and that cell is the shop storey. A retail floor is 12 feet, so **1 scene unit = 12 / 0.76 ≈ 15.79 feet**. The door opening (0.60) is then about 9.5 ft, and the tallest quay crate (0.24) is about 3.8 ft, under half the storey. The walk eye (0.58) sits near the lintel, so it is not the anchor.

Earlier scales understated that floor, so the same pane was too little glass:

| Scale | Why it was set | Full shop cell | Vessel face |
|---|---|---|---|
| 7 ft/unit | a guess | 20.8 sq ft → 10 | 5.2 sq ft → 3 |
| 7/0.60 ≈ 11.67 | door locked at 7 ft, storey only 8.9 ft | 57.7 sq ft → 29 | 14.5 sq ft → 7 |
| 12/0.76 ≈ 15.79 | shop storey is 12 ft | 105.6 sq ft → 53 | 26.5 sq ft → 13 |

```
width_ft = width_scene × (12 / 0.76)
height_ft = height_scene × (12 / 0.76)
area_sqft = width_ft × height_ft
count = round(0.5 × area_sqft)
```

One shard for every two square feet. A miss is 0 and spawns nothing. There is no clamp. Pieces are a bit smaller than the last pass and drop close to the opening, so the higher count sits as a pile instead of a wide sprinkle of large plates.

- Shop front: one ground-floor cell. Glazed width drops the shop mullions (0.04 of the cell on each edge that is present). Pane height runs from the sill clearance at y = 0.12 to the top mullion, 0.606 scene units. A full cell is 0.699 × 0.606 scene units ≈ 11.0 ft × 9.6 ft. Area in the scene is 0.424; square footage is 105.6 → 53 shards.
- Fenestra vessel: the largest face of the glass block, read off the mesh, 0.28 × 0.38 scene units ≈ 4.4 ft × 6.0 ft. Area in the scene is 0.106; square footage is 26.5 → 13 shards. The mullion cross is a bar on the glass, not extra area, and the other faces of the box are not unfolded.

Prop-wear atlases and the street-ground sheet are untouched.
