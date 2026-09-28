// Harbor glass shards — thin irregular facets.
// Shop-pane breaks and the fenestra vessel debris-swap both call make().
// Collision is the same prism (cannon ConvexPolyhedron). Mass and quay friction
// stay with the caller; inertia is clamped so a sheet does not spin apart.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const TINTS = [
  { color: 0xd7e3ef, attenuation: 0x8eabc4 },
  { color: 0xc5d4e6, attenuation: 0x6f93b4 },
  { color: 0xe4ddef, attenuation: 0x8a7bb8 },
  { color: 0xf4ecdf, attenuation: 0xc4a574 },
  { color: 0xe8eef6, attenuation: 0x9eb0c4 },
];

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 1) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function shardRing(rng) {
  const n = 3 + Math.floor(rng() * 4); // 3–6, triangles included
  const raw = [];
  let a = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    a += (Math.PI * 2 / n) * (0.42 + rng() * 1.25);
    const radius = 0.28 + rng() * 0.72;
    raw.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  const stretch = 1.45 + rng() * 0.9;
  const ang = rng() * Math.PI;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  for (const p of raw) {
    const x = p[0] * stretch;
    const y = p[1] * (0.55 + rng() * 0.25);
    p[0] = x * c - y * s;
    p[1] = x * s + y * c;
  }
  // Pull one vertex into a sharp tip, then re-hull so the prism stays convex.
  let far = 0;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i][0] ** 2 + raw[i][1] ** 2 > raw[far][0] ** 2 + raw[far][1] ** 2) far = i;
  }
  raw[far][0] *= 1.28;
  raw[far][1] *= 1.28;
  let hull = convexHull(raw);
  if (hull.length < 3) {
    hull = [[-0.45, -0.2], [0.62, -0.08], [0.05, 0.48]];
  }
  let cx = 0;
  let cz = 0;
  for (const p of hull) {
    cx += p[0];
    cz += p[1];
  }
  cx /= hull.length;
  cz /= hull.length;
  let maxR = 1e-6;
  const ring = hull.map((p) => {
    const x = p[0] - cx;
    const z = p[1] - cz;
    maxR = Math.max(maxR, Math.hypot(x, z));
    return [x, z];
  });
  return { ring, maxR };
}

function polygonArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return Math.abs(a) * 0.5;
}

function buildPrismGeometry(ring, thickness) {
  const n = ring.length;
  const ht = thickness * 0.5;
  const positions = [];
  const normals = [];
  const push = (x, y, z, nx, ny, nz) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
  };
  for (let i = 1; i < n - 1; i++) {
    const a = ring[0];
    const b = ring[i];
    const c = ring[i + 1];
    push(a[0], ht, a[1], 0, 1, 0);
    push(b[0], ht, b[1], 0, 1, 0);
    push(c[0], ht, c[1], 0, 1, 0);
    push(a[0], -ht, a[1], 0, -1, 0);
    push(c[0], -ht, c[1], 0, -1, 0);
    push(b[0], -ht, b[1], 0, -1, 0);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i][0];
    const az = ring[i][1];
    const bx = ring[j][0];
    const bz = ring[j][1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dz, -dx) || 1;
    const nx = dz / len;
    const nz = -dx / len;
    push(ax, ht, az, nx, 0, nz);
    push(bx, ht, bz, nx, 0, nz);
    push(bx, -ht, bz, nx, 0, nz);
    push(ax, ht, az, nx, 0, nz);
    push(bx, -ht, bz, nx, 0, nz);
    push(ax, -ht, az, nx, 0, nz);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

function orientFaceOutward(vertices, face) {
  const va = vertices[face[0]];
  const vb = vertices[face[1]];
  const vc = vertices[face[2]];
  const abx = vb.x - va.x;
  const aby = vb.y - va.y;
  const abz = vb.z - va.z;
  const cbx = vc.x - vb.x;
  const cby = vc.y - vb.y;
  const cbz = vc.z - vb.z;
  // Match cannon-es: final normal is -((vc-vb) × (vb-va)).
  let nx = -(cby * abz - cbz * aby);
  let ny = -(cbz * abx - cbx * abz);
  let nz = -(cbx * aby - cby * abx);
  if (nx * va.x + ny * va.y + nz * va.z < 0) face.reverse();
  return face;
}

function buildConvex(ring, thickness) {
  const n = ring.length;
  const ht = thickness * 0.5;
  const vertices = [];
  for (let i = 0; i < n; i++) vertices.push(new CANNON.Vec3(ring[i][0], ht, ring[i][1]));
  for (let i = 0; i < n; i++) vertices.push(new CANNON.Vec3(ring[i][0], -ht, ring[i][1]));
  const faces = [];
  const top = [];
  const bot = [];
  for (let i = 0; i < n; i++) {
    top.push(i);
    bot.push(n + (n - 1 - i));
  }
  faces.push(top, bot);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, j, n + j, n + i]);
  }
  for (const face of faces) orientFaceOutward(vertices, face);
  return new CANNON.ConvexPolyhedron({ vertices, faces });
}

function nightDockEnv(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new THREE.Scene();
  room.background = new THREE.Color(0x141a28);
  room.add(new THREE.HemisphereLight(0xb7c6dc, 0x16120e, 1.15));
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(14, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0x1c2638, side: THREE.BackSide })
  );
  room.add(sky);
  const warm = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 3.2),
    new THREE.MeshBasicMaterial({ color: 0xffc56a })
  );
  warm.position.set(2.2, 1.4, -5.5);
  room.add(warm);
  const cool = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 2.4),
    new THREE.MeshBasicMaterial({ color: 0x9eb6d8 })
  );
  cool.position.set(-3.4, 2.6, -5.2);
  cool.rotation.y = 0.4;
  room.add(cool);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(8, 24),
    new THREE.MeshBasicMaterial({ color: 0x12151c })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.2;
  room.add(ground);
  const target = pmrem.fromScene(room, 0.04);
  sky.geometry.dispose();
  sky.material.dispose();
  warm.geometry.dispose();
  warm.material.dispose();
  cool.geometry.dispose();
  cool.material.dispose();
  ground.geometry.dispose();
  ground.material.dispose();
  pmrem.dispose();
  return target.texture;
}

function glassOnBeforeCompile(shader) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `#include <opaque_fragment>
     float glassNdv = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
     float glassFres = pow(1.0 - glassNdv, 2.05);
     vec3 rim = vec3(0.84, 0.91, 1.0);
     gl_FragColor.rgb = mix(gl_FragColor.rgb * vec3(0.78, 0.88, 1.0) + vec3(0.04, 0.07, 0.11), rim, glassFres * 0.78);
     gl_FragColor.rgb += rim * pow(glassFres, 1.35) * 0.5;
     gl_FragColor.a = mix(0.4, 0.94, glassFres);`
  );
}

function makeBaseMaterial(envMap) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xd7e3ef,
    metalness: 0,
    roughness: 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    ior: 1.5,
    thickness: 0.12,
    transmission: 0,
    transparent: true,
    opacity: 1,
    envMap,
    envMapIntensity: 2.05,
    emissive: 0x243246,
    emissiveIntensity: 0.32,
    side: THREE.FrontSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  mat.onBeforeCompile = glassOnBeforeCompile;
  mat.customProgramCacheKey = () => 'harbor-glass-facet-v2';
  return mat;
}

export function createHarborGlassShards(renderer) {
  const envMap = nightDockEnv(renderer);
  const base = makeBaseMaterial(envMap);

  function make(opts) {
    const rng = opts.rng || Math.random;
    const span = Math.max(0.04, opts.span || 0.1);
    const tint = TINTS[(opts.tint | 0) % TINTS.length];
    const rough = 0.02 + rng() * 0.05;
    const { ring: unit, maxR } = shardRing(rng);
    const scale = (span * 0.5) / maxR;
    const ring = unit.map((p) => [p[0] * scale, p[1] * scale]);
    const thickness = Math.min(0.014, Math.max(0.008, span * (0.05 + rng() * 0.02)));
    const geometry = buildPrismGeometry(ring, thickness);
    const material = base.clone();
    material.color.setHex(tint.color);
    material.emissive.setHex(tint.attenuation);
    material.roughness = rough;
    material.clearcoatRoughness = Math.min(0.16, rough + 0.02);
    material.envMap = envMap;
    material.transparent = true;
    material.depthWrite = false;
    material.onBeforeCompile = glassOnBeforeCompile;
    material.customProgramCacheKey = () => 'harbor-glass-facet-v2';
    material.needsUpdate = true;
    const shape = buildConvex(ring, thickness);
    let hx = 0;
    let hz = 0;
    for (const p of ring) {
      hx = Math.max(hx, Math.abs(p[0]));
      hz = Math.max(hz, Math.abs(p[1]));
    }
    const halfExtents = new CANNON.Vec3(hx, thickness * 0.5, hz);
    const volume = Math.max(polygonArea(ring) * thickness, 1e-6);
    return {
      geometry,
      material,
      shape,
      halfExtents,
      volume,
      thickness,
      span,
      facets: ring.length,
    };
  }

  // Thin prisms have a tiny inertia about the in-plane axes. Cap invInertia
  // so contact impulses tumble a shard instead of exploding it.
  function stabilize(body) {
    const cap = 120;
    body.invInertia.x = Math.min(body.invInertia.x, cap);
    body.invInertia.y = Math.min(body.invInertia.y, cap);
    body.invInertia.z = Math.min(body.invInertia.z, cap);
    if (typeof body.updateInertiaWorld === 'function') body.updateInertiaWorld(true);
  }

  return { make, stabilize, envMap };
}

export function glassQuaternion(nx, ny, nz, twist, tilt) {
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3(nx || 0, ny || 0, nz || 0);
  if (n.lengthSq() < 1e-8) n.copy(up);
  else n.normalize();
  q.setFromUnitVectors(up, n);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(up, twist || 0));
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt || 0));
  return q;
}
