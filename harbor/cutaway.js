import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { trackDisposable } from './dispose.js';

// Basin vivisection. The night sheet stays the Gerstner plane in water.js.
// Under it the scene used to be empty: background and fog are 0x05060a, the
// district ground stops at the seawall, and the basin floor is only a Cannon
// body (physics.js BASIN_FLOOR_Y = -2.4, half-height 0.12). A low side camera
// therefore sees the waterline and then a black void.
//
// This module adds the missing volume — floor, quay footing, piles, submerged
// props, a fish school — and, only while the camera is down beside the basin,
// slides a cut plane through the sheet so hull bottoms and that volume read
// as a section. Orbit above the quay leaves uSectionOn at 0.
//
// Physics, buoyancy, and collision are not touched. Floor top matches the
// existing safety-net body so a sunk crate still meets the mesh it lands on.

const FLOOR_TOP = -2.28; // -2.4 + 0.12, top of the Cannon basin floor
const FLOOR_H = 0.5;

export function installHarborCutaway(deps) {
  const {
    scene, camera, controls, waterMat,
    WATER_D, WATER_NEAR_Z, WATER_Y, WATER_WALL_Z,
    SEAWALL_W,
    freezeMotion,
    sectionEnabled,
  } = deps;

  const root = new THREE.Group();
  root.name = 'harbor-cutaway';
  scene.add(root);

  const geos = [];
  const mats = [];
  const trackGeo = (g) => { geos.push(g); return g; };
  const trackMat = (m) => { mats.push(m); return m; };

  function slabTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#2a333d';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const v = 40 + Math.random() * 30;
      g.fillStyle = `rgba(${v},${v + 6},${v + 12},0.16)`;
      g.fillRect(x, y, 2, 2);
    }
    g.strokeStyle = '#1a2128';
    g.lineWidth = 4;
    for (let i = 0; i <= 8; i++) {
      const p = (i / 8) * 512;
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, 512);
      g.stroke();
      g.beginPath();
      g.moveTo(0, p);
      g.lineTo(512, p);
      g.stroke();
    }
    g.strokeStyle = 'rgba(186, 198, 208, 0.28)';
    g.lineWidth = 1.5;
    for (let i = 0; i <= 8; i++) {
      const p = (i / 8) * 512 + 2;
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, 512);
      g.stroke();
      g.beginPath();
      g.moveTo(0, p);
      g.lineTo(512, p);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  function courseTexture() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#323b46';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 7; i++) {
      const y = 8 + i * 36;
      g.fillStyle = i % 2 === 0 ? '#3c4652' : '#2c353f';
      g.fillRect(0, y, 256, 30);
      g.fillStyle = 'rgba(20, 24, 30, 0.45)';
      g.fillRect(0, y + 28, 256, 3);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  const floorMap = slabTexture();
  const wallMap = courseTexture();
  floorMap.repeat.set(5, 5);
  wallMap.repeat.set(6, 2);

  // fog off: scene fog is the same near-black as the void, and would swallow
  // the section at basin distance. The night around it stays fogged.
  const floorMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorMap,
    roughness: 0.92,
    metalness: 0.04,
    emissive: 0x141c24,
    emissiveIntensity: 0.22,
    fog: false,
  }));
  const wallMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: wallMap,
    roughness: 0.88,
    metalness: 0.05,
    emissive: 0x121820,
    emissiveIntensity: 0.2,
    fog: false,
  }));
  const cutMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xc4baa8,
    roughness: 0.62,
    metalness: 0.02,
    emissive: 0x3a3428,
    emissiveIntensity: 0.16,
    fog: false,
  }));
  const pileMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0x6a6256,
    roughness: 0.84,
    metalness: 0.06,
    emissive: 0x221e18,
    emissiveIntensity: 0.16,
    fog: false,
  }));
  const timberMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xa07848,
    roughness: 0.9,
    metalness: 0.02,
    emissive: 0x3a2410,
    emissiveIntensity: 0.22,
    fog: false,
  }));
  const crateMatA = trackMat(new THREE.MeshStandardMaterial({
    color: 0xb08458,
    roughness: 0.86,
    metalness: 0.04,
    emissive: 0x3a2814,
    emissiveIntensity: 0.24,
    fog: false,
  }));
  const crateMatB = trackMat(new THREE.MeshStandardMaterial({
    color: 0x7c5a3e,
    roughness: 0.9,
    metalness: 0.03,
    emissive: 0x2a1c10,
    emissiveIntensity: 0.22,
    fog: false,
  }));
  const ironMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0x8d98a4,
    roughness: 0.46,
    metalness: 0.55,
    emissive: 0x1a2228,
    emissiveIntensity: 0.2,
    fog: false,
  }));
  const lipMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0x1c4e5c,
    roughness: 0.28,
    metalness: 0.08,
    emissive: 0x0c3340,
    emissiveIntensity: 0.45,
    fog: false,
  }));
  const lineMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xe4ece8,
    roughness: 0.4,
    metalness: 0.0,
    emissive: 0x8a968e,
    emissiveIntensity: 0.28,
    fog: false,
  }));

  const basinX0 = -SEAWALL_W * 0.5;
  const basinX1 = SEAWALL_W * 0.5;
  const basinZ0 = WATER_WALL_Z + 0.32;
  const basinZ1 = WATER_NEAR_Z + WATER_D - 0.28;
  const floorW = basinX1 - basinX0;
  const floorD = basinZ1 - basinZ0;
  const floor = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(floorW, FLOOR_H, floorD)),
    [wallMat, wallMat, floorMat, wallMat, cutMat, wallMat]
  );
  floor.name = 'basin-floor';
  floor.position.set(0, FLOOR_TOP - FLOOR_H * 0.5, (basinZ0 + basinZ1) * 0.5);
  root.add(floor);

  // Quay footing: continues the seawall under the toe (toe bottom ≈ -0.78)
  // down into the slab. Outboard face sits proud of the toe so the section
  // shows wall thickness instead of a gap.
  const footH = (-0.7) - (FLOOR_TOP - 0.08);
  const footing = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(SEAWALL_W, footH, 0.52)),
    wallMat
  );
  footing.name = 'basin-footing';
  footing.position.set(0, (-0.7 + FLOOR_TOP - 0.08) * 0.5, WATER_WALL_Z + 0.11 + 0.46);
  root.add(footing);

  const wale = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(SEAWALL_W - 0.4, 0.1, 0.22)),
    pileMat
  );
  wale.name = 'basin-wale';
  wale.position.set(0, -0.92, WATER_WALL_Z + 0.78);
  root.add(wale);

  const pileGeo = trackGeo(new THREE.CylinderGeometry(0.13, 0.18, 1.42, 7));
  for (const x of [-8.6, -4.4, -0.2, 4.0, 8.2]) {
    const pile = new THREE.Mesh(pileGeo, pileMat);
    pile.name = 'basin-pile';
    pile.position.set(x, -1.55, WATER_WALL_Z + 0.86);
    root.add(pile);
  }

  // Short returns at the quay corners. They stop well short of the outboard
  // edge so a side camera still looks into the section.
  const returnGeo = trackGeo(new THREE.BoxGeometry(0.34, 1.7, 3.4));
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(returnGeo, [cutMat, cutMat, wallMat, wallMat, cutMat, wallMat]);
    wall.name = 'basin-return';
    wall.position.set(side * (SEAWALL_W * 0.5 - 0.2), -1.42, basinZ0 + 1.85);
    root.add(wall);
  }

  const dolphinGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.16, 1.7, 7));
  for (const [x, z] of [[-8.4, 22.6], [8.5, 22.2], [0.35, 24.8], [-4.6, 23.4]]) {
    const d = new THREE.Mesh(dolphinGeo, pileMat);
    d.name = 'basin-dolphin';
    d.position.set(x, FLOOR_TOP + 0.85, z);
    root.add(d);
  }

  function putBox(mat, w, h, d, x, y, z, rx, ry, rz) {
    const mesh = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    root.add(mesh);
    return mesh;
  }

  // Submerged set pieces. Visual only — not Cannon bodies, not crateWearMat.
  putBox(crateMatA, 0.36, 0.28, 0.32, 3.6, FLOOR_TOP + 0.16, 18.4, 0.08, 0.4, 0.15);
  putBox(crateMatB, 0.26, 0.22, 0.24, -1.4, FLOOR_TOP + 0.14, 21.6, 0.2, -0.6, 0.35);
  putBox(crateMatA, 0.3, 0.24, 0.28, -6.4, FLOOR_TOP + 0.18, 16.2, 0, 0.9, 0);
  putBox(crateMatB, 0.22, 0.2, 0.22, 7.1, FLOOR_TOP + 0.12, 20.8, 0.4, 0.2, 0.5);
  putBox(timberMat, 1.35, 0.12, 0.16, -2.2, FLOOR_TOP + 0.08, 23.2, 0, 0.55, 0.08);
  putBox(timberMat, 0.9, 0.1, 0.14, 5.4, FLOOR_TOP + 0.1, 15.1, 0.05, -0.3, 0);
  const barrel = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 8)),
    ironMat
  );
  barrel.rotation.z = Math.PI / 2;
  barrel.rotation.y = 0.4;
  barrel.position.set(1.15, FLOOR_TOP + 0.16, 20.2);
  root.add(barrel);
  const coil = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.16, 0.035, 6, 10)),
    ironMat
  );
  coil.rotation.x = Math.PI / 2;
  coil.position.set(-4.8, FLOOR_TOP + 0.06, 19.4);
  root.add(coil);

  // Fill that dies before the graffiti band and the quay deck.
  const cool = new THREE.PointLight(0xc5d4de, 3.2, 5.5, 2);
  cool.position.set(0.4, -1.55, 19.2);
  cool.name = 'basin-fill';
  root.add(cool);
  const warm = new THREE.PointLight(0xe0d2b8, 1.8, 2.6, 2);
  warm.position.set(0, -1.7, 8.6);
  warm.name = 'basin-footing-fill';
  root.add(warm);

  const lip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1, 1, 1)), lipMat);
  lip.name = 'basin-cut-lip';
  lip.visible = false;
  root.add(lip);
  const line = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1, 1, 1)), lineMat);
  line.name = 'basin-cut-line';
  line.visible = false;
  root.add(line);

  // ——— submerged school (side-readable; surface fish stay in craft.js) ———
  function makeFishGeo() {
    const body = new THREE.SphereGeometry(0.1, 12, 8);
    body.scale(0.7, 0.58, 2.2);
    const tail = new THREE.ConeGeometry(0.07, 0.2, 6);
    tail.rotateX(-Math.PI / 2);
    tail.translate(0, 0.005, -0.34);
    const fin = new THREE.BoxGeometry(0.012, 0.08, 0.14);
    fin.translate(0, 0.09, -0.02);
    const geo = mergeGeometries([body, tail, fin]);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const flank = new THREE.Color(0xd5e2ea);
    const back = new THREE.Color(0x24343e);
    const belly = new THREE.Color(0xc8c2b2);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      tmp.copy(flank);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (y > 0.02) tmp.lerp(back, THREE.MathUtils.smoothstep(0.02, 0.1, y));
      else tmp.lerp(belly, THREE.MathUtils.smoothstep(0.02, -0.08, y) * 0.7);
      if (z < -0.16) tmp.lerp(back, 0.45);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }

  const schools = [
    { cx: 1.4, cz: 21.4, rx: 2.5, rz: 1.45, y: -1.02, speed: 0.34, count: 7, spread: 0.2, lag: 0.34, scale: 0.64, phase: 0.35 },
    { cx: -2.6, cz: 17.8, rx: 1.65, rz: 1.9, y: -1.58, speed: 0.22, count: 5, spread: 0.17, lag: 0.4, scale: 0.8, phase: 1.45 },
    { cx: 6.2, cz: 14.2, rx: 1.1, rz: 1.25, y: -1.32, speed: 0.28, count: 4, spread: 0.14, lag: 0.32, scale: 0.52, phase: 2.25 },
  ];
  const fishPaths = [];
  for (let s = 0; s < schools.length; s++) {
    const def = schools[s];
    const mid = (def.count - 1) * 0.5;
    for (let i = 0; i < def.count; i++) {
      fishPaths.push({
        cx: def.cx, cz: def.cz, rx: def.rx, rz: def.rz, y: def.y,
        speed: def.speed, phase: def.phase, spread: def.spread,
        lag: i * def.lag, lat: (i - mid) * def.spread,
        scale: def.scale * (0.88 + (i % 3) * 0.07),
      });
    }
  }
  const fishGeo = trackGeo(makeFishGeo());
  const fishMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.12,
    emissive: 0x163038,
    emissiveIntensity: 0.38,
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: false,
  }));
  const fishMesh = new THREE.InstancedMesh(fishGeo, fishMat, fishPaths.length);
  fishMesh.name = 'basin-fish';
  fishMesh.frustumCulled = false;
  fishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const fishTint = new THREE.Color();
  for (let i = 0; i < fishPaths.length; i++) {
    const k = 0.82 + (i % 5) * 0.04;
    fishTint.setRGB(k, k + 0.03, k + 0.08);
    fishMesh.setColorAt(i, fishTint);
  }
  if (fishMesh.instanceColor) fishMesh.instanceColor.needsUpdate = true;
  root.add(fishMesh);

  const fishDummy = new THREE.Object3D();
  const fishA = new THREE.Vector3();
  const fishB = new THREE.Vector3();
  const fishC = new THREE.Vector3();
  const fishBasis = new THREE.Matrix4();
  const boatScratch = new THREE.Vector3();
  let boatGroups = null;

  function boatCircles() {
    // Craft installs after this module. Keep looking until the hulls exist.
    if (boatGroups && boatGroups.length) return boatGroups;
    boatGroups = [];
    const specs = [
      ['quay-skiff', 1.7],
      ['harbor-launch', 2.3],
      ['basin-tender', 1.35],
    ];
    for (let i = 0; i < specs.length; i++) {
      const obj = scene.getObjectByName(specs[i][0]);
      if (obj) boatGroups.push({ obj, r: specs[i][1] });
    }
    return boatGroups;
  }

  function fishAt(f, t) {
    const a = f.phase + t * f.speed - f.lag;
    const x0 = f.cx + Math.sin(a) * f.rx;
    const z0 = f.cz + Math.sin(a * 2.0) * f.rz;
    const dx = Math.cos(a) * f.rx;
    const dz = Math.cos(a * 2.0) * 2.0 * f.rz;
    const len = Math.hypot(dx, dz) || 1;
    return {
      x: x0 + (-dz / len) * f.lat,
      z: z0 + (dx / len) * f.lat,
      dx, dz,
    };
  }

  function clearFish(x, z) {
    const boats = boatCircles();
    for (let i = 0; i < boats.length; i++) {
      boats[i].obj.getWorldPosition(boatScratch);
      let dx = x - boatScratch.x;
      let dz = z - boatScratch.z;
      const r = boats[i].r;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) {
        const k = (r - d) / d;
        x += dx * k;
        z += dz * k;
      }
    }
    x = Math.max(basinX0 + 0.6, Math.min(basinX1 - 0.6, x));
    z = Math.max(basinZ0 + 1.2, Math.min(basinZ1 - 0.8, z));
    return { x, z };
  }

  function poseFish(t) {
    for (let i = 0; i < fishPaths.length; i++) {
      const f = fishPaths[i];
      const now = clearFish(fishAt(f, t).x, fishAt(f, t).z);
      const ahead = fishAt(f, t + 0.16);
      const y = f.y + Math.sin(t * 1.15 + f.phase + f.lat) * 0.035;
      fishA.set(ahead.x - now.x, 0, ahead.z - now.z);
      if (fishA.lengthSq() < 1e-8) fishA.set(1, 0, 0);
      else fishA.normalize();
      fishB.set(0, 1, 0);
      fishC.crossVectors(fishB, fishA).normalize();
      fishB.crossVectors(fishA, fishC).normalize();
      fishBasis.makeBasis(fishC, fishB, fishA);
      fishDummy.position.set(now.x, y, now.z);
      fishDummy.quaternion.setFromRotationMatrix(fishBasis);
      fishDummy.scale.setScalar(f.scale);
      fishDummy.updateMatrix();
      fishMesh.setMatrixAt(i, fishDummy.matrix);
    }
    fishMesh.instanceMatrix.needsUpdate = true;
  }

  // ——— section plane ———
  const rect = { x0: basinX0 + 0.05, x1: basinX1 - 0.05, z0: basinZ0, z1: basinZ1 };
  const anchorX = 0;
  const anchorZ = WATER_WALL_Z + 1.25;
  const keepDist = 6.0;
  const xAxis = new THREE.Vector3(1, 0, 0);
  const along = new THREE.Vector3();
  const state = { open: 0, on: 0, nx: 0, nz: 1, px: 0, pz: 80 };

  function rayExit(ox, oz, dx, dz) {
    let t = 80;
    if (dx > 1e-6) t = Math.min(t, (rect.x1 - ox) / dx);
    else if (dx < -1e-6) t = Math.min(t, (rect.x0 - ox) / dx);
    if (dz > 1e-6) t = Math.min(t, (rect.z1 - oz) / dz);
    else if (dz < -1e-6) t = Math.min(t, (rect.z0 - oz) / dz);
    return t;
  }

  function planeSegment(nx, nz, px, pz) {
    const hits = [];
    const corners = [
      [rect.x0, rect.z0], [rect.x1, rect.z0],
      [rect.x1, rect.z1], [rect.x0, rect.z1],
    ];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const da = (a[0] - px) * nx + (a[1] - pz) * nz;
      const db = (b[0] - px) * nx + (b[1] - pz) * nz;
      if ((da > 0 && db > 0) || (da < 0 && db < 0)) continue;
      const denom = da - db;
      if (Math.abs(denom) < 1e-6) continue;
      const u = THREE.MathUtils.clamp(da / denom, 0, 1);
      const x = a[0] + (b[0] - a[0]) * u;
      const z = a[1] + (b[1] - a[1]) * u;
      let dup = false;
      for (let h = 0; h < hits.length; h++) {
        if (Math.hypot(hits[h][0] - x, hits[h][1] - z) < 0.04) dup = true;
      }
      if (!dup) hits.push([x, z]);
    }
    if (hits.length < 2) return null;
    return [hits[0], hits[1]];
  }

  function placeCutMark(nx, nz, px, pz) {
    const seg = planeSegment(nx, nz, px, pz);
    if (!seg) {
      lip.visible = false;
      line.visible = false;
      return;
    }
    const a = seg[0];
    const b = seg[1];
    along.set(b[0] - a[0], 0, b[1] - a[1]);
    const len = along.length();
    if (len < 0.4) {
      lip.visible = false;
      line.visible = false;
      return;
    }
    along.multiplyScalar(1 / len);
    const mx = (a[0] + b[0]) * 0.5 + nx * 0.06;
    const mz = (a[1] + b[1]) * 0.5 + nz * 0.06;
    lip.visible = true;
    line.visible = true;
    lip.position.set(mx, WATER_Y - 0.08, mz);
    lip.quaternion.setFromUnitVectors(xAxis, along);
    lip.scale.set(len, 0.16, 0.055);
    line.position.set(mx, WATER_Y + 0.02, mz);
    line.quaternion.copy(lip.quaternion);
    line.scale.set(len, 0.028, 0.07);
  }

  function update(t) {
    poseFish(freezeMotion ? 1.25 : t);
    const p = camera.position;
    const overBasin = p.z > WATER_WALL_Z + 0.45 && p.z < 48 && Math.abs(p.x) < 22;
    const open = (sectionEnabled && overBasin)
      ? 1 - THREE.MathUtils.smoothstep(p.y, 0.05, 2.75)
      : 0;
    state.open = open;
    const u = waterMat.uniforms;
    if (open < 0.025) {
      state.on = 0;
      u.uSectionOn.value = 0;
      lip.visible = false;
      line.visible = false;
      return;
    }
    let dx = p.x - anchorX;
    let dz = p.z - anchorZ;
    const mag = Math.hypot(dx, dz);
    if (mag < 0.35) { dx = 0; dz = 1; }
    else { dx /= mag; dz /= mag; }
    const rim = rayExit(anchorX, anchorZ, dx, dz);
    const slide = THREE.MathUtils.lerp(rim + 2.5, keepDist, open);
    const px = anchorX + dx * slide;
    const pz = anchorZ + dz * slide;
    state.on = 1;
    state.nx = dx;
    state.nz = dz;
    state.px = px;
    state.pz = pz;
    u.uSectionOn.value = 1;
    u.uSectionN.value.set(dx, dz);
    u.uSectionP.value.set(px, pz);
    placeCutMark(dx, dz, px, pz);
  }

  poseFish(freezeMotion ? 1.25 : 0);

  window.__harborCutaway = {
    floorTop: FLOOR_TOP,
    fish: fishPaths.length,
    state,
    update,
  };
  window.__frameHarborCutaway = (mode) => {
    controls.maxPolarAngle = Math.PI * 0.92;
    controls.minDistance = 0.05;
    camera.up.set(0, 1, 0);
    camera.fov = 42;
    if (mode === 'side') {
      camera.position.set(17.6, 0.22, 18.4);
      controls.target.set(-0.4, -1.05, 16.8);
    } else if (mode === 'below') {
      camera.position.set(0.35, -0.72, 28.4);
      controls.target.set(0.1, -0.85, 12.5);
    } else if (mode === 'hero') {
      camera.position.set(16.5, 10.5, 20.5);
      controls.target.set(0, 1.6, -2.5);
      controls.maxPolarAngle = Math.PI * 0.495;
    } else {
      camera.position.set(0.65, 0.58, 29.2);
      controls.target.set(0.1, -0.85, 13.2);
    }
    camera.updateProjectionMatrix();
    controls.update();
    update(freezeMotion ? 1.25 : 0);
  };

  function disposeCutaway() {
    scene.remove(root);
    if (waterMat.uniforms.uSectionOn) waterMat.uniforms.uSectionOn.value = 0;
    for (let i = 0; i < geos.length; i++) geos[i].dispose();
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (m.map) m.map.dispose();
      m.dispose();
    }
    return geos.length;
  }
  trackDisposable('page', disposeCutaway);

  return { root, update, disposeCutaway, state };
}
