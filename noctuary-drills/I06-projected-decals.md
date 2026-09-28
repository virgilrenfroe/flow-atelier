# I06 · Projected decals — quay wear / freight marks

**Status:** done 2026-09-28 (America/New_York)
**Module:** `noctuary/i06-projected-decals.js`
**Glue:** `harbor.html` (import, `K` / Decals pill, `window.__harborDecals`)
**Brand:** Noctuary · intermediate. Motifs: Harbor / Quay / Signal. Marks on the paint: **HARBOR / SIGNAL / QUAY / FENESTRA** only.

This is the projector gap. Step 05’s “decals” were a shared atlas on LOD1 façades — UV stickers. This drill clips a projector box through existing Harbor meshes with `THREE.DecalGeometry`.

## Journey / technique map

| Piece | Map |
|-------|-----|
| `DecalGeometry` projector (position, orientation, size) clips mesh triangles and writes a new mesh | three.js example [`webgl_decals`](https://threejs.org/examples/#webgl_decals) · Wolfire, [How to project decals](http://blog.wolfire.com/2009/06/how-to-project-decals/) (cited in the three.js source) |
| Quay slab + seawall coping receive world-space projectors | Same projector, product surfaces — not a screen quad |
| Coping **SIGNAL** projector is tilted 45° so one clip hits the cap top and the water face | Edge wrap is the proof it is a projection, not a UV island |
| Crate stamps use the same tilt across lid and front, then the geometry is inverse-transformed into the crate and parented | Paint rides toss / buoyancy. No new Cannon body |
| Rust bleed + scuff sheets are canvas alpha, sampled by the projector UVs | Wear, not a second prop atlas |

Not a Journey intermediate lesson slot (Steps 01–04) and not a Step 05 redo. Official manual/example craft, filed as intermediate because Harbor’s zoom-in note named “decals” before the projector existed.

## What this is not

- Not a photo-atlas UV stick on quay-crate, quay-iron, street-ground, room, or shop sheets. Those loaders and `stampHarborCrateUVs` / `stampIronCell` are untouched.
- Not an InstancedMesh clutter pass.
- Not GPU picking. Decals were not blocked.

## What landed

| Surface | Projectors |
|---------|------------|
| Quay deck (`quay` plane) | HARBOR, SIGNAL, QUAY, FENESTRA stencils; three rust bleeds; two scuffs |
| Seawall coping (`seawallCap`) | HARBOR / QUAY / FENESTRA flat on the cap; SIGNAL wrapped over the water edge |
| Physics crates | One corner stamp each (word cycles the four marks) plus rust on the lid or a side scuff, parented to the crate mesh |

Materials are transparent `MeshStandardMaterial` with polygon offset and a little emissive so the paint reads on the night deck. Decal meshes do not raycast, so crate grab and walk collision stay on the existing bodies.

## Controls

| Input | Action |
|-------|--------|
| Default | Decals **on** |
| `?decals=0` or `?decals=off` | Hide |
| `?decals=1` or `?decals=on` | Show |
| `K` | Toggle |
| HUD pill **Decals** | Toggle (exhibit chrome stays off unless `H` / `?hud=1`) |
| `?still=1` | Freezes motion; decals stay. Crates park on the deck with their paint |

Exhibit-clean desktop is the default (`body.exhibit`). The pill lives in the existing quay control row.

## Verify

Open `harbor.html` (static server). Then in the console:

- `window.__harborDecals.technique` → `"DecalGeometry"`
- `window.__harborDecals.count` → greater than 0
- `window.__harborDecals.vertices()` → each entry’s `vertices` > 3 (clipped projector mesh, not a lone quad stuck in screen space)
- `window.__harborDecals.setEnabled(false)` hides quay group and crate-parented decals

Shots (desktop, `?still=1`, exhibit chrome off):

- `noctuary-drills/shots/i06-quay-wear-oblique.png` — deck stencils foreshorten with the slab
- `noctuary-drills/shots/i06-crate-corner-wrap.png` — stamp bends from lid onto the front
- `noctuary-drills/shots/i06-coping-wrap.png` — SIGNAL on the coping edge
- `noctuary-drills/shots/i06-decals-off.png` — same crate frame with the layer hidden

## Kept

Prop-wear atlases (quay-crate, quay-iron, street-ground), sheath, water, physics masses, springs, volume air, fenestra panes. No merge, no Railway.
