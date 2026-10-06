import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { trackDisposable } from './dispose.js';

// What the refractive sheet looks through. Not a side cutaway: this volume
// sits under the Gerstner plane so a normal overhead orbit sees floor, fish,
// and (through the same grab) the hull bottoms that already live on the boats.
// Floor top matches the Cannon safety net in physics.js (y = -2.4, half 0.12).
// No new collision. No crateWearMat. No camera-gated discard.

const FLOOR_TOP = -2.28;
const FLOOR_H = 0.42;

export function installHarborBasin(deps) {
  const {
    scene,
    WATER_D, WATER_NEAR_Z, WATER_Y, WATER_WALL_Z,
    SEAWALL_W,
    freezeMotion,
  } = deps;

  const root = new THREE.Group();
  root.name = 'harbor-basin';
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
    g.fillStyle = '#5a6c7c';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const v = 48 + Math.random() * 36;
      g.fillStyle = `rgba(${v},${v + 8},${v + 14},0.18)`;
      g.fillRect(x, y, 2, 2);
    }
    g.strokeStyle = '#1c242e';
    g.lineWidth = 4;
    for (let i = 0; i <= 8; i++) {
      const p = (i / 8) * 512;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(512, p); g.stroke();
    }
    g.strokeStyle = 'rgba(198, 210, 220, 0.35)';
    g.lineWidth = 1.5;
    for (let i = 0; i <= 8; i++) {
      const p = (i / 8) * 512 + 2;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(512, p); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.repeat.set(4, 4);
    tex.needsUpdate = true;
    return tex;
  }

  const floorMap = slabTexture();
  // fog off so the night fog (same black as the old void) does not eat the floor
  // inside the refraction grab. The sheet adds its own thin blue veil.
  const floorMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorMap,
    roughness: 0.92,
    metalness: 0.04,
    emissive: 0x2c3c4c,
    emissiveIntensity: 0.72,
    fog: false,
  }));
  const wallMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0x4a5562,
    roughness: 0.9,
    metalness: 0.05,
    emissive: 0x161c24,
    emissiveIntensity: 0.22,
    fog: false,
  }));
  const pileMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0x6d6558,
    roughness: 0.84,
    metalness: 0.08,
    emissive: 0x221e18,
    emissiveIntensity: 0.18,
    fog: false,
  }));
  const crateMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xa67a4e,
    roughness: 0.86,
    metalness: 0.04,
    emissive: 0x3a2814,
    emissiveIntensity: 0.28,
    fog: false,
  }));
  const timberMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0x8a6240,
    roughness: 0.9,
    metalness: 0.02,
    emissive: 0x2e1c10,
    emissiveIntensity: 0.2,
    fog: false,
  }));

  const basinX0 = -SEAWALL_W * 0.5;
  const basinX1 = SEAWALL_W * 0.5;
  const basinZ0 = WATER_WALL_Z + 0.28;
  const basinZ1 = WATER_NEAR_Z + WATER_D - 0.2;
  const floor = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(basinX1 - basinX0, FLOOR_H, basinZ1 - basinZ0)),
    floorMat
  );
  floor.name = 'basin-floor';
  floor.position.set(0, FLOOR_TOP - FLOOR_H * 0.5, (basinZ0 + basinZ1) * 0.5);
  root.add(floor);

  // Quay footing, under the existing toe, so the wall continues below the line.
  const footTop = -0.72;
  const footBot = FLOOR_TOP - 0.04;
  const footing = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(SEAWALL_W, footTop - footBot, 0.46)),
    wallMat
  );
  footing.name = 'basin-footing';
  footing.position.set(0, (footTop + footBot) * 0.5, WATER_WALL_Z + 0.62);
  root.add(footing);

  // Lining, not a section cut. Stops an orbit glance at the rim from falling
  // through into the night clear color.
  const wallTop = -0.52;
  const wallH = wallTop - FLOOR_TOP;
  const wallY = (wallTop + FLOOR_TOP) * 0.5;
  const spanX = basinX1 - basinX0;
  const spanZ = basinZ1 - basinZ0;
  const lining = [
    [spanX, wallH, 0.28, 0, wallY, basinZ0 + 0.14],
    [spanX, wallH, 0.28, 0, wallY, basinZ1 - 0.14],
    [0.28, wallH, spanZ, basinX0 + 0.14, wallY, (basinZ0 + basinZ1) * 0.5],
    [0.28, wallH, spanZ, basinX1 - 0.14, wallY, (basinZ0 + basinZ1) * 0.5],
  ];
  for (let i = 0; i < lining.length; i++) {
    const L = lining[i];
    const wall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(L[0], L[1], L[2])), wallMat);
    wall.position.set(L[3], L[4], L[5]);
    wall.name = 'basin-lining';
    root.add(wall);
  }

  const pileGeo = trackGeo(new THREE.CylinderGeometry(0.12, 0.16, 1.35, 7));
  for (const x of [-8.2, -4.0, 0.2, 4.4, 8.4]) {
    const pile = new THREE.Mesh(pileGeo, pileMat);
    pile.position.set(x, -1.5, WATER_WALL_Z + 0.95);
    root.add(pile);
  }

  function putBox(mat, w, h, d, x, y, z, rx, ry, rz) {
    const mesh = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    root.add(mesh);
  }
  putBox(crateMat, 0.34, 0.26, 0.3, 1.6, FLOOR_TOP + 0.14, 19.2, 0.05, 0.5, 0.12);
  putBox(crateMat, 0.24, 0.2, 0.22, -5.2, FLOOR_TOP + 0.12, 16.4, 0.15, -0.4, 0.2);
  putBox(timberMat, 1.2, 0.1, 0.14, 6.4, FLOOR_TOP + 0.07, 21.6, 0, 0.4, 0);

  const fill = new THREE.PointLight(0xc5d6e2, 4.5, 7.5, 2);
  fill.position.set(1.2, -1.35, 18.4);
  fill.name = 'basin-fill';
  root.add(fill);

  function makeFishGeo() {
    const body = new THREE.SphereGeometry(0.1, 10, 8);
    body.scale(0.62, 0.28, 2.05);
    const tail = new THREE.ConeGeometry(0.055, 0.18, 5);
    tail.rotateX(-Math.PI / 2);
    tail.translate(0, 0, -0.32);
    const geo = mergeGeometries([body, tail]);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const flank = new THREE.Color(0xd7e4ec);
    const back = new THREE.Color(0x24343e);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      tmp.copy(flank);
      if (pos.getY(i) > 0.01) tmp.lerp(back, 0.55);
      if (pos.getZ(i) < -0.14) tmp.lerp(back, 0.4);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }

  const schools = [
    { cx: 0.15, cz: 20.6, rx: 2.2, rz: 1.3, y: -1.05, speed: 0.32, count: 6, spread: 0.22, lag: 0.32, scale: 0.85, phase: 0.4 },
    { cx: -1.8, cz: 14.6, rx: 1.5, rz: 1.15, y: -1.42, speed: 0.24, count: 5, spread: 0.16, lag: 0.38, scale: 0.7, phase: 1.5 },
    { cx: 7.2, cz: 22.2, rx: 1.15, rz: 1.05, y: -1.22, speed: 0.28, count: 4, spread: 0.14, lag: 0.3, scale: 0.62, phase: 2.2 },
  ];
  const paths = [];
  for (let s = 0; s < schools.length; s++) {
    const def = schools[s];
    const mid = (def.count - 1) * 0.5;
    for (let i = 0; i < def.count; i++) {
      paths.push({
        cx: def.cx, cz: def.cz, rx: def.rx, rz: def.rz, y: def.y,
        speed: def.speed, phase: def.phase,
        lag: i * def.lag, lat: (i - mid) * def.spread,
        scale: def.scale * (0.9 + (i % 3) * 0.06),
      });
    }
  }
  const fishGeo = trackGeo(makeFishGeo());
  const fishMat = trackMat(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0.12,
    emissive: 0x2a4552,
    emissiveIntensity: 0.85,
    vertexColors: true,
    fog: false,
  }));
  const fishMesh = new THREE.InstancedMesh(fishGeo, fishMat, paths.length);
  fishMesh.name = 'basin-fish';
  fishMesh.frustumCulled = false;
  fishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(fishMesh);

  const dummy = new THREE.Object3D();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const boatPos = new THREE.Vector3();
  let boats = null;

  function boatCircles() {
    if (boats && boats.length) return boats;
    boats = [];
    const specs = [['quay-skiff', 1.7], ['harbor-launch', 2.3], ['basin-tender', 1.35]];
    for (let i = 0; i < specs.length; i++) {
      const obj = scene.getObjectByName(specs[i][0]);
      if (obj) boats.push({ obj, r: specs[i][1] });
    }
    return boats;
  }

  function at(f, t) {
    const a = f.phase + t * f.speed - f.lag;
    const x0 = f.cx + Math.sin(a) * f.rx;
    const z0 = f.cz + Math.sin(a * 2.0) * f.rz;
    const dx = Math.cos(a) * f.rx;
    const dz = Math.cos(a * 2.0) * 2.0 * f.rz;
    const len = Math.hypot(dx, dz) || 1;
    return { x: x0 + (-dz / len) * f.lat, z: z0 + (dx / len) * f.lat };
  }

  function clearOfHulls(x, z) {
    const list = boatCircles();
    for (let i = 0; i < list.length; i++) {
      list[i].obj.getWorldPosition(boatPos);
      let dx = x - boatPos.x;
      let dz = z - boatPos.z;
      const d = Math.hypot(dx, dz);
      if (d < list[i].r && d > 1e-4) {
        const k = (list[i].r - d) / d;
        x += dx * k;
        z += dz * k;
      }
    }
    return {
      x: Math.max(basinX0 + 0.7, Math.min(basinX1 - 0.7, x)),
      z: Math.max(basinZ0 + 1.4, Math.min(basinZ1 - 0.8, z)),
    };
  }

  function update(t) {
    const time = freezeMotion ? 1.25 : t;
    for (let i = 0; i < paths.length; i++) {
      const f = paths[i];
      const now = clearOfHulls(at(f, time).x, at(f, time).z);
      const ahead = at(f, time + 0.16);
      fwd.set(ahead.x - now.x, 0, ahead.z - now.z);
      if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, 1);
      else fwd.normalize();
      up.set(0, 1, 0);
      right.crossVectors(up, fwd).normalize();
      up.crossVectors(fwd, right).normalize();
      basis.makeBasis(right, up, fwd);
      dummy.position.set(now.x, f.y + Math.sin(time * 1.1 + f.phase) * 0.03, now.z);
      dummy.quaternion.setFromRotationMatrix(basis);
      dummy.scale.set(f.scale * 1.45, f.scale * 1.05, f.scale * 1.45);
      dummy.updateMatrix();
      fishMesh.setMatrixAt(i, dummy.matrix);
    }
    fishMesh.instanceMatrix.needsUpdate = true;
  }

  update(0);
  window.__harborBasin = { floorTop: FLOOR_TOP, fish: paths.length, waterY: WATER_Y };

  function disposeBasin() {
    scene.remove(root);
    for (let i = 0; i < geos.length; i++) geos[i].dispose();
    for (let i = 0; i < mats.length; i++) {
      if (mats[i].map) mats[i].map.dispose();
      mats[i].dispose();
    }
    return geos.length;
  }
  trackDisposable('page', disposeBasin);

  return { root, update, disposeBasin };
}
