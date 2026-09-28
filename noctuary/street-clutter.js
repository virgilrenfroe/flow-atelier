/**
 * Harbor street clutter — first pass.
 * Shared 4×4 photo atlas (street-clutter-atlas.png), InstancedMesh props.
 * Placement comes from street-clutter-plan.mjs against the live curb / sidewalk.
 * Static cannon bodies for the solid pieces only. No NPCs.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { planStreetClutter } from "./street-clutter-plan.mjs";

const CELL = {
  manhole: [0, 0],
  can: [0, 1],
  bag: [0, 2],
  soil: [0, 3],
  inlet: [1, 0],
  dumpster: [1, 1],
  litter: [1, 2],
  concrete: [1, 3],
  gutter: [2, 0],
  lid: [2, 1],
  timber: [2, 2],
  weeds: [2, 3],
  throat: [3, 0],
  cardboard: [3, 1],
  iron: [3, 2],
  hydrant: [3, 3],
};

const DECAL = new Set(["manhole", "grate", "litter", "cardboard"]);

function face(name) {
  const [col, row] = CELL[name];
  return { col, row };
}

function cellUV(col, row, u, v) {
  const su = 0.25;
  const sv = 0.25;
  const inset = 0.004;
  const u0 = col * su + inset;
  const v0 = 1 - (row + 1) * sv + inset;
  return [u0 + u * (su - inset * 2), v0 + v * (sv - inset * 2)];
}

function stampAll(geo, col, row) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const p = cellUV(col, row, uv.getX(i), uv.getY(i));
    uv.setXY(i, p[0], p[1]);
  }
  return geo;
}

function stampBox(geo, faces) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const cell = faces[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      const p = cellUV(cell.col, cell.row, uv.getX(idx), uv.getY(idx));
      uv.setXY(idx, p[0], p[1]);
    }
  }
  return geo;
}

function stampCylinder(geo, side, cap) {
  const uv = geo.attributes.uv;
  const n = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const cell = Math.abs(n.getY(i)) > 0.65 ? cap : side;
    const p = cellUV(cell.col, cell.row, uv.getX(i), uv.getY(i));
    uv.setXY(i, p[0], p[1]);
  }
  return geo;
}

function partBox(w, h, d, x, y, z, faces) {
  const g = new THREE.BoxGeometry(w, h, d);
  stampBox(g, faces);
  g.translate(x, y, z);
  return g;
}

const IRON = [face("iron"), face("iron"), face("iron"), face("iron"), face("iron"), face("iron")];
const WOOD = [face("timber"), face("timber"), face("timber"), face("timber"), face("timber"), face("timber")];
const CONC = [face("concrete"), face("concrete"), face("concrete"), face("concrete"), face("concrete"), face("concrete")];

function geoManhole() {
  const g = new THREE.CylinderGeometry(0.15, 0.15, 0.018, 20);
  g.translate(0, 0.009, 0);
  return stampCylinder(g, face("iron"), face("manhole"));
}

function geoInlet() {
  const g = new THREE.BoxGeometry(0.22, 0.075, 0.055);
  stampBox(g, [face("throat"), face("throat"), face("iron"), face("throat"), face("inlet"), face("throat")]);
  g.translate(0, 0.038, 0);
  return g;
}

function geoGrate() {
  const g = new THREE.BoxGeometry(0.30, 0.016, 0.12);
  stampBox(g, [face("iron"), face("iron"), face("gutter"), face("iron"), face("iron"), face("iron")]);
  g.translate(0, 0.008, 0);
  return g;
}

function geoCan() {
  const body = new THREE.CylinderGeometry(0.095, 0.102, 0.32, 16);
  body.translate(0, 0.16, 0);
  stampCylinder(body, face("can"), face("lid"));
  const lid = new THREE.CylinderGeometry(0.108, 0.108, 0.03, 16);
  lid.translate(0, 0.335, 0);
  stampCylinder(lid, face("iron"), face("lid"));
  return mergeGeometries([body, lid]);
}

function geoDumpster() {
  const panel = [face("dumpster"), face("dumpster"), face("lid"), face("iron"), face("dumpster"), face("dumpster")];
  const parts = [
    partBox(0.52, 0.30, 0.28, 0, 0.18, 0, panel),
    partBox(0.50, 0.028, 0.26, 0, 0.344, 0, [face("iron"), face("iron"), face("lid"), face("dumpster"), face("iron"), face("iron")]),
  ];
  for (const x of [-0.16, 0.16]) {
    for (const z of [-0.09, 0.09]) {
      const w = new THREE.CylinderGeometry(0.028, 0.028, 0.018, 8);
      w.rotateZ(Math.PI / 2);
      w.translate(x, 0.028, z);
      stampCylinder(w, face("iron"), face("iron"));
      parts.push(w);
    }
  }
  return mergeGeometries(parts);
}

function geoBag() {
  const g = new THREE.SphereGeometry(0.085, 12, 8);
  g.scale(1.2, 0.7, 0.95);
  g.translate(0, 0.055, 0);
  return stampAll(g, CELL.bag[0], CELL.bag[1]);
}

function geoLitter() {
  const g = new THREE.PlaneGeometry(0.10, 0.065);
  return stampAll(g, CELL.litter[0], CELL.litter[1]);
}

function geoCard() {
  const g = new THREE.PlaneGeometry(0.16, 0.11);
  return stampAll(g, CELL.cardboard[0], CELL.cardboard[1]);
}

function geoHydrant() {
  const parts = [];
  const addCyl = (r0, r1, h, y, side, cap, rotZ, tx) => {
    const g = new THREE.CylinderGeometry(r0, r1, h, 12);
    if (rotZ) g.rotateZ(rotZ);
    g.translate(tx || 0, y, 0);
    stampCylinder(g, side, cap);
    parts.push(g);
  };
  addCyl(0.074, 0.082, 0.045, 0.022, face("hydrant"), face("iron"));
  addCyl(0.052, 0.060, 0.16, 0.125, face("hydrant"), face("hydrant"));
  addCyl(0.032, 0.056, 0.07, 0.24, face("hydrant"), face("iron"));
  addCyl(0.016, 0.016, 0.028, 0.288, face("iron"), face("iron"));
  addCyl(0.018, 0.022, 0.07, 0.15, face("hydrant"), face("iron"), Math.PI / 2, 0.07);
  addCyl(0.018, 0.022, 0.07, 0.15, face("hydrant"), face("iron"), Math.PI / 2, -0.07);
  return mergeGeometries(parts);
}

function geoBench() {
  const parts = [];
  for (const x of [-0.26, 0.26]) {
    for (const z of [-0.06, 0.06]) {
      parts.push(partBox(0.022, 0.155, 0.022, x, 0.078, z, IRON));
    }
    parts.push(partBox(0.02, 0.18, 0.018, x, 0.24, -0.078, IRON));
  }
  for (const z of [-0.035, 0.02, 0.07]) {
    parts.push(partBox(0.56, 0.016, 0.026, 0, 0.162, z, WOOD));
  }
  for (const y of [0.24, 0.30]) {
    parts.push(partBox(0.54, 0.018, 0.014, 0, y, -0.078, WOOD));
  }
  return mergeGeometries(parts);
}

function geoWeed() {
  const a = new THREE.PlaneGeometry(0.11, 0.16);
  a.translate(0, 0.08, 0);
  stampAll(a, CELL.weeds[0], CELL.weeds[1]);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  return mergeGeometries([a, b]);
}

function geoPit() {
  const parts = [];
  const s = 0.30;
  const t = 0.028;
  parts.push(partBox(s, 0.045, t, 0, 0.022, s * 0.5, CONC));
  parts.push(partBox(s, 0.045, t, 0, 0.022, -s * 0.5, CONC));
  parts.push(partBox(t, 0.045, s - t, s * 0.5, 0.022, 0, CONC));
  parts.push(partBox(t, 0.045, s - t, -s * 0.5, 0.022, 0, CONC));
  const soil = new THREE.PlaneGeometry(s - 0.05, s - 0.05);
  soil.rotateX(-Math.PI / 2);
  soil.translate(0, 0.016, 0);
  stampAll(soil, CELL.soil[0], CELL.soil[1]);
  parts.push(soil);
  const trunk = new THREE.CylinderGeometry(0.026, 0.034, 0.70, 8);
  trunk.translate(0, 0.37, 0);
  stampCylinder(trunk, face("timber"), face("timber"));
  parts.push(trunk);
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.PlaneGeometry(0.26, 0.20);
    leaf.translate(0, 0.74, 0);
    stampAll(leaf, CELL.weeds[0], CELL.weeds[1]);
    leaf.rotateY((i * Math.PI) / 3);
    parts.push(leaf);
  }
  return mergeGeometries(parts);
}

function geoPlanter() {
  const parts = [
    partBox(0.24, 0.15, 0.24, 0, 0.075, 0, CONC),
  ];
  const soil = new THREE.PlaneGeometry(0.16, 0.16);
  soil.rotateX(-Math.PI / 2);
  soil.translate(0, 0.142, 0);
  stampAll(soil, CELL.soil[0], CELL.soil[1]);
  parts.push(soil);
  for (const x of [-0.04, 0.045]) {
    const w = new THREE.PlaneGeometry(0.09, 0.13);
    w.translate(x, 0.20, 0);
    stampAll(w, CELL.weeds[0], CELL.weeds[1]);
    const w2 = w.clone();
    w2.rotateY(Math.PI / 2);
    parts.push(w, w2);
  }
  return mergeGeometries(parts);
}

const GEOS = {
  manhole: geoManhole,
  inlet: geoInlet,
  grate: geoGrate,
  can: geoCan,
  dumpster: geoDumpster,
  bag: geoBag,
  litter: geoLitter,
  cardboard: geoCard,
  hydrant: geoHydrant,
  bench: geoBench,
  weed: geoWeed,
  pit: geoPit,
  planter: geoPlanter,
};

const VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vec4 world = instanceMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vNormalW = normalize(mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  uniform sampler2D uAtlas;
  uniform float uAtlasOn;
  uniform float uCut;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  void main() {
    vec4 texel = texture2D(uAtlas, vUv);
    if (texel.a < uCut) discard;
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(vec3(0.32, 0.88, 0.24));
    float ndl = clamp(dot(N, L), 0.0, 1.0);
    float hemi = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 photo = texel.rgb;
    vec3 lit = photo * (0.55 + 0.62 * ndl) + photo * hemi * 0.12;
    lit += vec3(0.025, 0.028, 0.04) * (1.0 - ndl);
    if (uAtlasOn < 0.5) {
      float g = fract(sin(dot(vUv, vec2(19.1, 73.4))) * 43758.5);
      lit = vec3(0.09, 0.09, 0.10) + g * 0.025;
    }
    float dist = length(vWorldPos - cameraPosition);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 12.0);
    gl_FragColor = vec4(mix(lit, uFogColor, clamp(fog, 0.0, 0.85)), 1.0);
  }
`;

function makeMat(polygonOffset) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: null },
      uAtlasOn: { value: 0 },
      uCut: { value: 0.28 },
      uFogColor: { value: new THREE.Color(0x05060a) },
      uFogDensity: { value: 0.018 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    polygonOffset,
    polygonOffsetFactor: polygonOffset ? -3 : 0,
    polygonOffsetUnits: polygonOffset ? -3 : 0,
  });
  const stub = new THREE.DataTexture(new Uint8Array([28, 30, 34, 255]), 1, 1);
  stub.needsUpdate = true;
  mat.uniforms.uAtlas.value = stub;
  return mat;
}

function centroid(list) {
  let x = 0;
  let z = 0;
  for (let i = 0; i < list.length; i++) {
    x += list[i].x;
    z += list[i].z;
  }
  return { x: x / list.length, z: z / list.length };
}

export function mountStreetClutter({ scene, world, CANNON, atlasUrl, anchors, enabled }) {
  const plan = planStreetClutter(anchors);
  const group = new THREE.Group();
  group.name = "harbor-street-clutter";
  const opaque = makeMat(false);
  const decal = makeMat(true);
  const materials = [opaque, decal];
  const bodies = [];
  let on = enabled !== false;

  function addBody(it) {
    if (!world || !CANNON || !it.solid) return;
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(it.hx, it.hy, it.hz)),
      position: new CANNON.Vec3(it.x, it.y + it.hy, it.z),
    });
    body.quaternion.setFromEuler(0, it.yaw || 0, 0);
    if (it.surface === "quay") body.position.y += 0.012;
    bodies.push(body);
    if (on) world.addBody(body);
  }

  const byKind = {};
  for (let i = 0; i < plan.items.length; i++) {
    const it = plan.items[i];
    if (!byKind[it.kind]) byKind[it.kind] = [];
    byKind[it.kind].push(it);
  }

  const dummy = new THREE.Object3D();
  const kinds = Object.keys(byKind);
  for (let k = 0; k < kinds.length; k++) {
    const kind = kinds[k];
    const list = byKind[kind];
    const geo = GEOS[kind]();
    const mesh = new THREE.InstancedMesh(geo, DECAL.has(kind) ? decal : opaque, list.length);
    mesh.name = "clutter-" + kind;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    if (DECAL.has(kind)) mesh.renderOrder = 2;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const lift = it.rx ? 0.014 : 0;
      dummy.position.set(it.x, it.y + lift, it.z);
      dummy.rotation.set(it.rx || 0, it.yaw || 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      addBody(it);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  group.visible = on;
  scene.add(group);

  const state = {
    counts: plan.counts,
    total: plan.total,
    items: plan.items,
    wider: plan.wider,
    live: plan.live,
    atlas: "pending",
    group,
    enabled() { return on; },
    setEnabled(v) {
      on = !!v;
      group.visible = on;
      if (!world) return on;
      for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        if (on && body.world !== world) world.addBody(body);
        if (!on && body.world === world) world.removeBody(body);
      }
      return on;
    },
    toggle() { return state.setEnabled(!on); },
    frame(mode, camera, controls) {
      if (!camera || !controls) return;
      const hero = plan.items.filter((it) => it.hero);
      const quay = plan.items.filter((it) => it.surface === "quay");
      const c = hero.length ? centroid(hero) : centroid(plan.items);
      const y = anchors.sidewalkTop || 0.08;
      if (mode === "detail") {
        const bench = plan.items.find((it) => it.hero && it.kind === "bench") || { x: c.x, z: c.z };
        camera.position.set(bench.x + 0.05, y + 0.42, bench.z + 0.95);
        controls.target.set(bench.x, 0.16, bench.z);
      } else if (mode === "quay" && quay.length) {
        const q = centroid(quay);
        camera.position.set(q.x + 2.4, 1.15, q.z - 1.15);
        controls.target.set(q.x, 0.28, q.z);
      } else if (mode === "street") {
        camera.position.set(c.x + 1.6, 1.85, c.z + 2.35);
        controls.target.set(c.x, 0.32, c.z);
      } else {
        camera.position.set(c.x + 0.15, y + 0.62, c.z + 1.45);
        controls.target.set(c.x, 0.22, c.z - 0.05);
      }
      controls.update();
    },
  };

  if (atlasUrl) {
    const loader = new THREE.TextureLoader();
    loader.load(atlasUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      for (let i = 0; i < materials.length; i++) {
        materials[i].uniforms.uAtlas.value = tex;
        materials[i].uniforms.uAtlasOn.value = 1;
      }
      state.atlas = "street-clutter-packed";
    }, undefined, () => {
      state.atlas = "fallback";
    });
  }

  return state;
}
