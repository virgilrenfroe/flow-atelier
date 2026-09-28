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

/** CELL entries are [row, col]. Row 0 is the top of the PNG. */
function face(name) {
  const [row, col] = CELL[name];
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

function stampAll(geo, name) {
  const cell = face(name);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const p = cellUV(cell.col, cell.row, uv.getX(i), uv.getY(i));
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

function ironTorus(radius, tube, y) {
  const g = new THREE.TorusGeometry(radius, tube, 6, 16);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  return stampAll(g, "iron");
}

function geoCan() {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.104, 0.090, 0.27, 20);
  body.translate(0, 0.155, 0);
  stampCylinder(body, face("can"), face("iron"));
  parts.push(body);
  parts.push(ironTorus(0.092, 0.011, 0.028));
  parts.push(ironTorus(0.108, 0.013, 0.292));
  const lid = new THREE.CylinderGeometry(0.118, 0.118, 0.020, 20);
  lid.translate(0, 0.318, 0);
  stampCylinder(lid, face("iron"), face("lid"));
  parts.push(lid);
  const dome = new THREE.SphereGeometry(0.095, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.42, 1);
  dome.computeVertexNormals();
  dome.translate(0, 0.328, 0);
  stampAll(dome, "lid");
  parts.push(dome);
  const bail = new THREE.TorusGeometry(0.026, 0.007, 6, 12, Math.PI);
  bail.translate(0, 0.362, 0);
  stampAll(bail, "iron");
  parts.push(bail);
  for (const sign of [1, -1]) {
    const lug = new THREE.TorusGeometry(0.018, 0.006, 5, 8, Math.PI);
    stampAll(lug, "iron");
    lug.rotateZ(sign > 0 ? -Math.PI / 2 : Math.PI / 2);
    lug.translate(sign * 0.096, 0.17, 0);
    parts.push(lug);
  }
  return mergeGeometries(parts);
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
  const body = new THREE.SphereGeometry(0.068, 12, 8);
  body.scale(1.15, 0.58, 0.88);
  body.translate(0, 0.044, 0);
  stampAll(body, "bag");
  const neck = new THREE.SphereGeometry(0.026, 8, 6);
  neck.scale(0.62, 1.35, 0.62);
  neck.translate(0, 0.086, 0);
  stampAll(neck, "bag");
  const knot = new THREE.SphereGeometry(0.011, 6, 5);
  knot.translate(0, 0.108, 0);
  stampAll(knot, "iron");
  return mergeGeometries([body, neck, knot]);
}

function geoLitter() {
  const g = new THREE.PlaneGeometry(0.10, 0.065);
  return stampAll(g, "litter");
}

function geoCard() {
  const g = new THREE.PlaneGeometry(0.16, 0.11);
  return stampAll(g, "cardboard");
}

function geoHydrant() {
  const parts = [];
  const pushUpright = (geo, y, side, cap) => {
    stampCylinder(geo, side, cap);
    geo.translate(0, y, 0);
    parts.push(geo);
  };
  pushUpright(new THREE.CylinderGeometry(0.098, 0.098, 0.026, 12), 0.013, face("iron"), face("iron"));
  pushUpright(new THREE.CylinderGeometry(0.058, 0.062, 0.20, 14), 0.126, face("hydrant"), face("hydrant"));
  const collar = new THREE.TorusGeometry(0.066, 0.011, 6, 16);
  collar.rotateX(Math.PI / 2);
  collar.translate(0, 0.168, 0);
  stampAll(collar, "hydrant");
  parts.push(collar);
  pushUpright(new THREE.CylinderGeometry(0.030, 0.066, 0.052, 12), 0.248, face("hydrant"), face("iron"));
  const nut = new THREE.CylinderGeometry(0.020, 0.020, 0.026, 5);
  stampCylinder(nut, face("iron"), face("iron"));
  nut.translate(0, 0.286, 0);
  parts.push(nut);

  const nozzle = (axis, sign, radius, length, y) => {
    const barrel = new THREE.CylinderGeometry(radius * 0.82, radius, length, 8);
    stampCylinder(barrel, face("hydrant"), face("hydrant"));
    const cap = new THREE.CylinderGeometry(radius * 1.22, radius * 1.22, 0.016, 6);
    stampCylinder(cap, face("iron"), face("iron"));
    if (axis === "x") {
      barrel.rotateZ(Math.PI / 2);
      cap.rotateZ(Math.PI / 2);
      const base = 0.060 + length * 0.5;
      barrel.translate(sign * base, y, 0);
      cap.translate(sign * (base + length * 0.5 + 0.008), y, 0);
    } else {
      barrel.rotateX(Math.PI / 2);
      cap.rotateX(Math.PI / 2);
      const base = 0.060 + length * 0.5;
      barrel.translate(0, y, sign * base);
      cap.translate(0, y, sign * (base + length * 0.5 + 0.008));
    }
    parts.push(barrel, cap);
  };
  nozzle("x", 1, 0.028, 0.046, 0.150);
  nozzle("x", -1, 0.028, 0.046, 0.150);
  nozzle("z", 1, 0.034, 0.044, 0.142);
  return mergeGeometries(parts);
}

function geoBench() {
  const parts = [];
  for (const x of [-0.27, 0.27]) {
    for (const z of [-0.052, 0.052]) {
      parts.push(partBox(0.030, 0.16, 0.028, x, 0.08, z, IRON));
    }
    parts.push(partBox(0.030, 0.022, 0.132, x, 0.036, 0, IRON));
    parts.push(partBox(0.028, 0.20, 0.026, x, 0.24, -0.070, IRON));
    parts.push(partBox(0.026, 0.018, 0.118, x, 0.198, -0.012, IRON));
  }
  for (const z of [-0.038, 0.012, 0.058]) {
    parts.push(partBox(0.58, 0.018, 0.028, 0, 0.168, z, WOOD));
  }
  for (const y of [0.248, 0.308]) {
    parts.push(partBox(0.56, 0.020, 0.016, 0, y, -0.070, WOOD));
  }
  return mergeGeometries(parts);
}

function geoWeed() {
  const a = new THREE.PlaneGeometry(0.11, 0.16);
  a.translate(0, 0.08, 0);
  stampAll(a, "weeds");
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  return mergeGeometries([a, b]);
}

function geoPit() {
  const parts = [];
  const s = 0.32;
  const t = 0.045;
  const h = 0.055;
  const outer = (s - t) * 0.5;
  parts.push(partBox(s, h, t, 0, h * 0.5, outer, CONC));
  parts.push(partBox(s, h, t, 0, h * 0.5, -outer, CONC));
  parts.push(partBox(t, h, s - t * 2, outer, h * 0.5, 0, CONC));
  parts.push(partBox(t, h, s - t * 2, -outer, h * 0.5, 0, CONC));
  const soil = new THREE.PlaneGeometry(s - t * 2 - 0.012, s - t * 2 - 0.012);
  soil.rotateX(-Math.PI / 2);
  soil.translate(0, 0.012, 0);
  stampAll(soil, "soil");
  parts.push(soil);
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.PlaneGeometry(0.09, 0.08);
    leaf.translate(0, 0.04, 0);
    stampAll(leaf, "weeds");
    leaf.rotateY((i * Math.PI) / 3);
    const ang = i * 2.15;
    leaf.translate(Math.cos(ang) * 0.028, 0.018, Math.sin(ang) * 0.028);
    parts.push(leaf);
  }
  return mergeGeometries(parts);
}

function geoPlanter() {
  const parts = [
    partBox(0.20, 0.12, 0.20, 0, 0.06, 0, CONC),
    partBox(0.26, 0.028, 0.26, 0, 0.134, 0, CONC),
  ];
  const soil = new THREE.PlaneGeometry(0.15, 0.15);
  soil.rotateX(-Math.PI / 2);
  soil.translate(0, 0.122, 0);
  stampAll(soil, "soil");
  parts.push(soil);
  const clump = new THREE.PlaneGeometry(0.09, 0.10);
  clump.translate(0, 0.05, 0);
  stampAll(clump, "weeds");
  clump.translate(0, 0.142, 0);
  const b = clump.clone();
  b.rotateY(Math.PI / 2);
  const c = clump.clone();
  c.rotateY(Math.PI / 5);
  parts.push(clump, b, c);
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
      const heroOf = (kind) => plan.items.find((it) => it.hero && it.kind === kind);
      const stand = (it, dist, eye, side, aimY) => {
        const yaw = it.yaw || 0;
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
        const baseY = it.y || y;
        controls.enableDamping = false;
        controls.minDistance = 0.08;
        camera.position.set(it.x + fx * dist + rx * side, baseY + eye, it.z + fz * dist + rz * side);
        controls.target.set(it.x, baseY + aimY, it.z);
        controls.update();
      };
      if (mode === "can") {
        const it = heroOf("can");
        if (it) stand(it, 0.36, 0.22, 0.11, 0.18);
      } else if (mode === "hydrant") {
        const it = heroOf("hydrant");
        if (it) stand(it, 0.34, 0.18, -0.10, 0.14);
      } else if (mode === "detail") {
        const can = heroOf("can");
        const hydrant = heroOf("hydrant");
        if (can && hydrant) {
          stand({
            x: (can.x + hydrant.x) * 0.5,
            z: (can.z + hydrant.z) * 0.5,
            y,
            yaw: can.yaw || 0,
          }, 0.88, 0.26, 0.0, 0.16);
        }
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
