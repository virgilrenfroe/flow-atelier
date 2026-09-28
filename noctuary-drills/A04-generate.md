# A04 · Generate — procedural district massing

**Ladder:** advanced craft, drill #4.  
**Map:** Journey *Procedural Terrain* and *Sliced Model* — technique only. Harbor / Signal / Quay / Fenestra grammar. No other marks.

Hand-placed Harbor blocks (`placeBuilding` over the 5×4 lot roll) do not scale. This drill adds an authored generator beside that mesh. It does not replace the intermediate InstancedMesh clutter, the street-atlas sheets, or quay prop-wear.

## What was practiced

- **Height field.** Value noise + fbm. A slow octave sets the district ridge; a faster octave roughens lot to lot. The field is shifted by a seed, so two seeds are two districts. Quay row stays low. A ridge through the middle blocks becomes Signal towers. Hinterland stays shorter.
- **Corridor mask.** Streets use the same cell as Harbor (`BLOCK + STREET`). The outer hard mask is the main street module, `STREET_W` 1.65 — the gap between building faces, not a wider district. Inside that gap the sidewalks are 0.18, so the asphalt carriageway is 1.29 (`STREET_W − 2×SIDEWALK_W`), wider than main’s 0.65 lane. Alleys stay 1.16 inside the block. Every block cuts a north–south alley. Every block inland of the quay also cuts a cross alley. Parcels sit behind a 0.52 inset, and each footprint must keep a 0.14 gap from every street and alley or it is shrunk until it does. Courts (low occupancy noise) stay empty. Dark alley ribbons are drawn with the massing pass, inside the block, so the cut reads even on the existing lot pads. A check recomputes the street bands, asserts an 8 cm clearance, and asserts the outer module is still 1.65 while the carriageway is 1.29.
- **Sliced mass.** A stack is a fixed 1.48 podium, then a shaft at 70% of that footprint. A crown is allowed only on the tallest lot of a Signal ridge block (not Quay, not the hinterland belt), one crown per block, and the crown is 72% of the shaft so it cannot spill past it. The hard mask runs again on every slice.

The mass is one `InstancedMesh` (`harbor-district-mass`) with a night façade shader: concrete body, 0.76 m fenestra cells, dark mullions, cool glass, rare warm panes. Extension streets past the hand grid are plain night asphalt in this module. They do not bind `uStreetAtlas`.

## Wider asphalt, same block spacing

The street module stays the main gap: `STREET_W` 1.65. Building faces do not move. Sidewalks sit inside that gap, so the lane you see is `STREET_W − 2×SIDEWALK_W`. Main used 0.50 sidewalks and left a 0.65 carriageway. Sidewalks are now 0.18, which opens the asphalt to 1.29. The walks are a skinny ribbon beside that lane. Alleys stay the narrow cut inside the block.

| Lane | Main | Now |
|---|---|---|
| `STREET_W` (outer gap, hard mask) | 1.65 | 1.65 |
| `SIDEWALK_W` | 0.50 | 0.18 |
| Carriageway (`STREET_W − 2×SIDEWALK_W`) | 0.65 | 1.29 |
| Quay-edge walk (north face of the first row) | 0.50 | 0.22 |
| Alley | 1.16 | 1.16 |

The quay-edge walk is a 0.22 strip on the water side of the first row. It stays inside the 1.65 gap, so it does not push the promenade or the buildings. Hand-placed asphalt, sidewalks, curbs, and crosswalks use these constants, and the generator mask uses the same outer `STREET_W` and sidewalk split. Atlas cell sampling is unchanged.

## Crosswalks

Marked crossings follow the NYC approach-band rule (Street Design Manual pavement markings, MUTCD 3B, NYSDOT HDM §18.7.7–18.7.8). They sit at grid intersections only, not in the middle of the box and not midblock.

Each leg that has a sidewalk on both sides of the street gets one band. The band is the continuation of that sidewalk across the carriageway: its inner edge lines up with the sidewalk’s street face, and the band lies just outside the intersection. The span is the carriageway, `STREET_W − 2×SIDEWALK_W` (1.29), curb to curb. The depth along the sidewalk is 0.70 (~11 ft at 15.79 ft/unit). Continental bars run parallel to traffic on that approach. A leg with no far sidewalk — the water edge of the quay street, and the outside of the district — is left unmarked. The paint is visual only.

## Toggle

The generator does not allocate meshes until it is turned on. Turning it off disposes those geometries and materials, then shows the hand-placed mesh again. The two cities are never both visible. The thinner sidewalks and wider asphalt stay in both modes, because they are the street module, not a massing-only overlay.

| Control | Effect |
|---|---|
| `harbor.html?generate=1` | Procedural massing on (alias `?massing=1`) |
| `P` | Toggle while the page is open |
| `?seed=signal` | District seed. Presets: `A04`, `signal`, `quay`, `fenestra`. A number or any other word is hashed. |
| Seed bar | Shown only while massing is on. `−` / `+` or `J` / `K` step the presets. Type a seed and press Enter. |
| The bar writes `generate` and `seed` into the URL | Reload keeps the same district. Turning massing off drops `generate` and leaves the seed in place. |

While massing is on, the hand-placed building mesh, lot scars, and rooftop strands hide. Cannon bodies, quay props, pennants, and the photographic street sheets stay as they were. Citizen walk collision is still the hand-placed volumes.

```bash
node noctuary/district-massing.check.mjs
```

`window.__harborMassing` reports instance counts, slice totals, and `corridorsClear`.

## Harbor view

Same camera and the same building spacing. Left is the 0.30 sidewalk (carriageway 1.05). Right slims the walk to 0.18 and opens the asphalt to 1.29. The quay-edge strip is 0.22.

![Harbor streets, same spacing, wider asphalt](a04-harbor-streets-before-after.png)

An interior intersection after the slim walks. Each band still sits on an approach, spans the 1.29 carriageway, and keeps continental bars parallel to traffic:

![Harbor intersection crosswalks, before and after](a04-harbor-crosswalk-approaches.png)

Seed `A04`, massing on. The asphalt ribbon is the wide part of the same gap; the seed bar is the only added chrome:

![Harbor seed A04 with wider corridors](a04-harbor-massing-seed-a04.png)

Same camera, seed `signal`. The skyline and courts change; the corridor widths do not:

![Harbor seed signal](a04-harbor-massing-seed-signal.png)

## Left alone

- `quay-crate` / `quay-iron` atlas wiring and `streetPack` / prop-wear hunks
- Street-ground atlas uniforms and cell sampling on the existing asphalt, sidewalk, and curb meshes (mesh scale changed; the sheets did not)
- Physics and collision for props that already have it
