# Glass shards

Shop-pane breaks and the fenestra vessel shatter were `BoxGeometry` chunks. They are thin glass facets now (`noctuary/glass-shards.js`).

Second pass, so the pile reads as broken glass from the quay rather than as acrylic prisms:

- Outlines are jagged convex splinters and flakes (long edge, needle tip). The hull stays sharp. There is no bevel.
- Thickness is about 1.4–2.2% of the span (about 0.0024–0.005). The cannon body is that same outer prism, not a thicker stand-in.
- The face is clear in the middle (low alpha, almost no emissive, no clearcoat). A narrow cool rim along the real boundary carries the highlight. Side faces are the glass edge, flat-shaded.
- Mass and quay friction are unchanged. `invInertia` stays capped. A facet that steps through the quay slab is sat back on the deck. Basin shards are not pulled back. Buoyancy stays off.

Prop-wear atlases and the street-ground sheet are untouched.
