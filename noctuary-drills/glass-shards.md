# Glass shards

Shop-pane breaks and the fenestra vessel shatter were `BoxGeometry` chunks. They are thin glass facets now (`noctuary/glass-shards.js`).

Second pass, so the pile reads as broken glass from the quay rather than as acrylic prisms:

- Outlines are jagged convex splinters and flakes (long edge, needle tip). The hull stays sharp. There is no bevel.
- Thickness is about 1.4–2.2% of the span (about 0.0024–0.005). The cannon body is that same outer prism, not a thicker stand-in.
- The face is clear in the middle (low alpha, almost no emissive, no clearcoat). A narrow cool rim along the real boundary carries the highlight. Side faces are the glass edge, flat-shaded.
- Mass and quay friction are unchanged. `invInertia` stays capped. A facet that steps through the quay slab is sat back on the deck. Basin shards are not pulled back. Buoyancy stays off.

How many pieces:

The harbor is a diorama. A storey is under one scene unit, so scene units are not metres and not feet. Glass uses **1 scene unit ≈ 7 feet**.

```
width_ft = width_scene × 7
height_ft = height_scene × 7
area_sqft = width_ft × height_ft
count = round(0.5 × area_sqft)
```

That is one shard for every two square feet. A miss (no pane) is 0 and spawns nothing. There is no clamp: a full shop cell is about 10 shards and the vessel face is 3, which is already a small pile.

- Shop front: one ground-floor cell (0.76 scene units). Glazed width drops the shop mullions (0.04 of the cell on each edge that is present). Pane height is the cell above the sill at y = 0.12 and under the top mullion, about 0.606. A full cell is 0.699 × 0.606 scene units ≈ 4.9 ft × 4.2 ft ≈ 20.8 sq ft → 10 shards. A short side clips that cell to about 0.336 scene units ≈ 16.5 sq ft → 8 shards.
- Fenestra vessel: the largest face of the glass block, 0.28 × 0.38 scene units ≈ 2.0 ft × 2.7 ft ≈ 5.2 sq ft → 3 shards. Half of 5 squares rounds the same as half of 6. The mullion cross is not glass, and the other faces of the box are not unfolded into extra area.

Prop-wear atlases and the street-ground sheet are untouched.
