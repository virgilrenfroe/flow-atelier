# A02 · Shade lights / night halftone

Journey map: **Lights Shading** · **Halftone Shading**. Technique only — no lesson branding in the scene.

Original marks only: HARBOR / SIGNAL / QUAY / FENESTRA.

Draft work. Do not merge. Do not deploy to Railway.

## What changed

Night fixtures on Signal, lanterns, and the wet quay shade with a fragment light equation. Selective bloom still runs. `?shade=0` restores the prior bloom-only read on these surfaces.

The equation, shared as `NIGHT_SHADE_GLSL` in `harbor.html`:

- Ambient fill.
- Directional moon: wrapped Lambert plus sharp Phong. The wrap is diffuse-only, so the terminator stays soft on iron and wet stone. The view vector points from the surface toward the camera, and Phong is `dot(reflect, view)`.
- Point fixtures: the same wrapped Lambert plus Phong, with a short spill so cage bars and the seawall face still catch a lamp that sits beside them. Decay is an inverse-square core (`1 / (1 + dist² · decay)`) gated by a smooth range window `(1 - (dist/range)⁴)²`. `lightDecay` is still `1/range`, so a lamp dies at the pool edge instead of a hard linear cutoff.

Where it lands:

- **Signal** shaft (product hero) takes a side moon so the column has a lit face, plus a point at the tip so the gold stripe follows the lamp down the shaft. Traffic lenses put one filament just in front of the sphere center (instance origin), then limb-darken, so the glass reads as a shaded lens. Traffic iron and visors take their color from the live lamp instead of MeshStandard.
- **Lanterns** — the filament is lit from the coil center (`vLampPos`), so the tube has a bright outer face. The bulb is an internal source: limb darkening plus a moon Phong, not a light stuck on the normal. Glass panes transmit from the bulb (light sits behind the pane) with a distance falloff and a small glint, and stay under the bloom cap. The pan is a warm pool under the bulb. Housing (instanced row and hinged lanterns) replaces MeshStandard lighting with the same equation, warmer on the cage nearest the bulb. Housing geometry and seating are unchanged.
- **Wet quay** — the basin adds a wrapped warm pool plus a tight Phong from the two quay lanterns, still inside the night color cap. The seawall wet course uses the same lamps and falls off along the stone. Quay deck plates are untouched.

Streets, storefronts, prop wear, boats, pennants, fenestra, Rube, and physics are unchanged. Scene point lights still illuminate everything else.

## Halftone

Soft screen-space disks (smoothstep, not a hard halftone step). Radius follows fixture light, so open water and unlit iron stay continuous. It does not run as a full-frame pass.

- Default: on, light (`0.42`).
- Off: `?halftone=0` or key `K` (toggles ink; if shade is off, `K` turns the equation back on).
- Strength: `?halftone=0.3` (0–1).
- Prior bloom-only read: `?shade=0` (forces halftone off).
- Hold motion for a still comparison without dropping bloom: `?hold=1`.

Runtime:

```js
window.__harborShade.setShade(false)   // bloom-only path
window.__harborShade.setHalftone(0)    // equation, no ink
window.__harborShade.setHalftone(0.42) // soft print-night
```

HUD row `shade` (hidden in exhibit) reads `equation · ink`, `equation`, or `bloom`.
