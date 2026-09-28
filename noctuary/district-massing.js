/**
 * A04 · Harbor procedural district massing.
 *
 * Technique transfer (no branding):
 * - Procedural terrain: value-noise fbm height field, low frequency for the
 *   skyline ridge and a faster octave for lot-to-lot roughness.
 * - The field is masked. Streets and alleys are negative space — mass is only
 *   emitted inside parcels, the way a road network masks a heightmap.
 * - Sliced model: each mass is stacked horizontal sections (podium, shaft,
 *   crown) with shrinking footprints, so the skyline reads as cut extrusions
 *   rather than one scaled box.
 *
 * Harbor grammar: axis-aligned night masses, quay row kept low, signal crowns
 * only on inland peaks, fenestra panes (mullion + cool glass, rare warm).
 * Does not touch street-atlas, prop-wear, or physics.
 */

const BASE_Y = 0.06;
const ALLEY_W = 0.7;
const MIN_FACE = 0.72;
const PODIUM_H = 1.42;

const TINT = {
  warm: 0xc47a4a,
  cool: 0x6e8fb5,
  violet: 0x8a7bb8,
  gold: 0xf0c24b,
  teal: 0x3a6e78,
};

function hash2(ix, iz) {
  let n = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

/** Value noise in 0..1. Stable for negative district coordinates. */
export function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz * (1 - fx) + (d - b) * fx * fz;
}

/** Fractional Brownian motion, normalized to 0..1. */
export function fbm(x, z) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    v += a * valueNoise(x * f, z * f);
    sum += a;
    f *= 2.03;
    a *= 0.5;
  }
  return v / sum;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function aabbHit(a, b, eps) {
  return Math.abs(a.x - b.x) < (a.hx + b.hx) - eps
    && Math.abs(a.z - b.z) < (a.hz + b.hz) - eps;
}

/**
 * Harbor street centerlines. Independent of how masses are emitted —
 * callers can recompute these and test footprints against them.
 */
export function streetCorridors(g) {
  const streets = [];
  const left = g.originX - g.streetW;
  const right = g.originX + g.cols * g.cellW;
  const hx = (right - left) * 0.5;
  const cx = (left + right) * 0.5;
  for (let r = 0; r <= g.rows; r++) {
    const z = g.originZ + g.streetW * 0.5 - r * g.cellD;
    streets.push({
      kind: 'street',
      axis: 'x',
      index: r,
      x: cx,
      z,
      hx,
      hz: g.streetW * 0.5,
    });
  }
  const zNear = g.originZ + g.streetW * 0.5;
  const zFar = g.originZ + g.streetW * 0.5 - g.rows * g.cellD;
  const cz = (zNear + zFar) * 0.5;
  const hz = Math.abs(zNear - zFar) * 0.5;
  for (let c = 0; c <= g.cols; c++) {
    const x = g.originX - g.streetW * 0.5 + c * g.cellW;
    streets.push({
      kind: 'street',
      axis: 'z',
      index: c,
      x,
      z: cz,
      hx: g.streetW * 0.5,
      hz,
    });
  }
  return streets;
}

function blockRect(bx, bz, g) {
  const x0 = g.originX + bx * g.cellW;
  const z1 = g.originZ - bz * g.cellD;
  return { x0, x1: x0 + g.blockW, z0: z1 - g.blockD, z1, bx, bz };
}

function resolveGrammar(options) {
  const streetW = options.streetW ?? 1.65;
  const blockW = options.blockW ?? 5;
  const blockD = options.blockD ?? 4.4;
  const cols = options.cols ?? 5;
  const rows = options.rows ?? 6;
  const originalRows = options.originalRows ?? 4;
  return {
    streetW,
    blockW,
    blockD,
    setback: options.setback ?? 0.32,
    originX: options.originX ?? -15.8,
    originZ: options.originZ ?? 1.15,
    cols,
    rows,
    originalRows,
    alleyW: options.alleyW ?? ALLEY_W,
    cellW: blockW + streetW,
    cellD: blockD + streetW,
  };
}

function heightFor(bz, rows, broad, lot) {
  const n = clamp01(broad * 0.58 + lot * 0.42);
  const quay = bz === 0;
  const hinter = bz >= rows - 2;
  const peak = !quay && !hinter && broad > 0.62 && lot > 0.66;
  if (quay) return { h: 1.35 + n * 2.5, n, peak: false, role: 'quay' };
  if (peak) return { h: 7.4 + ((broad + lot) * 0.5 - 0.64) * 14, n, peak: true, role: 'signal' };
  if (hinter) return { h: 1.85 + n * 4.8, n, peak: false, role: 'hinter' };
  return { h: 2.15 + n * 5.6, n, peak: false, role: 'harbor' };
}

function tintFor(role, slice, n) {
  if (slice === 2) return n > 0.72 ? TINT.gold : TINT.violet;
  if (role === 'quay') return n > 0.45 ? TINT.warm : TINT.gold;
  if (role === 'hinter') return n > 0.5 ? TINT.violet : TINT.cool;
  if (slice === 1 && n > 0.68) return TINT.teal;
  return n > 0.55 ? TINT.cool : TINT.violet;
}

function fitFootprint(parcel, fw, fd) {
  const maxW = Math.max(0.4, parcel.w - 0.06);
  const maxD = Math.max(0.4, parcel.d - 0.06);
  fw = Math.min(Math.max(fw, Math.min(MIN_FACE, maxW)), maxW);
  fd = Math.min(Math.max(fd, Math.min(MIN_FACE, maxD)), maxD);
  if (fw / fd > 2.6) fw = Math.min(maxW, fd * 2.6);
  if (fd / fw > 2.6) fd = Math.min(maxD, fw * 2.6);
  return { fw, fd };
}

function pushSlice(instances, spec) {
  instances.push({
    x: spec.x,
    y: spec.y,
    z: spec.z,
    w: spec.w,
    h: spec.h,
    d: spec.d,
    slice: spec.slice,
    seed: spec.seed,
    color: spec.color,
    role: spec.role,
    hx: spec.w * 0.5,
    hz: spec.d * 0.5,
  });
}

/**
 * Author the district. Returns instances, drawable extension surfaces,
 * corridor rects, and a clearance report.
 */
export function planDistrict(options = {}) {
  const g = resolveGrammar(options);
  const streets = streetCorridors(g);
  const corridors = streets.slice();
  const instances = [];
  const pads = [];
  const roads = [];
  let buildings = 0;
  let courts = 0;
  let alleys = 0;
  let heightMin = Infinity;
  let heightMax = 0;

  const left = g.originX - g.streetW;
  const right = g.originX + g.cols * g.cellW;
  const roadLen = right - left;
  const roadCx = (left + right) * 0.5;

  for (let r = g.originalRows + 1; r <= g.rows; r++) {
    const z = g.originZ + g.streetW * 0.5 - r * g.cellD;
    roads.push({
      kind: 'street',
      x: roadCx,
      z,
      len: roadLen,
      width: g.streetW * 0.98,
      rotY: 0,
      y: 0.016,
    });
    for (let bx = 0; bx < g.cols; bx++) {
      const b = blockRect(bx, 0, g);
      const dashX = (b.x0 + b.x1) * 0.5;
      roads.push({
        kind: 'dash',
        x: dashX,
        z,
        len: Math.min(1.7, g.blockW * 0.34),
        width: 0.07,
        rotY: 0,
        y: 0.022,
      });
    }
  }

  if (g.rows > g.originalRows) {
    const districtD = g.originalRows * g.blockD + (g.originalRows + 1) * g.streetW;
    const zMid = g.originZ - districtD * 0.5 + g.streetW * 0.5;
    const zInner = zMid - (districtD + 0.2) * 0.5;
    const zOuter = (g.originZ + g.streetW * 0.5 - g.rows * g.cellD) - g.streetW * 0.5;
    const z0 = Math.min(zInner + 0.08, zOuter);
    const z1 = Math.max(zInner + 0.08, zOuter);
    const segLen = z1 - z0;
    if (segLen > 0.4) {
      for (let c = 0; c <= g.cols; c++) {
        const x = g.originX - g.streetW * 0.5 + c * g.cellW;
        roads.push({
          kind: 'street',
          x,
          z: (z0 + z1) * 0.5,
          len: segLen,
          width: g.streetW * 0.98,
          rotY: Math.PI / 2,
          y: 0.012,
        });
      }
    }
  }

  for (let bz = 0; bz < g.rows; bz++) {
    for (let bx = 0; bx < g.cols; bx++) {
      const b = blockRect(bx, bz, g);
      const midX = (b.x0 + b.x1) * 0.5;
      const midZ = (b.z0 + b.z1) * 0.5;
      const broad = fbm(midX * 0.045 + 1.7, midZ * 0.05 - 0.8);
      const crossAlley = bz === 0 ? broad > 0.8 : broad > 0.56;
      corridors.push({
        kind: 'alley',
        axis: 'z',
        x: midX,
        z: midZ,
        hx: g.alleyW * 0.5,
        hz: (b.z1 - b.z0) * 0.5,
      });
      alleys++;
      if (bz >= g.originalRows) {
        roads.push({
          kind: 'alley',
          x: midX,
          z: midZ,
          len: b.z1 - b.z0 - 0.04,
          width: g.alleyW,
          rotY: Math.PI / 2,
          y: 0.014,
        });
      }
      if (crossAlley) {
        corridors.push({
          kind: 'alley',
          axis: 'x',
          x: midX,
          z: midZ,
          hx: (b.x1 - b.x0) * 0.5,
          hz: g.alleyW * 0.5,
        });
        alleys++;
        if (bz >= g.originalRows) {
          roads.push({
            kind: 'alley',
            x: midX,
            z: midZ,
            len: b.x1 - b.x0 - 0.04,
            width: g.alleyW,
            rotY: 0,
            y: 0.015,
          });
        }
      }

      const xSpans = [
        [b.x0 + g.setback, midX - g.alleyW * 0.5],
        [midX + g.alleyW * 0.5, b.x1 - g.setback],
      ];
      const zSpans = crossAlley
        ? [
          [b.z0 + g.setback, midZ - g.alleyW * 0.5],
          [midZ + g.alleyW * 0.5, b.z1 - g.setback],
        ]
        : [[b.z0 + g.setback, b.z1 - g.setback]];

      const parcels = [];
      for (let iz = 0; iz < zSpans.length; iz++) {
        for (let ix = 0; ix < xSpans.length; ix++) {
          const xs = xSpans[ix];
          const zs = zSpans[iz];
          const w = xs[1] - xs[0];
          const d = zs[1] - zs[0];
          if (w < 0.7 || d < 0.7) continue;
          const cx = (xs[0] + xs[1]) * 0.5;
          const cz = (zs[0] + zs[1]) * 0.5;
          const lot = fbm(cx * 0.19 + 8.2, cz * 0.17 + 3.4);
          const occ = fbm(cx * 0.27 + 40, cz * 0.23 - 6);
          parcels.push({ x0: xs[0], x1: xs[1], z0: zs[0], z1: zs[1], w, d, cx, cz, lot, occ });
        }
      }

      const ranked = parcels.slice().sort((a, c) => c.occ - a.occ);
      const must = ranked[0];
      for (const parcel of parcels) {
        // fbm sits near 0.5; the low tail is a court so a block is not a solid fill.
        const openCourt = parcel.occ < 0.40 && parcel !== must;
        const extension = bz >= g.originalRows;
        if (extension) {
          pads.push({
            x: parcel.cx,
            z: parcel.cz,
            w: parcel.w * 0.98,
            d: parcel.d * 0.98,
            court: openCourt,
          });
        }
        if (openCourt) {
          courts++;
          continue;
        }
        const foot = fbm(parcel.cx * 0.31 - 2.2, parcel.cz * 0.29 + 5.5);
        const sized = fitFootprint(
          parcel,
          parcel.w * (0.76 + 0.2 * foot),
          parcel.d * (0.74 + 0.22 * (1 - foot)),
        );
        const sample = heightFor(bz, g.rows, broad, parcel.lot);
        const h = Math.max(1.2, sample.h);
        const seed = fbm(parcel.cx * 0.07 + 2, parcel.cz * 0.07);
        const role = sample.role;
        buildings++;
        heightMin = Math.min(heightMin, h);
        heightMax = Math.max(heightMax, h);

        const sliced = h >= 3.6;
        const crowned = sample.peak && h >= 7.2;
        if (!sliced) {
          pushSlice(instances, {
            x: parcel.cx,
            y: BASE_Y,
            z: parcel.cz,
            w: sized.fw,
            h,
            d: sized.fd,
            slice: 0,
            seed,
            color: tintFor(role, 0, sample.n),
            role,
          });
          continue;
        }
        const podiumH = Math.min(PODIUM_H, h * 0.42);
        pushSlice(instances, {
          x: parcel.cx,
          y: BASE_Y,
          z: parcel.cz,
          w: sized.fw,
          h: podiumH,
          d: sized.fd,
          slice: 0,
          seed,
          color: tintFor(role, 0, sample.n),
          role,
        });
        let remain = h - podiumH;
        const crownH = crowned ? Math.min(1.05, remain * 0.24) : 0;
        const shaftH = Math.max(0.8, remain - crownH);
        const shaft = fitFootprint(parcel, sized.fw * 0.74, sized.fd * 0.74);
        pushSlice(instances, {
          x: parcel.cx,
          y: BASE_Y + podiumH,
          z: parcel.cz,
          w: shaft.fw,
          h: shaftH,
          d: shaft.fd,
          slice: 1,
          seed,
          color: tintFor(role, 1, sample.n),
          role,
        });
        if (crownH > 0.45) {
          const crown = fitFootprint(parcel, sized.fw * 0.48, sized.fd * 0.48);
          pushSlice(instances, {
            x: parcel.cx,
            y: BASE_Y + podiumH + shaftH,
            z: parcel.cz,
            w: crown.fw,
            h: crownH,
            d: crown.fd,
            slice: 2,
            seed,
            color: tintFor(role, 2, sample.n),
            role,
          });
        }
      }
    }
  }

  let overlaps = 0;
  const overlapSamples = [];
  for (const inst of instances) {
    for (const cor of corridors) {
      if (aabbHit(inst, cor, 0.012)) {
        overlaps++;
        if (overlapSamples.length < 6) {
          overlapSamples.push({
            building: { x: inst.x, z: inst.z, w: inst.w, d: inst.d, role: inst.role },
            corridor: { kind: cor.kind, axis: cor.axis, x: cor.x, z: cor.z },
          });
        }
      }
    }
  }

  const report = {
    seed: 'A04-harbor',
    cols: g.cols,
    rows: g.rows,
    originalRows: g.originalRows,
    instances: instances.length,
    buildings,
    courts,
    alleys,
    streets: streets.length,
    extensionSurfaces: roads.length,
    corridorsClear: overlaps === 0,
    overlaps,
    overlapSamples,
    heightMin: Number.isFinite(heightMin) ? heightMin : 0,
    heightMax,
    slices: {
      podium: instances.filter((i) => i.slice === 0).length,
      shaft: instances.filter((i) => i.slice === 1).length,
      crown: instances.filter((i) => i.slice === 2).length,
    },
  };

  return { grammar: g, instances, pads, roads, corridors, streets, report };
}

const MASS_VERT = /* glsl */`
  varying vec3 vColor;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec3 vLocalPos;
  varying vec3 vScale;
  varying float vSlice;
  varying float vSeed;
  attribute float aSlice;
  attribute float aSeed;
  void main(){
    vLocalPos = position;
    vSlice = aSlice;
    vSeed = aSeed;
    vec3 s = vec3(
      length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2])),
      length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2])),
      length(vec3(instanceMatrix[2][0], instanceMatrix[2][1], instanceMatrix[2][2]))
    );
    vScale = max(s, vec3(1e-4));
    mat3 rot = mat3(
      vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]) / vScale.x,
      vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]) / vScale.y,
      vec3(instanceMatrix[2][0], instanceMatrix[2][1], instanceMatrix[2][2]) / vScale.z
    );
    vec4 world = instanceMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vNormalW = normalize(rot * normal);
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(0.45, 0.55, 0.72);
    #endif
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const MASS_FRAG = /* glsl */`
  varying vec3 vColor;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec3 vLocalPos;
  varying vec3 vScale;
  varying float vSlice;
  varying float vSeed;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uTime;
  uniform float uLive;

  float hash(vec2 p){
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main(){
    vec3 N = normalize(vNormalW);
    float ndl = clamp(dot(N, normalize(vec3(0.35, 0.9, 0.2))), 0.0, 1.0);
    float isRoof = step(max(abs(N.x), abs(N.z)), abs(N.y));
    float isVert = 1.0 - isRoof;

    float warmBias = smoothstep(0.35, 0.75, vColor.r);
    float coolBias = smoothstep(0.35, 0.70, vColor.b);
    vec3 concCool = vec3(0.105, 0.118, 0.142);
    vec3 concWarm = vec3(0.138, 0.122, 0.108);
    vec3 conc = mix(concCool, concWarm, clamp(warmBias - coolBias * 0.35, 0.0, 1.0));
    conc = mix(conc, concCool, coolBias * 0.42);
    vec3 wall = mix(conc, vColor * 0.22, 0.28) + vec3(0.02, 0.022, 0.028) * ndl;
    vec3 lp = vLocalPos * vScale;
    vec2 cuv = (abs(N.x) >= abs(N.z)) ? vec2(lp.z, lp.y) : vec2(lp.x, lp.y);
    wall *= 1.0 + (noise(cuv * 7.5) - 0.5) * 0.08 * isVert;

    float cell = 0.76;
    float along = (abs(N.x) >= abs(N.z)) ? lp.z : lp.x;
    vec2 f = fract(vec2(along / cell, lp.y / cell));
    float storey = floor(max(lp.y, 0.0) / cell);
    float isShop = step(storey, 0.0) * (1.0 - step(0.5, vSlice));
    float crown = step(1.5, vSlice);
    float mullU = mix(mix(0.07, 0.045, isShop), 0.2, crown);
    float mullV = mix(mix(0.075, 0.05, isShop), 0.18, crown);
    float inPane = step(mullU, f.x) * step(f.x, 1.0 - mullU)
                 * step(mullV, f.y) * step(f.y, 1.0 - mullV);
    inPane *= step(0.1, lp.y) * step(lp.y, vScale.y - 0.16);
    inPane *= isVert;

    vec2 cellId = vec2(floor(along / cell), storey) + vSeed * 17.0;
    float h0 = hash(cellId);
    float h1 = hash(cellId + 4.2);
    float litThresh = mix(0.64, 0.42, isShop);
    litThresh = mix(litThresh, 0.84, crown);
    float lit = step(litThresh, h0);
    float flick = 1.0 - step(0.94, h1) * uLive * (0.35 + 0.4 * sin(uTime * (1.3 + h1) + h0 * 6.2));
    float warmPane = step(0.78, h1);
    vec3 coolGlass = vec3(0.42, 0.58, 0.78);
    vec3 warmGlass = vec3(0.95, 0.58, 0.24);
    vec3 darkGlass = vec3(0.018, 0.022, 0.034);
    vec3 interior = mix(darkGlass, mix(coolGlass, warmGlass, warmPane), lit * flick);

    vec3 V = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    vec3 refl = mix(vec3(0.16, 0.13, 0.08), vec3(0.11, 0.15, 0.26), clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
    vec3 glass = mix(interior, refl, fres * 0.55);
    glass = mix(glass, interior, lit * 0.62 * (1.0 - fres));
    vec3 col = mix(wall, glass, inPane);

    float podiumCap = (1.0 - step(0.5, vSlice)) * smoothstep(0.84, 0.96, vLocalPos.y) * isVert;
    col = mix(col, col * vec3(0.55, 0.56, 0.62), podiumCap);
    float lip = crown * smoothstep(0.72, 0.9, vLocalPos.y) * isVert;
    col = mix(col, vec3(0.62, 0.46, 0.16), lip * 0.72);
    col = mix(col, col * 0.72, isRoof);

    float dist = length(vWorldPos - cameraPosition);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 12.0);
    gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 0.9)), 1.0);
  }
`;

/**
 * Build the InstancedMesh district. `THREE` is passed in so this module
 * stays free of a hard import (Harbor's import map owns the three build).
 */
export function createDistrictMassing(THREE, options = {}) {
  const plan = planDistrict(options);
  const group = new THREE.Group();
  group.name = 'harbor-district-massing';
  group.visible = false;

  const asphalt = new THREE.MeshBasicMaterial({ color: 0x0a0c12 });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0x6a6244 });
  const alleyMat = new THREE.MeshBasicMaterial({ color: 0x10131a });
  const padMat = new THREE.MeshBasicMaterial({ color: 0x14171e });
  const courtMat = new THREE.MeshBasicMaterial({ color: 0x0c0e14 });

  const roadList = plan.roads.filter((r) => r.kind === 'street');
  const dashList = plan.roads.filter((r) => r.kind === 'dash');
  const alleyList = plan.roads.filter((r) => r.kind === 'alley');
  const dummy = new THREE.Object3D();

  function fillPlanes(list, material) {
    if (!list.length) return null;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    mesh.frustumCulled = false;
    list.forEach((r, i) => {
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(-Math.PI / 2, 0, r.rotY);
      dummy.scale.set(r.len, r.width, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = list.length;
    group.add(mesh);
    return mesh;
  }

  fillPlanes(roadList, asphalt);
  fillPlanes(dashList, dashMat);
  fillPlanes(alleyList, alleyMat);

  if (plan.pads.length) {
    const courts = plan.pads.filter((p) => p.court);
    const lots = plan.pads.filter((p) => !p.court);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const addPads = (list, material) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      mesh.frustumCulled = false;
      list.forEach((p, i) => {
        dummy.position.set(p.x, 0.02, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(p.w, 0.04, p.d);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = list.length;
      group.add(mesh);
    };
    addPads(lots, padMat);
    addPads(courts, courtMat);
  }

  const n = plan.instances.length;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const sliceAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  const seedAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  geo.setAttribute('aSlice', sliceAttr);
  geo.setAttribute('aSeed', seedAttr);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLive: { value: options.live === 0 ? 0 : 1 },
      uFogColor: { value: new THREE.Color(0x05060a) },
      uFogDensity: { value: 0.018 },
    },
    vertexShader: MASS_VERT,
    fragmentShader: MASS_FRAG,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  mesh.name = 'harbor-district-mass';
  mesh.frustumCulled = false;
  mesh.count = n;
  const color = new THREE.Color();
  plan.instances.forEach((inst, i) => {
    dummy.position.set(inst.x, inst.y, inst.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(inst.w, inst.h, inst.d);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setHex(inst.color);
    mesh.setColorAt(i, color);
    sliceAttr.setX(i, inst.slice);
    seedAttr.setX(i, inst.seed);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  sliceAttr.needsUpdate = true;
  seedAttr.needsUpdate = true;
  group.add(mesh);

  if (!plan.report.corridorsClear) {
    console.warn('Harbor district massing overlaps a corridor', plan.report.overlapSamples);
  }

  return {
    group,
    mesh,
    plan,
    report: plan.report,
    setEnabled(on) {
      group.visible = !!on;
    },
    update(t) {
      mat.uniforms.uTime.value = t;
    },
  };
}
