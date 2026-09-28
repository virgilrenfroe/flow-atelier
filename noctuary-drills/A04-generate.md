# A04 · Generate — procedural district massing

**Ladder:** advanced craft, drill #4.  
**Map:** Journey *Procedural Terrain* and *Sliced Model* — technique only. Harbor / Signal / Quay / Fenestra grammar. No other marks.

Hand-placed Harbor blocks (`placeBuilding` over the 5×4 lot roll) do not scale. This drill adds an authored generator beside that mesh. It does not replace the intermediate InstancedMesh clutter, the street-atlas sheets, or quay prop-wear.

## What was practiced

- **Height field.** Value noise + fbm. A slow octave sets the district ridge; a faster octave roughens lot to lot. Quay row stays low. Inland peaks become Signal crowns. Hinterland stays shorter.
- **Corridor mask.** Streets use the same cell as Harbor (`BLOCK + STREET`). Every block also cuts a north–south alley, and some blocks cut a cross alley. Mass is emitted only inside the remaining parcels. Courts (low occupancy noise) stay empty. A check recomputes the street bands and asserts no footprint intersects a street or alley.
- **Sliced mass.** Buildings taller than a walk-up are stacked sections: a shared podium height, a stepped shaft, and a crown on Signal peaks. That is the sliced-model idea used as extrusions, not a clipped tutorial prop.

The mass is one `InstancedMesh` (`harbor-district-mass`) with a night façade shader: concrete body, 0.76 m fenestra cells, dark mullions, cool glass, rare warm panes. Extension streets past the hand grid are plain night asphalt in this module. They do not bind `uStreetAtlas`.

## Toggle

Default Harbor is unchanged.

| Control | Effect |
|---|---|
| `harbor.html?generate=1` | Procedural massing on (alias `?massing=1`) |
| `P` | Toggle while the page is open |

Exhibit chrome stays hidden. While massing is on, the hand-placed building mesh, lot scars, and rooftop strands hide so the two cities do not stack. Cannon bodies, quay props, pennants, and the photographic street sheets stay as they were. Citizen walk collision is still the hand-placed volumes.

```bash
node noctuary/district-massing.check.mjs
```

`window.__harborMassing` reports instance counts, slice totals, and `corridorsClear`.

## Left alone

- `quay-crate` / `quay-iron` atlas wiring and `streetPack` / prop-wear hunks
- Street-ground atlas uniforms on the existing asphalt, sidewalk, and curb meshes
- Physics and collision for props that already have it
