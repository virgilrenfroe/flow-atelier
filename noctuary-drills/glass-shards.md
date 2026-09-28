# Glass shards

Shop-pane breaks and the fenestra vessel shatter were `BoxGeometry` chunks. They are thin glass facets now (`noctuary/glass-shards.js`).

Second pass, so the pile reads as broken glass from the quay rather than as acrylic prisms:

- Outlines are jagged convex splinters and flakes (long edge, needle tip). The hull stays sharp. There is no bevel.
- Thickness is about 1.4–2.2% of the span (about 0.0024–0.005). The cannon body is that same outer prism, not a thicker stand-in.
- The face is clear in the middle (low alpha, almost no emissive, no clearcoat). A narrow cool rim along the real boundary carries the highlight. Side faces are the glass edge, flat-shaded.
- Mass and quay friction are unchanged. `invInertia` stays capped. A facet that steps through the quay slab is sat back on the deck. Basin shards are not pulled back. Buoyancy stays off.

How many pieces:

```
count = clamp(round(26 × area), 2, 16)
```

`area` is the broken glass in scene units, measured from the pane that actually opens (a miss is 0 and spawns nothing). The density constant is `GLASS_SHARD_DENSITY` in `noctuary/glass-shards.js`.

- Shop front: one ground-floor cell of the façade (0.76 m pitch). Glazed width is the part of that cell on the wall, minus the shop mullions (0.04 of the cell on each edge that is present). Pane height is the cell above the sill at y = 0.12 and under the top mullion, about 0.606. A full cell is 0.699 × 0.606 ≈ 0.424 → 11 shards. A face only 0.72 wide clips the cell to about 0.200 → 5 shards.
- Fenestra vessel: the largest face of the glass block, 0.28 × 0.38 = 0.106 → 3 shards. The mullion cross is not glass, and the other faces of the box are not unfolded into extra area, so the little pane stays smaller than a shop front.

Prop-wear atlases and the street-ground sheet are untouched.
