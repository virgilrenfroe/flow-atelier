/**
 * Street passer — the same 16-frame side walk as the Signal plate,
 * grounded and translated from the quay deck into the street.
 * The façade plate in i0x-signal-holo.js is not touched.
 *
 * Path (world XZ, Harbor street module):
 *   quay deck east of the Rube gate, z = 2.22, x from −3.90 to 2.05
 *   quarter-turn (r 0.70) onto the east sidewalk of the center block
 *   south along that walk (x = 2.75) to z = −2.55, past the quay slab
 * He reverses in place at each end and walks back. Feet stay on the deck,
 * then step up onto the sidewalk. Stride length is the measured
 * contact-to-contact travel of the support boot so the plant does not skate.
 *
 * ?walker=0 / ?walker=off hides him. ?shot=walker frames the turn.
 */
import * as THREE from 'three';

const FPS = 6;
const FRAMES = 16;
const CELL_W = 320;
const CELL_H = 574;
// Sole sits this far up from the bottom of the cell (46px of plate below the boot).
const FOOT_FRAC = 47 / CELL_H;
// Eye ~0.58 above the sole at this height. Door on the quay is ~0.60.
const HEIGHT = 0.96;
const WIDTH = HEIGHT * (CELL_W / CELL_H);
const TURN_S = 0.7;

// Forward travel of the support boot, in cell pixels, frame i → i+1.
// The nose is on the right of the cell. A forward step moves the body that
// way, so the planted boot slides left in the sprite. Two stances.
const STEP_PX = [
  3.0, 41.1, 11.8, 36.6, 27.1, 37.4, 12.6, 28.5,
  0.0, 41.6, 18.5, 34.1, 26.2, 33.0, 10.3, 38.1,
];

const STEP_SUM = STEP_PX.reduce((a, b) => a + b, 0);
const CUM = [0];
for (let i = 0; i < STEP_PX.length; i++) CUM.push(CUM[i] + STEP_PX[i] / STEP_SUM);
const STRIDE = (STEP_SUM / CELL_W) * WIDTH;

const QUAY_Y = 0.046;
const WALK_Y = 0.088;

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

// Plate figure, retuned so a body this short still carries a scan.
// No slice glitch — a torn boot reads as a pop, not a step.
const FRAG = /* glsl */`
uniform float uTime;
uniform float uPulse;
uniform float uLive;
uniform float uFrame;
uniform sampler2D uMap;
uniform vec2 uGrid;
uniform float uFrames;
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
  vec2 uv = vec2(
    (colI + cell.x) / uGrid.x,
    1.0 - (rowI + (1.0 - cell.y)) / uGrid.y
  );
  vec3 raw = texture2D(uMap, uv).rgb;
  float peak = max(raw.r, max(raw.g, raw.b));
  float presence = smoothstep(0.018, 0.032, peak);
  if (peak < 0.016) discard;
  vec3 tex = srgbToLinear(raw);

  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = pow(1.0 - ndv, 2.4);
  float line = smoothstep(0.93, 0.995, fract(vUv.y * 22.0 - uTime * 0.35));
  float scanPhase = fract(uTime * 0.13 + 0.2);
  float scan = exp(-abs(vUv.y - scanPhase) * 16.0);
  float edge = smoothstep(0.22, 0.9, fwidth(presence));

  vec3 gold = vec3(0.96, 0.74, 0.26);
  vec3 violet = vec3(0.62, 0.50, 0.84);
  vec3 col = tex;
  col *= 1.0 - line * 0.06;
  col += gold * line * 0.22;
  col += gold * scan * (0.08 + 0.03 * uPulse);
  col += violet * edge * 0.38;
  col += violet * fresnel * edge * 0.16;

  // Same night exp fog as the district, so he sits in the air instead of as a sticker.
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-0.000324 * dist * dist * 12.0);
  col = mix(col, vec3(0.020, 0.024, 0.039), clamp(fog, 0.0, 0.72));

  gl_FragColor = vec4(col, clamp(presence, 0.0, 1.0));
}
`;

function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function phaseNorm(phase) {
  const p = ((phase % FRAMES) + FRAMES) % FRAMES;
  const i = Math.floor(p);
  const f = p - i;
  const a = CUM[i];
  const b = CUM[i + 1];
  return a + (b - a) * f;
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
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, len, total: len[len.length - 1] };
}

const PATH = buildPath();

function samplePath(s) {
  const total = PATH.total;
  const d = Math.min(total, Math.max(0, s));
  const len = PATH.len;
  const pts = PATH.pts;
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

function groundY(x, z) {
  const onEast = x >= 2.5 && x <= 3.02 && z <= 1.58 && z >= -3.3;
  const onNorth = z <= 1.65 && z >= 1.12 && x >= -3.05 && x <= 3.05;
  let k = (onEast || onNorth) ? 1 : 0;
  if (k < 1 && z > 1.65 && z < 2.0 && x > 1.5 && x < 3.15) {
    k = 1 - (z - 1.65) / 0.35;
  }
  k = smoothstep(k);
  return QUAY_Y + (WALK_Y - QUAY_Y) * k;
}

function yawFor(dir, tangent) {
  const tx = dir * tangent.x;
  const tz = dir * tangent.z;
  // Nose is local +X (right side of the cell). Aim that along travel.
  return Math.atan2(-tz, tx);
}

export function mountStreetWalker(opts) {
  const parent = opts.parent;
  const enabled0 = opts.enabled !== false;

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
  };
  const material = new THREE.ShaderMaterial({
    name: 'StreetWalker',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });

  const root = new THREE.Group();
  root.name = 'street-walker';

  const figure = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, HEIGHT), material);
  figure.name = 'street-walker-figure';
  figure.renderOrder = 4;
  figure.userData.streetWalker = true;
  root.add(figure);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 18),
    new THREE.MeshBasicMaterial({
      color: 0x05060a,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      toneMapped: false,
    })
  );
  shadow.name = 'street-walker-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.15, 0.62, 1);
  shadow.renderOrder = 2;
  root.add(shadow);

  root.visible = enabled0;
  parent.add(root);

  let s = 0;
  let dir = 1;
  let phase = 0;
  let mode = 'walk';
  let turnT = 0;
  let yaw0 = 0;
  let yaw1 = 0;
  let yaw = 0;
  let age = 0;

  function place() {
    const { p, t } = samplePath(s);
    const g = groundY(p.x, p.z);
    root.position.set(p.x, g + HEIGHT * 0.5 - FOOT_FRAC * HEIGHT, p.z);
    if (mode === 'walk') yaw = yawFor(dir, t);
    figure.rotation.y = yaw;
    shadow.position.y = (g + 0.012) - root.position.y;
    uniforms.uFrame.value = phase;
  }

  function beginTurn() {
    mode = 'turn';
    turnT = 0;
    const { t } = samplePath(s);
    yaw0 = yawFor(dir, t);
    yaw1 = yaw0 + Math.PI;
    yaw = yaw0;
  }

  // Distance along the quay leg, just before the arc. ?shot=walker starts here.
  const cornerS = 5.2;

  const api = {
    enabled: enabled0,
    root,
    length: PATH.total,
    stride: STRIDE,
    corner: cornerS,
    setEnabled(on) {
      api.enabled = !!on;
      root.visible = api.enabled;
    },
    seek(distance) {
      s = Math.min(PATH.total, Math.max(0, distance));
      dir = 1;
      mode = 'walk';
      phase = 0;
      // Match the pose to how far he has already walked.
      const cycles = s / STRIDE;
      const frac = cycles - Math.floor(cycles);
      // Invert phaseNorm approximately by scanning frames.
      let best = 0;
      let bestErr = 1;
      for (let i = 0; i <= 64; i++) {
        const ph = (i / 64) * FRAMES;
        const err = Math.abs(phaseNorm(ph) - frac);
        if (err < bestErr) { bestErr = err; best = ph; }
      }
      phase = best;
      place();
    },
    frame(camera, controls) {
      // Northeast of the turn, close enough that a body reads against the deck.
      // Quay leg crosses the frame; the sidewalk falls away into the street.
      camera.position.set(5.85, 1.72, 4.35);
      controls.target.set(1.85, 0.38, 1.55);
      if (controls.update) controls.update();
    },
    update(dt, pulse, live) {
      if (!api.enabled) return;
      const moving = live == null ? 1 : live;
      uniforms.uPulse.value = pulse == null ? 1 : pulse;
      uniforms.uLive.value = moving;
      if (moving > 0.5) age += dt;
      uniforms.uTime.value = age;
      if (moving < 0.5) {
        place();
        return;
      }
      if (mode === 'turn') {
        turnT += dt;
        const u = smoothstep(turnT / TURN_S);
        yaw = yaw0 + Math.PI * u;
        if (turnT >= TURN_S) {
          mode = 'walk';
          dir *= -1;
        }
        place();
        return;
      }
      const prevN = phaseNorm(phase);
      phase += dt * FPS;
      let wrapped = false;
      if (phase >= FRAMES) {
        phase -= FRAMES;
        wrapped = true;
      }
      // A negative boot step is double-support noise, not a loop.
      // Only the phase wrap carries the cycle boundary.
      let dN = phaseNorm(phase) - prevN;
      if (wrapped) dN += 1;
      if (dN < 0) dN = 0;
      const next = s + dir * STRIDE * dN;
      if (next >= PATH.total || next <= 0) {
        s = next >= PATH.total ? PATH.total : 0;
        beginTurn();
      } else {
        s = next;
      }
      place();
    },
    pose() {
      return { s, dir, phase, mode, x: root.position.x, y: root.position.y, z: root.position.z, yaw };
    },
  };

  place();
  return api;
}
