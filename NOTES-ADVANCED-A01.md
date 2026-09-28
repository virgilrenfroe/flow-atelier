# A01 · Bake pipeline (quay bay)

**Track:** advanced drill #1  
**Motifs:** Harbor · Quay · Signal · Fenestra  
**Taste:** night ink `#05060a`, gold practicals `#f0c24b`, cool spill toward violet `#8a7bb8`

One shop-scale room whose interior is a photographic cell from the ground-floor shop atlas, with a Cycles lightmap and a separate AO map. The drill imports the GLB and lights it with those maps. Harbor punches the same model through a single ground-floor opening.

---

## Journey 49–52 (technique names only)

Portal-scene chapter, used as a method list. Nothing from that product’s marks, copy, or oval device is in the mesh or the page.

| Lesson band | Technique | Where it landed |
|-------------|----------------|-----------------|
| 49 | Author the scene in Blender | `07-advanced/a01-bake/bake_quay_bay.py` builds the room headless |
| 50 | Bake lights and shadows | Cycles diffuse direct + indirect, color pass off → `quay-bay-lightmap.png` |
| 50 | Ambient occlusion | Cycles AO → `quay-bay-ao.png` (floor/wall crease, jambs, plate) |
| 51 | Import and keep it small | `quay-bay.glb`, two UV sets, 1024² maps, no embedded beauty texture |
| 52 | Details on top of the bake | Emissive practicals (pendant, sconce, counter lamp), cool spill through the opening |

## What was baked

- **Lightmap** — lighting only. Albedo stays on the glTF materials (textured MeshStandard, lightmap-aware). Shell materials still use `lightMapIntensity = π × 4.2`. The photographic atlas materials (`AtlasFloor`, `AtlasWall`, `AtlasRoom`) use `1.55` and AO `0.32`, because those pixels are already the night-graded shop sheet — π×4.2 blows them out to a white pool. Lamp positions and wattages are the ones Virgil already framed. Bulb meshes are gone so they do not sit as greybox in front of the photograph.
- **Surfaces** — the interior is `shop-atlas.png` cell 6 (row 1, column 2), the dense photographic shop on the ground-floor sheet Harbor binds as `uShopAtlas`. The back plate is that cell with its own floor band cropped off. The 3D floor is the same cell's foreground (interior wood/tile), not promenade or street concrete. Side walls and the ceiling are a softened crop of that cell's upper interior. `room-atlas-occupied-32.png` remains the upstairs apartment sheet; this bay is a floor-0 shop, so it matches the neighboring shop stickers rather than an upstairs cell.
- **Contents** — lived-in furniture, fabric, and clutter are the photograph, not low-poly props. The counter, shelf, niche, bollard, and crate clutter are gone.
- **AO** — occlusion where the floor meets the walls and along the jambs. Runtime `aoMap` uses the same UV as the lightmap (`TEXCOORD_1`, `texture.channel = 1`). Atlas materials use intensity `0.32` so the photograph is not crushed; the shell stays at `0.72`.
- **Combined preview** — `quay-bay-combined.png` is the Cycles beauty (albedo × light). It is not applied in the drill, so the albedo is not multiplied twice.
- **Practicals** — point lights in Blender make the pools. Bulb and shade meshes carry `KHR_materials_emissive_strength` so the lamps still read as sources after import.
- **Cool spill** — an area light outside the opening, aimed into the room, plus a weak cool wash on the stoop.

Axes: modeled Blender Z-up, depth along +Y. Exported glTF Y-up. Opening in the plane `z = 0`, interior toward `-Z`, floor at `y = 0`. Numbers live in `07-advanced-assets/a01-bake/quay-bay.json`.

## What was not copied

- No Journey wordmark, course UI, or lesson screenshots.
- No portal oval, orange rim, or other product branding from that chapter.
- No NFL marks. No third-party trademarks.
- Not a flat emissive sticker. The atlas fenestra path in Harbor is unchanged except one opening.

## Re-bake

Blender 4.2+ on `PATH` (this pass used the official 4.2.14 LTS Linux tarball; apt had no Blender binary):

```bash
blender --background --python 07-advanced/a01-bake/bake_quay_bay.py
```

Writes into `07-advanced-assets/a01-bake/`:

- `quay-bay.glb` — mesh, `TEXCOORD_0` + `TEXCOORD_1`, shop-atlas cell 6 albedo
- `quay-bay-lightmap.png` — sRGB lighting pass
- `quay-bay-ao.png` — non-color AO
- `quay-bay-combined.png` — beauty reference
- `quay-bay.blend` — the authored scene
- `quay-bay.json` — opening size for the Harbor hook

Cycles, CPU, 64 samples, 2048², margin 8. The script shoulders the lightmap so a bright practical does not stamp a white island, and applies a mild gamma on the AO so creases stay readable. Opening width, sill, and head are unchanged, so the single-cell Harbor fit still lands flush to the piers.

Headless Blender 4.2 `Image.save()` writes a black PNG for generated float images even when `image.pixels` is filled. The script encodes the float buffer to PNG itself (sRGB for the lightmap and the combined preview, linear for AO).

## Drill

`spatial-drill-advanced-bake.html`

- `GLTFLoader` + `MeshStandardMaterial.lightMap` / `aoMap`
- Orbit, damped unless `prefers-reduced-motion` or `?still=1`
- `?hud=1` exhibit chrome · `H` toggles · `B` swaps in a beige flat fill (sticker comparison) · `1` / `2` / `3` frame wide, close, sill
- `?flat=1` starts on the sticker fill · `?shot=wide|close|sill`

## Harbor hook

`harbor.html` only:

- Imports `GLTFLoader`
- Five uniforms (`uBakeBay`, `uBakeCenter`, `uBakeHalf`, `uBakeBot`, `uBakeTop`)
- One `discard` on a single `+Z` ground-floor fenestra cell when a bay instance is chosen
- `mountQuayBakeBay()` places the GLB opening on that cell and hides the baked façade/stoop (the district wall is already there)

The façade grid is shop | pier | shop. `faceAlong` is metres from the massing center, and cell 0 is `[0, 0.76)`, so x = 0 is the pier between two shops, not the middle of a bay. An earlier hole used `abs(faceAlong) <= uBakeHalf` and sat across that pier, reading as a third room between two atlas stickers. The hole is now one cell's glass only (shop mullion 0.04 / 0.045, plinth at 0.12 m), and the GLB opening is scaled and shifted onto that same rect. The neighboring shop pane and the pier stay on the atlas path.

The GLB interior is `shop-atlas.png` cell 6 — the same ground-floor sheet as the neighboring shop stickers (`uShopAtlas`), not a parallel plaster set. Harbor and the drill keep `lightMapIntensity` at `1.55` on materials named `Atlas*` so that photograph stays in the sticker range. The bay floor is that cell's interior foreground. The opening fit used to leave that floor under the lot pad and the quay slab, so promenade concrete showed through the glass. Harbor lifts `AtlasFloor` above that tread and clips the quay and sidewalk shaders to the façade, so outdoor concrete stops at the threshold.

Street ground, deck plank atlas, prop wear, fleet, lamp props, water, pennants, and buoyancy/physics are untouched. If the GLB fails to load, `uBakeBay` stays `-1` and every pane stays on the atlas path.

`?bay=1` on Harbor frames that opening after the GLB arrives. The default orbit is unchanged.

## Not in this repo

`craft-library/catalog.json` is not in flow-atelier. No catalog hook.
