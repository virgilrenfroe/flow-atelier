# Glass shards

Shop-pane breaks and the fenestra vessel shatter were spawning `BoxGeometry` chunks: roughly cubic, mostly opaque, a few of them on the bloom layer. They read as blocks.

`noctuary/glass-shards.js` builds each piece as a thin convex prism:

- Irregular 3–6 sided outline, one vertex pulled into a tip, hull kept convex so the silhouette stays a shard.
- Thickness is about 5–7% of the span (about 0.008–0.014 scene units). Flat face normals, so the rim stays sharp.
- The cannon shape is that same prism (`ConvexPolyhedron`). Mass and the quay contact material are unchanged. `invInertia` is capped so a sheet does not spin apart on contact.
- If a facet center steps through the quay slab, it is sat back on the deck. Shards that leave the slab (basin) are not pulled back. Buoyancy is off: a real sheet’s volume is far under a crate, and the crate “fully under, lift anyway” rescue would buzz a flake on the waterline.

The material is a physical glass: cool or faint-violet tint, low roughness, clearcoat, a night-dock reflection map, and a Fresnel alpha (more transparent head-on, bright at the edge). Shards are not on the bloom layer.

Prop-wear atlases and the street-ground sheet are untouched.
