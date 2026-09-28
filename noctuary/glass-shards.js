// Harbor glass shards — thin irregular facets.
// Shop-pane breaks and the fenestra vessel debris-swap both call make().
// The cannon body is the same outer prism. A face attribute draws a sharp
// cool rim; the middle of the pane stays clear. No rounded edge bevel.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Shards per square scene-unit of broken glass. Count is
// clamp(round(density * area), 2, 16). A full shop cell is several times
// the fenestra vessel's pane, so it sheds more pieces.
export const GLASS_SHARD_DENSITY = 26;
export const GLASS_SHARD_MIN = 2;
export const GLASS_SHARD_MAX = 16;

export function glassShardCount(area) {
  const n = Math.round(GLASS_SHARD_DENSITY * Math.max(0, area || 0));
  if (n <= 0) return 0;
  return Math.max(GLASS_SHARD_MIN, Math.min(GLASS_SHARD_MAX, n));
}

const TINTS = [
  0xe4eef8,
  0xd2e2f2,
  0xe3def2,
  0xc9d7e6,
  0xf2f6fa,
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

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return a * 0.5;
}

function centerRing(ring) {
  let cx = 0;
  let cz = 0;
  for (const p of ring) {
    cx += p[0];
    cz += p[1];
  }
  cx /= ring.length;
  cz /= ring.length;
  let maxR = 1e-6;
  const out = ring.map((p) => {
    const x = p[0] - cx;
    const z = p[1] - cz;
    maxR = Math.max(maxR, Math.hypot(x, z));
    return [x, z];
  });
  return { ring: out, maxR };
}

function shardRing(rng) {
  // Splinters (long, needle tip) and broader flakes. Both stay convex.
  const splinter = rng() < 0.62;
  const n = splinter ? 4 + Math.floor(rng() * 3) : 5 + Math.floor(rng() * 3);
  const raw = [];
  let a = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const jag = rng();
    const step = jag < 0.28
      ? (Math.PI * 2 / n) * (0.12 + rng() * 0.28)
      : (Math.PI * 2 / n) * (0.65 + rng() * 1.85);
    a += step;
    const radius = splinter ? 0.08 + rng() * rng() * 1.05 : 0.22 + rng() * 0.95;
    raw.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  const stretch = splinter ? 2.6 + rng() * 1.8 : 1.25 + rng() * 0.85;
  const squash = splinter ? 0.22 + rng() * 0.2 : 0.48 + rng() * 0.38;
  const ang = rng() * Math.PI;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  for (const p of raw) {
    const x = p[0] * stretch;
    const y = p[1] * squash;
    p[0] = x * c - y * s;
    p[1] = x * s + y * c;
  }
  let far = 0;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i][0] ** 2 + raw[i][1] ** 2 > raw[far][0] ** 2 + raw[far][1] ** 2) far = i;
  }
  const tip = splinter ? 1.65 : 1.28;
  raw[far][0] *= tip;
  raw[far][1] *= tip;
  let hull = convexHull(raw);
  if (hull.length < 3) {
    hull = [[-0.2, -0.08], [0.85, -0.02], [0.04, 0.16]];
  }
  return centerRing(hull);
}

function inradius(ring) {
  let m = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const ax = ring[i][0];
    const az = ring[i][1];
    const bx = ring[j][0];
    const bz = ring[j][1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    m = Math.min(m, Math.abs(ax * bz - az * bx) / len);
  }
  return m;
}

function insetRing(ring, dist) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n];
    const b = ring[i];
    const c = ring[(i + 1) % n];
    const e0x = b[0] - a[0];
    const e0z = b[1] - a[1];
    const e1x = c[0] - b[0];
    const e1z = c[1] - b[1];
    const l0 = Math.hypot(e0x, e0z) || 1;
    const l1 = Math.hypot(e1x, e1z) || 1;
    const n0x = -e0z / l0;
    const n0z = e0x / l0;
    const n1x = -e1z / l1;
    const n1z = e1x / l1;
    let bxn = n0x + n1x;
    let bzn = n0z + n1z;
    const bl = Math.hypot(bxn, bzn) || 1;
    bxn /= bl;
    bzn /= bl;
    const denom = Math.max(0.4, bxn * n0x + bzn * n0z);
    const d = Math.min(dist / denom, dist * 2.1);
    out.push([b[0] + bxn * d, b[1] + bzn * d]);
  }
  if (signedArea(out) < Math.abs(signedArea(ring)) * 0.12) return null;
  return out;
}

function polygonArea(ring) {
  return Math.abs(signedArea(ring));
}

function buildPrismGeometry(outer, inner, thickness) {
  const n = outer.length;
  const ht = thickness * 0.5;
  const positions = [];
  const normals = [];
  const rims = [];
  const push = (x, y, z, nx, ny, nz, rim) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    rims.push(rim);
  };
  const cap = (y, ny) => {
    if (inner) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const o0 = outer[i];
        const o1 = outer[j];
        const i0 = inner[i];
        const i1 = inner[j];
        if (ny > 0) {
          push(o0[0], y, o0[1], 0, ny, 0, 1);
          push(o1[0], y, o1[1], 0, ny, 0, 1);
          push(i1[0], y, i1[1], 0, ny, 0, 0);
          push(o0[0], y, o0[1], 0, ny, 0, 1);
          push(i1[0], y, i1[1], 0, ny, 0, 0);
          push(i0[0], y, i0[1], 0, ny, 0, 0);
        } else {
          push(o0[0], y, o0[1], 0, ny, 0, 1);
          push(i1[0], y, i1[1], 0, ny, 0, 0);
          push(o1[0], y, o1[1], 0, ny, 0, 1);
          push(o0[0], y, o0[1], 0, ny, 0, 1);
          push(i0[0], y, i0[1], 0, ny, 0, 0);
          push(i1[0], y, i1[1], 0, ny, 0, 0);
        }
      }
      for (let i = 1; i < n - 1; i++) {
        const a = inner[0];
        const b = inner[i];
        const c = inner[i + 1];
        if (ny > 0) {
          push(a[0], y, a[1], 0, ny, 0, 0);
          push(b[0], y, b[1], 0, ny, 0, 0);
          push(c[0], y, c[1], 0, ny, 0, 0);
        } else {
          push(a[0], y, a[1], 0, ny, 0, 0);
          push(c[0], y, c[1], 0, ny, 0, 0);
          push(b[0], y, b[1], 0, ny, 0, 0);
        }
      }
    } else {
      for (let i = 1; i < n - 1; i++) {
        const a = outer[0];
        const b = outer[i];
        const c = outer[i + 1];
        if (ny > 0) {
          push(a[0], y, a[1], 0, ny, 0, 0.15);
          push(b[0], y, b[1], 0, ny, 0, 1);
          push(c[0], y, c[1], 0, ny, 0, 1);
        } else {
          push(a[0], y, a[1], 0, ny, 0, 0.15);
          push(c[0], y, c[1], 0, ny, 0, 1);
          push(b[0], y, b[1], 0, ny, 0, 1);
        }
      }
    }
  };
  cap(ht, 1);
  cap(-ht, -1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = outer[i][0];
    const az = outer[i][1];
    const bx = outer[j][0];
    const bz = outer[j][1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dz, -dx) || 1;
    const nx = dz / len;
    const nz = -dx / len;
    push(ax, ht, az, nx, 0, nz, 1);
    push(bx, ht, bz, nx, 0, nz, 1);
    push(bx, -ht, bz, nx, 0, nz, 1);
    push(ax, ht, az, nx, 0, nz, 1);
    push(bx, -ht, bz, nx, 0, nz, 1);
    push(ax, -ht, az, nx, 0, nz, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aRim', new THREE.Float32BufferAttribute(rims, 1));
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
  const nx = -(cby * abz - cbz * aby);
  const ny = -(cbz * abx - cbx * abz);
  const nz = -(cbx * aby - cby * abx);
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
  room.background = new THREE.Color(0x101722);
  room.add(new THREE.HemisphereLight(0xc5d4ea, 0x121016, 1.05));
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(14, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0x1a2436, side: THREE.BackSide })
  );
  room.add(sky);
  const cool = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 3.4),
    new THREE.MeshBasicMaterial({ color: 0xb7cbe4 })
  );
  cool.position.set(-1.2, 2.4, -5.4);
  room.add(cool);
  // Small lamp glint. The pane stays cool; this is only a reflection.
  const warm = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.1),
    new THREE.MeshBasicMaterial({ color: 0xffd7a4 })
  );
  warm.position.set(3.4, 1.1, -5.6);
  room.add(warm);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(8, 24),
    new THREE.MeshBasicMaterial({ color: 0x10141a })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.2;
  room.add(ground);
  const target = pmrem.fromScene(room, 0.02);
  sky.geometry.dispose();
  sky.material.dispose();
  cool.geometry.dispose();
  cool.material.dispose();
  warm.geometry.dispose();
  warm.material.dispose();
  ground.geometry.dispose();
  ground.material.dispose();
  pmrem.dispose();
  return target.texture;
}

function glassOnBeforeCompile(shader) {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute float aRim;\nvarying float vRim;'
    )
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvRim = aRim;'
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nvarying float vRim;'
    )
    .replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
       float rim = smoothstep(0.18, 0.86, clamp(vRim, 0.0, 1.0));
       vec3 cool = vec3(0.74, 0.86, 1.0);
       vec3 body = gl_FragColor.rgb * vec3(0.55, 0.72, 0.92);
       gl_FragColor.rgb = mix(body, cool, rim);
       gl_FragColor.rgb += cool * rim * rim * 1.15;
       gl_FragColor.a = mix(0.07, 0.93, rim);`
    );
}

function makeBaseMaterial(envMap) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xe4eef8,
    metalness: 0,
    roughness: 0.02,
    clearcoat: 0,
    ior: 1.45,
    transmission: 0,
    transparent: true,
    opacity: 1,
    envMap,
    envMapIntensity: 1.7,
    emissive: 0x0c1218,
    emissiveIntensity: 0.04,
    side: THREE.FrontSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  mat.onBeforeCompile = glassOnBeforeCompile;
  mat.customProgramCacheKey = () => 'harbor-glass-facet-v3';
  return mat;
}

export function createHarborGlassShards(renderer) {
  const envMap = nightDockEnv(renderer);
  const base = makeBaseMaterial(envMap);

  function make(opts) {
    const rng = opts.rng || Math.random;
    const span = Math.max(0.05, opts.span || 0.12);
    const tint = TINTS[(opts.tint | 0) % TINTS.length];
    const { ring: unit, maxR } = shardRing(rng);
    const scale = (span * 0.5) / maxR;
    const ring = unit.map((p) => [p[0] * scale, p[1] * scale]);
    const thickness = Math.min(0.005, Math.max(0.0024, span * (0.014 + rng() * 0.008)));
    const radius = inradius(ring);
    let rimW = Math.min(span * 0.045, radius * 0.34);
    rimW = Math.max(0.0032, rimW);
    let inner = insetRing(ring, rimW);
    if (!inner) inner = insetRing(ring, rimW * 0.45);
    const geometry = buildPrismGeometry(ring, inner, thickness);
    const material = base.clone();
    material.color.setHex(tint);
    material.emissive.setHex(0x101820);
    material.emissiveIntensity = 0.035 + rng() * 0.02;
    material.roughness = 0.012 + rng() * 0.028;
    material.clearcoat = 0;
    material.envMap = envMap;
    material.envMapIntensity = 1.55 + rng() * 0.35;
    material.transparent = true;
    material.depthWrite = false;
    material.onBeforeCompile = glassOnBeforeCompile;
    material.customProgramCacheKey = () => 'harbor-glass-facet-v3';
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
