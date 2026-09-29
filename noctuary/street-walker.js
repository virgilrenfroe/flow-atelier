/**
 * Street passer — the same 16-frame side walk as the Signal plate,
 * grounded and translated from the quay deck into the street.
 * The façade plate in i0x-signal-holo.js is not touched.
 *
 * Path (world XZ, Harbor street module):
 *   quay deck east of the Rube gate, z = 2.22, x from −3.90 to 2.05
 *   quarter-turn (r 0.70) onto the east sidewalk of the center block
 *   south along that walk (x = 2.75) to z = −2.55, past the quay slab
 * He reverses in place at each end and walks back. Feet sit on the deck,
 * then step up onto the sidewalk.
 *
 * The body is one double-sided card. A yaw sweep that would show the
 * camera the edge (the about-face at a path end, or a heading change
 * after a drop) holds the start cell and the end cell and crossfades.
 * The silhouette stays the walk width instead of collapsing to a line.
 * A short yaw that never nears the edge still spins on the planted boot.
 *
 * Drag (same grab as a quay crate): pointer-down on the body, slide on the
 * deck / sidewalk plane, feet preview the drop. Release sets that XZ as the
 * new start. The route is the drop, then the closest point on this L, then
 * outbound along the L (toward the street end, or back toward the quay when
 * that remainder is the walk that is left). He still turns at the far end
 * and returns to the drop.
 *
 * ?walker=0 / ?walker=off hides him. ?shot=walker frames the turn.
 */
import * as THREE from 'three';
import { crossStyle, planCardTurn, presentYaw } from './street-walker-turn.js';

const FPS = 6;
const FRAMES = 16;
const CELL_W = 320;
const CELL_H = 574;
// Sole sits this far up from the bottom of the cell (46px of plate below the boot).
const FOOT_FRAC = 47 / CELL_H;
// Eye ~0.58 above the sole at this height. Door on the quay is ~0.60.
const HEIGHT = 0.96;
const WIDTH = HEIGHT * (CELL_W / CELL_H);
const BODY_LIFT = HEIGHT * 0.5 - FOOT_FRAC * HEIGHT;
const TURN_S = 1.02;
const DRAG_LIFT = 0.05;
// Share of each frame the support boot stays glued before the push.
const PLANT_HOLD = 0.4;

// Support-boot travel, in cell pixels, frame i → i+1.
// Measured on the stance sole (the boot that slides left in the cell while
// the nose points right). Frame 8→9 is the double-support beat: both soles
// stay down, so the body holds. Two stances, eight frames each.
const STEP_PX = [
  5.6, 32.7, 13.9, 31.3, 30.7, 40.6, 12.0, 25.2,
  0.0, 31.3, 20.9, 29.1, 29.5, 33.5, 9.6, 36.6,
];

// Sole x in the cell. A starts rear and becomes the second stance foot.
// B starts at the nose and is the first stance foot. Used to pivot a turn
// on the boot that is actually down.
const FOOT_A = [
  66.1, 70.9, 96.3, 109.7, 178.4, 222.0, 233.9, 249.4,
  259.7, 256.6, 225.3, 204.4, 175.3, 145.8, 112.3, 102.7,
];
const FOOT_B = [
  261.9, 256.3, 223.6, 209.7, 178.4, 147.7, 107.1, 95.1,
  69.9, 69.9, 93.9, 114.6, 175.3, 234.4, 239.6, 254.7,
];

const STEP_SUM = STEP_PX.reduce((a, b) => a + b, 0);
const CUM = [0];
for (let i = 0; i < STEP_PX.length; i++) CUM.push(CUM[i] + STEP_PX[i] / STEP_SUM);
const STRIDE = (STEP_SUM / CELL_W) * WIDTH;

const QUAY_Y = 0.046;
const WALK_Y = 0.088;
const ROAD_Y = 0.02;
const CURB_Y = 0.114;

// Same street module as harbor/main.js, so a drop can find the sidewalk.
const STREET_W = 1.65;
const SIDEWALK_W = 0.5;
const BLOCK_W = 5;
const BLOCK_D = 4.4;
const GRID_COLS = 5;
const GRID_ROWS = 4;
const CELL_X = BLOCK_W + STREET_W;
const CELL_Z = BLOCK_D + STREET_W;
const DISTRICT_W = GRID_COLS * BLOCK_W + (GRID_COLS + 1) * STREET_W;
const GRID_OX = -DISTRICT_W * 0.5 + STREET_W;
const GRID_OZ = 1.15;

const VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Atlas leads. A hue-preserving gain on the dark cloth, a thin rim,
// and less night fog than the first passer. No body tint.
// No slice glitch — a torn boot reads as a pop, not a step.
const FRAG = /* glsl */`
uniform float uTime;
uniform float uPulse;
uniform float uLive;
uniform float uFrame;
uniform sampler2D uMap;
uniform vec2 uGrid;
uniform float uFrames;
uniform float uAlpha;
uniform float uFlip;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;

vec3 srgbToLinear(vec3 c) {
  return mix(
    c * 0.0773993808,
    pow(max(c * 0.9478672986 + 0.0521327014, 0.0), vec3(2.4)),
    step(vec3(0.04045), c)
  );
}

void main() {
  float frame = floor(mod(uFrame, uFrames));
  if (uLive < 0.5) frame = 0.0;
  float colI = mod(frame, uGrid.x);
  float rowI = floor(frame / uGrid.x);
  vec2 cell = clamp(vUv, 0.0, 1.0);
  vec2 uvA = vec2(
    (colI + cell.x) / uGrid.x,
    1.0 - (rowI + (1.0 - cell.y)) / uGrid.y
  );
  vec3 rawA = texture2D(uMap, uvA).rgb;
  float peakA = max(rawA.r, max(rawA.g, rawA.b));
  vec3 tex = vec3(0.0);
  float presence = 0.0;
  // uFlip 0 is the authored cell, unchanged. A half-turn mirrors across
  // the same card so the body never rotates through its edge.
  if (uFlip <= 0.001) {
    if (peakA < 0.016) discard;
    tex = srgbToLinear(rawA);
    presence = smoothstep(0.018, 0.032, peakA);
  } else {
    vec2 cellB = vec2(1.0 - cell.x, cell.y);
    vec2 uvB = vec2(
      (colI + cellB.x) / uGrid.x,
      1.0 - (rowI + (1.0 - cellB.y)) / uGrid.y
    );
    vec3 rawB = texture2D(uMap, uvB).rgb;
    float peakB = max(rawB.r, max(rawB.g, rawB.b));
    float k = clamp(uFlip, 0.0, 1.0);
    float aA = smoothstep(0.018, 0.032, peakA) * (1.0 - k);
    float aB = smoothstep(0.018, 0.032, peakB) * k;
    float outA = aB + aA * (1.0 - aB);
    vec3 colA = srgbToLinear(rawA);
    vec3 colB = srgbToLinear(rawB);
    if (outA < 0.004) discard;
    tex = (colB * aB + colA * aA * (1.0 - aB)) / max(outA, 1.0e-4);
    presence = clamp(outA, 0.0, 1.0);
  }
  float luma = dot(tex, vec3(0.2126, 0.7152, 0.0722));
  // Dark cloth only. Same hue as the cell; trim and skin stay near 1.
  float shadow = 1.0 - smoothstep(0.004, 0.08, luma);
  vec3 col = tex * mix(1.08, 1.85, shadow);

  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = pow(1.0 - ndv, 2.4);
  float line = smoothstep(0.94, 0.995, fract(vUv.y * 22.0 - uTime * 0.35));
  float scanPhase = fract(uTime * 0.13 + 0.2);
  float scan = exp(-abs(vUv.y - scanPhase) * 16.0);
  float edge = smoothstep(0.45, 0.98, fwidth(presence));

  vec3 gold = vec3(0.96, 0.74, 0.26);
  vec3 violet = vec3(0.62, 0.50, 0.84);
  col *= 1.0 - line * 0.05;
  col += gold * line * 0.18;
  col += gold * scan * (0.06 + 0.02 * uPulse);
  col += violet * edge * 0.16;
  col += violet * fresnel * edge * 0.08;

  // Less of the night fog than the first passer, so the cell color survives.
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-0.000324 * dist * dist * 12.0);
  col = mix(col, vec3(0.020, 0.024, 0.039), clamp(fog, 0.0, 0.22));

  gl_FragColor = vec4(col, clamp(presence, 0.0, 1.0) * uAlpha);
}
`;

function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function smootherstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

// The boot is planted at the keyframe. Translation waits, then catches the
// next sole so the hold does not skate and the push lands on the frame change.
function plantEase(f) {
  const x = Math.min(1, Math.max(0, f));
  if (x <= PLANT_HOLD) return 0;
  return smoothstep((x - PLANT_HOLD) / (1 - PLANT_HOLD));
}

function wrapPhase(phase) {
  return ((phase % FRAMES) + FRAMES) % FRAMES;
}

function phaseNorm(phase) {
  const p = wrapPhase(phase);
  const i = Math.floor(p);
  const f = plantEase(p - i);
  const a = CUM[i];
  const b = CUM[i + 1];
  return a + (b - a) * f;
}

function sampleTrack(track, phase) {
  const p = wrapPhase(phase);
  const i = Math.min(FRAMES - 1, Math.floor(p));
  const f = p - i;
  return track[i] + (track[(i + 1) % FRAMES] - track[i]) * f;
}

function footLocalX(px) {
  return (px / CELL_W - 0.5) * WIDTH;
}

function blockRect(bx, bz) {
  const x0 = GRID_OX + bx * CELL_X;
  const z1 = GRID_OZ - bz * CELL_Z;
  return { x0, x1: x0 + BLOCK_W, z0: z1 - BLOCK_D, z1 };
}

function blockContaining(x, z) {
  for (let bz = 0; bz < GRID_ROWS; bz++) {
    for (let bx = 0; bx < GRID_COLS; bx++) {
      const b = blockRect(bx, bz);
      if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return b;
    }
  }
  return null;
}

function onSidewalk(x, z) {
  const sw = SIDEWALK_W;
  for (let bz = 0; bz < GRID_ROWS; bz++) {
    for (let bx = 0; bx < GRID_COLS; bx++) {
      const b = blockRect(bx, bz);
      if (x >= b.x0 - sw && x <= b.x1 + sw && z >= b.z1 && z <= b.z1 + sw) return true;
      if (x >= b.x0 - sw && x <= b.x1 + sw && z <= b.z0 && z >= b.z0 - sw) return true;
      if (z >= b.z0 && z <= b.z1 && x >= b.x1 && x <= b.x1 + sw) return true;
      if (z >= b.z0 && z <= b.z1 && x <= b.x0 && x >= b.x0 - sw) return true;
    }
  }
  return false;
}

function onCurb(x, z) {
  const sw = SIDEWALK_W;
  const cw = 0.08;
  for (let bz = 0; bz < GRID_ROWS; bz++) {
    for (let bx = 0; bx < GRID_COLS; bx++) {
      const b = blockRect(bx, bz);
      if (x >= b.x0 - sw && x <= b.x1 + sw && z >= b.z1 + sw && z <= b.z1 + sw + cw) return true;
      if (x >= b.x0 - sw && x <= b.x1 + sw && z <= b.z0 - sw && z >= b.z0 - sw - cw) return true;
      if (z >= b.z0 - sw && z <= b.z1 + sw && x >= b.x1 + sw && x <= b.x1 + sw + cw) return true;
      if (z >= b.z0 - sw && z <= b.z1 + sw && x <= b.x0 - sw && x >= b.x0 - sw - cw) return true;
    }
  }
  return false;
}

function onQuayDeck(x, z) {
  return Math.abs(x) <= 11.05 && z >= 1.0 && z <= 5.35;
}

function groundY(x, z) {
  let k = onSidewalk(x, z) ? 1 : 0;
  // The path's quarter-turn rises off the deck onto the east walk.
  if (k < 1 && z > 1.65 && z < 2.0 && x > 1.5 && x < 3.15) {
    k = Math.max(k, 1 - (z - 1.65) / 0.35);
  }
  k = smoothstep(k);
  if (k > 0) {
    const base = onQuayDeck(x, z) ? QUAY_Y : ROAD_Y;
    return base + (WALK_Y - base) * k;
  }
  if (onCurb(x, z)) return CURB_Y;
  if (onQuayDeck(x, z)) return QUAY_Y;
  return ROAD_Y;
}

function clampWalkable(x, z) {
  x = Math.min(17.2, Math.max(-17.2, x));
  z = Math.min(5.08, Math.max(-22.4, z));
  // The open deck stops at the quay slab. Streets inland of it run wider.
  if (z > 1.72) x = Math.min(10.7, Math.max(-10.7, x));
  const pad = SIDEWALK_W * 0.42;
  for (let n = 0; n < 2; n++) {
    const b = blockContaining(x, z);
    if (!b) break;
    const dl = x - b.x0;
    const dr = b.x1 - x;
    const ds = z - b.z0;
    const dn = b.z1 - z;
    const m = Math.min(dl, dr, ds, dn);
    if (m === dl) x = b.x0 - pad;
    else if (m === dr) x = b.x1 + pad;
    else if (m === ds) z = b.z0 - pad;
    else z = b.z1 + pad;
  }
  return { x, z };
}

function buildPath() {
  const pts = [];
  function push(x, z) {
    const last = pts[pts.length - 1];
    if (last && (last.x - x) * (last.x - x) + (last.z - z) * (last.z - z) < 1e-8) return;
    pts.push(new THREE.Vector3(x, 0, z));
  }
  const x0 = -3.9;
  const zQuay = 2.22;
  const arcR = 0.7;
  const arcCx = 2.05;
  const arcCz = zQuay - arcR;
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    push(x0 + (arcCx - x0) * t, zQuay);
  }
  for (let i = 1; i <= 12; i++) {
    const ang = (i / 12) * (Math.PI / 2);
    push(arcCx + Math.sin(ang) * arcR, arcCz + Math.cos(ang) * arcR);
  }
  const endZ = -2.55;
  const streetX = arcCx + arcR;
  for (let i = 1; i <= 32; i++) {
    const t = i / 32;
    push(streetX, arcCz + (endZ - arcCz) * t);
  }
  return finishRoute(pts);
}

function finishRoute(pts) {
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, len, total: len[len.length - 1] || 0 };
}

const PATH = buildPath();

function sampleRoute(route, s) {
  const total = route.total;
  const d = Math.min(total, Math.max(0, s));
  const len = route.len;
  const pts = route.pts;
  if (pts.length < 2 || total < 1e-6) {
    const p = pts[0] ? pts[0].clone() : new THREE.Vector3();
    return { p, t: new THREE.Vector3(1, 0, 0) };
  }
  let i = 1;
  while (i < len.length - 1 && len[i] < d) i++;
  const span = len[i] - len[i - 1] || 1;
  const f = (d - len[i - 1]) / span;
  const p = new THREE.Vector3().lerpVectors(pts[i - 1], pts[i], f);
  const t = new THREE.Vector3().subVectors(pts[i], pts[i - 1]);
  if (t.lengthSq() < 1e-8) t.set(1, 0, 0);
  else t.normalize();
  return { p, t };
}

function closestOnCanonical(x, z) {
  let bestS = 0;
  let bestD = Infinity;
  let bestX = PATH.pts[0].x;
  let bestZ = PATH.pts[0].z;
  for (let i = 1; i < PATH.pts.length; i++) {
    const a = PATH.pts[i - 1];
    const b = PATH.pts[i];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    let t = 0;
    if (len2 > 1e-10) {
      t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const d = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (d < bestD) {
      bestD = d;
      bestS = PATH.len[i - 1] + Math.sqrt(len2) * t;
      bestX = px;
      bestZ = pz;
    }
  }
  return { s: bestS, x: bestX, z: bestZ, dist: Math.sqrt(bestD) };
}

function appendSpan(pts, fromS, toS) {
  function push(x, z) {
    const last = pts[pts.length - 1];
    if (last && (last.x - x) * (last.x - x) + (last.z - z) * (last.z - z) < 1e-8) return;
    pts.push(new THREE.Vector3(x, 0, z));
  }
  const a = sampleRoute(PATH, fromS).p;
  push(a.x, a.z);
  if (Math.abs(toS - fromS) < 1e-4) return;
  if (toS > fromS) {
    for (let i = 1; i < PATH.pts.length; i++) {
      if (PATH.len[i] > fromS + 1e-4 && PATH.len[i] < toS - 1e-4) push(PATH.pts[i].x, PATH.pts[i].z);
    }
  } else {
    for (let i = PATH.pts.length - 2; i >= 0; i--) {
      if (PATH.len[i] < fromS - 1e-4 && PATH.len[i] > toS + 1e-4) push(PATH.pts[i].x, PATH.pts[i].z);
    }
  }
  const b = sampleRoute(PATH, toS).p;
  push(b.x, b.z);
}

// Drop is s = 0. He walks to the closest point on the L, then outbound.
// Outbound is toward the street end. If that remainder is under half a metre
// and the quay side is longer, outbound is back toward the quay end instead.
function buildRouteFromDrop(x, z) {
  const near = closestOnCanonical(x, z);
  const outbound = PATH.total - near.s;
  const inbound = near.s;
  const goOut = outbound >= 0.55 || outbound >= inbound;
  const pts = [];
  const lastPush = (px, pz) => {
    const last = pts[pts.length - 1];
    if (last && (last.x - px) * (last.x - px) + (last.z - pz) * (last.z - pz) < 1e-8) return;
    pts.push(new THREE.Vector3(px, 0, pz));
  };
  lastPush(x, z);
  appendSpan(pts, near.s, goOut ? PATH.total : 0);
  const route = finishRoute(pts);
  route.meta = {
    nearS: near.s,
    nearX: near.x,
    nearZ: near.z,
    lead: near.dist,
    outbound: goOut,
  };
  return route;
}

function yawFor(dir, tangent) {
  const tx = dir * tangent.x;
  const tz = dir * tangent.z;
  // Nose is local +X (right side of the cell). Aim that along travel.
  return Math.atan2(-tz, tx);
}

function dampYaw(yaw, target, gain) {
  let d = target - yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return yaw + d * gain;
}

export function mountStreetWalker(opts) {
  const parent = opts.parent;
  const enabled0 = opts.enabled !== false;
  const camera = opts.camera || null;
  const controls = opts.controls || null;
  const dom = opts.domElement || null;
  const input = opts.input || null;
  const allowDrag = opts.allowDrag || (() => true);

  const map = new THREE.TextureLoader().load(
    new URL('./textures/signal-holo-cyber-man-walk.png?v=smooth16', import.meta.url).href
  );
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = true;
  map.anisotropy = Math.min(8, opts.anisotropy || 4);
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;

  const uniforms = {
    uTime: { value: 0 },
    uPulse: { value: 1 },
    uLive: { value: 1 },
    uFrame: { value: 0 },
    uMap: { value: map },
    uGrid: { value: new THREE.Vector2(4, 4) },
    uFrames: { value: FRAMES },
    uAlpha: { value: 1 },
    uFlip: { value: 0 },
  };
  // The about-face ghost shares the walk frame. Only its fade differs,
  // so the two cells stay on the same boot.
  const ghostUniforms = { ...uniforms, uAlpha: { value: 0 } };
  function walkerMaterial(name, matsUniforms) {
    return new THREE.ShaderMaterial({
      name,
      uniforms: matsUniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
  }
  const material = walkerMaterial('StreetWalker', uniforms);
  const ghostMat = walkerMaterial('StreetWalkerTurn', ghostUniforms);

  const root = new THREE.Group();
  root.name = 'street-walker';

  const cardGeo = new THREE.PlaneGeometry(WIDTH, HEIGHT);
  const figure = new THREE.Mesh(cardGeo, material);
  figure.name = 'street-walker-figure';
  figure.renderOrder = 4;
  figure.userData.streetWalker = true;
  // Bright trim clears the bloom threshold. The coat does not.
  if (opts.bloomLayer != null) figure.layers.enable(opts.bloomLayer);
  root.add(figure);

  // Second cell for a thin yaw sweep. Hidden while he walks. Drawn after
  // the figure so the fade composites over the start pose. depthWrite stays
  // off, so the two cards do not fight when a half-turn puts them on one plane.
  const ghost = new THREE.Mesh(cardGeo, ghostMat);
  ghost.name = 'street-walker-turn';
  ghost.renderOrder = 5;
  ghost.visible = false;
  ghost.raycast = () => {};
  if (opts.bloomLayer != null) ghost.layers.enable(opts.bloomLayer);
  root.add(ghost);

  // A thicker volume than the card, so a crate-style grab can catch him
  // when the plane is nearly edge-on. Not drawn.
  const hitBox = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH * 1.05, HEIGHT * 0.9, 0.42),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hitBox.name = 'street-walker-hit';
  hitBox.visible = false;
  hitBox.layers.set(2);
  hitBox.userData.streetWalker = true;
  figure.add(hitBox);

  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x05060a,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 18), shadowMat);
  shadow.name = 'street-walker-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.15, 0.62, 1);
  shadow.renderOrder = 2;
  root.add(shadow);

  root.visible = enabled0;
  parent.add(root);

  let route = {
    pts: PATH.pts.map((p) => p.clone()),
    len: PATH.len.slice(),
    total: PATH.total,
    meta: null,
  };
  let home = null;
  let s = 0;
  let dir = 1;
  let phase = 0;
  let mode = 'walk';
  let turnT = 0;
  let turnDur = TURN_S;
  let turnDelta = Math.PI;
  let turnFlip = true;
  let yaw0 = 0;
  let yaw = 0;
  let age = 0;
  let blendT = 1;
  const blendFrom = new THREE.Vector3();
  let settleFrom = 0;
  let settleTarget = 0;
  let settleFoot = 'B';
  let settleT = 0;
  let settleDur = 0.2;
  let settleDuringTurn = false;
  const footAnchor = new THREE.Vector3();
  let pivotLx = 0;
  let turnPlan = null;
  let turnFade = 0;
  let turnHeld = false;
  const turnHold = { x: 0, z: 0 };

  let dragging = false;
  let dragMoved = 0;
  let dragOffX = 0;
  let dragOffZ = 0;
  const dragOrigin = new THREE.Vector3();

  const raycaster = new THREE.Raycaster();
  raycaster.layers.set(2);
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const rayHit = new THREE.Vector3();

  function viewXZ() {
    if (!camera) return { vx: 0, vz: 0 };
    return {
      vx: camera.position.x - root.position.x,
      vz: camera.position.z - root.position.z,
    };
  }

  function clearTurn() {
    turnPlan = null;
    turnFade = 0;
    turnHeld = false;
    uniforms.uAlpha.value = 1;
    uniforms.uFlip.value = 0;
    ghostUniforms.uAlpha.value = 0;
    ghost.visible = false;
  }

  function armTurn() {
    const v = viewXZ();
    turnPlan = planCardTurn(yaw0, turnDelta, v.vx, v.vz);
    if (turnPlan.kind === 'cross') {
      turnPlan.style = crossStyle(turnPlan.startShown, turnPlan.endShown);
    }
    turnFade = 0;
    turnHeld = false;
  }

  function commit(x, z, lift) {
    const g = groundY(x, z);
    root.position.set(x, g + BODY_LIFT + (lift || 0), z);
    const cross = !dragging && mode === 'turn' && turnPlan && turnPlan.kind === 'cross';
    if (cross && turnPlan.style === 'flip') {
      // Same plane, opposite nose. Mirror the cell; do not yaw the card.
      figure.rotation.y = turnPlan.startShown;
      uniforms.uAlpha.value = 1;
      uniforms.uFlip.value = turnFade;
      ghostUniforms.uAlpha.value = 0;
      ghost.visible = false;
    } else if (cross) {
      // Two headings. Each card stays put, so neither passes the edge.
      uniforms.uFlip.value = 0;
      figure.rotation.y = turnPlan.startShown;
      uniforms.uAlpha.value = 1 - turnFade;
      ghost.rotation.y = turnPlan.endShown;
      ghostUniforms.uAlpha.value = turnFade;
      ghost.visible = turnFade > 0.004;
    } else {
      const v = viewXZ();
      figure.rotation.y = presentYaw(yaw, v.vx, v.vz);
      uniforms.uAlpha.value = 1;
      uniforms.uFlip.value = 0;
      ghostUniforms.uAlpha.value = 0;
      ghost.visible = false;
    }
    shadow.position.y = (g + 0.012) - root.position.y;
    const held = (lift || 0) > 0;
    shadow.scale.set(held ? 0.82 : 1.15, held ? 0.46 : 0.62, 1);
    shadowMat.opacity = held ? 0.28 : 0.42;
    uniforms.uFrame.value = phase;
  }

  function placeOnPath() {
    const { p, t } = sampleRoute(route, s);
    if (mode === 'walk') yaw = yawFor(dir, t);
    let x = p.x;
    let z = p.z;
    if (blendT < 1) {
      const k = smoothstep(blendT);
      x = blendFrom.x + (p.x - blendFrom.x) * k;
      z = blendFrom.z + (p.z - blendFrom.z) * k;
    }
    commit(x, z, 0);
  }

  function placePivot() {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    commit(footAnchor.x - pivotLx * c, footAnchor.z + pivotLx * sn, 0);
  }

  function captureFootPx(px) {
    const lx = footLocalX(px);
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    footAnchor.set(root.position.x + lx * c, 0, root.position.z - lx * sn);
    pivotLx = lx;
  }

  function placeLocked(id) {
    // Keep the anchor captured when the settle began. Updating it from the
    // shifted body would let the sole skate.
    const track = id === 'A' ? FOOT_A : FOOT_B;
    pivotLx = footLocalX(sampleTrack(track, phase));
    placePivot();
  }

  function beginYaw() {
    mode = 'turn';
    turnT = 0;
    turnDur = TURN_S;
    turnDelta = Math.PI;
    turnFlip = true;
    yaw0 = yaw;
    if (!settleDuringTurn) {
      const mid = (sampleTrack(FOOT_A, phase) + sampleTrack(FOOT_B, phase)) * 0.5;
      captureFootPx(mid);
    }
    armTurn();
  }

  function beginYawToward(target) {
    let d = target - yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    mode = 'turn';
    turnT = 0;
    turnDelta = d;
    turnFlip = false;
    turnDur = Math.max(0.28, TURN_S * Math.min(1, Math.abs(d) / Math.PI));
    settleDuringTurn = false;
    yaw0 = yaw;
    const mid = (sampleTrack(FOOT_A, phase) + sampleTrack(FOOT_B, phase)) * 0.5;
    captureFootPx(mid);
    armTurn();
  }

  function beginArrive() {
    const p = wrapPhase(phase);
    settleDuringTurn = false;
    if (p < 0.35 || p > FRAMES - 0.35) {
      phase = 0;
      beginYaw();
      return;
    }
    if (Math.abs(p - 8) < 0.35) {
      phase = 8;
      beginYaw();
      return;
    }
    let target;
    let foot;
    let gap;
    if (p < 8) {
      target = 8;
      foot = 'B';
      gap = 8 - p;
    } else {
      target = 16;
      foot = 'A';
      gap = 16 - p;
    }
    settleFrom = p;
    settleTarget = target;
    settleFoot = foot;
    if (gap > 3.2) {
      settleDuringTurn = true;
      beginYaw();
      return;
    }
    mode = 'settle';
    settleT = 0;
    settleDur = Math.max(0.12, gap / FPS);
    captureFootPx(sampleTrack(foot === 'A' ? FOOT_A : FOOT_B, p));
  }

  function finishTurn() {
    const { p } = sampleRoute(route, s);
    const dx = root.position.x - p.x;
    const dz = root.position.z - p.z;
    blendFrom.set(root.position.x, root.position.y, root.position.z);
    blendT = (dx * dx + dz * dz) < 1e-4 ? 1 : 0;
    mode = 'walk';
    if (turnFlip) dir *= -1;
    settleDuringTurn = false;
    clearTurn();
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    placeOnPath();
  }

  function retarget(x, z) {
    const c = clampWalkable(x, z);
    route = buildRouteFromDrop(c.x, c.z);
    home = {
      x: c.x,
      z: c.z,
      nearS: route.meta.nearS,
      lead: route.meta.lead,
      outbound: route.meta.outbound,
    };
    s = 0;
    dir = 1;
    blendT = 1;
    settleDuringTurn = false;
    clearTurn();
    api.length = route.total;
    commit(c.x, c.z, 0);
    const heading = yawFor(1, sampleRoute(route, 0).t);
    let d = heading - yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < 0.35) {
      mode = 'walk';
      yaw = heading;
      placeOnPath();
    } else {
      beginYawToward(heading);
      placePivot();
    }
  }

  // Distance along the quay leg, just before the arc. ?shot=walker starts here.
  const cornerS = 5.2;

  function setPointer(e) {
    const rect = dom.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    pointer.x = ((e.clientX - rect.left) / w) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / h) * 2 + 1;
  }

  function hitDistance(e) {
    if (!api.enabled || !camera || !dom) return null;
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(hitBox, false);
    return hits.length ? hits[0].distance : null;
  }

  function projectGround(e) {
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    let y = groundY(root.position.x, root.position.z);
    for (let i = 0; i < 3; i++) {
      dragPlane.constant = -y;
      if (!raycaster.ray.intersectPlane(dragPlane, rayHit)) return null;
      const ny = groundY(rayHit.x, rayHit.z);
      if (Math.abs(ny - y) < 0.004) break;
      y = ny;
    }
    return rayHit;
  }

  function endDrag() {
    if (!dragging) return;
    const moved = dragMoved > 6
      || (root.position.x - dragOrigin.x) ** 2 + (root.position.z - dragOrigin.z) ** 2 > 0.05 * 0.05;
    dragging = false;
    window.__walkerGrabbed = null;
    if (dom) dom.style.cursor = '';
    if (controls && allowDrag()) controls.enabled = true;
    if (input) input.pointerDown = false;
    if (!moved) {
      if (mode === 'turn' && !settleDuringTurn) placePivot();
      else if (mode === 'settle') placeLocked(settleFoot);
      else placeOnPath();
      return;
    }
    retarget(root.position.x, root.position.z);
  }

  function onDown(e) {
    if (!api.enabled || !camera || !allowDrag()) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.defaultPrevented || window.__physGrabbed) return;
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(hitBox, false);
    if (!hits.length) return;
    const propDist = window.__harborPropDist;
    if (propDist != null && !(hits[0].distance < propDist - 1e-3)) return;
    const g = projectGround(e);
    if (!g) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    dragMoved = 0;
    dragOrigin.copy(root.position);
    dragOffX = root.position.x - g.x;
    dragOffZ = root.position.z - g.z;
    if (controls) controls.enabled = false;
    if (input) input.pointerDown = true;
    if (dom) dom.style.cursor = 'grabbing';
    window.__walkerGrabbed = true;
    try { dom.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
  }

  function onMove(e) {
    if (!dragging) {
      if (!api.enabled || !dom || !allowDrag() || window.__physGrabbed) {
        if (dom && dom.style.cursor === 'grab') dom.style.cursor = '';
        return;
      }
      const dist = hitDistance(e);
      dom.style.cursor = dist != null ? 'grab' : (dom.style.cursor === 'grab' ? '' : dom.style.cursor);
      return;
    }
    dragMoved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
    const g = projectGround(e);
    if (!g) return;
    const c = clampWalkable(g.x + dragOffX, g.z + dragOffZ);
    const dx = c.x - root.position.x;
    const dz = c.z - root.position.z;
    if (dx * dx + dz * dz > 1e-5) {
      const len = Math.hypot(dx, dz) || 1;
      yaw = dampYaw(yaw, yawFor(1, { x: dx / len, z: dz / len }), 0.45);
    }
    commit(c.x, c.z, DRAG_LIFT);
    window.__walkerGrabbed = { x: c.x, z: c.z };
  }

  function onUp() {
    endDrag();
  }

  if (dom && camera) {
    dom.addEventListener('pointerdown', onDown, true);
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onUp);
  }

  const api = {
    enabled: enabled0,
    root,
    length: PATH.total,
    stride: STRIDE,
    corner: cornerS,
    get dragging() { return dragging; },
    setEnabled(on) {
      api.enabled = !!on;
      root.visible = api.enabled;
      if (!api.enabled && dragging) endDrag();
    },
    hitDistance,
    retarget,
    probe(x, z) {
      const near = closestOnCanonical(x, z);
      return { y: groundY(x, z), clamp: clampWalkable(x, z), near };
    },
    mapping() {
      const a = route.pts[0];
      const b = route.pts[route.pts.length - 1];
      return {
        s,
        dir,
        mode,
        phase,
        route: route.total,
        canonical: PATH.total,
        home,
        start: a ? { x: a.x, z: a.z } : null,
        end: b ? { x: b.x, z: b.z } : null,
        outbound: route.meta ? route.meta.outbound : true,
        nearS: route.meta ? route.meta.nearS : 0,
        lead: route.meta ? route.meta.lead : 0,
      };
    },
    seek(distance) {
      s = Math.min(route.total, Math.max(0, distance));
      dir = 1;
      mode = 'walk';
      blendT = 1;
      settleDuringTurn = false;
      clearTurn();
      phase = 0;
      const cycles = s / STRIDE;
      const frac = cycles - Math.floor(cycles);
      let best = 0;
      let bestErr = 1;
      for (let i = 0; i <= 64; i++) {
        const ph = (i / 64) * FRAMES;
        const err = Math.abs(phaseNorm(ph) - frac);
        if (err < bestErr) { bestErr = err; best = ph; }
      }
      phase = best;
      placeOnPath();
    },
    frame(cam, ctrl) {
      cam.position.set(5.85, 1.72, 4.35);
      ctrl.target.set(1.85, 0.38, 1.55);
      if (ctrl.update) ctrl.update();
    },
    focus() {
      if (!camera || !controls) return null;
      const x = root.position.x;
      const y = root.position.y;
      const z = root.position.z;
      camera.position.set(x + 3.05, y + 0.85, z + 2.2);
      controls.target.set(x, y * 0.42, z);
      if (controls.update) controls.update();
      return { x, y, z };
    },
    update(dt, pulse, live) {
      if (!api.enabled) return;
      const moving = live == null ? 1 : live;
      uniforms.uPulse.value = pulse == null ? 1 : pulse;
      if (dragging) {
        uniforms.uLive.value = 1;
        uniforms.uFrame.value = phase;
        return;
      }
      uniforms.uLive.value = moving;
      if (moving > 0.5) age += dt;
      uniforms.uTime.value = age;
      if (moving < 0.5) {
        if (mode === 'walk') placeOnPath();
        return;
      }
      if (mode === 'settle') {
        settleT += dt;
        const u = smoothstep(Math.min(1, settleT / settleDur));
        phase = settleFrom + (settleTarget - settleFrom) * u;
        placeLocked(settleFoot);
        if (settleT >= settleDur) {
          phase = settleTarget % FRAMES;
          beginYaw();
          if (mode === 'turn' && !settleDuringTurn) placePivot();
        }
        return;
      }
      if (mode === 'turn') {
        turnT += dt;
        const u = Math.min(1, turnT / turnDur);
        if (settleDuringTurn) {
          const plantU = Math.min(1, u / 0.32);
          phase = settleFrom + (settleTarget - settleFrom) * smoothstep(plantU);
          if (plantU >= 1) phase = settleTarget % FRAMES;
        }
        const spinStart = turnFlip ? 0.28 : 0.08;
        const spinU = u <= spinStart ? 0 : smootherstep((u - spinStart) / (1 - spinStart));
        if (u >= 1) {
          finishTurn();
          return;
        }
        if (turnPlan && turnPlan.kind === 'cross') {
          if (!turnHeld) {
            turnHold.x = root.position.x;
            turnHold.z = root.position.z;
            turnHeld = true;
          }
          turnFade = spinU;
          // Stay on the planted spot. Orbiting the boot while the card is
          // held would skate the sprite sideways through the fade.
          if (settleDuringTurn) placeOnPath();
          else commit(turnHold.x, turnHold.z, 0);
        } else {
          const direct = turnPlan ? turnPlan.direct : turnDelta;
          yaw = yaw0 + direct * spinU;
          if (settleDuringTurn) placeOnPath();
          else placePivot();
        }
        return;
      }
      if (blendT < 1) blendT = Math.min(1, blendT + dt / 0.22);
      const prevN = phaseNorm(phase);
      phase += dt * FPS;
      let wrapped = false;
      if (phase >= FRAMES) {
        phase -= FRAMES;
        wrapped = true;
      }
      let dN = phaseNorm(phase) - prevN;
      if (wrapped) dN += 1;
      if (dN < 0) dN = 0;
      const next = s + dir * STRIDE * dN;
      // A planted hold reports dN = 0. Sitting on an end must not count as
      // arriving again, or he turns in place forever.
      const crossed = dN > 0 && (next >= route.total || next <= 0);
      if (crossed) {
        s = next >= route.total ? route.total : 0;
        placeOnPath();
        beginArrive();
        if (mode === 'settle') placeLocked(settleFoot);
        else if (mode === 'turn' && !settleDuringTurn) placePivot();
        else placeOnPath();
        return;
      }
      s = next;
      placeOnPath();
    },
    pose() {
      return {
        s,
        dir,
        phase,
        mode,
        x: root.position.x,
        y: root.position.y,
        z: root.position.z,
        yaw,
        shown: figure.rotation.y,
        plan: turnPlan ? turnPlan.kind : null,
        style: turnPlan && turnPlan.style ? turnPlan.style : null,
        fade: turnFade,
        dragging,
        route: route.total,
      };
    },
  };

  placeOnPath();
  return api;
}
