import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { live } from './live.js';
import { trackDisposable } from './dispose.js';

// Quay props, buoyancy, wind, shop glass, springs, pennants, and the Signal beacon.
// Cannon world + collision slabs stay here so main.js can keep the district mesh.
export function createHarborPhysics(deps) {
  const {
    scene, camera, renderer, controls,
    freezeMotion, stillMode,
    FURN_COUNT, INSTANCE_COUNT, LANTERN_N, SEAWALL_Z, BLOOM_LAYER,
    WATER_AMP, WATER_D, WATER_NEAR_Z, WATER_W, WATER_Y,
    atlasBase, atlasLoader,
    bollards, furnMat, quayPostMat, posts, dummy,
    harborBoxes, lanterns, makeHarborLanternMesh,
    pavementCols, quayTouchControls,
    shopBreakData, shopBreakTex,
    signalArmGeo, signalBackGeo, signalBaseGeo, signalHangerGeo,
    signalHousingGeo, signalIron, signalPoleGeo, signalVisorGeo, signalVisorMat,
    strandPostGeo, strandPostMat,
  } = deps;

// ——— Quay physics props (cannon-es · scoped overlay · Journey #20) ———
// Keep InstancedMesh bollards/posts/lanterns as district massing.
// Overlay: fixed bollards + hinged lanterns + free crates (grab / toss).
const physFreeze = freezeMotion; // RM / ?still=1 → no step, static masses
const physWorld = new CANNON.World({
  gravity: new CANNON.Vec3(0, physFreeze ? 0 : -9.82, 0),
});
physWorld.allowSleep = true;
physWorld.defaultContactMaterial.friction = 0.42;
physWorld.defaultContactMaterial.restitution = 0.12;
const physGroundMat = new CANNON.Material('quay');
const physCrateMat = new CANNON.Material('crate');
physWorld.addContactMaterial(new CANNON.ContactMaterial(physGroundMat, physCrateMat, {
  friction: 0.5,
  restitution: 0.06,
}));

const physEntries = []; // { mesh, body, kind, mass, spawn, halfExtents? }
const physCrates = [];
const physLanterns = [];
const physConstraints = [];
let physConstraintOn = !physFreeze;
// Soft-spring / wind extension hooks (filled after Signal tip exists)
const physHooks = {
  afterWind: null,   // (t, base, dx, dz) => void
  beforeStep: null,  // () => void — spring.applyForce
  afterStep: null,   // () => void — sync spring meshes / cables
  onReset: null,     // () => void
  onProbe: null,     // () => void — extend __harborPhysics / __springs
  onFreezeSync: null,// () => void
};

function physSync(entry) {
  entry.mesh.position.copy(entry.body.position);
  entry.mesh.quaternion.copy(entry.body.quaternion);
}

function physAdd(mesh, body, kind, mass) {
  scene.add(mesh);
  physWorld.addBody(body);
  const entry = {
    mesh, body, kind, mass,
    spawn: {
      position: body.position.clone(),
      quaternion: body.quaternion.clone(),
    },
  };
  mesh.userData.physEntry = entry;
  physEntries.push(entry);
  physSync(entry);
  return entry;
}

// Static quay collision slab (matches hero quay deck band).
// Thick downward so a fast crate cannot step through the promenade.
// Top stays at the deck (y=0.04). Plate latch still keys off this body.
const QUAY_TOP_Y = 0.04;
const PAVEMENT_HALF_Y = 1.05;
const quayDeckBody = new CANNON.Body({
  mass: 0,
  type: CANNON.Body.STATIC,
  material: physGroundMat,
  shape: new CANNON.Box(new CANNON.Vec3(11, PAVEMENT_HALF_Y, 3.2)),
  position: new CANNON.Vec3(0, QUAY_TOP_Y - PAVEMENT_HALF_Y, 2.6),
});
physWorld.addBody(quayDeckBody);

// Streets, sidewalks, and lot pads. Pieces that sit on the quay slab are
// clipped out so a crate on the promenade still rests on quayDeckBody.
const QUAY_COL_X = 11;
const QUAY_COL_Z0 = 2.6 - 3.2;
const QUAY_COL_Z1 = 2.6 + 3.2;
function pavementOutsideQuay(p) {
  const x0 = p.x - p.hx;
  const x1 = p.x + p.hx;
  const z0 = p.z - p.hz;
  const z1 = p.z + p.hz;
  const qx0 = -QUAY_COL_X;
  const qx1 = QUAY_COL_X;
  const ox0 = Math.max(x0, qx0);
  const ox1 = Math.min(x1, qx1);
  const oz0 = Math.max(z0, QUAY_COL_Z0);
  const oz1 = Math.min(z1, QUAY_COL_Z1);
  if (!(ox0 < ox1 - 1e-4 && oz0 < oz1 - 1e-4)) return [p];
  const out = [];
  const push = (ax0, ax1, az0, az1) => {
    if (ax1 - ax0 < 0.04 || az1 - az0 < 0.04) return;
    out.push({
      x: (ax0 + ax1) * 0.5,
      z: (az0 + az1) * 0.5,
      hx: (ax1 - ax0) * 0.5,
      hz: (az1 - az0) * 0.5,
      top: p.top,
    });
  };
  if (x0 < qx0) push(x0, qx0, z0, z1);
  if (x1 > qx1) push(qx1, x1, z0, z1);
  const mx0 = Math.max(x0, qx0);
  const mx1 = Math.min(x1, qx1);
  if (z0 < QUAY_COL_Z0) push(mx0, mx1, z0, QUAY_COL_Z0);
  if (z1 > QUAY_COL_Z1) push(mx0, mx1, QUAY_COL_Z1, z1);
  return out;
}
let pavementBodies = 0;
for (const footprint of pavementCols) {
  for (const p of pavementOutsideQuay(footprint)) {
    physWorld.addBody(new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: physGroundMat,
      shape: new CANNON.Box(new CANNON.Vec3(p.hx, PAVEMENT_HALF_Y, p.hz)),
      position: new CANNON.Vec3(p.x, p.top - PAVEMENT_HALF_Y, p.z),
    }));
    pavementBodies++;
  }
}

// Soft seawall curb (low) — slows sliding but toss clears into basin for buoyancy
const seawallLip = new CANNON.Body({
  mass: 0,
  material: physGroundMat,
  shape: new CANNON.Box(new CANNON.Vec3(11, 0.14, 0.12)),
  position: new CANNON.Vec3(0, 0.08, SEAWALL_Z + 0.05),
});
physWorld.addBody(seawallLip);

// Basin floor (deep) — safety net under the water; buoyancy keeps crates off it
const BASIN_FLOOR_Y = -2.4;
const basinFloor = new CANNON.Body({
  mass: 0,
  material: physGroundMat,
  shape: new CANNON.Box(new CANNON.Vec3(WATER_W * 0.5 + 0.5, 0.12, WATER_D * 0.5 + 0.5)),
  position: new CANNON.Vec3(0, BASIN_FLOOR_Y, WATER_NEAR_Z + WATER_D * 0.5),
});
physWorld.addBody(basinFloor);
// Side walls keep floaters in the night basin AABB
for (const [sx, sz, px, pz] of [
  [0.2, WATER_D * 0.5 + 0.4, -WATER_W * 0.5 - 0.15, WATER_NEAR_Z + WATER_D * 0.5],
  [0.2, WATER_D * 0.5 + 0.4,  WATER_W * 0.5 + 0.15, WATER_NEAR_Z + WATER_D * 0.5],
  [WATER_W * 0.5 + 0.4, 0.2, 0, WATER_NEAR_Z + WATER_D + 0.15],
]) {
  physWorld.addBody(new CANNON.Body({
    mass: 0,
    material: physGroundMat,
    shape: new CANNON.Box(new CANNON.Vec3(sx, 1.4, sz)),
    position: new CANNON.Vec3(px, -0.6, pz),
  }));
}

const ironMatStd = new THREE.MeshStandardMaterial({
  color: 0x2a2e3a, roughness: 0.88, metalness: 0.22,
});
const ironWarmStd = new THREE.MeshStandardMaterial({
  color: 0x3a3228, roughness: 0.9, metalness: 0.18,
});

// Hardware sheet — 06-intermediate-assets/quay-iron-atlas.png (+ normal, rough).
// Same freight-wear pass as the crates: scuff, rust, stencil fade. Not a metal tile.
// 2048×512, four square columns. UV v = 1 is the top of the image.
//   0 pole     signal poles, hangers, quay posts, strand posts, pennant masts
//   1 bollard  physics bollards, instanced bollards, signal bases
//   2 housing  traffic cabinets (SIGNAL)
//   3 arm      signal arms, visors, backs, quay lantern arms
// Cylinders and boxes already lay each face out in 0–1, so stamping that range
// into a column is enough. Lenses and the lit heads stay lamp materials.
// Instanced bollards/posts sample the same columns in furnMat (uCell).
const IRON_ATLAS_COLS = 4;
const IRON_CELL = { pole: 0, bollard: 1, housing: 2, arm: 3 };

function stampIronCell(geo, col) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  const du = 1 / IRON_ATLAS_COLS;
  const inset = 0.015;
  for (let i = 0; i < uv.count; i++) {
    const u = inset + uv.getX(i) * (1 - inset * 2);
    const v = inset + uv.getY(i) * (1 - inset * 2);
    uv.setXY(i, col * du + u * du, v);
  }
  uv.needsUpdate = true;
  geo.computeTangents();
}
stampIronCell(signalPoleGeo, IRON_CELL.pole);
stampIronCell(signalHangerGeo, IRON_CELL.pole);
stampIronCell(strandPostGeo, IRON_CELL.pole);
stampIronCell(signalBaseGeo, IRON_CELL.bollard);
stampIronCell(signalHousingGeo, IRON_CELL.housing);
stampIronCell(signalArmGeo, IRON_CELL.arm);
stampIronCell(signalBackGeo, IRON_CELL.arm);
stampIronCell(signalVisorGeo, IRON_CELL.arm);

function prepIronColor(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
function prepIronData(tex) {
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
window.__harborIron = {
  ready: false,
  atlas: '06-intermediate-assets/quay-iron-atlas.png',
  normal: '06-intermediate-assets/quay-iron-normal.png',
  rough: '06-intermediate-assets/quay-iron-rough.png',
  cols: IRON_ATLAS_COLS,
  cells: ['pole', 'bollard', 'housing', 'arm'],
};
const ironCache = location.protocol === 'file:' ? '' : '?v=iron1';
const ironWearMats = [signalIron, signalVisorMat, ironMatStd, ironWarmStd, strandPostMat];
// Dedicated sheets replace Studio's street-atlas row-2 crop on props only.
// The seed still runs; applyDedicatedPropWear puts these maps back on top.
const dedicatedPropWear = { iron: null, crate: null };
Promise.all([
  atlasLoader.loadAsync(new URL('quay-iron-atlas.png' + ironCache, atlasBase).href),
  atlasLoader.loadAsync(new URL('quay-iron-normal.png' + ironCache, atlasBase).href),
  atlasLoader.loadAsync(new URL('quay-iron-rough.png' + ironCache, atlasBase).href),
]).then(([color, normal, rough]) => {
  dedicatedPropWear.iron = {
    map: prepIronColor(color),
    normal: prepIronData(normal),
    rough: prepIronData(rough),
    size: `${color.image.width}x${color.image.height}`,
  };
  applyDedicatedPropWear();
}).catch((err) => {
  console.warn('Quay iron atlas failed — street-atlas iron crop remains', err);
});

// Fixed bollards (static) — collision posts crates can bounce off
const PHYS_BOLLARD_POS = [
  [-3.6, 0.04, 4.55],
  [-1.2, 0.04, 4.7],
  [1.8, 0.04, 4.5],
  [4.2, 0.04, 4.65],
];
const physBollardGeo = new THREE.CylinderGeometry(0.13, 0.17, 0.58, 10);
physBollardGeo.translate(0, 0.29, 0);
for (let i = 0; i < PHYS_BOLLARD_POS.length; i++) {
  const [x, y, z] = PHYS_BOLLARD_POS[i];
  const mesh = new THREE.Mesh(physBollardGeo, i % 2 ? ironWarmStd : ironMatStd);
  const body = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.STATIC,
    material: physGroundMat,
    shape: new CANNON.Box(new CANNON.Vec3(0.15, 0.29, 0.15)),
    position: new CANNON.Vec3(x, y + 0.29, z),
  });
  physAdd(mesh, body, 'bollard', 0);
}

// Hide a few instanced bollards near physics ones (avoid z-fight doubles)
(function hideOverlappingBollards() {
  const tmp = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  for (let i = 0; i < FURN_COUNT; i++) {
    bollards.getMatrixAt(i, tmp);
    pos.setFromMatrixPosition(tmp);
    for (const [px, , pz] of PHYS_BOLLARD_POS) {
      const dx = pos.x - px;
      const dz = pos.z - pz;
      if (dx * dx + dz * dz < 0.22 * 0.22) {
        dummy.position.copy(pos);
        dummy.scale.set(0.001, 0.001, 0.001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        bollards.setMatrixAt(i, dummy.matrix);
        break;
      }
    }
  }
  bollards.instanceMatrix.needsUpdate = true;
})();

// Hinged quay lanterns (select) — post + arm static, lantern PointToPoint
const PHYS_LANTERN_DEFS = [
  { post: [-5.4, 0.04, 3.85], armLen: 0.75, warm: true },
  { post: [2.4, 0.04, 3.85], armLen: 0.7, warm: false },
];
// Centered on the body. physSync copies the body center onto the mesh, so a
// +0.7 translate put the pole 0.7m above the deck and ran it through the arm.
const physPostGeo = new THREE.CylinderGeometry(0.05, 0.065, 1.4, 8);
const physArmGeo = new THREE.BoxGeometry(1, 0.06, 0.06);
const physCapitalGeo = new THREE.CylinderGeometry(0.07, 0.064, 0.1, 8);
stampIronCell(physBollardGeo, IRON_CELL.bollard);
stampIronCell(physPostGeo, IRON_CELL.pole);
stampIronCell(physArmGeo, IRON_CELL.arm);
stampIronCell(physCapitalGeo, IRON_CELL.pole);

for (let i = 0; i < PHYS_LANTERN_DEFS.length; i++) {
  const def = PHYS_LANTERN_DEFS[i];
  const [px, py, pz] = def.post;
  const postH = 1.4;
  const postTop = py + postH;
  // Capital (height 0.1) is centered here, 4mm above the post top, so the arm
  // leaves the middle of a socket and about 2cm of capital shows above the bar.
  const armY = postTop - 0.046;
  const armTipX = px + def.armLen * 0.5;

  const postMesh = new THREE.Mesh(physPostGeo, ironMatStd);
  const postBody = new CANNON.Body({
    mass: 0,
    material: physGroundMat,
    shape: new CANNON.Box(new CANNON.Vec3(0.06, postH * 0.5, 0.06)),
    position: new CANNON.Vec3(px, py + postH * 0.5, pz),
  });
  physAdd(postMesh, postBody, 'post', 0);

  const armMesh = new THREE.Mesh(physArmGeo, ironMatStd);
  armMesh.scale.x = def.armLen;
  const armBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(def.armLen * 0.5, 0.03, 0.03)),
    position: new CANNON.Vec3(armTipX, armY, pz),
  });
  physAdd(armMesh, armBody, 'arm', 0);

  const capital = new THREE.Mesh(physCapitalGeo, ironMatStd);
  capital.position.set(px, armY, pz);
  scene.add(capital);

  // Knob sits a few millimetres into the bail so the hang reads linked, not floating.
  // Cap stays clear of the arm (bail top 0.1825, cap top 0.157).
  const hookDrop = 0.11;
  const bailY = 0.174;
  const lx = px + def.armLen - 0.02;
  const ly = armY - hookDrop - bailY;
  const hook = new THREE.Group();
  hook.position.set(lx, armY - 0.03, pz);
  const hookStemGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.052, 6);
  stampIronCell(hookStemGeo, IRON_CELL.arm);
  const hookStem = new THREE.Mesh(hookStemGeo, ironMatStd);
  hookStem.position.y = -0.022;
  const hookKnobGeo = new THREE.SphereGeometry(0.018, 10, 8);
  stampIronCell(hookKnobGeo, IRON_CELL.arm);
  const hookKnob = new THREE.Mesh(hookKnobGeo, ironMatStd);
  hookKnob.position.y = -0.062;
  hook.add(hookStem, hookKnob);
  scene.add(hook);
  const lanternMesh = makeHarborLanternMesh(def.warm);

  const lanternMass = 0.55;
  const lanternBody = new CANNON.Body({
    mass: physFreeze ? 0 : lanternMass,
    material: physCrateMat,
    shape: new CANNON.Box(new CANNON.Vec3(0.11, 0.15, 0.11)),
    position: new CANNON.Vec3(lx, ly, pz),
    linearDamping: 0.12,
    angularDamping: 0.14,
    allowSleep: true,
  });
  if (physFreeze) lanternBody.type = CANNON.Body.STATIC;
  const lanternEntry = physAdd(lanternMesh, lanternBody, 'lantern', lanternMass);
  lanternEntry.halfExtents = new CANNON.Vec3(0.11, 0.15, 0.11);
  lanternEntry.armBody = armBody;
  lanternEntry.pivotA = new CANNON.Vec3(def.armLen * 0.5 - 0.02, -hookDrop, 0);
  lanternEntry.pivotB = new CANNON.Vec3(0, bailY, 0);
  physLanterns.push(lanternEntry);

  if (!physFreeze) {
    const c = new CANNON.PointToPointConstraint(
      armBody, lanternEntry.pivotA, lanternBody, lanternEntry.pivotB
    );
    physWorld.addConstraint(c);
    physConstraints.push(c);
    lanternEntry.constraint = c;
  }

  // Hide matching instanced lantern head + post near this hinge
  (function hideInstancedLamp() {
    const tmp = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (let j = 0; j < LANTERN_N; j++) {
      lanterns.getMatrixAt(j, tmp);
      pos.setFromMatrixPosition(tmp);
      if (Math.abs(pos.x - px) < 0.35 && Math.abs(pos.z - pz) < 0.35) {
        dummy.position.copy(pos);
        dummy.scale.set(0.001, 0.001, 0.001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        lanterns.setMatrixAt(j, dummy.matrix);
      }
    }
    lanterns.instanceMatrix.needsUpdate = true;
    for (let j = 0; j < 18; j++) {
      posts.getMatrixAt(j, tmp);
      pos.setFromMatrixPosition(tmp);
      if (Math.abs(pos.x - px) < 0.35 && Math.abs(pos.z - pz) < 0.35) {
        dummy.position.copy(pos);
        dummy.scale.set(0.001, 0.001, 0.001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        posts.setMatrixAt(j, dummy.matrix);
      }
    }
    posts.instanceMatrix.needsUpdate = true;
  })();
}

// Free crates — grab + toss. Masses stay the Rube plate signal (latch at 1.75:
// two ordinary crates, or one dense). Do not retune mass to fake buoyancy;
// density only sets draft, and halfExtents follow these sizes.
// Linear size is a quay crate against the ~0.60 door (tallest 0.24, under
// half a ground storey). The old 0.45–0.55 boxes read as half a shopfront.
//
// Wear atlas — 06-intermediate-assets/quay-crate-atlas.png (+ normal, rough).
// One shared photo sheet, freight-graf / street-ground wear, not a wood tile.
// 2560×2048, 5 columns × 4 rows, each cell 512×512.
// Columns follow HARBOR_CRATE_DEFS order (the paint family that used to be
// a flat color). Marks are original stencil only:
//   0 HARBOR cream · 1 SIGNAL taupe · 2 QUAY ochre · 3 FENESTRA · 4 HARBOR worn
// Rows, top of the PNG first (UV v = 1 is the top of the image):
//   0 front  → BoxGeometry +Z
//   1 back   → −Z
//   2 side   → +X, and −X with U mirrored. −Y (bottom) reuses this row, V-flipped.
//   3 lid    → +Y
// Each face cover-crops its square cell so the stencil isn't stretched onto a
// wide or flat box. A 2% inset keeps the bilinear filter off the neighbor cell.
// Normal + rough ship with the albedo: board-gap grooves and a matte/iron split
// catch the lanterns. Strength stays low so graffiti ink doesn't emboss.
const CRATE_ATLAS_COLS = 5;
const CRATE_ATLAS_ROWS = 4;
const CRATE_FACE_ROW = { front: 0, back: 1, side: 2, lid: 3 };
const CRATE_MARKS = ['HARBOR', 'SIGNAL', 'QUAY', 'FENESTRA', 'HARBOR'];

function crateFaceWindow(faceW, faceH) {
  const aspect = faceW / Math.max(faceH, 1e-4);
  let u0 = 0;
  let v0 = 0;
  let u1 = 1;
  let v1 = 1;
  if (aspect >= 1) {
    const hv = 1 / aspect;
    v0 = (1 - hv) * 0.5;
    v1 = v0 + hv;
  } else {
    const wu = aspect;
    u0 = (1 - wu) * 0.5;
    u1 = u0 + wu;
  }
  const inset = 0.02;
  return [
    u0 + (u1 - u0) * inset,
    v0 + (v1 - v0) * inset,
    u1 - (u1 - u0) * inset,
    v1 - (v1 - v0) * inset,
  ];
}

function crateAtlasUV(col, row, lu, lv) {
  const du = 1 / CRATE_ATLAS_COLS;
  const dv = 1 / CRATE_ATLAS_ROWS;
  return [
    col * du + lu * du,
    (1 - (row + 1) * dv) + lv * dv,
  ];
}

// BoxGeometry default segments: 6 faces × 4 verts, order +X −X +Y −Y +Z −Z.
function stampHarborCrateUVs(geo, col, sx, sy, sz) {
  const uv = geo.attributes.uv;
  const faces = [
    { row: CRATE_FACE_ROW.side, w: sz, h: sy, mirrorU: false, flipV: false },
    { row: CRATE_FACE_ROW.side, w: sz, h: sy, mirrorU: true, flipV: false },
    { row: CRATE_FACE_ROW.lid, w: sx, h: sz, mirrorU: false, flipV: false },
    { row: CRATE_FACE_ROW.side, w: sx, h: sz, mirrorU: false, flipV: true },
    { row: CRATE_FACE_ROW.front, w: sx, h: sy, mirrorU: false, flipV: false },
    { row: CRATE_FACE_ROW.back, w: sx, h: sy, mirrorU: false, flipV: false },
  ];
  const per = uv.count / faces.length;
  for (let f = 0; f < faces.length; f++) {
    const face = faces[f];
    const win = crateFaceWindow(face.w, face.h);
    for (let k = 0; k < per; k++) {
      const i = f * per + k;
      let u = uv.getX(i);
      let v = uv.getY(i);
      if (face.mirrorU) u = 1 - u;
      if (face.flipV) v = 1 - v;
      const lu = win[0] + u * (win[2] - win[0]);
      const lv = win[1] + v * (win[3] - win[1]);
      const at = crateAtlasUV(col, face.row, lu, lv);
      uv.setXY(i, at[0], at[1]);
    }
  }
  uv.needsUpdate = true;
  geo.computeTangents();
}

function makeCrateFallbackMap() {
  const cell = 256;
  const canvas = document.createElement('canvas');
  canvas.width = CRATE_ATLAS_COLS * cell;
  canvas.height = CRATE_ATLAS_ROWS * cell;
  const g = canvas.getContext('2d');
  const dyes = ['#d9d0c2', '#c4b8a6', '#a68448', '#b3a794', '#8a7562'];
  for (let col = 0; col < CRATE_ATLAS_COLS; col++) {
    for (let row = 0; row < CRATE_ATLAS_ROWS; row++) {
      const x = col * cell;
      const y = row * cell;
      g.fillStyle = dyes[col];
      g.fillRect(x, y, cell, cell);
      g.strokeStyle = 'rgba(36,28,20,0.38)';
      g.lineWidth = 2;
      for (let s = 16; s < cell; s += 26) {
        g.beginPath();
        g.moveTo(x + 6, y + s);
        g.lineTo(x + cell - 6, y + s);
        g.stroke();
      }
      g.strokeStyle = 'rgba(18,14,10,0.55)';
      g.strokeRect(x + 5, y + 5, cell - 10, cell - 10);
      if (row === 0) {
        g.fillStyle = 'rgba(18,14,12,0.84)';
        g.font = '700 26px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(CRATE_MARKS[col], x + cell * 0.5, y + cell * 0.52);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function prepCrateColor(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
function prepCrateData(tex) {
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const crateFallbackMap = makeCrateFallbackMap();
const crateWearMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: crateFallbackMap,
  roughness: 0.88,
  metalness: 0.04,
  emissive: 0xfff1dc,
  emissiveMap: crateFallbackMap,
  emissiveIntensity: 0.08,
});
window.__harborCrates = {
  ready: false,
  atlas: '06-intermediate-assets/quay-crate-atlas.png',
  normal: '06-intermediate-assets/quay-crate-normal.png',
  rough: '06-intermediate-assets/quay-crate-rough.png',
  cols: CRATE_ATLAS_COLS,
  rows: CRATE_ATLAS_ROWS,
  faces: ['front', 'back', 'side', 'lid'],
  marks: CRATE_MARKS.slice(),
};
const crateCache = location.protocol === 'file:' ? '' : '?v=cratewear1';
Promise.all([
  atlasLoader.loadAsync(new URL('quay-crate-atlas.png' + crateCache, atlasBase).href),
  atlasLoader.loadAsync(new URL('quay-crate-normal.png' + crateCache, atlasBase).href),
  atlasLoader.loadAsync(new URL('quay-crate-rough.png' + crateCache, atlasBase).href),
]).then(([color, normal, rough]) => {
  dedicatedPropWear.crate = {
    map: prepCrateColor(color),
    normal: prepCrateData(normal),
    rough: prepCrateData(rough),
    size: `${color.image.width}x${color.image.height}`,
  };
  applyDedicatedPropWear();
}).catch((err) => {
  console.warn('Quay crate atlas failed — canvas wear remains', err);
});

// Isolated prop path. Studio's applyStreetPropWear still crops street-atlas.png
// row 2 (iron col 0, crate col 1) onto these materials. When that seed lands
// after the dedicated sheets, put the richer maps back. Asphalt, sidewalk,
// and curb stay on loadStreetAtlas / streetPack.
function applyDedicatedPropWear() {
  const iron = dedicatedPropWear.iron;
  if (iron) {
    for (let i = 0; i < ironWearMats.length; i++) {
      const mat = ironWearMats[i];
      mat.map = iron.map;
      mat.normalMap = iron.normal;
      mat.normalScale.set(0.4, 0.4);
      mat.roughnessMap = iron.rough;
      mat.roughness = 1;
      mat.metalness = 0.32;
      mat.color.set(0xffffff);
      mat.emissive.set(0xfff1dc);
      mat.emissiveMap = iron.map;
      mat.emissiveIntensity = 0.07;
      mat.needsUpdate = true;
    }
    ironWarmStd.color.set(0xe4d4c4);
    furnMat.uniforms.uIron.value = iron.map;
    furnMat.uniforms.uIronOn.value = 1;
    quayPostMat.uniforms.uIron.value = iron.map;
    quayPostMat.uniforms.uIronOn.value = 1;
    window.__harborIron.ready = true;
    window.__harborIron.map = iron.size;
    window.__harborIron.live = signalIron.map && signalIron.map.image
      ? `${signalIron.map.image.width}x${signalIron.map.image.height}`
      : '';
    window.__harborIron.extends = 'street-atlas row2 col0';
  }
  const crate = dedicatedPropWear.crate;
  if (crate) {
    crateWearMat.map = crate.map;
    crateWearMat.emissiveMap = crate.map;
    crateWearMat.normalMap = crate.normal;
    crateWearMat.normalScale.set(0.65, 0.65);
    crateWearMat.roughnessMap = crate.rough;
    // Roughness map is absolute (G). Three multiplies by the scalar.
    crateWearMat.roughness = 1;
    crateWearMat.needsUpdate = true;
    window.__harborCrates.ready = true;
    window.__harborCrates.map = crate.size;
    window.__harborCrates.live = crateWearMat.map && crateWearMat.map.image
      ? `${crateWearMat.map.image.width}x${crateWearMat.map.image.height}`
      : '';
    window.__harborCrates.extends = 'street-atlas row2 col1';
  }
  if (live.syncBasinBatchWear) live.syncBasinBatchWear();
  if (stillMode && (iron || crate)) live.tick();
}
live.onStreetPropWear = applyDedicatedPropWear;

const HARBOR_CRATE_DEFS = [
  // mid — cream column 0, rides mid-high
  { size: [0.26, 0.24, 0.26], mass: 1.1, color: 0xe8dfd0, emissive: 0xf0c24b, ei: 0.05, pos: [-2.4, 0.9, 3.35], yaw: 0.2, label: 'mid' },
  // dense — taupe column 1, rides low with freeboard (must not sink)
  { size: [0.34, 0.18, 0.26], mass: 2.2, color: 0xd4cbb8, emissive: 0x8a7bb8, ei: 0.04, pos: [-0.3, 1.1, 3.55], yaw: -0.35, label: 'dense' },
  // light — ochre column 2, rides high
  { size: [0.22, 0.20, 0.22], mass: 0.7, color: 0xf0c24b, emissive: 0xf0c24b, ei: 0.1, pos: [1.5, 0.85, 3.25], yaw: 0.55, label: 'light' },
  // mid-heavy — column 3, low float, still clear of the basin floor
  { size: [0.28, 0.22, 0.24], mass: 1.8, color: 0xc8bda8, emissive: 0x8a7bb8, ei: 0.035, pos: [3.4, 1.0, 3.45], yaw: 0.1, label: 'mid' },
  // cork — worn column 4, very light, high bob
  { size: [0.24, 0.16, 0.24], mass: 0.45, color: 0xc4a574, emissive: 0xf0c24b, ei: 0.06, pos: [-4.1, 0.75, 3.5], yaw: -0.2, label: 'light' },
];

function makeHarborCrate(def, col) {
  const [sx, sy, sz] = def.size;
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  stampHarborCrateUVs(geo, col, sx, sy, sz);
  const mesh = new THREE.Mesh(geo, crateWearMat);
  mesh.name = `quay-crate-${col}`;
  const body = new CANNON.Body({
    mass: physFreeze ? 0 : def.mass,
    material: physCrateMat,
    shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)),
    position: new CANNON.Vec3(def.pos[0], def.pos[1], def.pos[2]),
    linearDamping: 0.14,
    angularDamping: 0.2,
    allowSleep: true,
  });
  body.quaternion.setFromEuler(0, def.yaw, 0);
  if (physFreeze) {
    body.type = CANNON.Body.STATIC;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    // Park on deck for stills
    body.position.y = sy / 2 + 0.06;
  }
  const entry = physAdd(mesh, body, 'crate', def.mass);
  entry.halfExtents = new CANNON.Vec3(sx / 2, sy / 2, sz / 2);
  entry.volume = sx * sy * sz;
  entry.density = def.mass / Math.max(entry.volume, 1e-4);
  entry.densityLabel = def.label || 'mid';
  entry.floatable = true;
  // Refresh spawn after still park
  entry.spawn.position.copy(body.position);
  entry.spawn.quaternion.copy(body.quaternion);
  physCrates.push(entry);
  return entry;
}
HARBOR_CRATE_DEFS.forEach((def, col) => makeHarborCrate(def, col));

// Grab / toss interaction (physics-props pattern)
const physRay = new THREE.Raycaster();
const physPointer = new THREE.Vector2();
const physDragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const physHit = new THREE.Vector3();
const physGrabTarget = new THREE.Vector3();
let physGrab = null;
let physSelected = null;

function physNdc(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  physPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  physPointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function physPick(e) {
  physNdc(e);
  physRay.setFromCamera(physPointer, camera);
  const meshes = physCrates.map((c) => c.mesh).concat(physLanterns.map((l) => l.mesh));
  const hits = physRay.intersectObjects(meshes, false);
  return hits.length ? hits[0] : null;
}

function physBeginGrab(e) {
  if (physFreeze || live.walkMode || live.tourMode) {
    window.__harborPropDist = null;
    return false;
  }
  const hit = physPick(e);
  window.__harborPropDist = hit ? hit.distance : null;
  // The street passer is not a crate. If he is the nearer surface, leave the
  // pointer for his drag. A closer crate or lantern still grabs as before.
  if (typeof live.walkerHitDistance === 'function') {
    const walkerDist = live.walkerHitDistance(e);
    if (walkerDist != null && (!hit || walkerDist < hit.distance - 1e-3)) return false;
  }
  if (!hit) return false;
  const entry = hit.object.userData.physEntry;
  if (!entry || entry.mass <= 0) return false;
  e.preventDefault();
  e.stopPropagation();
  controls.enabled = false;
  const worldHit = hit.point.clone();
  const localOffset = new CANNON.Vec3();
  entry.body.pointToLocalFrame(
    new CANNON.Vec3(worldHit.x, worldHit.y, worldHit.z),
    localOffset
  );
  physDragPlane.constant = -worldHit.y;
  physGrab = { entry, localOffset, planeY: worldHit.y };
  physSelected = entry;
  window.__physGrabbed = { kind: entry.kind, shard: !!entry.shard, mass: entry.mass };
  entry.body.wakeUp();
  entry.body.angularVelocity.scale(0.4, entry.body.angularVelocity);
  return true;
}

function physMoveGrab(e) {
  if (!physGrab) return;
  physNdc(e);
  physRay.setFromCamera(physPointer, camera);
  physDragPlane.constant = -physGrab.planeY;
  if (!physRay.ray.intersectPlane(physDragPlane, physHit)) return;
  physGrabTarget.copy(physHit);
  const body = physGrab.entry.body;
  const grabWorld = new CANNON.Vec3();
  body.pointToWorldFrame(physGrab.localOffset, grabWorld);
  const gain = 18;
  const damp = 6;
  body.velocity.set(
    (physGrabTarget.x - grabWorld.x) * gain - body.velocity.x * damp * 0.05,
    (physGrabTarget.y - grabWorld.y) * gain - body.velocity.y * damp * 0.05,
    (physGrabTarget.z - grabWorld.z) * gain - body.velocity.z * damp * 0.05
  );
}

function physEndGrab() {
  if (!physGrab) return;
  const body = physGrab.entry.body;
  const speed = body.velocity.length();
  if (speed > 0.05) {
    body.applyImpulse(
      new CANNON.Vec3(body.velocity.x * 0.1, body.velocity.y * 0.1, body.velocity.z * 0.1),
      physGrab.localOffset
    );
  }
  physGrab = null;
  window.__physGrabbed = null;
  if (!live.walkMode && !live.tourMode) controls.enabled = true;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  physBeginGrab(e);
}, true);
addEventListener('pointermove', physMoveGrab);
addEventListener('pointerup', physEndGrab);
addEventListener('pointercancel', physEndGrab);

function physToss() {
  if (physFreeze) return;
  const pool = physCrates.filter((c) => c.mass > 0 && !c.craft);
  if (!pool.length) return;
  const entry = (physSelected && physSelected.kind === 'crate' && physSelected.mass > 0)
    ? physSelected
    : pool[Math.floor(Math.random() * pool.length)];
  const body = entry.body;
  body.wakeUp();
  const he = entry.halfExtents || new CANNON.Vec3(0.25, 0.25, 0.25);
  const relativeOffset = new CANNON.Vec3(
    (Math.random() - 0.5) * he.x * 2,
    (Math.random() - 0.5) * he.y * 2,
    (Math.random() - 0.5) * he.z * 2
  );
  // Bias toss toward basin (+Z) a little
  const impulse = new CANNON.Vec3(
    (Math.random() - 0.5) * 4.5,
    1.8 + Math.random() * 2.4,
    1.5 + Math.random() * 3.5
  );
  body.applyImpulse(impulse, relativeOffset);
  body.angularVelocity.set(
    (Math.random() - 0.5) * 9,
    (Math.random() - 0.5) * 9,
    (Math.random() - 0.5) * 9
  );
  physSelected = entry;
  // Soft lantern tip
  for (const L of physLanterns) {
    if (!L.constraint) continue;
    L.body.wakeUp();
    L.body.applyImpulse(
      new CANNON.Vec3((Math.random() - 0.5) * 0.55, 0, (Math.random() - 0.5) * 0.55),
      new CANNON.Vec3(0, 0.12, 0)
    );
  }
}

function physReset() {
  for (const entry of physEntries) {
    if (entry.kind === 'bollard' || entry.kind === 'post' || entry.kind === 'arm') continue;
    const s = entry.spawn;
    entry.body.position.copy(s.position);
    entry.body.quaternion.copy(s.quaternion);
    entry.body.velocity.set(0, 0, 0);
    entry.body.angularVelocity.set(0, 0, 0);
    if (!physFreeze && entry.mass > 0) {
      entry.body.type = CANNON.Body.DYNAMIC;
      entry.body.mass = entry.mass;
      entry.body.updateMassProperties();
      entry.body.wakeUp();
    }
    physSync(entry);
  }
  physSelected = null;
  if (typeof shopGlassReset === 'function') shopGlassReset();
  if (typeof physHooks.onReset === 'function') physHooks.onReset();
  if (typeof rubeReset === 'function') rubeReset();
}

function physSetConstraint(on) {
  if (physFreeze) return;
  physConstraintOn = !!on;
  const btn = document.getElementById('props-constraint');
  if (btn) {
    btn.classList.toggle('on', physConstraintOn);
    btn.setAttribute('aria-pressed', physConstraintOn ? 'true' : 'false');
  }
  for (const L of physLanterns) {
    if (physConstraintOn) {
      if (!L.constraint) {
        L.constraint = new CANNON.PointToPointConstraint(
          L.armBody, L.pivotA, L.body, L.pivotB
        );
        physWorld.addConstraint(L.constraint);
        physConstraints.push(L.constraint);
      }
      L.body.wakeUp();
    } else {
      if (L.constraint) {
        physWorld.removeConstraint(L.constraint);
        const ix = physConstraints.indexOf(L.constraint);
        if (ix >= 0) physConstraints.splice(ix, 1);
        L.constraint = null;
      }
      L.body.wakeUp();
    }
  }
  refreshHarborPhysicsProbe();
}


// ——— Basin buoyancy (Archimedes) + light blast impulse · ladder step 3 ———
// Water plane = visual Gerstner mesh Y (WATER_Y). Force only inside basin AABB.
// Crate density = mass / volume. Water stays denser than every tossable crate
// (1.48× the heaviest) so draft stays a fraction of the box, not a sunk hull.
// Plate latch still sums mass (RUBE_MASS_THRESHOLD 1.75, resting contact), never draft.
function harborCrateDensity(def) {
  const [sx, sy, sz] = def.size;
  return def.mass / Math.max(sx * sy * sz, 1e-4);
}
const CRATE_DENSITY_MAX = HARBOR_CRATE_DEFS.reduce(
  (m, def) => Math.max(m, harborCrateDensity(def)),
  0
);
// 1.48× heaviest → dense equilibrium draft ~68% (freeboard above the chop).
const WATER_DENSITY = CRATE_DENSITY_MAX * 1.48;
// Cap lift so a light crate that dunks pops back instead of launching.
const BUOY_LIFT_CAP = 1.55;
const BUOY_DRAG_LINEAR = 3.4;
const BUOY_DRAG_ANGULAR = 2.1;
const BUOY_WAVE_COUPLE = 0.55; // bob from Gerstner amp
const basinBuoy = {
  on: !physFreeze,
  waterY: WATER_Y,
  density: WATER_DENSITY,
  aabb: {
    x0: -WATER_W * 0.5,
    x1:  WATER_W * 0.5,
    z0:  WATER_NEAR_Z,
    z1:  WATER_NEAR_Z + WATER_D,
    yBottom: BASIN_FLOOR_Y + 0.2,
  },
  submerged: 0,
  forceScratch: new CANNON.Vec3(),
  offsetScratch: new CANNON.Vec3(),
  blastOrigin: new CANNON.Vec3(0, WATER_Y, WATER_NEAR_Z + WATER_D * 0.35),
  blastImpulse: 14,
  blastRadius: 7.5,
  lastBlastAt: 0,
};

function basinSurfaceY(x, z, t) {
  // Match visual water base + small Gerstner-ish bob so crates don't float in air
  const amp = physFreeze ? 0 : WATER_AMP;
  if (amp <= 0) return basinBuoy.waterY;
  const phase = t * 0.48;
  const w1 = Math.sin(x * 0.42 + z * 0.15 - phase) * amp * 0.95;
  const w2 = Math.sin(-x * 0.23 + z * 0.42 - t * 0.65 + 1.3) * amp * 0.58;
  return basinBuoy.waterY + (w1 + w2) * BUOY_WAVE_COUPLE;
}

function crateInBasinXZ(p) {
  const a = basinBuoy.aabb;
  return p.x >= a.x0 && p.x <= a.x1 && p.z >= a.z0 && p.z <= a.z1;
}

const buoyLocalScratch = new CANNON.Vec3();
const buoyWorldScratch = new CANNON.Vec3();

/** World-space vertical half-extent of the oriented box (highest corner). */
function crateWorldHalfY(entry) {
  const he = entry.halfExtents || buoyLocalScratch;
  const body = entry.body;
  let h = 0;
  body.vectorToWorldFrame(buoyLocalScratch.set(he.x || 0.25, 0, 0), buoyWorldScratch);
  h += Math.abs(buoyWorldScratch.y);
  body.vectorToWorldFrame(buoyLocalScratch.set(0, he.y || 0.25, 0), buoyWorldScratch);
  h += Math.abs(buoyWorldScratch.y);
  body.vectorToWorldFrame(buoyLocalScratch.set(0, 0, he.z || 0.25), buoyWorldScratch);
  h += Math.abs(buoyWorldScratch.y);
  return Math.max(h, 1e-4);
}

/**
 * Submerged fraction against a flat water plane.
 * Uses the oriented vertical span so a tumbled crate's top corner, not its
 * unrotated height, decides whether it is still under.
 */
function submergedFraction(entry, surfaceY) {
  const halfH = crateWorldHalfY(entry);
  const y = entry.body.position.y;
  const top = y + halfH;
  const bot = y - halfH;
  if (bot >= surfaceY) return 0;
  if (top <= surfaceY) return 1;
  return (surfaceY - bot) / (2 * halfH);
}

function buoyancyApplyForces(t) {
  if (physFreeze || !basinBuoy.on) {
    basinBuoy.submerged = 0;
    return;
  }
  let wet = 0;
  const g = Math.abs(physWorld.gravity.y) || 9.82;
  for (const entry of physCrates) {
    if (!entry.floatable || entry.mass <= 0) continue;
    const body = entry.body;
    if (body.type !== CANNON.Body.DYNAMIC) continue;
    if (physGrab && physGrab.entry === entry) continue; // don't fight grab
    const p = body.position;
    if (!crateInBasinXZ(p)) continue;
    const surfaceY = basinSurfaceY(p.x, p.z, t);
    const halfH = crateWorldHalfY(entry);
    const top = p.y + halfH;
    const bot = p.y - halfH;
    let frac = 0;
    if (bot >= surfaceY) frac = 0;
    else if (top <= surfaceY) frac = 1;
    else frac = (surfaceY - bot) / (2 * halfH);
    if (frac <= 0) continue;
    wet++;
    const vol = entry.volume || (entry.halfExtents
      ? entry.halfExtents.x * entry.halfExtents.y * entry.halfExtents.z * 8
      : 0.1);
    const submergedVol = vol * frac;
    const weight = entry.mass * g;
    // Archimedes: F = ρ_water * V_sub * g upward.
    let Fb = basinBuoy.density * submergedVol * g;
    // Fully under: always net-positive so a crate cannot sleep on the floor.
    if (frac >= 0.995) Fb = Math.max(Fb, weight * 1.15);
    Fb = Math.min(Fb, weight * BUOY_LIFT_CAP);
    basinBuoy.forceScratch.set(0, Fb, 0);
    // Buoyancy center sits in the wet half. A small horizontal shift toward
    // the low side rolls a tumbled crate back toward an even keel.
    body.vectorToWorldFrame(buoyLocalScratch.set(0, 1, 0), buoyWorldScratch);
    const tiltH = Math.hypot(buoyWorldScratch.x, buoyWorldScratch.z);
    let ox = 0;
    let oz = 0;
    if (tiltH > 0.12) {
      const shift = Math.min(halfH * 0.18, 0.05) * Math.min(tiltH, 1);
      ox = -buoyWorldScratch.x / tiltH * shift;
      oz = -buoyWorldScratch.z / tiltH * shift;
    }
    const wetTop = Math.min(top, surfaceY);
    const centroidY = (bot + wetTop) * 0.5;
    basinBuoy.offsetScratch.set(ox, centroidY - p.y, oz);
    body.wakeUp();
    body.applyForce(basinBuoy.forceScratch, basinBuoy.offsetScratch);
    // Drag while wet — settles bob instead of perpetual thrash
    const damp = frac;
    body.velocity.x *= Math.max(0, 1 - BUOY_DRAG_LINEAR * damp * 0.016);
    body.velocity.y *= Math.max(0, 1 - BUOY_DRAG_LINEAR * damp * 0.02);
    body.velocity.z *= Math.max(0, 1 - BUOY_DRAG_LINEAR * damp * 0.016);
    body.angularVelocity.x *= Math.max(0, 1 - BUOY_DRAG_ANGULAR * damp * 0.016);
    body.angularVelocity.y *= Math.max(0, 1 - BUOY_DRAG_ANGULAR * damp * 0.016);
    body.angularVelocity.z *= Math.max(0, 1 - BUOY_DRAG_ANGULAR * damp * 0.016);
    // Moored craft: same lift as a crate, plus a painter so the hull stays in the basin.
    if (entry.craft && entry.moor) {
      const mx = entry.moor.x - p.x;
      const mz = entry.moor.z - p.z;
      const dist = Math.hypot(mx, mz);
      if (dist > 0.22) {
        const pull = entry.mass * 0.5 * Math.min(dist, 2);
        const inv = 1 / dist;
        basinBuoy.forceScratch.set(mx * inv * pull, 0, mz * inv * pull);
        basinBuoy.offsetScratch.set(0, 0, 0);
        body.applyForce(basinBuoy.forceScratch, basinBuoy.offsetScratch);
      }
      const q = body.quaternion;
      const fx = 2 * (q.x * q.z + q.w * q.y);
      const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      let dyaw = entry.moor.yaw - Math.atan2(fx, fz);
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      body.torque.y += dyaw * entry.mass * 0.28;
      body.angularVelocity.x *= 0.9;
      body.angularVelocity.z *= 0.9;
    }
  }
  basinBuoy.submerged = wet;
}

// Every physics substep, not once per animation frame. fixedStep() can run
// several 1/60 steps after a long frame; a single applyForce is cleared after
// the first of those, and the rest are gravity-only — dense and light crates
// both sink on mobile / hitch frames.
physWorld.addEventListener('preStep', () => {
  buoyancyApplyForces(performance.now() * 0.001);
});

function physBlast() {
  if (physFreeze) return;
  const now = performance.now();
  if (now - basinBuoy.lastBlastAt < 280) return; // light debounce
  basinBuoy.lastBlastAt = now;
  const origin = basinBuoy.blastOrigin;
  // Prefer blast near mean of wet crates; else basin mid
  let n = 0;
  let sx = 0, sz = 0;
  for (const entry of physCrates) {
    const p = entry.body.position;
    if (!crateInBasinXZ(p)) continue;
    const surfaceY = basinSurfaceY(p.x, p.z, now * 0.001);
    if (submergedFraction(entry, surfaceY) <= 0.05) continue;
    sx += p.x; sz += p.z; n++;
  }
  if (n > 0) {
    origin.x = sx / n;
    origin.z = sz / n;
  } else {
    origin.x = 0;
    origin.z = WATER_NEAR_Z + WATER_D * 0.35;
  }
  origin.y = basinBuoy.waterY;
  const R = basinBuoy.blastRadius;
  const strength = basinBuoy.blastImpulse;
  for (const entry of physCrates) {
    if (entry.mass <= 0 || entry.craft) continue;
    const body = entry.body;
    if (body.type !== CANNON.Body.DYNAMIC) continue;
    const p = body.position;
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const dz = p.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > R || dist < 1e-4) continue;
    const falloff = 1 - dist / R;
    const k = strength * falloff * falloff;
    const inv = 1 / dist;
    // Lateral shove across basin + slight lift
    const ix = dx * inv * k;
    const iy = Math.max(0.35, dy * inv * k * 0.45 + 1.2 * falloff);
    const iz = dz * inv * k;
    body.wakeUp();
    body.applyImpulse(new CANNON.Vec3(ix, iy, iz), new CANNON.Vec3(0, 0, 0));
    body.angularVelocity.set(
      (Math.random() - 0.5) * 4 * falloff,
      (Math.random() - 0.5) * 5 * falloff,
      (Math.random() - 0.5) * 4 * falloff
    );
  }
  // Soft lantern tip from blast pressure
  for (const L of physLanterns) {
    if (!L.constraint) continue;
    L.body.wakeUp();
    L.body.applyImpulse(
      new CANNON.Vec3((Math.random() - 0.5) * 0.4, 0.15, 0.25 + Math.random() * 0.3),
      new CANNON.Vec3(0, 0.12, 0)
    );
  }
  shopGlassBlast(origin, R);
  if (propsHint && !live.showHud) {
    propsHint.textContent = 'Blast · basin shove';
    propsHint.classList.add('on');
    setTimeout(() => {
      if (!live.showHud) {
        propsHint.textContent = 'Quay · crate → plate → lantern → Signal · shatter';
        propsHint.classList.remove('on');
      }
    }, 1600);
  }
}

// ——— Scene wind (crates + hinged lanterns; bollards / InstancedMesh untouched) ———
const WIND_CARDINALS = [
  { name: 'E', x: 1, z: 0 },
  { name: 'NE', x: 0.707, z: -0.707 },
  { name: 'N', x: 0, z: -1 },
  { name: 'NW', x: -0.707, z: -0.707 },
  { name: 'W', x: -1, z: 0 },
  { name: 'SW', x: -0.707, z: 0.707 },
  { name: 'S', x: 0, z: 1 },
  { name: 'SE', x: 0.707, z: 0.707 },
];
// Gentle night breeze. Default step stays under quay friction so crates
// rest; the top step can creep the lightest box, not launch it.
// Cork μN ≈ 2.2 N. Peak default crate force ≈ 1.3 N.
const WIND_STR_STEPS = [0.18, 0.32, 0.48, 0.72];
const WIND_CRATE_SCALE = 2.4;
const WIND_LANTERN_SCALE = 2.2; // soft nod; hinge stays intact
const harborWind = {
  on: !physFreeze,
  dirIdx: 0, // default E — along quay
  strIdx: 2,
  strength: WIND_STR_STEPS[2],
  gust: 1,
  dir: new CANNON.Vec3(1, 0, 0),
  forceScratch: new CANNON.Vec3(),
  torqueScratch: new CANNON.Vec3(),
  offsetScratch: new CANNON.Vec3(),
};

function windLabel() {
  if (!harborWind.on) return 'Wind off';
  const c = WIND_CARDINALS[harborWind.dirIdx];
  const dots = '·'.repeat(harborWind.strIdx + 1);
  return `Wind ${c.name} ${dots}`;
}

function windRefreshDir() {
  const c = WIND_CARDINALS[harborWind.dirIdx];
  harborWind.dir.set(c.x, 0, c.z);
  const btn = document.getElementById('props-wind');
  if (btn) btn.textContent = windLabel();
}

function windRefreshStr() {
  harborWind.strength = WIND_STR_STEPS[harborWind.strIdx];
  const btn = document.getElementById('props-wind');
  if (btn) btn.textContent = windLabel();
}

function windSetOn(on) {
  harborWind.on = !!on && !physFreeze;
  const btn = document.getElementById('props-wind');
  if (btn) {
    btn.classList.toggle('on', harborWind.on);
    btn.setAttribute('aria-pressed', harborWind.on ? 'true' : 'false');
    btn.textContent = windLabel();
    if (physFreeze) btn.disabled = true;
  }
  refreshHarborPhysicsProbe();
}

function windCycleDir(delta) {
  const n = WIND_CARDINALS.length;
  harborWind.dirIdx = (harborWind.dirIdx + delta + n) % n;
  windRefreshDir();
  refreshHarborPhysicsProbe();
}

function windCycleStr(delta) {
  const n = WIND_STR_STEPS.length;
  harborWind.strIdx = Math.max(0, Math.min(n - 1, harborWind.strIdx + delta));
  windRefreshStr();
  refreshHarborPhysicsProbe();
}

// rubeFillProbe is a hoisted function, so a typeof check is true during this
// init. const rubeState is declared later in the module — calling the probe
// here throws (TDZ) and the quay never draws. Arm the flag after rubeState.
let rubeProbeReady = false;

windRefreshDir();
windRefreshStr();
windSetOn(harborWind.on);

function windApplyForces(t) {
  if (physFreeze || !harborWind.on || harborWind.strength <= 0) {
    harborWind.gust = 0;
    return;
  }
  // Slow breath. Small amplitude, long period — no rapid gust spikes.
  const gust = 0.84
    + 0.06 * Math.sin(t * 0.36)
    + 0.03 * Math.sin(t * 0.15 + 1.7);
  harborWind.gust = gust;
  const base = harborWind.strength * gust;
  const dx = harborWind.dir.x;
  const dz = harborWind.dir.z;

  // Free crates — continuous linear force at COM (wake so they stay lively)
  for (const entry of physCrates) {
    if (entry.mass <= 0 || entry.craft) continue;
    const body = entry.body;
    if (body.type !== CANNON.Body.DYNAMIC) continue;
    // Light crates catch a little more air; keep it under static friction.
    const massFade = 0.78 + 0.22 * (0.85 / Math.max(entry.mass, 0.45));
    const f = base * WIND_CRATE_SCALE * massFade;
    harborWind.forceScratch.set(dx * f, f * 0.02, dz * f);
    body.wakeUp();
    body.applyForce(harborWind.forceScratch, harborWind.offsetScratch.set(0, 0, 0));
  }

  // Hinged lanterns — soft lateral force + tiny torque; keep hinge intact
  for (const L of physLanterns) {
    if (L.mass <= 0) continue;
    const body = L.body;
    if (body.type !== CANNON.Body.DYNAMIC) continue;
    const soft = base * WIND_LANTERN_SCALE;
    harborWind.forceScratch.set(dx * soft, soft * 0.05, dz * soft);
    // Apply slightly below COM so it sways rather than translating hard
    harborWind.offsetScratch.set(0, -0.1, 0);
    body.wakeUp();
    body.applyForce(harborWind.forceScratch, harborWind.offsetScratch);
    // Gentle torque so the lamp nods in wind (PointToPoint holds)
    harborWind.torqueScratch.set(-dz * soft * 0.35, 0, dx * soft * 0.35);
    body.applyTorque(harborWind.torqueScratch);
  }
  if (typeof physHooks.afterWind === 'function') {
    physHooks.afterWind(t, base, dx, dz);
  }

}

// ——— Breakable ground-floor shop glass ———
// Tossed crates, a grabbed shove, and the basin blast punch shop panes.
// Shards join physCrates so the existing grab / toss path can pick them up.
// Apartment rows are never masked. R clears the mask and the shards.
const SHOP_GLASS_Y0 = 0.10;
const SHOP_GLASS_Y1 = 0.70;
const shopShards = [];

function shopMarkBroken(id, face, slot) {
  if (id < 0 || id >= INSTANCE_COUNT || face < 0 || face > 3 || slot < 0 || slot > 15) return false;
  const i = ((face * 16 + slot) * INSTANCE_COUNT + id) * 4;
  if (shopBreakData[i] > 200) return false;
  shopBreakData[i] = shopBreakData[i + 1] = shopBreakData[i + 2] = shopBreakData[i + 3] = 255;
  shopBreakTex.needsUpdate = true;
  return true;
}

function shopSpawnShards(x, y, z, nx, ny, nz) {
  const palette = [0xb8c4d8, 0x9aa8c0, 0xd5dde8, 0xf0c24b, 0x8a9bb0];
  for (let i = 0; i < 5; i++) {
    const s = 0.045 + Math.random() * 0.06;
    const sy = s * (0.55 + Math.random() * 0.5);
    const sz = s * (0.7 + Math.random() * 0.45);
    const mass = 0.12 + Math.random() * 0.16;
    const color = palette[i % palette.length];
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.28 + Math.random() * 0.35, metalness: 0.08,
      transparent: true, opacity: 0.88,
      emissive: color, emissiveIntensity: 0.08,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, sy, sz), mat);
    if (i % 2 === 0) mesh.layers.enable(BLOOM_LAYER);
    const body = new CANNON.Body({
      mass: physFreeze ? 0 : mass,
      material: physCrateMat,
      shape: new CANNON.Box(new CANNON.Vec3(s * 0.5, sy * 0.5, sz * 0.5)),
      position: new CANNON.Vec3(
        x + nx * 0.05 + (Math.random() - 0.5) * 0.12,
        y + (Math.random() - 0.5) * 0.12,
        z + nz * 0.05 + (Math.random() - 0.5) * 0.12
      ),
      linearDamping: 0.14,
      angularDamping: 0.2,
      allowSleep: true,
    });
    if (!physFreeze) {
      body.velocity.set(
        nx * (1.1 + Math.random() * 1.6) + (Math.random() - 0.5) * 1.4,
        ny + 0.8 + Math.random() * 1.6,
        nz * (1.1 + Math.random() * 1.6) + (Math.random() - 0.5) * 1.4
      );
      body.angularVelocity.set(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      );
    }
    const entry = physAdd(mesh, body, 'crate', mass);
    entry.shard = true;
    entry.shopGlass = true;
    entry.halfExtents = new CANNON.Vec3(s * 0.5, sy * 0.5, sz * 0.5);
    entry.volume = s * sy * sz;
    entry.density = mass / Math.max(entry.volume, 1e-4);
    entry.densityLabel = 'light';
    entry.floatable = true;
    physCrates.push(entry);
    shopShards.push(entry);
  }
}

function shopGlassReset() {
  if (physGrab && physGrab.entry && physGrab.entry.shopGlass) {
    physGrab = null;
    window.__physGrabbed = null;
    if (typeof live.walkMode !== 'undefined' && typeof live.tourMode !== 'undefined' && !live.walkMode && !live.tourMode && controls) {
      controls.enabled = true;
    }
  }
  if (physSelected && physSelected.shopGlass) physSelected = null;
  for (const entry of shopShards) {
    physWorld.removeBody(entry.body);
    scene.remove(entry.mesh);
    const pi = physEntries.indexOf(entry);
    if (pi >= 0) physEntries.splice(pi, 1);
    const ci = physCrates.indexOf(entry);
    if (ci >= 0) physCrates.splice(ci, 1);
    if (entry.mesh.geometry) entry.mesh.geometry.dispose();
    if (entry.mesh.material && entry.mesh.material.dispose) entry.mesh.material.dispose();
  }
  shopShards.length = 0;
  shopBreakData.fill(0);
  shopBreakTex.needsUpdate = true;
}

function shopGlassScan() {
  for (const entry of physCrates) {
    if (!entry || entry.craft || entry.shopGlass || entry.shard || !(entry.mass > 0) || !entry.body) continue;
    if (entry.body.type !== CANNON.Body.DYNAMIC) continue;
    const p = entry.body.position;
    const v = entry.body.velocity;
    const held = physGrab && physGrab.entry === entry;
    const speed = Math.hypot(v.x, v.y, v.z);
    const prev = entry._shopPrev;
    if (!prev || speed < (held ? 1.15 : 2.05)) {
      if (!entry._shopPrev) entry._shopPrev = new CANNON.Vec3();
      entry._shopPrev.copy(p);
      continue;
    }
    const he = entry.halfExtents || { x: 0.25, y: 0.25, z: 0.25 };
    let best = null;
    for (let i = 0; i < harborBoxes.length; i++) {
      const b = harborBoxes[i];
      if (Math.abs(p.x - b.x) > b.w * 0.5 + 2.2) continue;
      if (Math.abs(p.z - b.z) > b.d * 0.5 + 2.2) continue;
      const faces = [
        { face: 0, outward: 1, p0: prev.x, p1: p.x, plane: b.x + b.w * 0.5, a0: prev.z - b.z, a1: p.z - b.z, limit: b.d * 0.5, vel: v.x, reach: he.x, nx: 1, nz: 0 },
        { face: 1, outward: -1, p0: prev.x, p1: p.x, plane: b.x - b.w * 0.5, a0: prev.z - b.z, a1: p.z - b.z, limit: b.d * 0.5, vel: v.x, reach: he.x, nx: -1, nz: 0 },
        { face: 2, outward: 1, p0: prev.z, p1: p.z, plane: b.z + b.d * 0.5, a0: prev.x - b.x, a1: p.x - b.x, limit: b.w * 0.5, vel: v.z, reach: he.z, nx: 0, nz: 1 },
        { face: 3, outward: -1, p0: prev.z, p1: p.z, plane: b.z - b.d * 0.5, a0: prev.x - b.x, a1: p.x - b.x, limit: b.w * 0.5, vel: v.z, reach: he.z, nx: 0, nz: -1 },
      ];
      for (const f of faces) {
        const d0 = (f.p0 - f.plane) * f.outward;
        const d1 = (f.p1 - f.plane) * f.outward;
        if (!(d0 > -0.02 && d1 < f.reach + 0.1 && d0 > d1 - 1e-4)) continue;
        if (f.vel * f.outward > -0.2) continue;
        const denom = d0 - d1;
        const t = Math.abs(denom) < 1e-4 ? 0 : d0 / denom;
        const tc = Math.min(1, Math.max(0, t));
        const along = f.a0 + (f.a1 - f.a0) * tc;
        const hy = prev.y + (p.y - prev.y) * tc;
        if (Math.abs(along) > f.limit - 0.05) continue;
        if (hy < SHOP_GLASS_Y0 - he.y || hy > SHOP_GLASS_Y1 + 0.02) continue;
        const slot = Math.floor(along / 0.76) + 8;
        if (slot < 0 || slot > 15) continue;
        const dist = Math.abs(d1);
        if (!best || dist < best.dist) {
          best = { id: i, face: f.face, slot, dist, hy, along, nx: f.nx, nz: f.nz, b };
        }
      }
    }
    if (best && shopMarkBroken(best.id, best.face, best.slot)) {
      const hy = Math.min(SHOP_GLASS_Y1 - 0.04, Math.max(SHOP_GLASS_Y0 + 0.05, best.hy));
      const x = best.nx !== 0 ? best.b.x + best.nx * (best.b.w * 0.5 + 0.06) : best.b.x + best.along;
      const z = best.nz !== 0 ? best.b.z + best.nz * (best.b.d * 0.5 + 0.06) : best.b.z + best.along;
      shopSpawnShards(x, hy, z, best.nx, 0.2, best.nz);
      if (best.nx !== 0) entry.body.velocity.x = best.nx * Math.max(0.35, Math.abs(v.x) * 0.22);
      else entry.body.velocity.z = best.nz * Math.max(0.35, Math.abs(v.z) * 0.22);
    }
    entry._shopPrev.copy(p);
  }
}

function shopGlassBlast(origin, radius) {
  const R = Math.min(radius || 4, 4.2);
  for (let i = 0; i < harborBoxes.length; i++) {
    const b = harborBoxes[i];
    const faces = [
      { face: 0, x: b.x + b.w * 0.5, z: b.z, nx: 1, nz: 0, along: origin.z - b.z, limit: b.d * 0.5 },
      { face: 1, x: b.x - b.w * 0.5, z: b.z, nx: -1, nz: 0, along: origin.z - b.z, limit: b.d * 0.5 },
      { face: 2, x: b.x, z: b.z + b.d * 0.5, nx: 0, nz: 1, along: origin.x - b.x, limit: b.w * 0.5 },
      { face: 3, x: b.x, z: b.z - b.d * 0.5, nx: 0, nz: -1, along: origin.x - b.x, limit: b.w * 0.5 },
    ];
    for (const f of faces) {
      const dx = f.x - origin.x;
      const dz = f.z - origin.z;
      if (Math.hypot(dx, (origin.y || 0.4) - 0.4, dz) > R) continue;
      if (dx * f.nx + dz * f.nz > 0.35) continue;
      const along = Math.max(-f.limit + 0.06, Math.min(f.limit - 0.06, f.along));
      const slot = Math.floor(along / 0.76) + 8;
      if (!shopMarkBroken(i, f.face, slot)) continue;
      const x = f.nx !== 0 ? f.x + f.nx * 0.06 : b.x + along;
      const z = f.nz !== 0 ? f.z + f.nz * 0.06 : b.z + along;
      shopSpawnShards(x, 0.42, z, f.nx, 0.55, f.nz);
    }
  }
}

window.__shopGlass = {
  broken() {
    let n = 0;
    for (let i = 0; i < shopBreakData.length; i += 4) if (shopBreakData[i] > 200) n++;
    return n;
  },
  shards: () => shopShards.length,
  reset: shopGlassReset,
  strike(id, face, slot, x, y, z, nx, nz) {
    if (shopMarkBroken(id, face, slot)) shopSpawnShards(x, y, z, nx || 0, 0.4, nz || 0);
    return { broken: window.__shopGlass.broken(), shards: shopShards.length };
  },
  // Swept crate vs one façade face. Used to confirm impact without a HUD control.
  cross(boxIdx, face) {
    const entry = physCrates.find((e) => e && !e.shard && !e.shopGlass && e.mass > 0 && e.body);
    const b = harborBoxes[boxIdx];
    if (!entry || !b) return { ok: false };
    const f = face | 0;
    const he = entry.halfExtents || { x: 0.25, y: 0.25, z: 0.25 };
    const y = 0.42;
    let nx = 0, nz = 0, ox = b.x, oz = b.z;
    if (f === 0) { nx = 1; ox = b.x + b.w * 0.5; }
    else if (f === 1) { nx = -1; ox = b.x - b.w * 0.5; }
    else if (f === 2) { nz = 1; oz = b.z + b.d * 0.5; }
    else { nz = -1; oz = b.z - b.d * 0.5; }
    const out = 0.35 + (nx ? he.x : he.z);
    entry._shopPrev = new CANNON.Vec3(ox + nx * out, y, oz + nz * out);
    entry.body.position.set(ox - nx * 0.08, y, oz - nz * 0.08);
    entry.body.velocity.set(-nx * 4.5, 0.1, -nz * 4.5);
    entry.body.wakeUp();
    shopGlassScan();
    return {
      ok: true,
      broken: window.__shopGlass.broken(),
      shards: shopShards.length,
      shard: shopShards[0] ? { shard: true, shopGlass: true, inCrates: physCrates.includes(shopShards[0]) } : null,
    };
  },
};

function physStep() {
  if (physFreeze) {
    for (const entry of physEntries) {
      entry.body.velocity.set(0, 0, 0);
      entry.body.angularVelocity.set(0, 0, 0);
      physSync(entry);
    }
    if (typeof physHooks.onFreezeSync === 'function') physHooks.onFreezeSync();
    return;
  }
  const _tBuoy = performance.now() * 0.001;
  windApplyForces(_tBuoy);
  if (typeof physHooks.beforeStep === 'function') physHooks.beforeStep();
  physWorld.fixedStep();
  for (const entry of physEntries) physSync(entry);
  shopGlassScan();
  if (typeof physHooks.afterStep === 'function') physHooks.afterStep();
  if (typeof rubeTick === 'function') rubeTick();
  if ((physStep._n = (physStep._n || 0) + 1) % 5 === 0) refreshHarborPhysicsProbe();
}

function refreshHarborPhysicsProbe() {
  const card = WIND_CARDINALS[harborWind.dirIdx];
  const windProbe = {
    on: harborWind.on && !physFreeze,
    strength: harborWind.strength,
    strIdx: harborWind.strIdx,
    cardinal: card.name,
    dir: { x: harborWind.dir.x, y: 0, z: harborWind.dir.z },
    gust: harborWind.gust,
    freeze: physFreeze,
  };
  window.__wind = windProbe;
  window.__harborPhysics = {
    engine: 'cannon-es',
    freeze: physFreeze,
    bodies: physEntries.length,
    bollards: physEntries.filter((e) => e.kind === 'bollard').length,
    lanterns: physLanterns.length,
    crates: physCrates.length,
    constraints: physConstraints.filter(Boolean).length,
    constraintKinds: physConstraintOn
      ? physLanterns.map(() => 'PointToPoint')
      : [],
    constraintOn: physConstraintOn,
    staticGround: 6 + pavementBodies, // quay + curb + basin + 3 walls + streets
    wind: windProbe,
    cratePos: physCrates.map((c) => ({
      x: +c.body.position.x.toFixed(3),
      y: +c.body.position.y.toFixed(3),
      z: +c.body.position.z.toFixed(3),
    })),
    lanternPos: physLanterns.map((L) => ({
      x: +L.body.position.x.toFixed(3),
      y: +L.body.position.y.toFixed(3),
      z: +L.body.position.z.toFixed(3),
    })),
    buoyancy: {
      on: basinBuoy.on && !physFreeze,
      waterY: basinBuoy.waterY,
      density: basinBuoy.density,
      submerged: basinBuoy.submerged,
      blastImpulse: basinBuoy.blastImpulse,
      crates: physCrates.map((c) => ({
        label: c.densityLabel,
        density: +(c.density || 0).toFixed(2),
        mass: c.mass,
      })),
    },
    rube: null,
    shatter: null,
  };
  window.__buoyancy = window.__harborPhysics.buoyancy;
  if (typeof physHooks.onProbe === 'function') physHooks.onProbe();
  if (rubeProbeReady) rubeFillProbe();
}
refreshHarborPhysicsProbe();

window.addEventListener('noctuary-props-toss', physToss);
window.addEventListener('noctuary-props-reset', physReset);
const propsTossBtn = document.getElementById('props-toss');
const propsResetBtn = document.getElementById('props-reset');
const propsConstraintBtn = document.getElementById('props-constraint');
if (propsTossBtn) propsTossBtn.addEventListener('click', physToss);
if (propsResetBtn) propsResetBtn.addEventListener('click', physReset);
if (propsConstraintBtn) {
  propsConstraintBtn.addEventListener('click', () => physSetConstraint(!physConstraintOn));
  if (physFreeze) {
    propsConstraintBtn.classList.remove('on');
    propsConstraintBtn.setAttribute('aria-pressed', 'false');
    propsConstraintBtn.disabled = true;
  }
}

const propsWindBtn = document.getElementById('props-wind');
if (propsWindBtn) {
  // Click toggles. Dir/strength keys stay ,/. and [/]; touch strip cycles the same events.
  propsWindBtn.addEventListener('click', () => windSetOn(!harborWind.on));
}
const windDirBtn = document.getElementById('wind-dir');
const windStrBtn = document.getElementById('wind-str');
if (windDirBtn) {
  windDirBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('noctuary-wind-dir', { detail: 1 }));
  });
  if (physFreeze) windDirBtn.disabled = true;
}
if (windStrBtn) {
  windStrBtn.addEventListener('click', () => {
    const n = WIND_STR_STEPS.length;
    const detail = harborWind.strIdx >= n - 1 ? -(n - 1) : 1;
    window.dispatchEvent(new CustomEvent('noctuary-wind-str', { detail }));
  });
  if (physFreeze) windStrBtn.disabled = true;
}
window.addEventListener('noctuary-wind-toggle', () => windSetOn(!harborWind.on));
window.addEventListener('noctuary-wind-dir', (ev) => windCycleDir(ev.detail || 1));
window.addEventListener('noctuary-wind-str', (ev) => windCycleStr(ev.detail || 1));
window.addEventListener('noctuary-props-blast', physBlast);
const propsBlastBtn = document.getElementById('props-blast');
if (propsBlastBtn) {
  propsBlastBtn.addEventListener('click', physBlast);
  if (physFreeze) propsBlastBtn.disabled = true;
}

// Soft toast: brief exhibit-only (no button row). Hidden whenever HUD chrome shows actions.
const propsHint = document.getElementById('props-hint');
function syncPropsHint(forceShow) {
  if (!propsHint) return;
  if (live.showHud || quayTouchControls()) { propsHint.classList.remove('on'); return; }
  if (forceShow) propsHint.classList.add('on');
  else propsHint.classList.remove('on');
}
if (propsHint && !physFreeze && !live.showHud && !quayTouchControls()) {
  propsHint.classList.add('on');
  setTimeout(() => { if (!live.showHud) propsHint.classList.remove('on'); }, 4200);
}
// ——— Signal beacon — product hero ShaderMaterial + halo ring ———
const signalGroup = new THREE.Group();
signalGroup.position.set(-6.5, 0, 3.2);
scene.add(signalGroup);

const signalMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uPulse: { value: 1 },
  },
  transparent: true,
  vertexShader: /* glsl */`
    varying vec2 vUv;
    varying vec3 vNormalW;
    varying vec3 vWorldPos;
    void main(){
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uTime;
    uniform float uPulse;
    varying vec2 vUv;
    varying vec3 vNormalW;
    varying vec3 vWorldPos;
    void main(){
      vec3 N = normalize(vNormalW);
      float ndl = clamp(dot(N, normalize(vec3(0.3, 0.8, 0.4))), 0.2, 1.0);
      vec3 body = vec3(0.12, 0.13, 0.18) * (0.5 + 0.5 * ndl);
      // vertical gold core
      float core = smoothstep(0.35, 0.0, abs(vUv.x - 0.5)) * (0.55 + 0.45 * uPulse);
      vec3 goldC = vec3(0.94, 0.76, 0.29);
      body = mix(body, goldC * 1.6, core * 0.85);
      // tip flare
      float tip = smoothstep(0.72, 1.0, vUv.y);
      body += goldC * tip * (1.1 + 0.5 * uPulse);
      float rim = pow(1.0 - max(dot(N, normalize(cameraPosition - vWorldPos)), 0.0), 2.0);
      body += goldC * rim * 0.35 * uPulse;
      gl_FragColor = vec4(body, 1.0);
    }
  `,
});
const beacon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.09, 0.15, 4.2, 12),
  signalMat
);
beacon.position.y = 2.1;
beacon.layers.enable(BLOOM_LAYER);
signalGroup.add(beacon);

const haloMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uPulse: { value: 1 },
  },
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uTime;
    uniform float uPulse;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float d = length(c) * 2.0;
      float ring = smoothstep(0.55, 0.72, d) * smoothstep(1.05, 0.82, d);
      float pulse = 0.55 + 0.45 * uPulse;
      float a = ring * pulse * 0.85;
      vec3 col = vec3(0.94, 0.76, 0.29) * (0.9 + 0.3 * sin(uTime * 1.5));
      // soft inner glow
      float glow = exp(-d * d * 2.2) * 0.35 * pulse;
      col += vec3(1.0, 0.85, 0.45) * glow;
      a = max(a, glow);
      gl_FragColor = vec4(col, a);
    }
  `,
});
const halo = new THREE.Mesh(new THREE.RingGeometry(0.55, 1.35, 48), haloMat);
halo.rotation.x = -Math.PI / 2;
halo.position.y = 0.08;
halo.layers.enable(BLOOM_LAYER);
signalGroup.add(halo);

const tipGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.22, 12, 10),
  new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPulse: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vN;
      void main(){
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uPulse;
      varying vec3 vN;
      void main(){
        float f = pow(1.0 - abs(vN.z), 1.5);
        vec3 col = vec3(1.0, 0.85, 0.4) * (1.2 * uPulse);
        gl_FragColor = vec4(col, 0.75 + 0.2 * f);
      }
    `,
  })
);
tipGlow.position.y = 4.25;
tipGlow.layers.enable(BLOOM_LAYER);
signalGroup.add(tipGlow);

const beaconLight = new THREE.PointLight(0xf0c24b, 16, 22, 2);
beaconLight.position.set(0, 4.0, 0);
signalGroup.add(beaconLight);

const signalWorld = new THREE.Vector3();
const signalChip = document.getElementById('signal-chip');

// ——— Soft springs (cannon-es Spring · tip / cables / banners) ———
// Soft distance constraints — NOT atlas wire. Atlases are a later pass.
const SPRING_COLLISION_GROUP = 4;
const SPRING_COLLISION_MASK = 0; // springy props ignore collisions (stay lively under wind)
const physSpringList = []; // CANNON.Spring[]
const physSpringBodies = []; // dynamic entries { mesh, body, kind, mass, spawn }
const physCableVisuals = []; // { line, positions Float32Array, getA(), getB() }
const physBannerSegs = []; // banner panel entries (wind targets)
let physSpringsOn = !physFreeze;
const springScratchA = new CANNON.Vec3();
const springScratchB = new CANNON.Vec3();
const springThreeA = new THREE.Vector3();
const springThreeB = new THREE.Vector3();
const springMid = new THREE.Vector3();
const springAxis = new THREE.Vector3();
const springQuat = new THREE.Quaternion();
const springYUp = new THREE.Vector3(0, 1, 0);

function springMakeBody(mesh, body, kind, mass) {
  if (mesh) {
    scene.add(mesh);
    mesh.userData.springKind = kind;
  }
  body.collisionFilterGroup = SPRING_COLLISION_GROUP;
  body.collisionFilterMask = SPRING_COLLISION_MASK;
  physWorld.addBody(body);
  const entry = {
    mesh, body, kind, mass,
    spawn: {
      position: body.position.clone(),
      quaternion: body.quaternion.clone(),
    },
  };
  if (mesh) mesh.userData.physEntry = entry;
  physSpringBodies.push(entry);
  if (mesh) {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  }
  return entry;
}

function springAdd(bodyA, bodyB, opts) {
  const s = new CANNON.Spring(bodyA, bodyB, opts);
  physSpringList.push(s);
  return s;
}

function springMakeCable(getA, getB, color) {
  const positions = new Float32Array(6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: color || 0xc4b49a,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  scene.add(line);
  // Thin cylinder companion (reads better than a 1px line at distance)
  const cylGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5);
  const cylMat = new THREE.MeshStandardMaterial({
    color: color || 0x8a8070, roughness: 0.72, metalness: 0.28,
  });
  const cyl = new THREE.Mesh(cylGeo, cylMat);
  scene.add(cyl);
  const vis = { line, cyl, positions, getA, getB };
  physCableVisuals.push(vis);
  return vis;
}

function springSyncCables() {
  if (typeof pennantDeformCloths === 'function') pennantDeformCloths();
  for (const vis of physCableVisuals) {
    vis.getA(springThreeA);
    vis.getB(springThreeB);
    const p = vis.positions;
    p[0] = springThreeA.x; p[1] = springThreeA.y; p[2] = springThreeA.z;
    p[3] = springThreeB.x; p[4] = springThreeB.y; p[5] = springThreeB.z;
    vis.line.geometry.attributes.position.needsUpdate = true;
    springMid.addVectors(springThreeA, springThreeB).multiplyScalar(0.5);
    springAxis.subVectors(springThreeB, springThreeA);
    const len = Math.max(springAxis.length(), 0.001);
    vis.cyl.position.copy(springMid);
    vis.cyl.scale.set(1, len, 1);
    springQuat.setFromUnitVectors(springYUp, springAxis.normalize());
    vis.cyl.quaternion.copy(springQuat);
    vis.cyl.visible = physSpringsOn || physFreeze;
    vis.line.visible = physSpringsOn || physFreeze;
  }
}

// —— Signal tip: soft spring (sways on wind; not rigid PointToPoint) ——
const tipAnchorWorld = new THREE.Vector3();
signalGroup.getWorldPosition(tipAnchorWorld);
tipAnchorWorld.y += 4.28;
const tipStatic = new CANNON.Body({
  mass: 0,
  type: CANNON.Body.STATIC,
  position: new CANNON.Vec3(tipAnchorWorld.x, tipAnchorWorld.y, tipAnchorWorld.z),
});
physWorld.addBody(tipStatic);
tipStatic.collisionFilterGroup = SPRING_COLLISION_GROUP;
tipStatic.collisionFilterMask = SPRING_COLLISION_MASK;

const tipMass = 0.12;
const tipBody = new CANNON.Body({
  mass: physFreeze ? 0 : tipMass,
  shape: new CANNON.Sphere(0.16),
  position: new CANNON.Vec3(tipAnchorWorld.x, tipAnchorWorld.y - 0.18, tipAnchorWorld.z),
  linearDamping: 0.12,
  angularDamping: 0.18,
  allowSleep: false,
});
if (physFreeze) tipBody.type = CANNON.Body.STATIC;
// Re-parent tipGlow onto scene so world sync is honest
signalGroup.remove(tipGlow);
const tipEntry = springMakeBody(tipGlow, tipBody, 'signalTip', tipMass);
const tipSpring = springAdd(tipStatic, tipBody, {
  restLength: 0.18,
  stiffness: 28,
  damping: 1.35,
  localAnchorA: new CANNON.Vec3(0, 0, 0),
  localAnchorB: new CANNON.Vec3(0, 0, 0),
});
springMakeCable(
  (out) => { out.set(tipStatic.position.x, tipStatic.position.y, tipStatic.position.z); },
  (out) => { out.set(tipBody.position.x, tipBody.position.y, tipBody.position.z); },
  0xf0c24b
);
// Keep beacon light near tip
beaconLight.position.set(0, 4.0, 0); // still parented to signalGroup (mast)

// —— Guy cables: mid-mast → bollard tops with hanging bob (two springs each) ——
const GUY_DEFS = [
  {
    mast: [-6.5, 2.35, 3.2],
    bollard: [-3.6, 0.72, 4.55],
    color: 0xb8a88c,
  },
  {
    mast: [-6.5, 1.85, 3.2],
    bollard: [-1.2, 0.72, 4.7],
    color: 0x9a8e78,
  },
];
for (const gd of GUY_DEFS) {
  const aBody = new CANNON.Body({
    mass: 0, type: CANNON.Body.STATIC,
    position: new CANNON.Vec3(gd.mast[0], gd.mast[1], gd.mast[2]),
  });
  aBody.collisionFilterGroup = SPRING_COLLISION_GROUP;
  aBody.collisionFilterMask = SPRING_COLLISION_MASK;
  physWorld.addBody(aBody);
  const bBody = new CANNON.Body({
    mass: 0, type: CANNON.Body.STATIC,
    position: new CANNON.Vec3(gd.bollard[0], gd.bollard[1], gd.bollard[2]),
  });
  bBody.collisionFilterGroup = SPRING_COLLISION_GROUP;
  bBody.collisionFilterMask = SPRING_COLLISION_MASK;
  physWorld.addBody(bBody);
  const mx = (gd.mast[0] + gd.bollard[0]) * 0.5;
  const my = (gd.mast[1] + gd.bollard[1]) * 0.5 - 0.22;
  const mz = (gd.mast[2] + gd.bollard[2]) * 0.5;
  const bobMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshStandardMaterial({ color: gd.color, roughness: 0.65, metalness: 0.35 })
  );
  const bobMass = 0.12;
  const bobBody = new CANNON.Body({
    mass: physFreeze ? 0 : bobMass,
    shape: new CANNON.Sphere(0.05),
    position: new CANNON.Vec3(mx, my, mz),
    linearDamping: 0.22,
    angularDamping: 0.3,
    allowSleep: false,
  });
  if (physFreeze) bobBody.type = CANNON.Body.STATIC;
  springMakeBody(bobMesh, bobBody, 'cableBob', bobMass);
  const restA = Math.hypot(gd.mast[0] - mx, gd.mast[1] - my, gd.mast[2] - mz);
  const restB = Math.hypot(gd.bollard[0] - mx, gd.bollard[1] - my, gd.bollard[2] - mz);
  springAdd(aBody, bobBody, { restLength: restA, stiffness: 55, damping: 2.0 });
  springAdd(bBody, bobBody, { restLength: restB, stiffness: 55, damping: 2.0 });
  springMakeCable(
    (out) => out.set(aBody.position.x, aBody.position.y, aBody.position.z),
    (out) => out.set(bobBody.position.x, bobBody.position.y, bobBody.position.z),
    gd.color
  );
  springMakeCable(
    (out) => out.set(bobBody.position.x, bobBody.position.y, bobBody.position.z),
    (out) => out.set(bBody.position.x, bBody.position.y, bBody.position.z),
    gd.color
  );
}

// —— Quay pennants: one tapered cloth per flag on a halyard ——
// Two short strings along the promenade. Each flag is a single subdivided
// trapezoid (no strip seams, no stepped leech). A short spring chain skins
// the sheet so the fly can bend; the hoist hem, grommets, and halyard stay
// thin hardware. Marks are original — Harbor, Signal house, Quay, Fenestra.
const PENNANT_PER_STRING = 3;
const PENNANT_NODES = 8;
const PENNANT_SUB_X = 7;
const PENNANT_SUB_Y = 16;
const PENNANT_CLOTH_LEN = 0.92;
const PENNANT_TIP_W = 0.05;
const PENNANT_TIE = 0.055;
const PENNANT_CABLE_Y = 2.68;
const PENNANT_POST_H = 2.74;
const PENNANT_MARGIN = 0.28;
const PENNANT_GAP = 0.11;
const PENNANT_MARKS = ['HARBOR', 'SIGNAL', 'QUAY', 'FENESTRA'];
// East string sits where the gold slab was; west string is seaward of the
// guy cables so the cloth clears Signal and the Rube chain.
const BANNER_DEFS = [
  {
    a: [4.15, 0.04, 4.32],
    b: [7.28, 0.04, 4.58],
    marks: [0, 1, 2],
  },
  {
    a: [-5.05, 0.04, 4.46],
    b: [-1.82, 0.04, 4.74],
    marks: [2, 3, 0],
  },
];

function makePennantFallbackMap() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d');
  const dyes = ['#7a3c34', '#1c1e28', '#163840', '#342846'];
  for (let i = 0; i < 4; i++) {
    g.fillStyle = dyes[i];
    g.fillRect(i * 256, 0, 256, 512);
    g.strokeStyle = 'rgba(242,235,224,0.07)';
    g.lineWidth = 1;
    for (let y = 0; y < 512; y += 4) {
      g.beginPath();
      g.moveTo(i * 256, y);
      g.lineTo(i * 256 + 256, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(242,235,224,0.92)';
    g.font = '700 40px sans-serif';
    g.textAlign = 'center';
    g.fillText(PENNANT_MARKS[i], i * 256 + 128, 210);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const pennantClothMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: makePennantFallbackMap(),
  roughness: 0.9,
  metalness: 0.03,
  emissive: 0xfff2d4,
  emissiveIntensity: 0.2,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 1,
  alphaTest: 0.18,
  depthWrite: true,
});
pennantClothMat.onBeforeCompile = (shader) => {
  shader.uniforms.uClothTime = { value: 0 };
  shader.uniforms.uClothGust = { value: 0.35 };
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float aHang;
       uniform float uClothTime;
       uniform float uClothGust;`
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float uCell = fract(uv.x * 4.0);
       float edge = abs(uCell - 0.5) * 2.0;
       // Fly and leech lead; the hoist stays quiet. Displacement is along the
       // cloth normal so a world-space sheet still ripples out of plane.
       float flutter = aHang * aHang * (0.28 + 0.72 * edge);
       float gust = max(uClothGust, 0.22);
       float phase = aHang * 7.5 + uClothTime * (1.55 + gust);
       float wave = sin(phase + edge * 2.2);
       float wave2 = sin(aHang * 13.0 - uClothTime * 2.35 + edge * 4.0);
       float amp = flutter * 0.062 * gust;
       transformed += normalize(normal) * (wave * 0.82 + wave2 * 0.28) * amp;`
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `#include <opaque_fragment>
     float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
     float thru = pow(1.0 - ndv, 1.65);
     gl_FragColor.rgb += diffuseColor.rgb * vec3(1.06, 0.82, 0.48) * thru * 0.36;
     gl_FragColor.a *= mix(0.76, 0.98, ndv);`
  );
  pennantClothMat.userData.shader = shader;
};
pennantClothMat.customProgramCacheKey = () => 'quay-pennant-cloth-v2';

function pennantSyncCloth(t) {
  const sh = pennantClothMat.userData.shader;
  if (!sh) return;
  sh.uniforms.uClothTime.value = t;
  const live = !physFreeze && harborWind.on;
  const gust = live ? harborWind.gust * (0.45 + harborWind.strength * 1.35) : 0.16;
  sh.uniforms.uClothGust.value = gust;
}

function prepPennantColor(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
function prepPennantData(tex) {
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
window.__pennantTex = { ready: false, marks: PENNANT_MARKS.slice() };
const pennantCache = location.protocol === 'file:' ? '' : '?v=pennant1';
Promise.all([
  atlasLoader.loadAsync(new URL('quay-pennant-atlas.png' + pennantCache, atlasBase).href),
  atlasLoader.loadAsync(new URL('quay-pennant-normal.png' + pennantCache, atlasBase).href),
  atlasLoader.loadAsync(new URL('quay-pennant-rough.png' + pennantCache, atlasBase).href),
]).then(([color, normal, rough]) => {
  const map = prepPennantColor(color);
  pennantClothMat.map = map;
  pennantClothMat.emissiveMap = map;
  pennantClothMat.normalMap = prepPennantData(normal);
  pennantClothMat.roughnessMap = prepPennantData(rough);
  pennantClothMat.needsUpdate = true;
  window.__pennantTex.ready = true;
}).catch((err) => {
  console.warn('Quay pennant atlas failed — canvas cloth remains', err);
});

const pennantRopeMat = new THREE.MeshStandardMaterial({
  color: 0x5a4a36, roughness: 0.9, metalness: 0.04,
});
const pennantBrass = new THREE.MeshStandardMaterial({
  color: 0x8a7044, roughness: 0.4, metalness: 0.72,
});
const pennantCordGeo = new THREE.CylinderGeometry(1, 1, 1, 5);
const pennantGrommetGeo = new THREE.TorusGeometry(0.015, 0.0042, 6, 10);
const pennantRig = new THREE.Group();
pennantRig.name = 'quay-pennants';
scene.add(pennantRig);

function pennantGrommet(mesh, x, y) {
  const g = new THREE.Mesh(pennantGrommetGeo, pennantBrass);
  g.position.set(x, y, 0.008);
  mesh.add(g);
  return g;
}
function pennantHalyardAt(a, b, t, target) {
  const sag = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI) * 0.1;
  target.set(
    a[0] + (b[0] - a[0]) * t,
    PENNANT_CABLE_Y - sag,
    a[2] + (b[2] - a[2]) * t,
  );
  return target;
}
function pennantWidthAt(headW, t) {
  return PENNANT_TIP_W + (headW - PENNANT_TIP_W) * (1 - t);
}
function makePennantClothGeo(headW, u0, u1) {
  const sx = PENNANT_SUB_X;
  const sy = PENNANT_SUB_Y;
  const vx = sx + 1;
  const vy = sy + 1;
  const positions = new Float32Array(vx * vy * 3);
  const uvs = new Float32Array(vx * vy * 2);
  const hang = new Float32Array(vx * vy);
  const indices = [];
  const uInset = 0.5 / 2048;
  const vInset = 0.5 / 1024;
  const uu0 = u0 + uInset;
  const uu1 = u1 - uInset;
  for (let r = 0; r < vy; r++) {
    const t = r / sy;
    const w = pennantWidthAt(headW, t);
    const v = (1 - vInset) + (vInset - (1 - vInset)) * t;
    for (let c = 0; c < vx; c++) {
      const s = c / sx;
      const i = r * vx + c;
      positions[i * 3] = (s - 0.5) * w;
      positions[i * 3 + 1] = -PENNANT_TIE - t * PENNANT_CLOTH_LEN;
      positions[i * 3 + 2] = 0;
      uvs[i * 2] = uu0 + (uu1 - uu0) * s;
      uvs[i * 2 + 1] = v;
      hang[i] = t;
    }
  }
  for (let r = 0; r < sy; r++) {
    for (let c = 0; c < sx; c++) {
      const i = r * vx + c;
      indices.push(i, i + vx, i + 1, i + 1, i + vx, i + vx + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aHang', new THREE.BufferAttribute(hang, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeTangents();
  return geo;
}
function pennantCatmull(out, p0, p1, p2, p3, f) {
  const f2 = f * f;
  const f3 = f2 * f;
  out.set(
    0.5 * ((2 * p1.x) + (-p0.x + p2.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3),
    0.5 * ((2 * p1.y) + (-p0.y + p2.y) * f + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3),
    0.5 * ((2 * p1.z) + (-p0.z + p2.z) * f + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * f2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * f3),
  );
  return out;
}
function pennantCatmullTan(out, p0, p1, p2, p3, f) {
  const f2 = f * f;
  out.set(
    0.5 * ((-p0.x + p2.x) + 2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f + 3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f2),
    0.5 * ((-p0.y + p2.y) + 2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f + 3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f2),
    0.5 * ((-p0.z + p2.z) + 2 * (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * f + 3 * (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * f2),
  );
  return out;
}
function pennantPin(bodyA, localA, bodyB, localB) {
  if (physFreeze) return;
  const hinge = new CANNON.PointToPointConstraint(bodyA, localA, bodyB, localB);
  physWorld.addConstraint(hinge);
  physConstraints.push(hinge);
}
function pennantSpring(bodyA, localA, bodyB, localB, stiffness, damping) {
  bodyA.pointToWorldFrame(localA, springScratchA);
  bodyB.pointToWorldFrame(localB, springScratchB);
  const dist = springScratchA.distanceTo(springScratchB);
  // Cannon springs divide by length — a coincident rest pose goes NaN and the cloth explodes.
  if (!Number.isFinite(dist) || dist < 0.008) return;
  springAdd(bodyA, bodyB, {
    restLength: dist,
    stiffness,
    damping,
    localAnchorA: localA,
    localAnchorB: localB,
  });
}
// Finial stays plain iron. A sphere's default UVs would smear the 4-column sheet.
const pennantFinialMat = new THREE.MeshStandardMaterial({
  color: 0x2a2e3a, roughness: 0.88, metalness: 0.22,
});
function addPennantPost(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const poleGeo = new THREE.CylinderGeometry(0.026, 0.04, PENNANT_POST_H, 8);
  stampIronCell(poleGeo, IRON_CELL.pole);
  const pole = new THREE.Mesh(poleGeo, ironMatStd);
  pole.position.y = 0.04 + PENNANT_POST_H * 0.5;
  const footGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.035, 8);
  stampIronCell(footGeo, IRON_CELL.bollard);
  const foot = new THREE.Mesh(footGeo, ironWarmStd);
  foot.position.y = 0.04 + 0.018;
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), pennantFinialMat);
  finial.position.y = 0.04 + PENNANT_POST_H + 0.02;
  const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.038), pennantBrass);
  cleat.position.y = PENNANT_CABLE_Y - 0.02;
  const eye = new THREE.Mesh(pennantGrommetGeo, pennantBrass);
  eye.position.y = PENNANT_CABLE_Y;
  eye.rotation.y = Math.PI * 0.5;
  g.add(pole, foot, finial, cleat, eye);
  pennantRig.add(g);
  const body = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(0.045, PENNANT_POST_H * 0.5, 0.045)),
    position: new CANNON.Vec3(x, 0.04 + PENNANT_POST_H * 0.5, z),
  });
  physWorld.addBody(body);
}

const pennantUp = new THREE.Vector3(0, 1, 0);
const pennantZ = new THREE.Vector3(0, 0, 1);
const pennantHead = new THREE.Vector3();
const pennantN = new THREE.Vector3();
const pennantAcross = new THREE.Vector3();
const pennantDown = new THREE.Vector3();
const pennantCenter = new THREE.Vector3();
const pennantCloths = [];
let pennantCount = 0;

function pennantPlaceRod(mesh, ax, ay, az, bx, by, bz, radius) {
  pennantCenter.set(ax + bx, ay + by, az + bz).multiplyScalar(0.5);
  pennantDown.set(bx - ax, by - ay, bz - az);
  const len = Math.max(pennantDown.length(), 0.001);
  mesh.position.copy(pennantCenter);
  mesh.scale.set(radius, len, radius);
  if (pennantDown.lengthSq() < 1e-8) pennantDown.copy(pennantUp);
  else pennantDown.multiplyScalar(1 / len);
  mesh.quaternion.setFromUnitVectors(pennantUp, pennantDown);
}

function pennantDeformCloths() {
  const sx = PENNANT_SUB_X;
  const sy = PENNANT_SUB_Y;
  const vx = sx + 1;
  for (let ci = 0; ci < pennantCloths.length; ci++) {
    const cloth = pennantCloths[ci];
    const nodes = cloth.nodes;
    const n = nodes.length;
    const pts = cloth.pts;
    for (let i = 0; i < n; i++) {
      const bp = nodes[i].body.position;
      pts[i].set(bp.x, bp.y, bp.z);
    }
    const pos = cloth.positions;
    let topAcrossX = cloth.right.x;
    let topAcrossY = cloth.right.y;
    let topAcrossZ = cloth.right.z;
    let topDownX = 0;
    let topDownY = -1;
    let topDownZ = 0;
    for (let r = 0; r <= sy; r++) {
      const t = r / sy;
      const u = t * (n - 1);
      let i0 = Math.floor(u);
      if (i0 >= n - 1) i0 = n - 2;
      const f = Math.min(1, Math.max(0, u - i0));
      const ia = i0 > 0 ? i0 - 1 : i0;
      const ib = i0;
      const ic = i0 + 1;
      const id = i0 + 2 < n ? i0 + 2 : ic;
      pennantCatmull(pennantCenter, pts[ia], pts[ib], pts[ic], pts[id], f);
      pennantCatmullTan(pennantDown, pts[ia], pts[ib], pts[ic], pts[id], f);
      if (pennantDown.lengthSq() < 1e-8) pennantDown.subVectors(pts[ic], pts[ib]);
      if (pennantDown.lengthSq() < 1e-8) pennantDown.set(0, -1, 0);
      else pennantDown.normalize();
      pennantAcross.crossVectors(cloth.forward, pennantDown);
      if (pennantAcross.lengthSq() < 1e-6) pennantAcross.copy(cloth.right);
      else pennantAcross.normalize();
      if (pennantAcross.dot(cloth.right) < 0) pennantAcross.negate();
      if (r === 0) {
        topAcrossX = pennantAcross.x;
        topAcrossY = pennantAcross.y;
        topAcrossZ = pennantAcross.z;
        topDownX = pennantDown.x;
        topDownY = pennantDown.y;
        topDownZ = pennantDown.z;
      }
      const w = pennantWidthAt(cloth.headW, t);
      for (let c = 0; c <= sx; c++) {
        const span = (c / sx - 0.5) * w;
        const idx = (r * vx + c) * 3;
        pos[idx] = pennantCenter.x + pennantAcross.x * span;
        pos[idx + 1] = pennantCenter.y + pennantAcross.y * span;
        pos[idx + 2] = pennantCenter.z + pennantAcross.z * span;
      }
    }
    const attr = cloth.geo.attributes.position;
    attr.needsUpdate = true;
    cloth.geo.computeVertexNormals();
    cloth.geo.computeTangents();

    const ax = pos[0];
    const ay = pos[1];
    const az = pos[2];
    const rgt = sx * 3;
    const bx = pos[rgt];
    const by = pos[rgt + 1];
    const bz = pos[rgt + 2];
    pennantAcross.set(topAcrossX, topAcrossY, topAcrossZ);
    pennantDown.set(topDownX, topDownY, topDownZ);
    pennantN.crossVectors(pennantAcross, pennantDown);
    if (pennantN.dot(cloth.forward) < 0) pennantN.negate();
    if (pennantN.lengthSq() < 1e-6) pennantN.copy(cloth.forward);
    else pennantN.normalize();
    const lift = 0.01;
    pennantPlaceRod(
      cloth.hem,
      ax + pennantN.x * lift, ay + pennantN.y * lift, az + pennantN.z * lift,
      bx + pennantN.x * lift, by + pennantN.y * lift, bz + pennantN.z * lift,
      0.0062
    );
    cloth.gL.position.set(ax, ay, az).addScaledVector(pennantN, 0.012);
    cloth.gR.position.set(bx, by, bz).addScaledVector(pennantN, 0.012);
    cloth.gL.quaternion.setFromUnitVectors(pennantZ, pennantN);
    cloth.gR.quaternion.copy(cloth.gL.quaternion);
  }
}

for (let si = 0; si < BANNER_DEFS.length; si++) {
  const bd = BANNER_DEFS[si];
  const span = Math.hypot(bd.b[0] - bd.a[0], bd.b[2] - bd.a[2]);
  const headW = (span - PENNANT_MARGIN * 2 - PENNANT_GAP * (PENNANT_PER_STRING - 1)) / PENNANT_PER_STRING;
  const right = new THREE.Vector3(bd.b[0] - bd.a[0], 0, bd.b[2] - bd.a[2]).normalize();
  const forward = new THREE.Vector3().crossVectors(right, pennantUp).normalize();
  const basisQ = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, pennantUp, forward)
  );
  addPennantPost(bd.a[0], bd.a[2]);
  addPennantPost(bd.b[0], bd.b[2]);

  const halyardPts = [];
  for (let s = 0; s <= 20; s++) {
    const p = new THREE.Vector3();
    pennantHalyardAt(bd.a, bd.b, s / 20, p);
    halyardPts.push(p);
  }
  const halyard = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(halyardPts), 24, 0.01, 5, false),
    pennantRopeMat
  );
  halyard.name = `quay-halyard-${si}`;
  pennantRig.add(halyard);
  // A small warm pool so the weave reads at night without turning the cloth into a lamp.
  const midT = 0.5;
  const poolPos = new THREE.Vector3();
  pennantHalyardAt(bd.a, bd.b, midT, poolPos);
  const pool = new THREE.PointLight(0xffc48a, 5.5, 6.5, 2);
  pool.position.set(poolPos.x, poolPos.y - 0.35, poolPos.z + 0.55);
  pennantRig.add(pool);

  for (let pi = 0; pi < PENNANT_PER_STRING; pi++) {
    const along = PENNANT_MARGIN + headW * 0.5 + pi * (headW + PENNANT_GAP);
    const tCenter = along / span;
    pennantHalyardAt(bd.a, bd.b, tCenter, pennantHead);
    const mark = bd.marks[pi] % 4;
    const u0 = mark / 4;
    const u1 = (mark + 1) / 4;
    const hitch = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      position: new CANNON.Vec3(pennantHead.x, pennantHead.y, pennantHead.z),
    });
    hitch.quaternion.set(basisQ.x, basisQ.y, basisQ.z, basisQ.w);
    hitch.collisionFilterGroup = SPRING_COLLISION_GROUP;
    hitch.collisionFilterMask = SPRING_COLLISION_MASK;
    physWorld.addBody(hitch);

    const geo = makePennantClothGeo(headW, u0, u1);
    const mesh = new THREE.Mesh(geo, pennantClothMat);
    mesh.frustumCulled = false;
    mesh.name = `quay-pennant-s${si}-p${pi}`;
    pennantRig.add(mesh);
    const hem = new THREE.Mesh(pennantCordGeo, pennantRopeMat);
    hem.name = `quay-pennant-hem-s${si}-p${pi}`;
    hem.frustumCulled = false;
    pennantRig.add(hem);
    const gL = pennantGrommet(pennantRig, pennantHead.x, pennantHead.y);
    const gR = pennantGrommet(pennantRig, pennantHead.x, pennantHead.y);
    gL.frustumCulled = false;
    gR.frustumCulled = false;
    const headTie = pennantHead.clone();
    const tie = (grommet) => {
      springMakeCable(
        (out) => out.copy(headTie),
        (out) => grommet.getWorldPosition(out),
        0x6a5840
      );
    };
    tie(gL);
    tie(gR);

    const nodes = [];
    const pts = [];
    for (let row = 0; row < PENNANT_NODES; row++) {
      const t = row / (PENNANT_NODES - 1);
      const yDrop = PENNANT_TIE + t * PENNANT_CLOTH_LEN;
      const wx = pennantHead.x - pennantUp.x * yDrop;
      const wy = pennantHead.y - pennantUp.y * yDrop;
      const wz = pennantHead.z - pennantUp.z * yDrop;
      const segMass = 0.068 - t * 0.028;
      const body = new CANNON.Body({
        mass: physFreeze ? 0 : segMass,
        shape: new CANNON.Sphere(0.03),
        position: new CANNON.Vec3(wx, wy, wz),
        linearDamping: 0.34 - t * 0.16,
        angularDamping: 0.5 - t * 0.22,
        allowSleep: false,
      });
      body.quaternion.set(basisQ.x, basisQ.y, basisQ.z, basisQ.w);
      if (physFreeze) body.type = CANNON.Body.STATIC;
      const entry = springMakeBody(null, body, 'bannerSeg', segMass);
      entry.bannerIdx = si;
      entry.pennantIdx = pennantCount;
      entry.segIdx = row;
      entry.row = row;
      entry.col = 0;
      entry.rows = PENNANT_NODES;
      entry.leech = t;
      nodes.push(entry);
      pts.push(new THREE.Vector3(wx, wy, wz));
      physBannerSegs.push(entry);
    }
    const origin = new CANNON.Vec3(0, 0, 0);
    const hitchLocal = new CANNON.Vec3();
    nodes[0].body.pointToWorldFrame(origin, springScratchA);
    hitch.pointToLocalFrame(springScratchA, hitchLocal);
    // Hold the hoist on the halyard. Joints meet at the shared edge — pinning
    // the centers would collapse the whole fly into one point.
    pennantPin(hitch, hitchLocal, nodes[0].body, origin);
    const step = PENNANT_CLOTH_LEN / (PENNANT_NODES - 1);
    const half = step * 0.5;
    for (let row = 0; row < PENNANT_NODES - 1; row++) {
      const t = (row + 1) / (PENNANT_NODES - 1);
      const a = new CANNON.Vec3(0, -half, 0);
      const b = new CANNON.Vec3(0, half, 0);
      pennantPin(nodes[row].body, a, nodes[row + 1].body, b);
      springAdd(nodes[row].body, nodes[row + 1].body, {
        restLength: step,
        stiffness: 16 - t * 8,
        damping: 1.9 - t * 0.35,
        localAnchorA: new CANNON.Vec3(0, 0, 0),
        localAnchorB: new CANNON.Vec3(0, 0, 0),
      });
    }
    // Skip links resist a hard fold. Weaker toward the tip so the fly streams.
    for (let row = 0; row < PENNANT_NODES - 2; row++) {
      const t = (row + 1) / (PENNANT_NODES - 1);
      pennantSpring(
        nodes[row].body, new CANNON.Vec3(0, 0, 0),
        nodes[row + 2].body, new CANNON.Vec3(0, 0, 0),
        28 - t * 16, 1.7
      );
    }
    pennantCloths.push({
      mesh,
      geo,
      positions: geo.attributes.position.array,
      nodes,
      pts,
      hem,
      gL,
      gR,
      headW,
      right,
      forward,
    });
    pennantCount++;
  }
}
pennantDeformCloths();
window.__harborPennants = {
  strings: BANNER_DEFS.length,
  pennants: pennantCount,
  segs: physBannerSegs.length,
  panelsPerPennant: 1,
  subdiv: [PENNANT_SUB_X, PENNANT_SUB_Y],
  nodes: PENNANT_NODES,
  marks: PENNANT_MARKS.slice(),
  atlas: '06-intermediate-assets/quay-pennant-atlas.png',
};

function springApplyForces() {
  if (physFreeze || !physSpringsOn) return;
  for (const s of physSpringList) s.applyForce();
}

function springWindPush(base, dx, dz) {
  if (physFreeze || !physSpringsOn || !harborWind.on) return;
  // Signal tip — lively lateral sway
  if (tipBody.type === CANNON.Body.DYNAMIC) {
    const soft = base * 3.2;
    tipBody.wakeUp();
    tipBody.applyForce(
      harborWind.forceScratch.set(dx * soft, soft * 0.08, dz * soft),
      harborWind.offsetScratch.set(0, 0, 0)
    );
  }
  // Cable bobs
  for (const entry of physSpringBodies) {
    if (entry.kind !== 'cableBob' || entry.body.type !== CANNON.Body.DYNAMIC) continue;
    const soft = base * 1.05;
    entry.body.wakeUp();
    entry.body.applyForce(
      harborWind.forceScratch.set(dx * soft, soft * 0.05, dz * soft),
      harborWind.offsetScratch.set(0, 0, 0)
    );
  }
  // Pennant chain — the fly catches more air. The sheet is one mesh skinned
  // to these nodes, so the extra force bends the cloth instead of a stack of panels.
  for (const entry of physBannerSegs) {
    if (entry.body.type !== CANNON.Body.DYNAMIC) continue;
    const rows = Math.max(1, entry.rows - 1);
    const tFly = entry.row / rows;
    // Quadratic so the fly streams and the hoist stays on the halyard.
    const catchF = 0.2 + tFly * tFly * 1.75;
    const soft = base * 1.42 * catchF;
    entry.body.wakeUp();
    entry.body.applyForce(
      harborWind.forceScratch.set(dx * soft, soft * 0.015, dz * soft),
      harborWind.offsetScratch.set(0, 0, 0)
    );
  }
}

function springSetOn(on) {
  physSpringsOn = !!on && !physFreeze;
  const btn = document.getElementById('props-springs');
  if (btn) {
    btn.classList.toggle('on', physSpringsOn);
    btn.setAttribute('aria-pressed', physSpringsOn ? 'true' : 'false');
    if (physFreeze) btn.disabled = true;
  }
  if (!physSpringsOn) {
    for (const entry of physSpringBodies) {
      entry.body.velocity.set(0, 0, 0);
      entry.body.angularVelocity.set(0, 0, 0);
      if (entry.mass > 0 && !physFreeze) {
        // Park at spawn when springs disabled (no force integration)
        entry.body.position.copy(entry.spawn.position);
        entry.body.quaternion.copy(entry.spawn.quaternion);
      }
      if (entry.mesh) {
        entry.mesh.position.copy(entry.body.position);
        entry.mesh.quaternion.copy(entry.body.quaternion);
      }
    }
  } else if (!physFreeze) {
    for (const entry of physSpringBodies) {
      if (entry.mass > 0) {
        entry.body.type = CANNON.Body.DYNAMIC;
        entry.body.mass = entry.mass;
        entry.body.updateMassProperties();
        entry.body.wakeUp();
      }
    }
  }
  springSyncCables();
  refreshHarborPhysicsProbe();
}

function springReset() {
  for (const entry of physSpringBodies) {
    entry.body.position.copy(entry.spawn.position);
    entry.body.quaternion.copy(entry.spawn.quaternion);
    entry.body.velocity.set(0, 0, 0);
    entry.body.angularVelocity.set(0, 0, 0);
    if (!physFreeze && entry.mass > 0 && physSpringsOn) {
      entry.body.type = CANNON.Body.DYNAMIC;
      entry.body.mass = entry.mass;
      entry.body.updateMassProperties();
      entry.body.wakeUp();
    }
    if (entry.mesh) {
      entry.mesh.position.copy(entry.body.position);
      entry.mesh.quaternion.copy(entry.body.quaternion);
    }
  }
  springSyncCables();
}

function springSyncMeshes() {
  for (const entry of physSpringBodies) {
    // Soft safety: park only if NaN / teleported; otherwise soft-cap speed
    const bp = entry.body.position;
    const speed = entry.body.velocity.length();
    if (!Number.isFinite(bp.x) || !Number.isFinite(bp.y) || !Number.isFinite(bp.z)
      || Math.abs(bp.x) > 40 || Math.abs(bp.y) > 40 || Math.abs(bp.z) > 40) {
      entry.body.position.copy(entry.spawn.position);
      entry.body.quaternion.copy(entry.spawn.quaternion);
      entry.body.velocity.set(0, 0, 0);
      entry.body.angularVelocity.set(0, 0, 0);
    } else if (entry.kind === 'bannerSeg' && speed > 2.4) {
      entry.body.velocity.scale(2.4 / speed, entry.body.velocity);
      const ang = entry.body.angularVelocity.length();
      if (ang > 2.8) entry.body.angularVelocity.scale(2.8 / ang, entry.body.angularVelocity);
    } else if (speed > 10) {
      entry.body.velocity.scale(10 / speed, entry.body.velocity);
    }
    if (entry.mesh) {
      entry.mesh.position.copy(entry.body.position);
      entry.mesh.quaternion.copy(entry.body.quaternion);
    }
  }
  if (tipBody && beaconLight) {
    beaconLight.position.set(
      tipBody.position.x - signalGroup.position.x,
      tipBody.position.y - signalGroup.position.y - 0.15,
      tipBody.position.z - signalGroup.position.z
    );
  }
  springSyncCables();
}

function springFillProbe() {
  const tipPos = tipBody
    ? {
        x: +tipBody.position.x.toFixed(3),
        y: +tipBody.position.y.toFixed(3),
        z: +tipBody.position.z.toFixed(3),
      }
    : null;
  const bannerTips = physBannerSegs
    .filter((e) => e.segIdx === 0 && e.col === 0)
    .map((e) => ({
      x: +e.body.position.x.toFixed(3),
      y: +e.body.position.y.toFixed(3),
      z: +e.body.position.z.toFixed(3),
    }));
  const springsProbe = {
    on: physSpringsOn && !physFreeze,
    freeze: physFreeze,
    count: physSpringList.length,
    bodies: physSpringBodies.length,
    cables: physCableVisuals.length,
    banners: BANNER_DEFS.length,
    pennants: bannerTips.length,
    bannerSegs: physBannerSegs.length,
    tip: tipPos,
    bannerTips,
    kinds: ['signalTip', 'cableBob', 'bannerSeg'],
  };
  window.__springs = springsProbe;
  if (window.__harborPhysics) {
    window.__harborPhysics.springs = springsProbe;
    window.__harborPhysics.springCount = physSpringList.length;
    const kinds = (window.__harborPhysics.constraintKinds || []).slice();
    // Strip prior Spring tags then re-add if on
    const base = kinds.filter((k) => k !== 'Spring');
    if (physSpringsOn && !physFreeze) {
      for (let i = 0; i < physSpringList.length; i++) base.push('Spring');
    }
    window.__harborPhysics.constraintKinds = base;
  }
}

physHooks.afterWind = (t, base, dx, dz) => {
  springWindPush(base, dx, dz);
};
physHooks.beforeStep = () => {
  springApplyForces();
};
physHooks.afterStep = () => {
  springSyncMeshes();
};
physHooks.onFreezeSync = () => {
  for (const entry of physSpringBodies) {
    entry.body.velocity.set(0, 0, 0);
    entry.body.angularVelocity.set(0, 0, 0);
    if (entry.mesh) {
      entry.mesh.position.copy(entry.body.position);
      entry.mesh.quaternion.copy(entry.body.quaternion);
    }
  }
  springSyncCables();
};
physHooks.onReset = () => {
  springReset();
};
physHooks.onProbe = () => {
  springFillProbe();
};

// ——— Rube Goldberg (ladder step 4) + shatter/debris-swap (step 5) ———
// Chain on quay: crate → pressure plate → hinged lantern tip → Signal pulse + pier gate.
// Night-concrete / fenestra taste. Uses existing crates / constraint / wind / springs / buoyancy.
// Shatter fires last when the gate finishes opening (debris-swap the fenestra vessel).
// The gate then closes on its own once that shatter has settled. R is still a full reset.
// Two ordinary crates (mid 1.1 + light 0.7 = 1.8) or one dense (2.2).
// Resting contact on the gold pad, not the old 2.5 center-in-box test.
const RUBE_MASS_THRESHOLD = 1.75;
const RUBE_LATCH_HOLD_MS = 280;
// After shatter settles, drop the pier gate without a manual reset.
// A few seconds lets the debris read; the cap covers a shard that keeps rolling.
const RUBE_GATE_CLOSE_MS = 3400;
const RUBE_GATE_CLOSE_CAP_MS = 6000;
// Promenade deck plane is y=0.04. Pad sits fully above it, on open deck
// left of Signal (x=-6.5) and clear of crate spawns.
const RUBE_DECK_Y = 0.04;
const RUBE_PLATE = { x: -9.46, z: 2.45, w: 2.9, d: 2.7, h: 0.05 };
const RUBE_GATE = { x: -5.15, z: 2.55, w: 1.35, h: 1.55, d: 0.12 };
const RUBE_VESSEL = { x: -4.55, y: 0.55, z: 2.88 };

const rubeState = {
  stage: 'idle', // idle | plate | lantern | gate | done
  plateMass: 0,
  plateResting: 0,
  platePressed: false,
  plateHoldSince: 0,
  plateBelowSince: 0,
  plateLatched: false,
  lanternFiredAt: 0,
  gateOpen: false,
  gateY: 0,
  gateClosedY: 0,
  gateOpenY: 0,
  shatterDone: false,
  shatterAt: 0,
  signalPulseUntil: 0,
  hintAt: 0,
};

// Pressure plate — gold slab on a night-concrete rim, fully above the deck.
// Large enough to read from the default orbit, with a slow warm breath.
const rubePlateMat = new THREE.MeshStandardMaterial({
  color: 0xffd36a,
  roughness: 0.34,
  metalness: 0.42,
  emissive: 0xffc14a,
  emissiveIntensity: 1.25,
});
const rubePlateRimMat = new THREE.MeshStandardMaterial({
  color: 0x2c313c,
  roughness: 0.86,
  metalness: 0.16,
  emissive: 0xf0c24b,
  emissiveIntensity: 0.55,
});
const rubePlateRimH = 0.06;
const rubePlateRim = new THREE.Mesh(
  new THREE.BoxGeometry(RUBE_PLATE.w + 0.18, rubePlateRimH, RUBE_PLATE.d + 0.18),
  rubePlateRimMat
);
rubePlateRim.position.set(
  RUBE_PLATE.x,
  RUBE_DECK_Y + 0.025 + rubePlateRimH * 0.5,
  RUBE_PLATE.z
);
rubePlateRim.renderOrder = 2;
scene.add(rubePlateRim);
const rubePlateMesh = new THREE.Mesh(
  new THREE.BoxGeometry(RUBE_PLATE.w, RUBE_PLATE.h, RUBE_PLATE.d),
  rubePlateMat
);
rubePlateMesh.position.set(
  RUBE_PLATE.x,
  rubePlateRim.position.y + rubePlateRimH * 0.5 + RUBE_PLATE.h * 0.5,
  RUBE_PLATE.z
);
rubePlateMesh.renderOrder = 3;
scene.add(rubePlateMesh);
const rubePlateTopY = rubePlateMesh.position.y + RUBE_PLATE.h * 0.5;
const rubePlateLight = new THREE.PointLight(0xffc14a, 1.35, 11, 2);
rubePlateLight.position.set(RUBE_PLATE.x, 1.35, RUBE_PLATE.z);
scene.add(rubePlateLight);

// Idle marker: thin gold mast + floating ring. Hidden once the chain leaves idle.
const rubePlateBeaconH = 2.4;
const rubePlateBeaconMat = new THREE.MeshStandardMaterial({
  color: 0xffd36a,
  roughness: 0.3,
  metalness: 0.4,
  emissive: 0xffc14a,
  emissiveIntensity: 1.7,
});
const rubePlateBeaconGeo = new THREE.CylinderGeometry(0.03, 0.045, rubePlateBeaconH, 10);
rubePlateBeaconGeo.translate(0, rubePlateBeaconH * 0.5, 0);
const rubePlateBeacon = new THREE.Mesh(rubePlateBeaconGeo, rubePlateBeaconMat);
rubePlateBeacon.position.set(RUBE_PLATE.x, rubePlateTopY + 0.02, RUBE_PLATE.z);
rubePlateBeacon.layers.enable(BLOOM_LAYER);
rubePlateBeacon.renderOrder = 4;
scene.add(rubePlateBeacon);
const rubePlateBeaconTip = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 12, 10),
  rubePlateBeaconMat
);
rubePlateBeaconTip.position.y = rubePlateBeaconH;
rubePlateBeaconTip.layers.enable(BLOOM_LAYER);
rubePlateBeacon.add(rubePlateBeaconTip);
const rubePlateRingMat = new THREE.MeshStandardMaterial({
  color: 0xffd36a,
  roughness: 0.28,
  metalness: 0.35,
  emissive: 0xffc14a,
  emissiveIntensity: 1.45,
});
const rubePlateRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.95, 0.03, 8, 56),
  rubePlateRingMat
);
rubePlateRing.rotation.x = Math.PI / 2;
rubePlateRing.position.set(RUBE_PLATE.x, rubePlateTopY + 1.45, RUBE_PLATE.z);
rubePlateRing.layers.enable(BLOOM_LAYER);
rubePlateRing.renderOrder = 4;
scene.add(rubePlateRing);

// Drop instanced posts / lanterns / bollards that would grow through the pad.
(function rubeClearPlateFurniture() {
  const halfW = RUBE_PLATE.w * 0.5 + 0.4;
  const halfD = RUBE_PLATE.d * 0.5 + 0.45;
  const tmp = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const shrink = (inst, n) => {
    for (let i = 0; i < n; i++) {
      inst.getMatrixAt(i, tmp);
      pos.setFromMatrixPosition(tmp);
      if (Math.abs(pos.x - RUBE_PLATE.x) < halfW && Math.abs(pos.z - RUBE_PLATE.z) < halfD) {
        dummy.position.copy(pos);
        dummy.scale.set(0.001, 0.001, 0.001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
  };
  shrink(bollards, FURN_COUNT);
  shrink(posts, 18);
  shrink(lanterns, LANTERN_N);
})();

// Sliding pier gate near Signal (kinematic) — night iron + gold accent bar
const rubeGateMat = new THREE.MeshStandardMaterial({
  color: 0x1c1f28,
  roughness: 0.78,
  metalness: 0.28,
  emissive: 0xf0c24b,
  emissiveIntensity: 0.04,
});
const rubeGateMesh = new THREE.Mesh(
  new THREE.BoxGeometry(RUBE_GATE.w, RUBE_GATE.h, RUBE_GATE.d),
  rubeGateMat
);
rubeState.gateClosedY = RUBE_GATE.h * 0.5 + 0.04;
rubeState.gateOpenY = rubeState.gateClosedY + RUBE_GATE.h + 0.12;
rubeState.gateY = rubeState.gateClosedY;
const rubeGateBody = new CANNON.Body({
  mass: 0,
  type: CANNON.Body.KINEMATIC,
  shape: new CANNON.Box(new CANNON.Vec3(RUBE_GATE.w * 0.5, RUBE_GATE.h * 0.5, RUBE_GATE.d * 0.5)),
  position: new CANNON.Vec3(RUBE_GATE.x, rubeState.gateClosedY, RUBE_GATE.z),
});
physWorld.addBody(rubeGateBody);
rubeGateMesh.position.copy(rubeGateBody.position);
scene.add(rubeGateMesh);
const rubeGateBar = new THREE.Mesh(
  new THREE.BoxGeometry(RUBE_GATE.w * 0.92, 0.06, RUBE_GATE.d + 0.02),
  new THREE.MeshStandardMaterial({
    color: 0xf0c24b, roughness: 0.4, metalness: 0.35,
    emissive: 0xf0c24b, emissiveIntensity: 0.35,
  })
);
rubeGateBar.position.y = RUBE_GATE.h * 0.18;
rubeGateMesh.add(rubeGateBar);
// Static gate posts (concrete taste)
for (const sx of [-1, 1]) {
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, RUBE_GATE.h + 0.25, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.9, metalness: 0.06 })
  );
  post.position.set(RUBE_GATE.x + sx * (RUBE_GATE.w * 0.5 + 0.14), (RUBE_GATE.h + 0.25) * 0.5, RUBE_GATE.z);
  scene.add(post);
  const postBody = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(0.08, (RUBE_GATE.h + 0.25) * 0.5, 0.09)),
    position: new CANNON.Vec3(post.position.x, post.position.y, post.position.z),
  });
  physWorld.addBody(postBody);
}

// Fenestra vessel — intact glass block on night-concrete plinth (shatter debris-swap target)
const rubePlinth = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.28, 0.42),
  new THREE.MeshStandardMaterial({ color: 0x2e333e, roughness: 0.88, metalness: 0.05 })
);
rubePlinth.position.set(RUBE_VESSEL.x, 0.14, RUBE_VESSEL.z);
scene.add(rubePlinth);
const rubeVesselMat = new THREE.MeshStandardMaterial({
  color: 0xb8c4d8,
  roughness: 0.18,
  metalness: 0.05,
  transparent: true,
  opacity: 0.72,
  emissive: 0x8a7bb8,
  emissiveIntensity: 0.12,
});
const rubeVesselMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.38, 0.28), rubeVesselMat);
rubeVesselMesh.position.set(RUBE_VESSEL.x, RUBE_VESSEL.y, RUBE_VESSEL.z);
rubeVesselMesh.layers.enable(BLOOM_LAYER);
scene.add(rubeVesselMesh);
// Thin mullion cross (fenestra read)
const rubeMullionMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.7, metalness: 0.2 });
rubeVesselMesh.add(
  new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.025), rubeMullionMat),
  new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.4, 0.025), rubeMullionMat),
  new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.3), rubeMullionMat)
);
const rubeDebris = []; // { mesh, body }

const rubeHeScratch = { x: 0, y: 0, z: 0 };
const rubePtScratch = { x: 0, y: 0, z: 0 };

function rubeWorldHe(entry) {
  const he = entry.halfExtents || { x: 0.25, y: 0.25, z: 0.25 };
  const q = entry.body.quaternion;
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const r00 = 1 - 2 * (y * y + z * z);
  const r01 = 2 * (x * y - z * w);
  const r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w);
  const r21 = 2 * (y * z + x * w);
  const r22 = 1 - 2 * (x * x + y * y);
  rubeHeScratch.x = Math.abs(r00) * he.x + Math.abs(r01) * he.y + Math.abs(r02) * he.z;
  rubeHeScratch.y = Math.abs(r10) * he.x + Math.abs(r11) * he.y + Math.abs(r12) * he.z;
  rubeHeScratch.z = Math.abs(r20) * he.x + Math.abs(r21) * he.y + Math.abs(r22) * he.z;
  return rubeHeScratch;
}

function rubeOverlapsPlate(entry) {
  const he = rubeWorldHe(entry);
  const hx = he.x;
  const hz = he.z;
  const p = entry.body.position;
  const overlapW = (RUBE_PLATE.w * 0.5 + hx) - Math.abs(p.x - RUBE_PLATE.x);
  const overlapD = (RUBE_PLATE.d * 0.5 + hz) - Math.abs(p.z - RUBE_PLATE.z);
  if (overlapW <= 0.04 || overlapD <= 0.04) return false;
  const foot = Math.max(hx * 2 * hz * 2, 1e-4);
  const area = Math.min(overlapW, hx * 2) * Math.min(overlapD, hz * 2);
  return area / foot >= 0.28;
}

function rubeContactOnPlate(contact) {
  rubePtScratch.x = contact.bi.position.x + contact.ri.x;
  rubePtScratch.z = contact.bi.position.z + contact.ri.z;
  return Math.abs(rubePtScratch.x - RUBE_PLATE.x) <= RUBE_PLATE.w * 0.5
    && Math.abs(rubePtScratch.z - RUBE_PLATE.z) <= RUBE_PLATE.d * 0.5;
}

// Resting weight only. A grab (physGrab) lifts that crate off the sum.
// physSelected is the last raycast hit and must not add or remove plate mass.
function rubeSamplePlateMass() {
  const held = physGrab && physGrab.entry;
  const crateByBody = new Map();
  for (const entry of physCrates) {
    if (!entry || entry.craft || !(entry.mass > 0) || !entry.body) continue;
    if (entry === held) continue;
    crateByBody.set(entry.body, entry);
  }
  const supported = new Set();
  const contacts = physWorld.contacts;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      let crate = null;
      let crateIsI = false;
      if (crateByBody.has(c.bi)) {
        crate = crateByBody.get(c.bi);
        crateIsI = true;
      } else if (crateByBody.has(c.bj)) {
        crate = crateByBody.get(c.bj);
      } else {
        continue;
      }
      if (supported.has(crate)) continue;
      // ni sign depends on which body is i. A support contact sits under the
      // crate and is mostly vertical — not a side bump against the quay.
      rubePtScratch.y = c.bi.position.y + c.ri.y;
      if (rubePtScratch.y > crate.body.position.y - 0.02) continue;
      if (Math.abs(c.ni.y) < 0.45) continue;
      if (!rubeContactOnPlate(c)) continue;
      const other = crateIsI ? c.bj : c.bi;
      const onDeck = other === quayDeckBody;
      const under = crateByBody.get(other);
      const onStack = !!(under && supported.has(under));
      if (!onDeck && !onStack) continue;
      if (!rubeOverlapsPlate(crate)) continue;
      supported.add(crate);
    }
  }
  let sum = 0;
  for (const entry of supported) sum += entry.mass;
  rubeState.plateResting = supported.size;
  return sum;
}

function rubeFireLantern() {
  // Tip the warm hinged lantern (index 0 @ -5.4) toward Signal / gate
  const L = physLanterns[0] || physLanterns[physLanterns.length - 1];
  if (!L || !L.body || physFreeze) return;
  if (!L.constraint && physConstraintOn) {
    // ensure hinge if player toggled off mid-chain — soft tip only when hinged
  }
  L.body.wakeUp();
  // Lateral impulse + slight lift so PointToPoint swings visibly
  const towardSignal = new CANNON.Vec3(-1.6, 0.35, -0.55);
  L.body.applyImpulse(towardSignal, new CANNON.Vec3(0.05, -0.08, 0.04));
  L.body.angularVelocity.x += 1.8;
  L.body.angularVelocity.z += -2.4;
  rubeState.lanternFiredAt = performance.now();
}

function rubePulseSignal(ms) {
  rubeState.signalPulseUntil = performance.now() + (ms || 2200);
  if (typeof beaconLight !== 'undefined' && beaconLight) {
    beaconLight.intensity = 28;
  }
  if (typeof tipGlow !== 'undefined' && tipGlow && tipGlow.material && tipGlow.material.uniforms) {
    tipGlow.material.uniforms.uPulse.value = 1.6;
  }
}

function rubeHint(msg) {
  if (!propsHint) return;
  propsHint.textContent = msg;
  if (!live.showHud && !quayTouchControls()) {
    propsHint.classList.add('on');
    rubeState.hintAt = performance.now();
  }
}

function rubeShardsSettled(speedLimit, angLimit) {
  for (let i = 0; i < rubeDebris.length; i++) {
    const body = rubeDebris[i].body;
    if (!body) continue;
    if (body.velocity.length() > speedLimit || body.angularVelocity.length() > angLimit) return false;
  }
  return true;
}

function rubeShatter() {
  if (rubeState.shatterDone || physFreeze) return;
  rubeState.shatterDone = true;
  rubeState.shatterAt = performance.now();
  rubeVesselMesh.visible = false;
  for (const ch of rubeVesselMesh.children) ch.visible = false;

  const palette = [0xb8c4d8, 0x8a7bb8, 0xf0c24b, 0xd4cbb8, 0x9aa8c0];
  const origin = rubeVesselMesh.position;
  for (let i = 0; i < 9; i++) {
    const s = 0.06 + Math.random() * 0.09;
    const mat = new THREE.MeshStandardMaterial({
      color: palette[i % palette.length],
      roughness: 0.35 + Math.random() * 0.4,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
      emissive: palette[i % palette.length],
      emissiveIntensity: 0.08,
    });
    const sy = s * (0.65 + Math.random() * 0.55);
    const sz = s * (0.75 + Math.random() * 0.45);
    const mass = 0.16 + Math.random() * 0.22;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, sy, sz), mat);
    if (i % 3 === 0) mesh.layers.enable(BLOOM_LAYER);
    const body = new CANNON.Body({
      mass: physFreeze ? 0 : mass,
      material: physCrateMat,
      shape: new CANNON.Box(new CANNON.Vec3(s * 0.5, sy * 0.5, sz * 0.5)),
      position: new CANNON.Vec3(
        origin.x + (Math.random() - 0.5) * 0.2,
        origin.y + (Math.random() - 0.3) * 0.2,
        origin.z + (Math.random() - 0.5) * 0.2
      ),
      linearDamping: 0.14,
      angularDamping: 0.2,
      allowSleep: true,
    });
    if (!physFreeze) {
      body.velocity.set(
        (Math.random() - 0.5) * 3.2,
        1.2 + Math.random() * 2.4,
        (Math.random() - 0.5) * 3.2
      );
      body.angularVelocity.set(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      );
    }
    // Same entry as a quay crate: physEntry + physCrates so raycast grab/toss hits it.
    const entry = physAdd(mesh, body, 'crate', mass);
    entry.shard = true;
    entry.halfExtents = new CANNON.Vec3(s * 0.5, sy * 0.5, sz * 0.5);
    entry.volume = s * sy * sz;
    entry.density = mass / Math.max(entry.volume, 1e-4);
    entry.densityLabel = 'light';
    entry.floatable = true;
    physCrates.push(entry);
    rubeDebris.push(entry);
  }
  rubeHint('Shatter · fenestra debris');
}

function rubeClearDebris() {
  if (physGrab && physGrab.entry && physGrab.entry.shard) {
    physGrab = null;
    window.__physGrabbed = null;
    if (!live.walkMode && !live.tourMode) controls.enabled = true;
  }
  if (physSelected && physSelected.shard) physSelected = null;
  for (const entry of rubeDebris) {
    physWorld.removeBody(entry.body);
    scene.remove(entry.mesh);
    const pi = physEntries.indexOf(entry);
    if (pi >= 0) physEntries.splice(pi, 1);
    const ci = physCrates.indexOf(entry);
    if (ci >= 0) physCrates.splice(ci, 1);
    if (entry.mesh.geometry) entry.mesh.geometry.dispose();
    if (entry.mesh.material && entry.mesh.material.dispose) entry.mesh.material.dispose();
  }
  rubeDebris.length = 0;
}

function rubeReset() {
  rubeState.stage = 'idle';
  rubeState.plateMass = 0;
  rubeState.plateResting = 0;
  rubeState.platePressed = false;
  rubeState.plateHoldSince = 0;
  rubeState.plateBelowSince = 0;
  rubeState.plateLatched = false;
  rubeState.lanternFiredAt = 0;
  rubeState.gateOpen = false;
  rubeState.gateY = rubeState.gateClosedY;
  rubeState.shatterDone = false;
  rubeState.shatterAt = 0;
  rubeState.signalPulseUntil = 0;
  rubeGateBody.position.y = rubeState.gateClosedY;
  rubeGateBody.velocity.set(0, 0, 0);
  rubeGateMesh.position.copy(rubeGateBody.position);
  rubePlateMat.emissiveIntensity = 1.25;
  rubePlateRimMat.emissiveIntensity = 0.55;
  rubePlateBeaconMat.emissiveIntensity = 1.7;
  rubePlateRingMat.emissiveIntensity = 1.45;
  rubePlateLight.intensity = 1.35;
  rubePlateBeacon.visible = true;
  rubePlateRing.visible = true;
  rubePlateRing.position.y = rubePlateTopY + 1.45;
  rubeGateMat.emissiveIntensity = 0.04;
  rubeClearDebris();
  rubeVesselMesh.visible = true;
  for (const ch of rubeVesselMesh.children) ch.visible = true;
  if (typeof beaconLight !== 'undefined' && beaconLight) beaconLight.intensity = 16;
  rubeHint('Quay · crate → plate → lantern → Signal · shatter');
  refreshHarborPhysicsProbe();
}

function rubeTick() {
  if (physFreeze) {
    rubeGateBody.position.y = rubeState.gateY;
    rubeGateMesh.position.copy(rubeGateBody.position);
    for (const d of rubeDebris) {
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);
    }
    return;
  }

  // Sync debris meshes
  for (const d of rubeDebris) {
    d.mesh.position.copy(d.body.position);
    d.mesh.quaternion.copy(d.body.quaternion);
  }

  // Signal pulse decay
  if (rubeState.signalPulseUntil > 0) {
    const left = rubeState.signalPulseUntil - performance.now();
    if (left <= 0) {
      rubeState.signalPulseUntil = 0;
      if (beaconLight) beaconLight.intensity = 16;
    } else if (beaconLight) {
      const k = left / 2200;
      beaconLight.intensity = 16 + 14 * k;
    }
  }

  // Fade chain hint
  if (rubeState.hintAt && performance.now() - rubeState.hintAt > 3800) {
    rubeState.hintAt = 0;
    if (propsHint && !live.showHud) propsHint.classList.remove('on');
  }

  rubeState.plateMass = rubeSamplePlateMass();
  const pressed = rubeState.plateMass >= RUBE_MASS_THRESHOLD - 1e-3;
  rubeState.platePressed = pressed;
  const nowMs = performance.now();
  if (rubeState.stage === 'idle') {
    if (pressed) {
      rubeState.plateBelowSince = 0;
      if (!rubeState.plateHoldSince) rubeState.plateHoldSince = nowMs;
    } else if (rubeState.plateHoldSince) {
      // A one-frame contact gap must not wipe a crate that is still sitting there.
      if (!rubeState.plateBelowSince) rubeState.plateBelowSince = nowMs;
      if (nowMs - rubeState.plateBelowSince > 160) {
        rubeState.plateHoldSince = 0;
        rubeState.plateBelowSince = 0;
      }
    }
  }
  const heldLongEnough = rubeState.plateHoldSince
    && nowMs - rubeState.plateHoldSince >= RUBE_LATCH_HOLD_MS;
  const t = Math.min(1, rubeState.plateMass / RUBE_MASS_THRESHOLD);
  const breathe = 0.5 + 0.5 * Math.sin(performance.now() * 0.00115);
  rubePlateMat.emissiveIntensity = 1.05 + breathe * 0.5 + t * 0.4;
  rubePlateRimMat.emissiveIntensity = 0.38 + breathe * 0.28 + t * 0.16;
  rubePlateLight.intensity = 1.05 + breathe * 0.55 + t * 1.2;
  const marking = rubeState.stage === 'idle';
  rubePlateBeacon.visible = marking;
  rubePlateRing.visible = marking;
  if (marking) {
    rubePlateBeaconMat.emissiveIntensity = 1.35 + breathe * 0.7;
    rubePlateRingMat.emissiveIntensity = 1.15 + breathe * 0.65;
    rubePlateRing.position.y = rubePlateTopY + 1.38 + breathe * 0.14;
    const rs = 0.96 + breathe * 0.08;
    rubePlateRing.scale.set(rs, rs, rs);
  }

  // Stage machine — one-shot chain until Reset. Latch only after weight
  // has been resting on the plate; grabbing a crate elsewhere does not press it.
  // Once latched, the chain runs through to shatter even if a crate is lifted off.
  if (rubeState.stage === 'idle' && pressed && heldLongEnough) {
    rubeState.stage = 'plate';
    rubeState.plateLatched = true;
    rubeFireLantern();
    rubeState.stage = 'lantern';
    rubeHint('Rube · plate → lantern tip');
  }

  if (rubeState.stage === 'lantern') {
    const L = physLanterns[0] || physLanterns[physLanterns.length - 1];
    const elapsed = performance.now() - rubeState.lanternFiredAt;
    let swung = elapsed > 420;
    if (L && L.body) {
      const spd = L.body.velocity.length() + L.body.angularVelocity.length() * 0.35;
      if (spd > 1.1) swung = true;
    }
    if (swung || elapsed > 900) {
      rubePulseSignal(2400);
      rubeState.gateOpen = true;
      rubeState.stage = 'gate';
      rubeGateMat.emissiveIntensity = 0.22;
      rubeHint('Rube · lantern → Signal / gate');
    }
  }

  // Gate motion
  const targetY = rubeState.gateOpen ? rubeState.gateOpenY : rubeState.gateClosedY;
  const speed = 2.2;
  // approx dt via fixed step feel
  rubeState.gateY += (targetY - rubeState.gateY) * Math.min(1, speed * (1 / 60) * 3.2);
  if (Math.abs(targetY - rubeState.gateY) < 0.003) rubeState.gateY = targetY;
  rubeGateBody.position.y = rubeState.gateY;
  rubeGateBody.velocity.set(0, 0, 0);
  rubeGateMesh.position.copy(rubeGateBody.position);

  if (rubeState.stage === 'gate' && rubeState.gateOpen
    && Math.abs(rubeState.gateY - rubeState.gateOpenY) < 0.02) {
    rubeState.stage = 'done';
    rubeShatter(); // ladder step 5 — debris-swap last
  }

  // Gate closes on its own once shatter has settled. Stage stays done so a
  // crate still on the plate does not replay the chain. R remains the full
  // plate / lantern / gate / vessel / shard reset.
  if (rubeState.stage === 'done' && rubeState.gateOpen && rubeState.shatterAt) {
    const age = nowMs - rubeState.shatterAt;
    const settled = age >= RUBE_GATE_CLOSE_CAP_MS
      || (age >= RUBE_GATE_CLOSE_MS && rubeShardsSettled(0.55, 1.4));
    if (settled) {
      rubeState.gateOpen = false;
      rubeGateMat.emissiveIntensity = 0.04;
    }
  }
}

function rubeFillProbe() {
  const probe = {
    ladder: { step4: 'rube', step5: 'shatter' },
    stage: rubeState.stage,
    plateMass: +rubeState.plateMass.toFixed(2),
    plateResting: rubeState.plateResting,
    plate: {
      x: RUBE_PLATE.x,
      y: +rubePlateMesh.position.y.toFixed(3),
      z: RUBE_PLATE.z,
      w: RUBE_PLATE.w,
      d: RUBE_PLATE.d,
      top: +rubePlateTopY.toFixed(3),
      rimBottom: +(rubePlateRim.position.y - rubePlateRimH * 0.5).toFixed(3),
      deckY: RUBE_DECK_Y,
      beacon: rubePlateBeacon.visible,
      ringY: +rubePlateRing.position.y.toFixed(3),
    },
    threshold: RUBE_MASS_THRESHOLD,
    platePressed: rubeState.platePressed,
    plateHoldMs: rubeState.plateHoldSince ? Math.max(0, performance.now() - rubeState.plateHoldSince) : 0,
    plateLatched: rubeState.plateLatched,
    gateOpen: rubeState.gateOpen,
    gateY: +rubeState.gateY.toFixed(3),
    shatterDone: rubeState.shatterDone,
    debris: rubeDebris.length,
    chain: 'crate → plate → lantern → Signal/gate → shatter',
  };
  window.__rube = probe;
  window.__rubeShatter = rubeShatter;
  window.__shatter = {
    done: rubeState.shatterDone,
    debris: rubeDebris.length,
    vesselVisible: rubeVesselMesh.visible,
    pickable: rubeDebris.filter((d) => d.kind === 'crate' && d.mass > 0 && d.mesh && d.mesh.userData.physEntry).length,
    shards: rubeDebris.map((d) => ({
      x: +d.body.position.x.toFixed(3),
      y: +d.body.position.y.toFixed(3),
      z: +d.body.position.z.toFixed(3),
      mass: d.mass,
    })),
  };
  if (window.__harborPhysics) {
    window.__harborPhysics.rube = probe;
    window.__harborPhysics.shatter = window.__shatter;
  }
}

// Initial probe — safe to read rubeState / vessel / debris from here on
rubeProbeReady = true;
rubeFillProbe();
window.__frameRube = (mode) => {
  // Camera helper: plate | gate | vessel | chain
  const c = controls && controls.target ? controls : null;
  if (!c) return;
  if (mode === 'gate' || mode === 'signal') {
    camera.position.set(-2.2, 2.4, 6.2);
    controls.target.set(RUBE_GATE.x, 1.0, RUBE_GATE.z);
  } else if (mode === 'vessel' || mode === 'shatter') {
    camera.position.set(-2.8, 2.0, 5.8);
    controls.target.set(RUBE_VESSEL.x, 0.6, RUBE_VESSEL.z);
  } else {
    camera.position.set(-1.5, 2.6, 7.0);
    controls.target.set(RUBE_PLATE.x, 0.4, RUBE_PLATE.z);
  }
  controls.update();
};

window.__springLive = {
  tipBody,
  bannerSegs: physBannerSegs,
  springsOn: () => physSpringsOn,
  sample() {
    return {
      tip: {
        x: tipBody.position.x,
        y: tipBody.position.y,
        z: tipBody.position.z,
        vx: tipBody.velocity.x,
        vy: tipBody.velocity.y,
        vz: tipBody.velocity.z,
      },
      banners: physBannerSegs.map((e) => ({
        i: e.segIdx,
        col: e.col,
        x: e.body.position.x,
        y: e.body.position.y,
        z: e.body.position.z,
        vx: e.body.velocity.x,
      })),
      on: physSpringsOn,
    };
  },
};
window.__frameQuaySprings = function (mode) {
  // mode: 'signal' | 'banners' | 'wide' | 'atlas' | 'shop' | 'seawall' | 'windows' | edges/apt*
  // Allow proof framing even under ?still=1 (rotate may be locked)
  const prevRotate = controls.enableRotate;
  const prevMin = controls.minDistance;
  controls.enableRotate = true;
  controls.minDistance = 0.05;
  if (mode === 'banners') {
    // Close on the east halyard so the pennant weave and fly read
    camera.position.set(8.55, 2.35, 7.15);
    controls.target.set(5.7, 1.72, 4.42);
  } else if (mode === 'wide') {
    camera.position.set(4, 6.5, 12);
    controls.target.set(-1, 1.8, 3.2);
  } else if (mode === 'atlas') {
    // Street-close on façades: ground shop band + upper room panes
    camera.position.set(6.2, 2.4, 7.8);
    controls.target.set(1.2, 2.8, -1.5);
  } else if (mode === 'shop') {
    // Tighter on ground-floor shop band
    camera.position.set(4.8, 1.55, 6.4);
    controls.target.set(0.6, 1.35, -0.8);
  } else if (mode === 'entry') {
    // Eye height on the ground-floor bay. Door head is 0.70, next floor at 0.76.
    camera.position.set(3.4, 0.78, 5.2);
    controls.target.set(0.5, 0.42, -0.4);
  } else if (mode === 'bay') {
    // Head-on ground floor of the seeded block at x 1.17 (building 10, +Z face).
    camera.position.set(1.17, 0.62, 3.15);
    controls.target.set(1.17, 0.42, 0.69);
  } else if (mode === 'seawall') {
    // Water-side proof: basin outboard of seawall, quay dry
    camera.position.set(11.5, 4.2, 14.5);
    controls.target.set(0.5, 0.4, 5.6);
  } else if (mode === 'graf') {
    // Promenade side of the freight band, eye height, dry quay.
    camera.position.set(0.6, 0.95, 3.15);
    controls.target.set(0.4, 0.42, 5.29);
  } else if (mode === 'windows') {
    // Rectilinear façade + atlas panes head-on
    camera.position.set(5.4, 2.1, 6.8);
    controls.target.set(0.4, 2.2, -0.6);
  } else if (mode === 'edges') {
    // Elevated oblique skyline — straight box silhouettes (less worm's-eye warp)
    camera.position.set(11.5, 9.5, 14.0);
    controls.target.set(-0.8, 3.5, -1.2);
  } else if (mode === 'mullions') {
    // Close façade grid — straight mullions, nearly head-on
    camera.position.set(1.8, 3.2, 3.4);
    controls.target.set(0.1, 3.1, -1.6);
  } else if (mode === 'aptA') {
    // Ultra-close head-on lit panes — fenestra rooms must read
    camera.position.set(0.9, 3.55, 1.85);
    controls.target.set(0.15, 3.5, -1.7);
  } else if (mode === 'aptB') {
    // Second close façade / different rooms
    camera.position.set(2.6, 2.9, 1.55);
    controls.target.set(2.0, 2.85, -2.2);
  } else if (mode === 'aptOblique') {
    // Slight oblique close — furniture lines must stay straight
    camera.position.set(2.4, 3.3, 2.6);
    controls.target.set(0.4, 3.25, -1.6);
  } else {
    camera.position.set(-1.5, 4.2, 9.5);
    controls.target.set(-5.2, 2.4, 3.5);
  }
  controls.update();
  controls.minDistance = prevMin;
  controls.enableRotate = prevRotate;
  live.renderFrame();
};
window.__shotCam = function (pos, target) {
  const prevRotate = controls.enableRotate;
  const prevMin = controls.minDistance;
  controls.enableRotate = true;
  controls.minDistance = 0.05;
  camera.position.set(pos[0], pos[1], pos[2]);
  controls.target.set(target[0], target[1], target[2]);
  controls.update();
  controls.minDistance = prevMin;
  controls.enableRotate = prevRotate;
  live.renderFrame();
};
window.__harborView = { camera, controls, frame: window.__frameQuaySprings, shot: window.__shotCam };


springSetOn(physSpringsOn);
springSyncCables();
refreshHarborPhysicsProbe();

const propsSpringsBtn = document.getElementById('props-springs');
if (propsSpringsBtn) {
  propsSpringsBtn.addEventListener('click', () => springSetOn(!physSpringsOn));
  if (physFreeze) {
    propsSpringsBtn.classList.remove('on');
    propsSpringsBtn.setAttribute('aria-pressed', 'false');
    propsSpringsBtn.disabled = true;
  }
}
window.addEventListener('noctuary-springs-toggle', () => springSetOn(!physSpringsOn));

  function disposePhysics() {
    const bodies = physWorld.bodies.slice();
    for (let i = 0; i < bodies.length; i++) physWorld.removeBody(bodies[i]);
    const constraints = physWorld.constraints.slice();
    for (let i = 0; i < constraints.length; i++) physWorld.removeConstraint(constraints[i]);
    return bodies.length;
  }
  trackDisposable('page', disposePhysics);

  return {
    beaconLight, haloMat, harborWind, physFreeze,
    signalChip, signalGroup, signalMat, signalWorld, tipGlow,
    pennantSyncCloth, physStep,
    ironMatStd, ironWarmStd, physCrates,
    crateWearMat, ironWearMats, physWorld, physGroundMat,
    stampIronCell, IRON_CELL, stampHarborCrateUVs,
    CRATE_ATLAS_COLS, CRATE_ATLAS_ROWS, CRATE_FACE_ROW,
    basinBuoy, physCrateMat, physAdd, physHooks, crateInBasinXZ,
    disposePhysics,
    HARBOR_CRATE_DEFS, RUBE_PLATE, RUBE_GATE, RUBE_VESSEL,
  };
}
