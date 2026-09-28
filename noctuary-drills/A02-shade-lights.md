# A02 · Shade lights / night stilftone

Journey map: **Lights Shading** · **Halftone Shading**. Technique only — no lesson branding in the scene.

Original marks only: HARBOR / SIGNAL / QUAY / FENESTRA.

Draft work. Do not merge. Do not deploy to Railway.

## What changed

Night fixtures on Signal, lanterns, and the wet quay shade with a fragment light equation. Selective bloom still runs. `?shade=0` restores the prior bloom-only read on these surfaces.

The equation, shared as `NIGHT_SHADE_GLSL` in `harbor.html`:

- Ambient fill.
- Directional moon: Lambert plus Phong. The view vector points from the surface toward the camera.
- Point fixtures: the same Lambert plus Phong, with linear distance decay `max(0, 1 - distance * decay)`.

Where it lands:

- **Signal** shaft (product hero) is lit by a point at the tip, plus the gold core. Traffic lenses shade as fixtures. Traffic iron and visors take their color from the live lamp instead of MeshStandard.
- **Lanterns** — glass, bulb, filament, and the pan use the bulb as the point. Housing (instanced row and hinged lanterns) replaces MeshStandard lighting with the same equation. Housing geometry and seating are unchanged.
- **Wet quay** — the basin replaces the old specular-only lamp glint with the point equation (two quay lanterns plus a dim directional). The seawall wet course uses the same lamps. Quay deck plates are untouched.

Streets, storefronts, prop wear, boats, pennants, fenestra, Rube, and physics are unchanged. Scene point lights still illuminate everything else.

## Stilftone

Soft screen-space disks (smoothstep, not a hard halftone step). Radius follows fixture light, so open water and unlit iron stay continuous. It does not run as a full-frame pass.

- Default: on, light (`0.42`).
- Off: `?stilftone=0` or key `K` (toggles ink; if shade is off, `K` turns the equation back on).
- Strength: `?stilftone=0.3` (0–1).
- Prior bloom-only read: `?shade=0` (forces stilftone off).
- Hold motion for a still comparison without dropping bloom: `?hold=1`.

Runtime:

```js
window.__harborShade.setShade(false)   // bloom-only path
window.__harborShade.setStilftone(0)    // equation, no ink
window.__harborShade.setStilftone(0.42) // soft print-night
```

HUD row `shade` (hidden in exhibit) reads `equation · ink`, `equation`, or `bloom`.
