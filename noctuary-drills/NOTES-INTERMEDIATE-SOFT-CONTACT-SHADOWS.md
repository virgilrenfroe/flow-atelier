# Intermediate · soft contact shadows (lantern pools)

**Scene:** `harbor.html`  
**Pass:** `noctuary/lantern-contact.js`  
**Compare:** `?contact=0` (or `?contact=off`) turns the path off. `L` toggles it while the frame loop is running. `?contact=mask` shows the shadow mask on the quay. `?shot=lantern` frames a quay lantern from the water side. `?still=1` still works.

## Choice

Soft **PCF contact shadows** from the quay lanterns onto the promenade, not another bloom and not a scene-wide AO wash.

The quay slab is an unlit shader. The lantern point lights already aim a short pool at that deck, and the water keeps its own lantern specular, but the slab never occluded the fixture. Cube shadows from the bulb were the wrong fit: the lamp sits inside the housing, so a point-light shadow map either blacks out the pool or misses the foot. A light probe would lift the district instead of grounding one fixture.

What shipped:

- Orthographic shadow map of **posts, feet, and housings** only (glow, glass, and filament stay off the map). Lowest surface wins, so a post that touches the deck leaves a contact and a cage in the air does not stamp a disk.
- Separable blur, then a 5-tap PCF in the quay fragment.
- The same fragment gives the wet stone a short warm/cool pool from each lantern (instanced row, plus the two hinged lamps, which follow the swing). The contact cuts that pool and cools the stone under the foot.
- Existing selective bloom is unchanged. Pools stay on the quay, which is not on the bloom layer.

Lantern seating and housing geometry are untouched. Streets, storefronts, prop wear, boats, pennants, fenestra, Rube, and physics are untouched.

## Probe

`window.__harborContact` · `technique === 'pcf-contact'` · `lampCount()` · `resolution` `[1024, 256]`.
