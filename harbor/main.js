import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { live } from './live.js';
import { createHarborScene } from './scene.js';
import { createHarborWater } from './water.js';
import { createHarborPhysics } from './physics.js';
import { createHarborPost } from './post.js';
import { createPerfMonitor, resolveFboTier } from './perf.js';
import { createHarborLoad } from './load.js';
import { installSwapGpu } from './swap-gpu.js';
import { installCitizen } from './citizen.js';

const harborLoad = createHarborLoad();

let perfMonitor = null;
let citizen = null;
function publishHarborMode(prev) {
  if (!perfMonitor || !prev) return;
  const next = live.tourMode ? 'tour' : (live.walkMode ? 'walk' : 'orbit');
  if (prev !== next) perfMonitor.onModeSwap(prev, next);
}

const params = new URLSearchParams(location.search);
let debugMode = params.has('debug'); // ?debug or ?debug=1; D toggles
const ROOM_FACE_NAMES = ['living','kitchen','master','study','kids','dining','den'];
const stillMode = params.has('still');
// Atlas (fenestra occupied-32 + shop) is the default interior path. Persist so Safari reopen keeps it.
// ?faces=1 / ?faces=on → force face-map. ?atlas=1 / ?faces=0 / ?faces=off → force atlas.
const FACES_KEY = 'noctuary-harbor-faces-v2'; // v2: atlas default (ignore old face-locked 'on')
function readFacesPref() {
  if (params.get('atlas') === '1' || params.get('faces') === '0' || params.get('faces') === 'off') return false;
  if (params.get('faces') === '1' || params.get('faces') === 'on') return true;
  try {
    const v = localStorage.getItem(FACES_KEY);
    if (v === 'off') return false;
    if (v === 'on') return true;
  } catch (_) {}
  return false; // default: occupied-32 + shop atlas interiors
}
const facesMode = readFacesPref();
try { localStorage.setItem(FACES_KEY, facesMode ? 'on' : 'off'); } catch (_) {}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const freezeMotion = reduceMotion || stillMode;

// Clean exhibit mode (Virgil): no on-screen instructional text by default.
// Persist: localStorage noctuary-harbor-hud = 'off' | 'on'
// Override: ?hud=1 show chrome · ?hud=0 force exhibit
const HUD_KEY = 'noctuary-harbor-hud';
function readHudPref() {
  if (params.has('hud')) return params.get('hud') === '1' || params.get('hud') === 'on';
  try {
    const v = localStorage.getItem(HUD_KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch (_) {}
  return false; // default exhibit
}
// Phones have no H key. Coarse pointer or a narrow viewport always shows #props-actions
// (CSS), including body.exhibit. This flag only suppresses the keyboard toast.
const quayTouchQuery = matchMedia('(max-width: 720px), (pointer: coarse)');
function quayTouchControls() {
  return quayTouchQuery.matches;
}
function syncHudToggle(show) {
  const btn = document.getElementById('hud-toggle');
  if (!btn) return;
  btn.classList.toggle('on', !!show);
  btn.setAttribute('aria-pressed', show ? 'true' : 'false');
  btn.title = show ? 'Hide exhibit chrome' : 'Show exhibit chrome';
}
function syncWalkToggle(on) {
  const btn = document.getElementById('walk-toggle');
  if (btn) {
    btn.classList.toggle('on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  document.body.classList.toggle('walking', !!on && quayTouchControls());
}
function syncTourToggle(on) {
  const btn = document.getElementById('tour-toggle');
  if (!btn) return;
  btn.classList.toggle('on', !!on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}
quayTouchQuery.addEventListener('change', () => {
  const walkBtn = document.getElementById('walk-toggle');
  const on = !!(walkBtn && walkBtn.classList.contains('on'));
  document.body.classList.toggle('walking', on && quayTouchControls());
});
function applyHud(show) {
  document.body.classList.toggle('exhibit', !show);
  const chrome = document.getElementById('chrome');
  if (chrome) {
    chrome.hidden = !show;
    chrome.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
  const propsAct = document.getElementById('props-actions');
  if (propsAct) propsAct.classList.toggle('show', !!show);
  syncHudToggle(show);
  // props-hint is exhibit-only toast — never restate actions when buttons are visible
  const ph = document.getElementById('props-hint');
  if (ph && (show || quayTouchControls())) ph.classList.remove('on');
  try { localStorage.setItem(HUD_KEY, show ? 'on' : 'off'); } catch (_) {}
}
let showHud = readHudPref();
live.showHud = showHud;
applyHud(showHud);
const hudToggleBtn = document.getElementById('hud-toggle');
if (hudToggleBtn) {
  hudToggleBtn.addEventListener('click', () => {
    showHud = !showHud;
    live.showHud = showHud;
    applyHud(showHud);
  });
}
const walkToggleBtn = document.getElementById('walk-toggle');
if (walkToggleBtn) {
  walkToggleBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('noctuary-toggle-walk'));
  });
}
const tourToggleBtn = document.getElementById('tour-toggle');
if (tourToggleBtn) {
  tourToggleBtn.addEventListener('click', () => {
    if (citizen && citizen.touring()) {
      citizen.stopTour(true);
    } else {
      window.dispatchEvent(new CustomEvent('noctuary-start-tour'));
    }
  });
}

// Citizen walk: ?walk=1 / localStorage noctuary-harbor-walk / key V
const WALK_KEY = 'noctuary-harbor-walk';
function readWalkPref() {
  if (params.get('walk') === '1' || params.get('walk') === 'on') return true;
  if (params.get('walk') === '0' || params.get('walk') === 'off') return false;
  try {
    const v = localStorage.getItem(WALK_KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch (_) {}
  return false;
}
let walkWanted = readWalkPref();



if (facesMode) {
  const blurb = document.getElementById('hero-blurb');
  if (blurb) {
    blurb.textContent = 'Face-map mode (?faces=1): five room-face textures by ray-box hit. Default Harbor uses fenestra occupied-32 + shop atlases; ?atlas=1 / ?faces=0 force atlas.';
  }
  const eyebrow = document.querySelector('.hero .eyebrow');
  if (eyebrow) eyebrow.textContent = 'Step 01 · face-mapped interiors · override';
}
window.addEventListener('keydown', (e) => {
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === 'h' || e.key === 'H') {
    showHud = !showHud;
    live.showHud = showHud;
    applyHud(showHud);
  }
  if (e.key === 'v' || e.key === 'V') {
    // Walk toggle — handler attached after PointerLock setup (see setWalkMode)
    window.dispatchEvent(new CustomEvent('noctuary-toggle-walk'));
  }
  if (e.key === 't' || e.key === 'T') {
    window.dispatchEvent(new CustomEvent('noctuary-start-tour'));
  }
  if (e.key === 'd' || e.key === 'D') {
    debugMode = !debugMode;
    const el = document.getElementById('debug-hud');
    if (el && !debugMode) el.classList.remove('on');
  }
  if (e.code === 'Space') {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('noctuary-props-toss'));
  }
  if (e.key === 'r' || e.key === 'R') {
    window.dispatchEvent(new CustomEvent('noctuary-props-reset'));
  }
  if (e.key === 'n' || e.key === 'N') {
    window.dispatchEvent(new CustomEvent('noctuary-wind-toggle'));
  }
  if (e.key === 'g' || e.key === 'G') {
    window.dispatchEvent(new CustomEvent('noctuary-springs-toggle'));
  }
  if (e.key === 'b' || e.key === 'B') {
    window.dispatchEvent(new CustomEvent('noctuary-props-blast'));
  }
  if (e.key === ',' || e.key === '<') {
    window.dispatchEvent(new CustomEvent('noctuary-wind-dir', { detail: -1 }));
  }
  if (e.key === '.' || e.key === '>') {
    window.dispatchEvent(new CustomEvent('noctuary-wind-dir', { detail: 1 }));
  }
  if (e.key === '[') {
    window.dispatchEvent(new CustomEvent('noctuary-wind-str', { detail: -1 }));
  }
  if (e.key === ']') {
    window.dispatchEvent(new CustomEvent('noctuary-wind-str', { detail: 1 }));
  }
});

const MOTIFS = ['Harbor', 'Quay', 'Signal'];
let motifIdx = 0;

const BLOOM_LAYER = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);


const perfTier = resolveFboTier(params);
live.tick = tick;
const {
  renderer, scene, camera, controls, ORBIT_FOV, WALK_FOV, EYE_H,
  fill, key, pointer, pointerSmooth, input,
} = createHarborScene({ freezeMotion, stillMode, tier: perfTier });


// ——— Shared GLSL helpers ———
const NOISE_GLSL = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash(i), b = hash(i+vec2(1.,0.));
  float c = hash(i+vec2(0.,1.)), d = hash(i+vec2(1.,1.));
  vec2 u = f*f*(3.-2.*f);
  return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
}
float fbm(vec2 p){
  float v=0., a=0.5;
  for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.02; a*=0.5; }
  return v;
}
`;

// ——— Urban grammar: streets → blocks → lots → buildings (pass 3 + irregular lots p4) ———
// Hierarchy refs: CityEngine / StreetGen / Purdue procedural; Three.js CityGenerator + SidewalkGenerator;
// arXiv:1801.05741; mysimulator procedural buildings. Negative space = asphalt corridors.
const STREET_W = 1.65;
const SIDEWALK_W = 0.50;
const CURB_H = 0.09;
const BLOCK_W = 5.0;   // lot area width (X) inside sidewalks
const BLOCK_D = 4.4;   // lot area depth (Z)
const SETBACK = 0.32;
const GRID_COLS = 5;   // blocks along quay (X)
const GRID_ROWS = 4;   // blocks toward hinterland (−Z)
const LOTS_X = 2;
const LOTS_Z = 2;

const cellW = BLOCK_W + STREET_W;
const cellD = BLOCK_D + STREET_W;
const districtW = GRID_COLS * BLOCK_W + (GRID_COLS + 1) * STREET_W;
const districtD = GRID_ROWS * BLOCK_D + (GRID_ROWS + 1) * STREET_W;
const gridOriginX = -districtW * 0.5 + STREET_W;
const gridOriginZ = 1.15; // first block near quay (+Z water), rows march −Z

function blockRect(bx, bz) {
  const x0 = gridOriginX + bx * cellW;
  const z1 = gridOriginZ - bz * cellD; // near edge (toward quay / +Z)
  return { x0, x1: x0 + BLOCK_W, z0: z1 - BLOCK_D, z1 };
}

// Photographic street sheet (street-atlas.png). 2048², 4×4, row 0 = top of the PNG
// (same V flip as sampleAtlas). Until the PNG packs in, uStreetOn stays 0 and the
// old night grade draws — a failed load must not black the district.
//   row0  asphalt | oil | lane paint | crosswalk
//   row1  sidewalk | stain | curb | curb alt
//   row2  iron wear | crate wear | asphalt macro | sidewalk macro
//   row3  asphalt detail | oil detail | iron detail | sheen
function streetPlaceholderTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 4;
  const g = c.getContext('2d');
  g.fillStyle = '#12141c';
  g.fillRect(0, 0, 4, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
const streetAtlasPlaceholder = streetPlaceholderTexture();
const STREET_CELL_GLSL = `
uniform sampler2D uStreetAtlas;
uniform float uStreetOn;
vec3 streetCell(float col, float row, vec2 huv) {
  vec2 cellSize = vec2(0.25);
  vec2 inset = cellSize * 0.014;
  vec2 cellOrigin = vec2(col * cellSize.x, 1.0 - (row + 1.0) * cellSize.y) + inset;
  return texture2D(uStreetAtlas, cellOrigin + clamp(huv, 0.0, 1.0) * (cellSize - 2.0 * inset)).rgb;
}
float streetLuma(vec3 c) { return dot(c, vec3(0.20, 0.72, 0.08)); }
`;

// Asphalt — photo grit, oil, tire wear; lane paint from the atlas (not a flat dash)
const asphaltMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0x05060a) },
    uFogDensity: { value: 0.018 },
    uStreetAtlas: { value: streetAtlasPlaceholder },
    uStreetOn: { value: 0 },
  },
  vertexShader: /* glsl */`
    attribute float aKind;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying float vKind;
    varying float vAlong;
    void main(){
      vUv = uv;
      vKind = aKind;
      vAlong = uv.x * length(instanceMatrix[0].xyz);
      vec4 wp = instanceMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying float vKind;
    varying float vAlong;
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    ${NOISE_GLSL}
    ${STREET_CELL_GLSL}
    vec3 streetAsphalt(vec3 world) {
      vec2 wuv = world.xz;
      vec3 grit = streetCell(0.0, 0.0, fract(wuv * 0.55));
      vec3 oil = streetCell(1.0, 0.0, fract(wuv * 0.28 + vec2(0.17, 0.38)));
      vec3 macro = streetCell(2.0, 2.0, fract(wuv * 1.85));
      float oilL = streetLuma(oil);
      vec3 photo = mix(grit, oil, smoothstep(0.08, 0.30, oilL) * 0.82);
      float l = streetLuma(photo);
      // Keep the photograph's own deviation. A luma-only grade was flattening grit
      // under ACES. Blue-black anchor, oil chroma and aggregate stay in the plate.
      vec3 col = vec3(0.07, 0.074, 0.095) + (photo - 0.16) * 1.45;
      col += (macro - 0.5) * 0.22;
      float streak = pow(max(0.0, sin(world.x * 2.4 + l * 18.0 + uTime * 0.15)), 10.0);
      col += vec3(0.06, 0.11, 0.26) * streak * 0.55;
      col += vec3(0.05, 0.08, 0.16) * smoothstep(0.18, 0.40, oilL);
      return max(col, vec3(0.0));
    }
    void main(){
      vec3 col;
      if (uStreetOn < 0.5) {
        col = vec3(0.045, 0.048, 0.06);
        float grain = fbm(vWorldPos.xz * 1.8 + uTime * 0.02);
        col += grain * 0.03;
        float streak = pow(max(0.0, sin(vWorldPos.x * 3.2 + grain * 2.0 + uTime * 0.15)), 14.0);
        col += vec3(0.22, 0.28, 0.42) * streak * 0.35;
        float along = vUv.x;
        float across = abs(vUv.y - 0.5);
        float dash = step(0.45, fract(along * 14.0));
        float line = smoothstep(0.06, 0.02, across) * dash;
        col = mix(col, vec3(0.72, 0.68, 0.42), line * 0.55);
        float edge = smoothstep(0.04, 0.0, min(vUv.y, 1.0 - vUv.y));
        col += vec3(0.08, 0.09, 0.12) * edge;
      } else {
        col = streetAsphalt(vWorldPos);
        if (vKind > 0.5) {
          vec3 tick = streetCell(3.0, 0.0, vec2(clamp(vUv.x, 0.02, 0.98), clamp(vUv.y, 0.02, 0.98)));
          float paint = smoothstep(0.46, 0.64, streetLuma(tick));
          col = mix(col, vec3(0.93, 0.94, 0.91), paint);
        } else {
          vec2 muv = vec2(fract(vAlong * 0.64), mix(0.05, 0.95, vUv.y));
          vec3 mark = streetCell(2.0, 0.0, muv);
          float paint = smoothstep(0.44, 0.62, streetLuma(mark));
          float yellow = smoothstep(0.06, 0.18, mark.r - mark.b);
          vec3 paintCol = mix(vec3(0.90, 0.91, 0.88), vec3(1.02, 0.76, 0.16), yellow);
          col = mix(col, paintCol, paint);
        }
      }
      float dist = length(vWorldPos - cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 12.0);
      gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 0.88)), 1.0);
    }
  `,
});

// Sidewalk — photo concrete, joints, damp. Lot pads share this tread.
const sidewalkMat = new THREE.ShaderMaterial({
  uniforms: {
    uFogColor: { value: new THREE.Color(0x05060a) },
    uFogDensity: { value: 0.018 },
    uStreetAtlas: { value: streetAtlasPlaceholder },
    uStreetOn: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main(){
      vUv = uv;
      vec4 wp = instanceMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    varying vec3 vWorldPos;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    ${NOISE_GLSL}
    ${STREET_CELL_GLSL}
    void main(){
      vec3 col;
      if (uStreetOn < 0.5) {
        col = vec3(0.14, 0.145, 0.17);
        float g = fbm(vWorldPos.xz * 4.5);
        col += g * 0.04;
        float jx = smoothstep(0.02, 0.0, abs(fract(vUv.x * 5.0) - 0.5) - 0.47);
        float jz = smoothstep(0.02, 0.0, abs(fract(vUv.y * 3.0) - 0.5) - 0.47);
        col *= 1.0 - (jx + jz) * 0.12;
      } else {
        vec2 suv = fract(vWorldPos.xz * 0.92);
        vec3 concrete = streetCell(0.0, 1.0, suv);
        vec3 stain = streetCell(1.0, 1.0, fract(vWorldPos.xz * 0.41 + vec2(0.2, 0.47)));
        float lc = streetLuma(concrete);
        float ls = streetLuma(stain);
        vec3 photo = mix(concrete, stain * vec3(0.82, 0.88, 1.02), smoothstep(0.0, 0.14, lc - ls) * 0.7);
        vec3 macro = streetCell(3.0, 2.0, fract(vWorldPos.xz * 2.4));
        col = vec3(0.16, 0.145, 0.125) + (photo - 0.42) * 0.85;
        col += (macro - 0.5) * 0.16;
      }
      float dist = length(vWorldPos - cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 12.0);
      gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 0.85)), 1.0);
    }
  `,
});

// Curb — photo lip and stained face. Unlit, same night fog as the tread.
const curbMat = new THREE.ShaderMaterial({
  uniforms: {
    uFogColor: { value: new THREE.Color(0x05060a) },
    uFogDensity: { value: 0.018 },
    uStreetAtlas: { value: streetAtlasPlaceholder },
    uStreetOn: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec3 vWorldPos;
    void main(){
      vec4 wp = instanceMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    varying vec3 vWorldPos;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    ${STREET_CELL_GLSL}
    void main(){
      vec3 col;
      if (uStreetOn < 0.5) {
        col = vec3(0.165, 0.180, 0.220);
      } else {
        float h = clamp((vWorldPos.y - 0.018) / 0.10, 0.0, 1.0);
        float along = fract(vWorldPos.x * 0.85 + vWorldPos.z * 0.85);
        vec3 a = streetCell(2.0, 1.0, vec2(along, h));
        vec3 b = streetCell(3.0, 1.0, vec2(fract(along + 0.37), h));
        vec3 photo = mix(a, b, 0.42);
        col = photo * vec3(0.48, 0.45, 0.40) + vec3(0.02, 0.018, 0.016);
      }
      float dist = length(vWorldPos - cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 12.0);
      gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 0.85)), 1.0);
    }
  `,
});

const roadGeo = new THREE.PlaneGeometry(1, 1);
const slabGeo = new THREE.BoxGeometry(1, 1, 1);
slabGeo.translate(0, 0.5, 0);

const ROAD_MAX = 64;
const SW_MAX = 200;
const CURB_MAX = 160;
// 0 = lane paint (center dash + edge lines), 1 = crosswalk cell
const roadKindAttr = new THREE.InstancedBufferAttribute(new Float32Array(ROAD_MAX), 1);
roadGeo.setAttribute('aKind', roadKindAttr);
const roads = new THREE.InstancedMesh(roadGeo, asphaltMat, ROAD_MAX);
const sidewalks = new THREE.InstancedMesh(slabGeo, sidewalkMat, SW_MAX);
const curbs = new THREE.InstancedMesh(slabGeo, curbMat, CURB_MAX);
roads.frustumCulled = false;
sidewalks.frustumCulled = false;
curbs.frustumCulled = false;

const dummyR = new THREE.Object3D();
let roadN = 0, swN = 0, curbN = 0;
// World-XZ footprints for static ground. Top is the walk surface.
// Built into cannon after physWorld exists.
const pavementCols = [];

function addRoad(cx, cz, len, width, rotY) {
  if (roadN >= ROAD_MAX) return;
  dummyR.position.set(cx, 0.015, cz);
  dummyR.rotation.set(-Math.PI / 2, 0, rotY);
  // PlaneGeometry: scale.x = len along local X after rot, scale.y = width
  dummyR.scale.set(len, width, 1);
  dummyR.updateMatrix();
  roadKindAttr.setX(roadN, 0);
  roads.setMatrixAt(roadN++, dummyR.matrix);
  const alongX = Math.abs(rotY) < 0.8;
  pavementCols.push({
    x: cx,
    z: cz,
    hx: (alongX ? len : width) * 0.5 + 0.04,
    hz: (alongX ? width : len) * 0.5 + 0.04,
    top: 0.015,
  });
}

function addSidewalk(cx, cz, sx, sz) {
  if (swN >= SW_MAX) return;
  dummyR.position.set(cx, 0.03, cz);
  dummyR.rotation.set(0, 0, 0);
  dummyR.scale.set(sx, 0.055, sz);
  dummyR.updateMatrix();
  sidewalks.setMatrixAt(swN++, dummyR.matrix);
  // Box is centered on y=0.03, so the tread is half the thickness up.
  pavementCols.push({
    x: cx,
    z: cz,
    hx: sx * 0.5 + 0.03,
    hz: sz * 0.5 + 0.03,
    top: 0.03 + 0.055 * 0.5,
  });
}

function addCurb(cx, cz, sx, sz) {
  if (curbN >= CURB_MAX) return;
  dummyR.position.set(cx, 0.02, cz);
  dummyR.rotation.set(0, 0, 0);
  dummyR.scale.set(sx, CURB_H, sz);
  dummyR.updateMatrix();
  curbs.setMatrixAt(curbN++, dummyR.matrix);
}

// Horizontal streets (along X) — GRID_ROWS+1 corridors
for (let r = 0; r <= GRID_ROWS; r++) {
  const z = gridOriginZ + STREET_W * 0.5 - r * cellD;
  const cx = 0;
  addRoad(cx, z, districtW + 0.4, STREET_W * 0.98, 0);
  // crosswalk ticks near block corners (simple night dashes perpendicular)
  for (let c = 0; c <= GRID_COLS; c++) {
    const x = gridOriginX - STREET_W * 0.5 + c * cellW;
    // Photo zebra across the N–S street. rotZ π/2: local X (uv.x, scale.x) runs
    // along Z, local Y (uv.y) across X. Bars in the atlas are long in uv.x.
    // Visual only — not a pavement collider.
    if (roadN < ROAD_MAX) {
      dummyR.position.set(x, 0.028, z);
      dummyR.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      dummyR.scale.set(2.15, STREET_W * 0.92, 1);
      dummyR.updateMatrix();
      roadKindAttr.setX(roadN, 1);
      roads.setMatrixAt(roadN++, dummyR.matrix);
    }
  }
}
// Vertical streets (along Z)
for (let c = 0; c <= GRID_COLS; c++) {
  const x = gridOriginX - STREET_W * 0.5 + c * cellW;
  const zMid = gridOriginZ - districtD * 0.5 + STREET_W * 0.5;
  addRoad(x, zMid, districtD + 0.2, STREET_W * 0.98, Math.PI / 2);
}

// Sidewalks + curbs around each block perimeter
for (let bz = 0; bz < GRID_ROWS; bz++) {
  for (let bx = 0; bx < GRID_COLS; bx++) {
    const b = blockRect(bx, bz);
    const sw = SIDEWALK_W;
    // N (+Z, quay-ward), S (−Z), E (+X), W (−X) sidewalk strips outside lot rect
    addSidewalk((b.x0 + b.x1) * 0.5, b.z1 + sw * 0.5, BLOCK_W + sw * 2, sw);
    addSidewalk((b.x0 + b.x1) * 0.5, b.z0 - sw * 0.5, BLOCK_W + sw * 2, sw);
    addSidewalk(b.x0 - sw * 0.5, (b.z0 + b.z1) * 0.5, sw, BLOCK_D);
    addSidewalk(b.x1 + sw * 0.5, (b.z0 + b.z1) * 0.5, sw, BLOCK_D);
    // granite curb drop at sidewalk outer edge (toward street)
    const cw = 0.08;
    addCurb((b.x0 + b.x1) * 0.5, b.z1 + sw + cw * 0.5, BLOCK_W + sw * 2 + cw * 2, cw);
    addCurb((b.x0 + b.x1) * 0.5, b.z0 - sw - cw * 0.5, BLOCK_W + sw * 2 + cw * 2, cw);
    addCurb(b.x0 - sw - cw * 0.5, (b.z0 + b.z1) * 0.5, cw, BLOCK_D + sw * 2);
    addCurb(b.x1 + sw + cw * 0.5, (b.z0 + b.z1) * 0.5, cw, BLOCK_D + sw * 2);
  }
}

// Lot pads — raised block interiors (negative space outside = streets)
for (let bz = 0; bz < GRID_ROWS; bz++) {
  for (let bx = 0; bx < GRID_COLS; bx++) {
    const b = blockRect(bx, bz);
    addSidewalk((b.x0 + b.x1) * 0.5, (b.z0 + b.z1) * 0.5, BLOCK_W * 0.98, BLOCK_D * 0.98);
  }
}

roads.count = roadN;
sidewalks.count = swN;
curbs.count = curbN;
roadKindAttr.needsUpdate = true;
roads.instanceMatrix.needsUpdate = true;
sidewalks.instanceMatrix.needsUpdate = true;
curbs.instanceMatrix.needsUpdate = true;
scene.add(roads);
scene.add(sidewalks);
scene.add(curbs);

// ——— Buildings on lots — InstancedMesh + real windows (pass 5 · interior mapping) ———
// Teachers: van Dongen Interior Mapping (2008); Gotow Part 1; Chandler & Yang procwin;
// Mapbox building.fragment faux rooms; three-fenestra (rooms behind glass + Fresnel) — implemented in GLSL.
// Kill sway. Local façade UV from vLocalPos × instance scale. Mullions = opaque wall. Windows = holes + rooms.
// Pass 7 · atlases wired: room-atlas-occupied-32 (8×4 fenestra) on every floor above 0 · shop-atlas on floor 0 only.
const INSTANCE_COUNT = 128;
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
boxGeo.translate(0, 0.5, 0);

// Break mask for ground-floor shop glass. 128 instances × (4 faces × 16 slots).
const SHOP_BREAK_H = 64;
const shopBreakData = new Uint8Array(INSTANCE_COUNT * SHOP_BREAK_H * 4);
const shopBreakTex = new THREE.DataTexture(
  shopBreakData, INSTANCE_COUNT, SHOP_BREAK_H, THREE.RGBAFormat, THREE.UnsignedByteType
);
shopBreakTex.flipY = false;
shopBreakTex.magFilter = THREE.NearestFilter;
shopBreakTex.minFilter = THREE.NearestFilter;
shopBreakTex.wrapS = THREE.ClampToEdgeWrapping;
shopBreakTex.wrapT = THREE.ClampToEdgeWrapping;
shopBreakTex.colorSpace = THREE.NoColorSpace;
shopBreakTex.needsUpdate = true;

// Façade sheath placeholders. Real sheets bind in loadSheathAtlases; uSheathOn
// stays 0 until then so a failed load keeps the night-concrete grain.
function facadeSheathPlaceholder() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 2;
  const g = c.getContext('2d');
  g.fillStyle = '#141820';
  g.fillRect(0, 0, 2, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
const sheathCircuitPlaceholder = facadeSheathPlaceholder();
const sheathGrowthPlaceholder = facadeSheathPlaceholder();

const buildingMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0x05060a) },
    uFogDensity: { value: 0.018 },
    uLive: { value: freezeMotion ? 0.0 : 1.0 },
    uRoomAtlas: { value: null },
    uShopAtlas: { value: null },
    uRoomCols: { value: 8.0 },
    uRoomRows: { value: 4.0 },
    uRoomCount: { value: 32.0 },
    uAtlasOn: { value: 0.0 },
    uFaceMapOn: { value: 0.0 },
    uFaceBack: { value: null },
    uFaceLeft: { value: null },
    uFaceRight: { value: null },
    uFaceFloor: { value: null },
    uFaceCeiling: { value: null },
    uFaceCount: { value: 7.0 },
    uFaceCols: { value: 4.0 },
    uFaceRows: { value: 2.0 },
    uSignAtlas: { value: null },
    uSignOn: { value: 0.0 },
    uShopBreak: { value: shopBreakTex },
    uSheathCircuit: { value: sheathCircuitPlaceholder },
    uSheathGrowth: { value: sheathGrowthPlaceholder },
    uSheathOn: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec3 vColor;
    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying vec3 vLocalPos;
    varying vec3 vLocalNormal;
    varying vec3 vScale;
    varying vec3 vCamLocal;
    varying float vId;
    void main(){
      vLocalPos = position;
      vLocalNormal = normal;
      vId = float(gl_InstanceID);
      // Instance scale from matrix columns (local UV locked to massing — never world XZ)
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
      vec3 translation = instanceMatrix[3].xyz;
      // Camera in unit-box local space (no sway). GLES1-safe: no transpose()
      // Local = (dot(worldDelta, axisX), …) then un-scale
      vec3 worldDelta = cameraPosition - translation;
      vCamLocal = vec3(dot(worldDelta, rot[0]), dot(worldDelta, rot[1]), dot(worldDelta, rot[2]));
      vCamLocal /= vScale;

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
  `,
  fragmentShader: /* glsl */`
    varying vec3 vColor;
    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying vec3 vLocalPos;
    varying vec3 vLocalNormal;
    varying vec3 vScale;
    varying vec3 vCamLocal;
    varying float vId;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform float uTime;
    uniform float uLive;
    uniform sampler2D uRoomAtlas;
    uniform sampler2D uShopAtlas;
    uniform float uRoomCols;
    uniform float uRoomRows;
    uniform float uRoomCount;
    uniform float uAtlasOn;
    uniform float uFaceMapOn;
    uniform sampler2D uFaceBack;
    uniform sampler2D uFaceLeft;
    uniform sampler2D uFaceRight;
    uniform sampler2D uFaceFloor;
    uniform sampler2D uFaceCeiling;
    uniform float uFaceCount;
    uniform float uFaceCols;
    uniform float uFaceRows;
    uniform sampler2D uSignAtlas;
    uniform float uSignOn;
    uniform sampler2D uShopBreak;
    uniform sampler2D uSheathCircuit;
    uniform sampler2D uSheathGrowth;
    uniform float uSheathOn;

    // Ground-floor shop pane break mask. Rows: 4 faces × 16 cell slots.
    // Slot = floor(along / cellW) + 8. Face +X 0, −X 1, +Z 2, −Z 3.
    float shopPaneBroken(float along, float cell, vec3 nLocal, float id) {
      float ax = step(abs(nLocal.z), abs(nLocal.x));
      float face = mix(
        mix(3.0, 2.0, step(0.0, nLocal.z)),
        mix(1.0, 0.0, step(0.0, nLocal.x)),
        ax
      );
      float slot = clamp(floor(along / cell + 8.0), 0.0, 15.0);
      vec2 buv = vec2((id + 0.5) / 128.0, (face * 16.0 + slot + 0.5) / 64.0);
      return step(0.5, texture2D(uShopBreak, buv).r);
    }
    ${NOISE_GLSL}

    // Sample atlas cell (cols×rows). huv in [0,1]. Flip V for image space.
    vec3 sampleAtlas(sampler2D atlas, float cols, float rows, float idx, vec2 huv) {
      float n = cols * rows;
      float id = mod(floor(idx + 0.5), n);
      float col = mod(id, cols);
      float row = floor(id / cols);
      vec2 cellSize = vec2(1.0 / cols, 1.0 / rows);
      vec2 inset = cellSize * 0.001;
      vec2 cellOrigin = vec2(col * cellSize.x, 1.0 - (row + 1.0) * cellSize.y) + inset;
      return texture2D(atlas, cellOrigin + clamp(huv, 0.0, 1.0) * (cellSize - 2.0 * inset)).rgb;
    }

    vec4 sampleAtlasRGBA(sampler2D atlas, float cols, float rows, float idx, vec2 huv) {
      float n = cols * rows;
      float id = mod(floor(idx + 0.5), n);
      float col = mod(id, cols);
      float row = floor(id / cols);
      vec2 cellSize = vec2(1.0 / cols, 1.0 / rows);
      vec2 inset = cellSize * 0.004;
      vec2 cellOrigin = vec2(col * cellSize.x, 1.0 - (row + 1.0) * cellSize.y) + inset;
      return texture2D(atlas, cellOrigin + clamp(huv, 0.0, 1.0) * (cellSize - 2.0 * inset));
    }

    // Shared UV center-crop for EVERY interior atlas sample (room + shop + face-map).
    // 0.52 ≈ crop 24% margin each side — panes read furniture/back wall, not side wall.
    // 2026-09-26: beige-IN-PANE was (c) baked room color (taupe cells), not wall bands.
    // 2026-09-27 cool rebake: occupied-32 + shop plates graded to rooms-ref night-dock
    // warmth (R−B ≈ 6); crop tightened 0.60 → 0.52. Massing/façades untouched.
    const float ATLAS_UV_CROP = 0.52;
    vec2 cropAtlasUV(vec2 uv) {
      return 0.5 + (clamp(uv, 0.0, 1.0) - 0.5) * ATLAS_UV_CROP;
    }

    // Procedural cavity fallback (atlases off) — classic face colors.
    vec3 shadeRoomProc(vec3 ro, vec3 rd, float lit, float warmAmt, float shop) {
      float tMin = 1e5;
      int face = -1;
      vec2 huv = vec2(0.0);
      if (abs(rd.z) > 1e-5) {
        float t = (1.0 - ro.z) / rd.z;
        vec3 p = ro + rd * t;
        if (t > 1e-4 && t < tMin && p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) {
          tMin = t; face = 0; huv = p.xy;
        }
      }
      if (abs(rd.y) > 1e-5) {
        float t = (0.0 - ro.y) / rd.y;
        vec3 p = ro + rd * t;
        if (t > 1e-4 && t < tMin && p.x >= 0.0 && p.x <= 1.0 && p.z >= 0.0 && p.z <= 1.0) {
          tMin = t; face = 1; huv = p.xz;
        }
      }
      if (abs(rd.y) > 1e-5) {
        float t = (1.0 - ro.y) / rd.y;
        vec3 p = ro + rd * t;
        if (t > 1e-4 && t < tMin && p.x >= 0.0 && p.x <= 1.0 && p.z >= 0.0 && p.z <= 1.0) {
          tMin = t; face = 2; huv = p.xz;
        }
      }
      if (abs(rd.x) > 1e-5) {
        float t = (0.0 - ro.x) / rd.x;
        vec3 p = ro + rd * t;
        if (t > 1e-4 && t < tMin && p.y >= 0.0 && p.y <= 1.0 && p.z >= 0.0 && p.z <= 1.0) {
          tMin = t; face = 3; huv = p.yz;
        }
      }
      if (abs(rd.x) > 1e-5) {
        float t = (1.0 - ro.x) / rd.x;
        vec3 p = ro + rd * t;
        if (t > 1e-4 && t < tMin && p.y >= 0.0 && p.y <= 1.0 && p.z >= 0.0 && p.z <= 1.0) {
          tMin = t; face = 4; huv = p.yz;
        }
      }
      vec3 floorLit = mix(vec3(0.22, 0.18, 0.12), vec3(0.42, 0.28, 0.12), warmAmt);
      floorLit = mix(floorLit, vec3(0.48, 0.32, 0.10), shop);
      vec3 ceilLit = mix(vec3(0.55, 0.52, 0.42), vec3(0.70, 0.58, 0.32), warmAmt);
      vec3 wallLit = mix(vec3(0.28, 0.32, 0.42), vec3(0.48, 0.36, 0.22), warmAmt);
      vec3 col = vec3(0.035, 0.038, 0.05);
      if (face == 0) col = mix(vec3(0.028, 0.03, 0.042), wallLit * 0.85, lit);
      else if (face == 1) col = mix(vec3(0.03, 0.032, 0.04), floorLit, lit);
      else if (face == 2) col = mix(vec3(0.045, 0.048, 0.055), ceilLit, lit);
      else if (face == 3 || face == 4) col = mix(vec3(0.035, 0.038, 0.05), wallLit, lit);
      return col;
    }


    // Face-mapped room in ORTHONORMAL metres (Tw/Bw/Nw).
    // Old path normalized rays in cellW/cellH/cellSpan units — that anisotropic
    // space bends straight furniture lines on tall shop cells and yawed massing.
    // camM / originM / box extents are all metres; UV is still 0–1 on each face.
    // sideMute 0 = full 5-face; 1 = back only (flat cavity sides) — kills concave/convex
    // wall bow when orbiting corners (double-perspective on side elevations).
    vec3 shadeFaceMappedRoom(vec3 camM, vec2 localXY, float cellW, float cellH, float depthM, float roomIdx, float sideMute) {
      vec3 origin = vec3(localXY.x * cellW, localXY.y * cellH, 0.0);
      vec3 dir = normalize(origin - camM);
      vec3 invDir = 1.0 / dir;
      vec3 bmin = vec3(-0.5 * cellW, -0.5 * cellH, -depthM);
      vec3 bmax = vec3( 0.5 * cellW,  0.5 * cellH,  0.0);
      vec3 t1 = (bmin - origin) * invDir;
      vec3 t2 = (bmax - origin) * invDir;
      vec3 tFar = max(t1, t2);
      float t = min(min(tFar.x, tFar.y), tFar.z);
      vec3 hit = origin + dir * max(t, 1e-4);

      float backDist = abs(hit.z + depthM);
      float leftDist = abs(hit.x + 0.5 * cellW);
      float rightDist = abs(hit.x - 0.5 * cellW);
      float floorDist = abs(hit.y + 0.5 * cellH);
      float ceilDist = abs(hit.y - 0.5 * cellH);

      float best = backDist;
      int face = 0;
      if (leftDist < best)  { best = leftDist;  face = 1; }
      if (rightDist < best) { best = rightDist; face = 2; }
      if (floorDist < best) { best = floorDist; face = 3; }
      if (ceilDist < best)  { best = ceilDist;  face = 4; }

      float invW = 1.0 / max(cellW, 1e-4);
      float invH = 1.0 / max(cellH, 1e-4);
      float invD = 1.0 / max(depthM, 1e-4);
      float idx = mod(floor(roomIdx + 0.5), max(uFaceCount, 1.0));
      vec2 uv;
      vec3 cavityL = vec3(0.07, 0.075, 0.09);
      vec3 cavityR = vec3(0.055, 0.06, 0.075);
      vec3 cavityF = vec3(0.045, 0.042, 0.05);
      vec3 cavityC = vec3(0.09, 0.09, 0.1);
      if (face == 0) {
        uv = cropAtlasUV(clamp(vec2(hit.x * invW, hit.y * invH) + 0.5, 0.0, 1.0));
        return sampleAtlas(uFaceBack, uFaceCols, uFaceRows, idx, uv);
      } else if (face == 1) {
        uv = cropAtlasUV(clamp(vec2(-hit.z * invD, hit.y * invH + 0.5), 0.0, 1.0));
        vec3 tex = sampleAtlas(uFaceLeft, uFaceCols, uFaceRows, idx, uv);
        return mix(tex, cavityL, sideMute);
      } else if (face == 2) {
        uv = cropAtlasUV(clamp(vec2(hit.z * invD + 1.0, hit.y * invH + 0.5), 0.0, 1.0));
        vec3 tex = sampleAtlas(uFaceRight, uFaceCols, uFaceRows, idx, uv);
        return mix(tex, cavityR, sideMute);
      } else if (face == 3) {
        uv = cropAtlasUV(clamp(vec2(hit.x * invW + 0.5, -hit.z * invD), 0.0, 1.0));
        vec3 tex = texture2D(uFaceFloor, uv).rgb * 0.82;
        return mix(tex, cavityF, sideMute * 0.85);
      } else {
        uv = cropAtlasUV(clamp(vec2(hit.x * invW + 0.5, -hit.z * invD), 0.0, 1.0));
        vec3 tex = texture2D(uFaceCeiling, uv).rgb;
        return mix(tex, cavityC, sideMute * 0.85);
      }
    }

    // Atlas path — FLAT orthographic back-wall sample (Virgil 2026-09-26).
    // Deep ray-box parallax bowed mullions/furniture into curves at glancing angles.
    // UV center-crop via cropAtlasUV (ATLAS_UV_CROP): same factor for room + shop.
    // Extremely shallow depth cue only via mild vignette, not ray hit.
    vec3 shadeRoomAtlas(vec2 paneUV, float lit, float shop, float seed) {
      float glowAmt = clamp(lit, 0.0, 1.0);
      vec2 huv = cropAtlasUV(paneUV);
      float idx = shop > 0.55
        ? floor(hash(vec2(seed * 1.7, seed * 0.31)) * 16.0)
        : floor(hash(vec2(seed * 2.3, seed * 0.19)) * uRoomCount);
      vec3 tex = shop > 0.55
        ? sampleAtlas(uShopAtlas, 4.0, 4.0, idx, huv)
        : sampleAtlas(uRoomAtlas, uRoomCols, uRoomRows, idx, huv);
      // Mild edge vignette (no lateral parallax) — keeps pot-light rooms readable
      float vig = 1.0 - 0.12 * pow(max(abs(huv.x - 0.5), abs(huv.y - 0.5)) * 2.0, 2.0);
      tex *= vig;
      vec3 dark = tex * 0.10 + vec3(0.01, 0.012, 0.018);
      vec3 litTex = tex * mix(0.65, 1.15, glowAmt);
      return mix(dark, litTex, mix(0.18, 1.0, glowAmt));
    }

    void main(){
      vec3 N = normalize(vNormalW);
      vec3 Ln = normalize(vLocalNormal);
      float ndl = clamp(dot(N, normalize(vec3(0.35, 0.9, 0.2))), 0.0, 1.0);

      float isRoof = step(0.7, Ln.y);
      float isFloor = step(0.7, -Ln.y);
      float isVert = 1.0 - max(isRoof, isFloor);

      // Local metres on façade (instance scale) — NEVER world-position UV
      vec3 lpM = vLocalPos * vScale;

      // Concrete façade body (Virgil 2026-09-26) — architectural grain on opaque
      // wall / pier / frameBand only. Panes keep atlas interiors unchanged.
      // When the sheath sheets load, vertical faces replace this grain with
      // moss over a circuit underlayer; this color remains the roof/floor
      // fallback and the concrete tint inside opened patches.
      // Cool-gray bias on cool instances, warm-gray on warm; night Noctuary dark.
      float warmBias = smoothstep(0.35, 0.75, vColor.r);
      float coolBias = smoothstep(0.35, 0.70, vColor.b);
      vec3 concCool = vec3(0.105, 0.118, 0.142);
      vec3 concWarm = vec3(0.138, 0.122, 0.108);
      vec3 concBase = mix(concCool, concWarm, clamp(warmBias - coolBias * 0.35, 0.0, 1.0));
      concBase = mix(concBase, concCool, coolBias * 0.42);
      // Whisper of instance tint so district warm/cool still reads at distance
      vec3 litTint = mix(vColor * 0.18, vColor * 0.48, ndl);
      vec3 wallCol = mix(concBase, litTint, 0.34) + vec3(0.018, 0.02, 0.026) * ndl;
      // Façade-local UV (horizontal tangent × height) — rectilinear, no world swirl
      vec2 concUV = (abs(Ln.x) >= abs(Ln.z))
        ? vec2(lpM.z, lpM.y)
        : vec2(lpM.x, lpM.y);
      float grain = fbm(concUV * 8.5);           // fine concrete grain
      float blotch = fbm(concUV * 2.2 + 19.3);   // subtle blotches / pour variation
      float micro = noise(concUV * 26.0);        // fine speck / aggregate hint
      float concVar = (grain - 0.5) * 0.065
                    + (blotch - 0.5) * 0.048
                    + (micro - 0.5) * 0.022;
      wallCol *= 1.0 + concVar * isVert;
      wallCol += vec3(0.008, 0.009, 0.011) * (blotch - 0.42) * isVert;
      // Slightly cooler shadow side — reads as matte concrete, not plastic
      wallCol = mix(wallCol, wallCol * vec3(0.92, 0.94, 1.02), (1.0 - ndl) * 0.35 * isVert);
      // Cell size CONSTANT in metres (Virgil 2026-09-26).
      // cellW/cellH that vary with height bend vertical mullions into curves.
      // Same square pitch every floor. Shop atlas is floor index 0 only —
      // a metre band (the old 2.55 m shopBand) covered several rows and
      // painted retail interiors on the floors above the street.
      float cellW = 0.76;
      float cellH = 0.76;
      float floorIndex = floor(max(lpM.y, 0.0) / cellH);
      float isShop = (1.0 - step(0.5, floorIndex)) * step(0.02, lpM.y);

      // Dominant face → façade U along the horizontal tangent, V along height
      vec3 T, B, D; // tangent, bitangent, inward depth (unit-local)
      float faceAlong;
      if (abs(Ln.x) >= abs(Ln.z)) {
        float sx = sign(Ln.x + 1e-6);
        T = vec3(0.0, 0.0, -sx);
        B = vec3(0.0, 1.0, 0.0);
        D = vec3(-sx, 0.0, 0.0);
        faceAlong = lpM.z; // metres along Z on ±X façades
      } else {
        float sz = sign(Ln.z + 1e-6);
        T = vec3(sz, 0.0, 0.0);
        B = vec3(0.0, 1.0, 0.0);
        D = vec3(0.0, 0.0, -sz);
        faceAlong = lpM.x;
      }

      float facadeU = faceAlong;
      float facadeV = lpM.y;
      vec2 roomUV = vec2(facadeU / cellW, facadeV / cellH);
      vec2 cell = floor(roomUV);
      vec2 f = fract(roomUV);

      // Mullions / frames — thin dark bands; window = hole (Virgil 2026-09-26).
      // Old 0.14/0.16 left ~49% glass + beige wallCol rings (frameBand only covered
      // inner 55% of the margin). Shrink margins and paint the whole leftover as mullion.
      float mullU = mix(0.05, 0.04, isShop);
      float mullV = mix(0.055, 0.045, isShop);
      float inPane = step(mullU, f.x) * step(f.x, 1.0 - mullU)
                   * step(mullV, f.y) * step(f.y, 1.0 - mullV);
      // Keep clear of roof/plinth edge
      inPane *= step(0.12, lpM.y) * step(lpM.y, vScale.y - 0.18);
      inPane *= isVert;
      // Corner conflict: façade-local rooms reorient on adjacent faces (face-map/proc).
      // Kill ~0.4 bay at each vertical edge (hard), then soft-fade another ~0.2 bay.
      // Atlas flat-ortho must NOT hard-kill: inPane=0 fills the mullion hole with
      // wallCol, which reads as warm tan/brown "side wall" opaque panes (Virgil
      // 2026-09-27 after cool127). Fenestra stays lit to the corner; face-map keeps
      // the pier. edgeFade=1 on atlas so mix(body, interior) never bleeds façade.
      float halfAlong = (abs(Ln.x) >= abs(Ln.z)) ? (0.5 * vScale.z) : (0.5 * vScale.x);
      float edgeDistM = halfAlong - abs(faceAlong);
      float edgeKillM = max(0.42 * cellW, 0.28);
      float edgeSoftM = edgeKillM + 0.18 * cellW;
      float atlasFlat = step(0.5, uAtlasOn) * (1.0 - step(0.5, uFaceMapOn));
      inPane *= mix(step(edgeKillM, edgeDistM), 1.0, atlasFlat);
      float edgeFade = mix(smoothstep(edgeKillM, edgeSoftM, edgeDistM), 1.0, atlasFlat);

      // Glazed shop entry — one column of the ground-floor grid, one storey.
      // Sill 0.10, head 0.70, under the next floor (cellH 0.76). The opening
      // takes the whole column so the pane row does not run through it: stone
      // sill, dark jambs, a lintel, a meeting stile, and a kick. It does not
      // grow with the massing and it is not a second window.
      float faceLen = halfAlong * 2.0;
      float faceIsX = step(abs(Ln.z), abs(Ln.x));
      float doorSeed = hash(vec2(vId * 0.37 + 1.7, mix(4.1, 8.6, faceIsX)));
      float margin = 0.06;
      float iLo = ceil(((-halfAlong + margin) / cellW) - 0.5 - 1e-4);
      float iHi = floor(((halfAlong - margin) / cellW) - 0.5 + 1e-4);
      float nCols = max(iHi - iLo + 1.0, 0.0);
      float useCol = step(0.5, nCols);
      float pick = floor(doorSeed * max(nCols - 1e-4, 1.0));
      pick = min(pick, max(nCols - 1.0, 0.0));
      float doorCol = iLo + pick;
      float midAlong = clamp(0.0, -halfAlong + margin, halfAlong - margin);
      float midCol = floor(midAlong / cellW);
      float doorL = mix(max(midCol * cellW, -halfAlong + 0.04), doorCol * cellW, useCol);
      float doorR = mix(min((midCol + 1.0) * cellW, halfAlong - 0.04), (doorCol + 1.0) * cellW, useCol);
      doorL = max(doorL, -halfAlong + 0.03);
      doorR = min(doorR, halfAlong - 0.03);
      float doorBot = 0.10;
      // Hard cap under the next floor (cellH == 0.76). Never grow with the box.
      float doorTop = min(cellH - 0.06, 0.70);
      float jambW = 0.048;
      float glassL = doorL + jambW;
      float glassR = doorR - jambW;
      float doorOk = step(0.95, vScale.y) * step(0.62, faceLen) * isVert;
      doorOk *= step(0.28, doorR - doorL);
      doorOk *= step(doorBot + 0.28, doorTop);
      float inDoorX = step(doorL, faceAlong) * step(faceAlong, doorR);
      float inGlassX = step(glassL, faceAlong) * step(faceAlong, glassR);
      float inDoorY = step(doorBot, lpM.y) * step(lpM.y, doorTop);
      float inDoor = doorOk * inDoorX * inDoorY;
      float inGlass = doorOk * inGlassX * inDoorY;
      // Whole ground-floor column. Cutting only the glass left the pane grid
      // reading as a continuous shopfront with no entry.
      float inDoorCol = doorOk * inDoorX * step(0.0, lpM.y) * step(lpM.y, cellH);
      float shopEntry = inDoor;

      // Frame / mullion bands — whole margin is dark mullion (not façade beige).
      // The entry opening is cut out of the grid so stacked window mullions
      // do not slice the door or sit on top of the shop interior.
      float frameBand = isVert * (1.0 - step(
        min(mullU, mullV),
        min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y))
      ));
      frameBand *= (1.0 - inDoorCol);
      inPane *= (1.0 - inDoorCol);
      // Dual sheath on vertical concrete only (Virgil: circuit under, living cover).
      // Samples stay outside the branch — WebGL1 derivatives need a uniform flow.
      // Tile is façade-local metres (concUV), not world XZ.
      // Growth alpha is mostly shut. Openings are the atlas cracks/flakes plus
      // a few world-space worn patches, fissures, and a narrow corner peel —
      // wide enough that the circuit actually reads at night.
      vec2 sheathUv = concUV / 2.05 + vec2(vId * 0.37, vId * 0.21);
      vec4 circuit = texture2D(uSheathCircuit, sheathUv);
      vec4 growth = texture2D(uSheathGrowth, sheathUv);
      // Atlas is already night-valued. Cap only stops a stray highlight
      // so leaflet veins, moss tips, and shelf zones still separate.
      vec3 moss = min(growth.rgb, vec3(0.24, 0.26, 0.20));
      // Steep cover so a mip-blurred edge stays moss and a real opening stays open.
      float cover = smoothstep(0.04, 0.30, growth.a);
      // Binary openings — a soft shoulder was a bright circuit haze.
      // Worn patches, a few per façade, large enough to show a run of traces.
      float flake = step(0.80, fbm(concUV * 0.62 + vec2(2.2, vId * 0.09)));
      // Fissures a few centimetres wide. Gated so they are not a barcode.
      float seamU = abs(fract(concUV.x * 1.15 + vId * 0.13) - 0.5);
      float seamV = abs(fract(concUV.y * 0.72 + 0.37) - 0.5);
      float crackLine = max(step(seamU, 0.020), step(seamV, 0.016));
      float crackGate = step(0.76, fbm(concUV * 0.48 + vec2(vId, 5.1)));
      float edgePeek = step(edgeDistM, 0.10);
      cover *= 1.0 - max(max(flake, crackLine * crackGate), edgePeek);
      cover = clamp(cover, 0.0, 1.0);
      // Board that shows inside an opening: atlas traces, plus metre-scale
      // runs so a flake is recognizably circuitry and not bare concrete.
      float hOn = step(0.42, hash(vec2(floor(concUV.y * 3.4), vId + 1.0)));
      float vOn = step(0.52, hash(vec2(floor(concUV.x * 2.8), vId + 4.0)));
      float hLine = 1.0 - smoothstep(0.03, 0.11, abs(fract(concUV.y * 3.4) - 0.5));
      float vLine = 1.0 - smoothstep(0.03, 0.10, abs(fract(concUV.x * 2.8) - 0.5));
      float pcb = max(hLine * hOn, vLine * vOn);
      float viaCell = hash(floor(concUV * 3.4) + vec2(vId, 2.0));
      float via = smoothstep(0.16, 0.02, length(fract(concUV * 3.4) - 0.5));
      pcb = max(pcb, via * step(0.78, viaCell));
      float amberPick = step(0.67, hash(vec2(floor(concUV.y * 3.4 + concUV.x), vId)));
      vec3 traceCol = mix(vec3(0.09, 0.40, 0.44), vec3(0.52, 0.26, 0.07), amberPick);
      // Atlas traces are hot in the PNG; pull them into a night glint before mix.
      vec3 circuitNight = mix(circuit.rgb * 0.72, circuit.rgb * vec3(0.42, 0.55, 0.55), circuit.a);
      vec3 under = mix(circuitNight, traceCol, max(pcb, circuit.a));
      vec3 sheathCol = mix(under, moss, cover);
      // Subtle night glint on whatever trace is actually uncovered.
      float exposed = max(pcb, circuit.a) * (1.0 - cover);
      sheathCol += traceCol * exposed * 0.16;
      sheathCol = mix(sheathCol, sheathCol * vec3(0.90, 0.94, 1.03), (1.0 - ndl) * 0.22);
      float sheathGate = step(0.5, uSheathOn) * isVert;
      vec3 faceCol = mix(wallCol, sheathCol, sheathGate);
      // Unsheathed mullion (roof fallback / failed atlas) stays the old dark bar.
      vec3 mullionPlain = mix(wallCol * 0.42, vColor * 0.08 + vec3(0.012, 0.013, 0.018), 0.55);
      // Frame stays darker than the pier. The glint is re-added so a trace
      // on the bar is not crushed back into the moss.
      vec3 mullionSheath = mix(sheathCol, vec3(0.010, 0.014, 0.012), 0.34);
      mullionSheath += traceCol * exposed * 0.20;
      vec3 mullionCol = mix(mullionPlain, mullionSheath, sheathGate);
      vec3 body = mix(faceCol, mullionCol, frameBand * 0.94);

      // Shared 3D room seed (building-local) — same volume from +X or +Z.
      // Keep 2D cell/f/pane for façade mullion grid only.
      float cellX = floor(lpM.x / cellW);
      float cellY = floor(lpM.y / cellH);
      float cellZ = floor(lpM.z / cellW);
      vec3 roomCell = vec3(cellX, cellY, cellZ);
      float h0 = hash3(roomCell + vec3(vId * 0.17, vId * 0.09, vId * 0.05));
      float h1 = hash3(roomCell * 1.61 + vec3(vId * 0.31, 19.3, 7.2));
      float h2 = hash3(roomCell + vec3(7.1 + vId * 0.05, 3.7, 11.3));
      float warmAmt = smoothstep(0.35, 0.75, vColor.r);
      float coolAmt = smoothstep(0.35, 0.7, vColor.b);
      float litThresh = mix(0.48, 0.30, warmAmt);
      litThresh = mix(litThresh, 0.46, coolAmt * 0.55);
      litThresh = mix(litThresh, 0.16, isShop * 0.9);
      float lit = step(litThresh, h0);
      float flickerGate = step(0.93, h1);
      float flicker = 1.0 - flickerGate * uLive * (0.25 + 0.55 * (0.5 + 0.5 * sin(uTime * (1.4 + h1 * 2.2) + h0 * 6.28)));
      float shiftGate = step(0.90, h2);
      float shiftWave = 0.5 + 0.5 * sin(uTime * 0.12 + h0 * 12.0 + vId);
      float litLive = mix(lit, mix(lit, 1.0 - lit, shiftWave), shiftGate * uLive);
      float glow = litLive * flicker;

      // Interior mapping when in pane
      vec3 interior = body;
      if (inPane > 0.5) {
        // Remap pane fract to [0,1] excluding mullion margins
        vec2 pane = (f - vec2(mullU, mullV)) / (vec2(1.0) - 2.0 * vec2(mullU, mullV));
        pane = clamp(pane, 0.0, 1.0);

        // Stable room frame = instance-local T/B/D (yaw=0). World Tw=cross(up,N)
        // flips near corners and makes virtual walls read concave/convex while orbiting.
        vec2 localXY = pane - 0.5;
        vec3 dM = (vCamLocal - vLocalPos) * vScale; // metres, frag → camera
        // Camera in room space relative to pane center (frag room-xy + offset to cam)
        vec3 camM = vec3(dot(dM, T), dot(dM, B), max(-dot(dM, D), 0.08))
                  + vec3(localXY.x * cellW, localXY.y * cellH, 0.0);
        float cellSpan = mix(cellW, cellH, 0.5);
        // Shallower box — deep rooms exaggerate wall bow at glancing angles
        float depthM = mix(0.78, 1.05, isShop);
        vec3 camLocal = vec3(camM.x / cellW, camM.y / cellH, camM.z / cellSpan);
        float roomDepth = depthM / cellSpan;

        // Head-on mid-façade: full 5-face. Near corner / glancing: back atlas only + damp lateral parallax.
        vec3 Vearly = normalize(cameraPosition - vWorldPos);
        float facing = max(dot(normalize(vNormalW), Vearly), 0.0);
        float sideMute = 0.0;
        if (edgeDistM < 1.1 * cellW || facing < 0.40) {
          sideMute = 1.0;
        }
        // Crush sideways room parallax at glancing angles (bow kill without blanking panes)
        camM.x *= mix(0.12, 1.0, clamp(facing * 1.4, 0.0, 1.0));

        if (uFaceMapOn > 0.5) {
          float roomIdx = floor(h0 * uFaceCount);
          float distW = length(cameraPosition - vWorldPos);
          float lodFlat = smoothstep(16.0, 36.0, distW); // 0=near full, 1=far flat impostor
          vec2 paneUV = cropAtlasUV(pane);
          vec3 faceCol;
          if (lodFlat < 0.97) {
            faceCol = shadeFaceMappedRoom(camM, localXY, cellW, cellH, depthM, roomIdx, sideMute);
            vec3 flatCol = sampleAtlas(uFaceBack, uFaceCols, uFaceRows, roomIdx, paneUV);
            faceCol = mix(faceCol, flatCol, lodFlat);
          } else {
            faceCol = sampleAtlas(uFaceBack, uFaceCols, uFaceRows, roomIdx, paneUV);
          }
          vec3 faceDark = faceCol * 0.07 + vec3(0.008, 0.01, 0.015);
          vec3 faceLit = faceCol * mix(0.5, 1.0, glow);
          interior = mix(faceDark, faceLit, mix(0.12, 1.0, glow));
          // Soft edge pier: blend toward solid body before hard kill
          interior = mix(body, interior, edgeFade);
        } else if (uAtlasOn > 0.5) {
          // Flat ortho fenestra sample — no ray-box bow
          interior = shadeRoomAtlas(pane, glow, isShop, h0 + vId * 0.13);
          interior = mix(body, interior, edgeFade);
        } else {
          vec3 rayDirM = normalize((vLocalPos - vCamLocal) * vScale);
          float into = max(dot(rayDirM, D), 0.02);
          float roomDepthM = depthM;
          vec3 rd = normalize(vec3(
            dot(rayDirM, T) / cellW,
            dot(rayDirM, B) / cellH,
            into / roomDepthM
          ));
          vec3 ro = vec3(pane.x, pane.y, 0.001);
          if (rd.z > 0.015) {
            interior = shadeRoomProc(ro, rd, glow, warmAmt, isShop);
          } else {
            interior = mix(vec3(0.02, 0.022, 0.03), vec3(0.12, 0.1, 0.06) * glow, 0.3);
          }
        }

        // Glass: Fresnel at grazing. Atlas path keeps head-on almost pure fenestra
        // (no ray-box warp to hide) so rooms stay sharp and rectilinear.
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.85);
        fres = max(fres, (1.0 - edgeFade) * 0.35);
        vec3 skyTint = vec3(0.12, 0.16, 0.28);
        vec3 streetTint = vec3(0.18, 0.14, 0.08);
        vec3 glassRefl = mix(streetTint, skyTint, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
        glassRefl += vec3(0.08, 0.07, 0.12) * fres;
        float spec = pow(max(dot(reflect(-V, N), normalize(vec3(0.35, 0.9, 0.2))), 0.0), 48.0);
        glassRefl += vec3(0.55, 0.6, 0.75) * spec * 0.18;

        float atlasPath = step(0.5, uAtlasOn) * (1.0 - step(0.5, uFaceMapOn));
        // Atlas: barely dim head-on; Face/proc: stronger hide-warp behaviour
        interior *= (1.0 - fres * mix(0.45, 0.22, atlasPath));
        float glassMix = mix(mix(0.02, 0.01, atlasPath), mix(0.88, 0.72, atlasPath), fres);
        vec3 glass = mix(interior, glassRefl, glassMix);
        glass = mix(glass, interior, glow * mix(0.55, 0.72, atlasPath) * (1.0 - fres * 0.9));
        body = glass;

        // Retail names on ground-floor glass only — soft gold / sea-glass, not stickers.
        // The entry bay is clear shop glass; names stay on the panes beside it.
        if (uSignOn > 0.5 && isShop > 0.5) {
          float signBand = smoothstep(0.60, 0.68, f.y) * (1.0 - smoothstep(0.90, 0.97, f.y));
          signBand *= smoothstep(0.10, 0.16, f.x) * (1.0 - smoothstep(0.84, 0.92, f.x));
          signBand *= (1.0 - shopEntry);
          float faceKey = step(abs(Ln.z), abs(Ln.x));
          float signIdx = floor(hash(vec2(vId * 1.31 + faceKey * 5.0, faceAlong * 0.17 + 2.2)) * 8.0);
          vec2 suv = vec2(
            clamp((f.x - 0.12) / 0.76, 0.0, 1.0),
            clamp((f.y - 0.62) / 0.30, 0.0, 1.0)
          );
          vec4 sgn = sampleAtlasRGBA(uSignAtlas, 4.0, 2.0, signIdx, suv);
          float a = sgn.a * signBand * 0.88;
          body = mix(body, sgn.rgb, a);
          body += sgn.rgb * a * 0.18;
        }
      }

      // Shop entry glass — one lit interior across the opening. Kick and the
      // meeting stile sit on the glass only, so a break reveals the room.
      if (inGlass > 0.5) {
        float ax = clamp((faceAlong - glassL) / max(glassR - glassL, 0.04), 0.0, 1.0);
        float ay = clamp((lpM.y - doorBot) / max(doorTop - doorBot, 0.04), 0.0, 1.0);
        vec2 doorPane = vec2(ax, ay);
        float faceShopSeed = vId * 0.17 + mix(6.4, 2.2, faceIsX) + doorCol * 0.13;
        float doorGlow = max(glow, 0.88);
        if (uFaceMapOn > 0.5) {
          float doorRoom = floor(hash(vec2(faceShopSeed, 3.3)) * uFaceCount);
          interior = sampleAtlas(uFaceBack, uFaceCols, uFaceRows, doorRoom, cropAtlasUV(doorPane));
          interior *= mix(0.55, 1.05, doorGlow);
        } else if (uAtlasOn > 0.5) {
          interior = shadeRoomAtlas(doorPane, doorGlow, 1.0, faceShopSeed);
        } else {
          interior = mix(vec3(0.05, 0.04, 0.032), vec3(0.42, 0.28, 0.12), doorGlow);
        }
        float kick = 1.0 - smoothstep(0.0, 0.15, ay);
        vec3 shown = mix(interior, vec3(0.055, 0.048, 0.04), kick * 0.88);
        vec3 doorView = normalize(cameraPosition - vWorldPos);
        float doorFres = pow(1.0 - max(dot(N, doorView), 0.0), 2.6);
        vec3 doorRefl = mix(vec3(0.16, 0.12, 0.07), vec3(0.11, 0.15, 0.26), clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
        float doorAtlas = step(0.5, uAtlasOn) * (1.0 - step(0.5, uFaceMapOn));
        shown *= (1.0 - doorFres * mix(0.28, 0.12, doorAtlas));
        vec3 doorGlass = mix(shown, doorRefl, doorFres * mix(0.22, 0.10, doorAtlas));
        float meet = (1.0 - smoothstep(0.010, 0.026, abs(ax - 0.5))) * step(0.40, glassR - glassL);
        doorGlass = mix(doorGlass, vec3(0.018, 0.020, 0.024), meet);
        body = doorGlass;
      }

      // Broken shop glass is a hole into the bay. Keep the room that was
      // behind the pane. A flat near-black plate was wiping the interior.
      float shopHit = isShop * shopPaneBroken(faceAlong, cellW, Ln, vId);
      if (shopHit * max(inPane, inGlass) > 0.5) {
        vec3 hole = interior;
        float holeLum = dot(hole, vec3(0.30, 0.55, 0.15));
        if (holeLum < 0.045) {
          vec2 holeUV = clamp(
            (f - vec2(mullU, mullV)) / max(vec2(1.0) - 2.0 * vec2(mullU, mullV), vec2(0.02)),
            0.0, 1.0
          );
          if (uAtlasOn > 0.5 && uFaceMapOn < 0.5) {
            hole = shadeRoomAtlas(holeUV, max(glow, 0.82), 1.0, h0 + vId * 0.13);
          } else if (uFaceMapOn > 0.5) {
            float holeRoom = floor(h0 * uFaceCount);
            hole = sampleAtlas(uFaceBack, uFaceCols, uFaceRows, holeRoom, cropAtlasUV(holeUV));
            hole *= mix(0.55, 1.05, max(glow, 0.82));
          } else {
            hole = mix(vec3(0.06, 0.05, 0.042), vec3(0.30, 0.20, 0.12), max(glow, 0.6));
          }
        }
        float recess = smoothstep(0.0, 0.10, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
        body = hole * mix(0.58, 1.0, recess);
      }

      // Jamb, stone sill, and lintel. They stay after the glass breaks so the
      // bay still reads as an opening, not a missing pane.
      float inStile = inDoor * (1.0 - inGlassX);
      body = mix(body, vec3(0.012, 0.013, 0.016), inStile);
      float sillBand = doorOk * step(doorL - 0.025, faceAlong) * step(faceAlong, doorR + 0.025)
        * step(0.015, lpM.y) * step(lpM.y, doorBot);
      body = mix(body, vec3(0.22, 0.17, 0.12), sillBand);
      float inLintel = doorOk * step(doorL - 0.02, faceAlong) * step(faceAlong, doorR + 0.02)
        * step(doorTop, lpM.y) * step(lpM.y, min(doorTop + 0.062, cellH));
      body = mix(body, vec3(0.030, 0.028, 0.026), inLintel);

      // Soft roof wash
      body = mix(body, vColor * 0.20 + vec3(0.03, 0.035, 0.05), isRoof * 0.88);
      body = mix(body, vColor * 0.16, isFloor * 0.9);

      float rim = pow(1.0 - max(dot(N, normalize(cameraPosition - vWorldPos)), 0.0), 2.8);
      body += vec3(0.28, 0.24, 0.48) * rim * 0.08 * isVert * (1.0 - max(inPane, inGlass));

      float dist = length(vWorldPos - cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 12.0);
      vec3 col = mix(body, uFogColor, clamp(fog, 0.0, 0.85));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

const mesh = new THREE.InstancedMesh(boxGeo, buildingMat, INSTANCE_COUNT);

// ——— Atlas textures (fenestra occupied-32 residential · 16 shop) ———
const atlasLoader = harborLoad.loader;
const atlasBase = new URL('../06-intermediate-assets/', import.meta.url);
// file:// cannot use ?v= query on local PNGs; http(s) gets cache-bust.
const atlasCache = location.protocol === 'file:' ? '' : '?v=pane128';
const streetCache = location.protocol === 'file:' ? '' : '?v=street1';

// Pack the street sheet the way freight graffiti is packed: crop/overlay on a
// canvas, then bind. Prop wear is cropped out of the same sheet. Any failure
// leaves uStreetOn at 0 (procedural streets) so the district still draws.
function streetPrepAtlas(tex) {
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

function streetCropCell(packed, col, row) {
  const cell = packed.width / 4;
  const canvas = document.createElement('canvas');
  canvas.width = cell;
  canvas.height = cell;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const inset = 2;
  g.drawImage(
    packed,
    col * cell + inset, row * cell + inset, cell - inset * 2, cell - inset * 2,
    0, 0, cell, cell
  );
  return canvas;
}

function streetPunchPaint(ctx, x, y, w, h) {
  const im = ctx.getImageData(x, y, w, h);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const l = 0.2 * r + 0.72 * g + 0.08 * b;
    if (l > 145) {
      const t = Math.min(1, (l - 145) / 70);
      d[i] = Math.min(255, r + 18 * t);
      d[i + 1] = Math.min(255, g + 14 * t);
      d[i + 2] = Math.min(255, b + 6 * t);
    }
  }
  ctx.putImageData(im, x, y);
}

function streetPack(img) {
  const S = 2048;
  const out = document.createElement('canvas');
  out.width = S;
  out.height = S;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, S, S);
  const cell = S / 4;
  // Second oil pass + a shifted detail crop, clipped to the asphalt cell.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cell, cell);
  ctx.clip();
  ctx.globalAlpha = 0.42;
  ctx.drawImage(img, cell, 0, cell, cell, -cell * 0.18, cell * 0.06, cell, cell);
  ctx.globalAlpha = 0.28;
  ctx.drawImage(img, 0, 3 * cell, cell, cell, cell * 0.22, -cell * 0.08, cell, cell);
  ctx.restore();
  streetPunchPaint(ctx, 2 * cell, 0, cell, cell);
  streetPunchPaint(ctx, 3 * cell, 0, cell, cell);
  return out;
}

function streetWearTexture(canvas, colorSpace) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function streetLiftIron(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const u = d[i + k] / 255;
      d[i + k] = Math.min(255, Math.pow(u, 0.82) * 255 * 1.12);
    }
  }
  ctx.putImageData(im, 0, 0);
}

function streetDeepenCrate(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (l < 215) {
      const t = Math.min(1, (215 - l) / 70);
      d[i] = Math.max(0, d[i] - 48 * t);
      d[i + 1] = Math.max(0, d[i + 1] - 42 * t);
      d[i + 2] = Math.max(0, d[i + 2] - 34 * t);
    }
  }
  ctx.putImageData(im, 0, 0);
}

let ironMatStd = null;
let ironWarmStd = null;
let physCrates = [];
function applyStreetPropWear(packed) {
  try {
    const ironCanvas = streetCropCell(packed, 0, 2);
    const crateCanvas = streetCropCell(packed, 1, 2);
    streetLiftIron(ironCanvas);
    streetDeepenCrate(crateCanvas);
    const ironTex = streetWearTexture(ironCanvas, THREE.SRGBColorSpace);
    const crateTex = streetWearTexture(crateCanvas, THREE.NoColorSpace);
    signalIron.map = ironTex;
    signalIron.color.set(0xffffff);
    signalIron.roughness = 0.58;
    signalIron.metalness = 0.42;
    signalIron.needsUpdate = true;
    ironMatStd.map = ironTex;
    ironMatStd.color.set(0xd5dbe6);
    ironMatStd.needsUpdate = true;
    ironWarmStd.map = ironTex;
    ironWarmStd.color.set(0xe6d5c4);
    ironWarmStd.needsUpdate = true;
    for (let i = 0; i < physCrates.length; i++) {
      const mat = physCrates[i].mesh.material;
      mat.map = crateTex;
      mat.needsUpdate = true;
    }
    if (live.onStreetPropWear) live.onStreetPropWear();
  } catch (err) {
    console.warn('Harbor street prop wear skipped', err);
  }
}

function wireStreetAtlas(tex) {
  asphaltMat.uniforms.uStreetAtlas.value = tex;
  sidewalkMat.uniforms.uStreetAtlas.value = tex;
  curbMat.uniforms.uStreetAtlas.value = tex;
  asphaltMat.uniforms.uStreetOn.value = 1;
  sidewalkMat.uniforms.uStreetOn.value = 1;
  curbMat.uniforms.uStreetOn.value = 1;
  asphaltMat.needsUpdate = true;
  sidewalkMat.needsUpdate = true;
  curbMat.needsUpdate = true;
}

function loadStreetAtlas() {
  const streetAtlasUrl = new URL('street-atlas.png' + streetCache, atlasBase).href;
  window.__streetAtlasUrl = streetAtlasUrl;
  window.__streetAtlas = 'pending';
  atlasLoader.load(streetAtlasUrl, (tex) => {
    try {
      if (!tex.image || !tex.image.width) throw new Error('empty street atlas');
      const packed = streetPack(tex.image);
      const packedTex = new THREE.CanvasTexture(packed);
      streetPrepAtlas(packedTex);
      wireStreetAtlas(packedTex);
      applyStreetPropWear(packed);
      if (tex.dispose) tex.dispose();
      window.__streetAtlas = 'street-photo-packed';
      window.__streetPacked = packed;
    } catch (err) {
      console.warn('Harbor street atlas pack failed — procedural streets remain', err);
      window.__streetAtlas = 'canvas-fallback';
    }
  }, undefined, () => {
    window.__streetAtlas = 'canvas-fallback';
  });
}
loadStreetAtlas();

// Circuit underlayer + moss/kudzu/fungus cover. Vertical concrete only.
// A failed load leaves uSheathOn at 0 (procedural night concrete).
const sheathCache = location.protocol === 'file:' ? '' : '?v=sheath4';
function prepSheath(tex) {
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // No mips — a blurred alpha turns the circuit into a bright haze.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}
function loadSheathAtlases() {
  const circuitUrl = new URL('facade-circuit.png' + sheathCache, atlasBase).href;
  const growthUrl = new URL('facade-growth.png' + sheathCache, atlasBase).href;
  window.__sheathAtlas = 'pending';
  Promise.all([
    atlasLoader.loadAsync(circuitUrl),
    atlasLoader.loadAsync(growthUrl),
  ]).then(([circuitTex, growthTex]) => {
    if (!circuitTex.image || !growthTex.image) throw new Error('empty sheath atlas');
    buildingMat.uniforms.uSheathCircuit.value = prepSheath(circuitTex);
    buildingMat.uniforms.uSheathGrowth.value = prepSheath(growthTex);
    buildingMat.uniforms.uSheathOn.value = 1.0;
    buildingMat.needsUpdate = true;
    window.__sheathAtlas = 'circuit-moss';
  }).catch((err) => {
    console.warn('Harbor façade sheath skipped — concrete grain remains', err);
    window.__sheathAtlas = 'fallback';
  });
}
loadSheathAtlases();

function prepAtlas(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // No mip chain — glancing/upward panes were streaking into horizontal mush via mips.
  // Anisotropy unused without mips; Linear keeps fenestra furniture lines crisp.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
function prepFace(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function wireRoomShopAtlases(roomTex, shopTex, cols, rows, count) {
  buildingMat.uniforms.uRoomAtlas.value = prepAtlas(roomTex);
  buildingMat.uniforms.uShopAtlas.value = prepAtlas(shopTex);
  buildingMat.uniforms.uRoomCols.value = cols;
  buildingMat.uniforms.uRoomRows.value = rows;
  buildingMat.uniforms.uRoomCount.value = count;
  buildingMat.uniforms.uAtlasOn.value = 1.0;
  buildingMat.needsUpdate = true;
}
async function loadHarborAtlases() {
  // Default: fenestra occupied-32 (8×4). Fallback: locked room-atlas.png (4×4).
  // room-atlas-48.png is NOT the approved upstairs sheet.
  try {
    const [roomTex, shopTex] = await Promise.all([
      atlasLoader.loadAsync(new URL('room-atlas-occupied-32.png' + atlasCache, atlasBase).href),
      atlasLoader.loadAsync(new URL('shop-atlas.png' + atlasCache, atlasBase).href),
    ]);
    wireRoomShopAtlases(roomTex, shopTex, 8.0, 4.0, 32.0);
  } catch (err) {
    console.warn('Harbor occupied-32 load failed — trying room-atlas.png', err);
    try {
      const [roomTex, shopTex] = await Promise.all([
        atlasLoader.loadAsync(new URL('room-atlas.png' + atlasCache, atlasBase).href),
        atlasLoader.loadAsync(new URL('shop-atlas.png' + atlasCache, atlasBase).href),
      ]);
      wireRoomShopAtlases(roomTex, shopTex, 4.0, 4.0, 16.0);
    } catch (e2) {
      console.warn('Harbor atlas load failed — procedural interiors remain', e2);
    }
  }
}

// Ground-floor retail names. Original harbor words, soft gold / sea-glass.
// Transparent plate so the shop interior stays visible around the letters.
function makeHarborSignAtlas() {
  const cols = 4;
  const rows = 2;
  const cw = 256;
  const ch = 128;
  const canvas = document.createElement('canvas');
  canvas.width = cols * cw;
  canvas.height = rows * ch;
  const ctx = canvas.getContext('2d');
  const names = ['SALT', 'BERTH', 'HULL', 'KEEL', 'NETS', 'LAMP', 'CARGO', 'DOCK'];
  const sea = (i) => i % 3 === 1;
  function glyph(kind, x, y, ink) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (kind === 'wave') {
      ctx.beginPath();
      ctx.moveTo(-16, 4);
      ctx.bezierCurveTo(-8, -10, -2, 14, 8, 2);
      ctx.bezierCurveTo(14, -6, 18, 8, 22, 0);
      ctx.stroke();
    } else if (kind === 'ring') {
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0.4, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 14, 3.2, 0, Math.PI * 2);
      ctx.stroke();
    } else if (kind === 'lamp') {
      ctx.beginPath();
      ctx.moveTo(-10, -8);
      ctx.lineTo(10, -8);
      ctx.lineTo(6, 6);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.lineTo(0, 14);
      ctx.moveTo(-7, 14);
      ctx.lineTo(7, 14);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(12, 10);
      ctx.lineTo(-12, 10);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }
  const kinds = ['wave', 'ring', 'mark', 'wave', 'ring', 'lamp', 'mark', 'ring'];
  for (let i = 0; i < names.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cw;
    const y = row * ch;
    const ink = sea(i) ? 'rgba(186, 214, 220, 0.94)' : 'rgba(232, 196, 120, 0.95)';
    const glow = sea(i) ? 'rgba(140, 186, 198, 0.55)' : 'rgba(240, 194, 75, 0.5)';
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cw, ch);
    ctx.clip();
    ctx.fillStyle = 'rgba(6, 8, 14, 0.42)';
    ctx.fillRect(x + 18, y + 28, cw - 36, ch - 52);
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = ink;
    ctx.font = '700 62px "Arial Black", "Noto Sans", "Liberation Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(names[i], x + cw * 0.58, y + ch * 0.52);
    ctx.shadowBlur = 0;
    glyph(kinds[i], x + 48, y + ch * 0.52, ink);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  buildingMat.uniforms.uSignAtlas.value = tex;
  buildingMat.uniforms.uSignOn.value = 1.0;
  buildingMat.needsUpdate = true;
}
makeHarborSignAtlas();

if (facesMode) {
  const faceBase = new URL('../06-intermediate-assets/face-proto/', import.meta.url);
  Promise.all([
    atlasLoader.loadAsync(new URL('face-back-atlas.png', faceBase).href),
    atlasLoader.loadAsync(new URL('face-left-atlas.png', faceBase).href),
    atlasLoader.loadAsync(new URL('face-right-atlas.png', faceBase).href),
    atlasLoader.loadAsync(new URL('face-floor.png', faceBase).href),
    atlasLoader.loadAsync(new URL('face-ceiling.png', faceBase).href),
  ]).then(([back, left, right, floor, ceil]) => {
    buildingMat.uniforms.uFaceBack.value = prepFace(back);
    buildingMat.uniforms.uFaceLeft.value = prepFace(left);
    buildingMat.uniforms.uFaceRight.value = prepFace(right);
    buildingMat.uniforms.uFaceFloor.value = prepFace(floor);
    buildingMat.uniforms.uFaceCeiling.value = prepFace(ceil);
    buildingMat.uniforms.uFaceCount.value = 7.0;
    buildingMat.uniforms.uFaceCols.value = 4.0;
    buildingMat.uniforms.uFaceRows.value = 2.0;
    buildingMat.uniforms.uFaceMapOn.value = 1.0;
    buildingMat.uniforms.uAtlasOn.value = 0.0;
    buildingMat.needsUpdate = true;
  }).catch((err) => {
    console.warn('Harbor face-map load failed — falling back to atlas', err);
    loadHarborAtlases();
  });
} else {
  loadHarborAtlases();
}

mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

const dummy = new THREE.Object3D();
const warm = new THREE.Color(0xc47a4a);
const cool = new THREE.Color(0x6e8fb5);
const violet = new THREE.Color(0x8a7bb8);
const gold = new THREE.Color(0xf0c24b);
const teal = new THREE.Color(0x3a6e78);
const tmpC = new THREE.Color();

// Rectilinear district massing only (Virgil 2026-09-26): unit BoxGeometry × scale.
// No yaw / chamfer / cylinder silhouettes — planar façades so local UV + room/shop atlas stay square.
const harborBoxes = [];
function placeBuilding(x, z, w, h, d, color, _yawIgnored) {
  if (placed >= INSTANCE_COUNT) return false;
  // Snap tiny footprints up so pencil towers never read as curved posts
  const MIN_FACE = 0.72;
  w = Math.max(w, MIN_FACE);
  d = Math.max(d, MIN_FACE);
  // Soft aspect clamp — avoid blade-thin silhouettes that orbit as cylinders
  if (w / d > 2.4) w = d * 2.4;
  if (d / w > 2.4) d = w * 2.4;
  dummy.position.set(x, 0, z);
  dummy.scale.set(w, h, d);
  dummy.rotation.set(0, 0, 0); // axis-aligned; faces stay planar for window cells
  dummy.updateMatrix();
  mesh.setMatrixAt(placed, dummy.matrix);
  mesh.setColorAt(placed, color);
  harborBoxes.push({ x, z, w, h, d });
  placed++;
  return true;
}

let placed = 0;
// Seeded PRNG — stable stills / accretion feel without pure Euclidean packing
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x48415234); // HAR4
const rng = (a, b) => a + rand() * (b - a);

// Plaza / parking scar pads (empty lots) — darker lot fills
const scarMat = new THREE.MeshStandardMaterial({
  color: 0x12151c, roughness: 0.92, metalness: 0.06,
});
const scars = new THREE.InstancedMesh(slabGeo, scarMat, 48);
scars.frustumCulled = false;
let scarN = 0;
function addScar(cx, cz, sx, sz) {
  if (scarN >= 48) return;
  dummy.position.set(cx, 0.045, cz);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(sx, 0.04, sz);
  dummy.updateMatrix();
  scars.setMatrixAt(scarN++, dummy.matrix);
}

// Irregular lots: still roads→blocks→lots, but empty / merged / organic heights (pass 4)
for (let bz = 0; bz < GRID_ROWS; bz++) {
  for (let bx = 0; bx < GRID_COLS; bx++) {
    const b = blockRect(bx, bz);
    const lotW = (BLOCK_W - SETBACK * (LOTS_X + 1)) / LOTS_X;
    const lotD = (BLOCK_D - SETBACK * (LOTS_Z + 1)) / LOTS_Z;
    const nearQuay = bz === 0;
    const hinter = bz >= GRID_ROWS - 1;

    // Slot plan: 2×2; mark empty or merge
    // slot state: 1 = build, 0 = empty scar, 2 = consumed by merge
    const slot = [[1, 1], [1, 1]];
    const roll = rand();
    if (roll < 0.16) {
      // empty plaza / parking scar — clear 1–2 lots
      const elx = Math.floor(rand() * LOTS_X);
      const elz = Math.floor(rand() * LOTS_Z);
      slot[elz][elx] = 0;
      if (rand() < 0.45) slot[elz][1 - elx] = 0;
    } else if (roll < 0.38) {
      // merge two lots along X into one double-width low building
      const mz = Math.floor(rand() * LOTS_Z);
      slot[mz][0] = 3; // merge anchor
      slot[mz][1] = 2; // consumed
    } else if (roll < 0.48) {
      // merge along Z (depth)
      const mx = Math.floor(rand() * LOTS_X);
      slot[0][mx] = 4;
      slot[1][mx] = 2;
    }

    // No skewLot / yaw — rectilinear boxes only (curves broke atlas window reads).

    for (let lz = 0; lz < LOTS_Z; lz++) {
      for (let lx = 0; lx < LOTS_X; lx++) {
        const st = slot[lz][lx];
        const lx0 = b.x0 + SETBACK + lx * (lotW + SETBACK);
        const lz0 = b.z0 + SETBACK + lz * (lotD + SETBACK);

        if (st === 0) {
          addScar(lx0 + lotW * 0.5, lz0 + lotD * 0.5, lotW * 0.92, lotD * 0.92);
          continue;
        }
        if (st === 2) continue;

        let footprintW, footprintD, cx, cz, hBias;
        // Discrete footprint scales (planar box silhouettes — no organic jitter that reads curved)
        const FW = [0.70, 0.78, 0.85, 0.92];
        const FD = [0.68, 0.76, 0.84, 0.90];
        const fw = FW[Math.floor(rand() * FW.length)];
        const fd = FD[Math.floor(rand() * FD.length)];
        if (st === 3) {
          // double-width along X, low shop/warehouse
          footprintW = lotW * 2 + SETBACK;
          footprintD = lotD * fd;
          cx = lx0 + (lotW * 2 + SETBACK) * 0.5;
          cz = lz0 + lotD * 0.5;
          hBias = 'low';
        } else if (st === 4) {
          footprintW = lotW * fw;
          footprintD = lotD * 2 + SETBACK;
          cx = lx0 + lotW * 0.5;
          cz = lz0 + (lotD * 2 + SETBACK) * 0.5;
          hBias = 'low';
        } else {
          footprintW = lotW * fw;
          footprintD = lotD * fd;
          cx = lx0 + lotW * 0.5;
          cz = lz0 + lotD * 0.5;
          hBias = 'normal';
        }

        // Organic height variance — short shop next to tall neighbor
        let h;
        const hRoll = rand();
        if (hBias === 'low') {
          h = rng(1.35, 2.85);
        } else if (hRoll < 0.2) {
          h = rng(1.25, 2.55); // short shop / walk-up
        } else if (hRoll < 0.32) {
          h = nearQuay ? rng(7.2, 11.2) : rng(6.5, 10.5); // tall neighbor
        } else if (nearQuay) {
          h = rng(3.0, 8.2);
        } else if (hinter) {
          h = rng(2.2, 6.6);
        } else {
          h = rng(2.6, 9.2);
        }

        const pick = rand();
        let c;
        if (hBias === 'low' || h < 2.7) {
          // ground-ish massing leans warm (shops / bars suggested by light only)
          c = pick > 0.4 ? tmpC.copy(warm).multiplyScalar(rng(0.8, 1))
            : pick > 0.2 ? tmpC.copy(gold).multiplyScalar(0.7)
            : tmpC.copy(violet).multiplyScalar(0.85);
        } else if (nearQuay) {
          c = pick > 0.55 ? tmpC.copy(warm).multiplyScalar(rng(0.75, 1))
            : pick > 0.3 ? tmpC.copy(gold).multiplyScalar(0.65)
            : tmpC.copy(cool);
        } else if (hinter) {
          c = pick > 0.5 ? tmpC.copy(cool).multiplyScalar(0.85)
            : pick > 0.25 ? tmpC.copy(violet).multiplyScalar(0.9)
            : tmpC.copy(teal);
        } else {
          c = pick > 0.7 ? tmpC.copy(gold).multiplyScalar(0.68)
            : pick > 0.45 ? cool : pick > 0.22 ? violet : teal;
          c = tmpC.copy(c);
        }

        // Axis-aligned box only — planar façades for local UV / occupied-32 + shop atlas.
        placeBuilding(cx, cz, footprintW, h, footprintD, c, 0);
      }
    }
  }
}

// Promenade stays open along the seawall. These rolls used to drop a row of
// pier sheds on the quay, jammed against the graffiti face. Burn the same
// draws so the inland district does not reshuffle; the instance budget
// fills on the hinterland belt instead.
for (let i = 0; i < 14; i++) {
  rng(0.3, 1.1);
  rng(0.55, 1.05);
  rng(1.1, 2.8);
  rng(0.5, 0.95);
  rand();
}

// 360° hinterland wrap — extra row + side wings so orbit never faces void
const rearZ = gridOriginZ - GRID_ROWS * cellD - STREET_W * 0.2;
for (let i = 0; i < 16 && placed < INSTANCE_COUNT; i++) {
  const x = -districtW * 0.45 + i * (districtW * 0.9 / 15) + rng(-0.2, 0.2);
  const z = rearZ - rng(1.2, 3.8);
  const h = rng(2.0, 7.5);
  const c = rand() > 0.45 ? tmpC.copy(cool).multiplyScalar(0.8)
    : tmpC.copy(violet).multiplyScalar(0.85);
  placeBuilding(x, z, rng(0.7, 1.6), h, rng(0.7, 1.5), c, 0);
}
// Side wings (±X)
for (let side = -1; side <= 1; side += 2) {
  for (let i = 0; i < 8 && placed < INSTANCE_COUNT; i++) {
    const x = side * (districtW * 0.5 + rng(0.8, 2.4));
    const z = gridOriginZ - rng(0.5, districtD - 1);
    placeBuilding(x, z, rng(0.65, 1.4), rng(2.2, 7.2), rng(0.65, 1.35),
      tmpC.copy(side > 0 ? teal : cool).multiplyScalar(0.82), 0);
  }
}

// Fill remaining budget with hinterland scatter (still on negative-Z massing belt)
while (placed < INSTANCE_COUNT) {
  const x = rng(-districtW * 0.55, districtW * 0.55);
  const z = rearZ - rng(0.5, 6.5);
  placeBuilding(x, z, rng(0.55, 1.3), rng(1.6, 6.5), rng(0.55, 1.2),
    tmpC.copy(rand() > 0.5 ? cool : violet).multiplyScalar(0.78), 0);
}

scars.count = scarN;
scars.instanceMatrix.needsUpdate = true;
scene.add(scars);

mesh.count = INSTANCE_COUNT;
mesh.instanceMatrix.needsUpdate = true;
if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
scene.add(mesh);
mesh.frustumCulled = false;
mesh.computeBoundingSphere();
window.__harborBuildings = (() => {
  const list = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < placed; i++) {
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    e.setFromQuaternion(q, 'YXZ');
    list.push({ i, x: p.x, y: p.y, z: p.z, w: s.x, h: s.y, d: s.z, yaw: e.y });
  }
  return list;
})();

// ——— Rooftop strand lights (2–4 flat roofs, visible from the Harbor orbit) ———
// Café bulbs on a sagging cable. Emissive bulbs + one warm pool per roof —
// not a bulb light each — so phones stay in budget. Massing stays a box.
function pickStrandRoofs(boxes) {
  const cam = new THREE.Vector3(16.5, 10.5, 20.5);
  const look = new THREE.Vector3(0, 1.6, -2.5);
  const viewDir = look.clone().sub(cam).normalize();
  const cands = [];
  for (const b of boxes) {
    if (b.h < 3.4 || b.h > 11.5) continue;
    const longSide = Math.max(b.w, b.d);
    const shortSide = Math.min(b.w, b.d);
    if (longSide < 1.45 || shortSide < 0.95) continue;
    const roof = new THREE.Vector3(b.x, b.h, b.z);
    const toRoof = roof.clone().sub(cam).normalize();
    const facing = toRoof.dot(viewDir);
    if (facing < 0.72) continue;
    const score = facing * 3 + b.z * 0.12 + Math.min(b.h, 8) * 0.05 + shortSide;
    cands.push({ b, score });
  }
  cands.sort((a, c) => c.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.every((p) => Math.hypot(p.b.x - c.b.x, p.b.z - c.b.z) > 3.4)) picked.push(c);
    if (picked.length === 3) break;
  }
  return picked.map((p) => p.b);
}

const strandGroup = new THREE.Group();
strandGroup.name = 'rooftop-strands';
scene.add(strandGroup);
const strandPostGeo = new THREE.CylinderGeometry(0.015, 0.018, 1, 6);
strandPostGeo.translate(0, 0.5, 0);
const strandPostMat = new THREE.MeshStandardMaterial({
  color: 0x2a2e34, roughness: 0.62, metalness: 0.35,
});
const strandWireMat = new THREE.MeshStandardMaterial({
  color: 0x1a1c22, roughness: 0.72, metalness: 0.25,
});
const strandBulbGeo = new THREE.SphereGeometry(0.032, 7, 5);
const strandBulbMat = new THREE.MeshStandardMaterial({
  color: 0x3a2a1c,
  emissive: 0xffc48a,
  emissiveIntensity: 2.8,
  roughness: 0.32,
  metalness: 0.04,
});
const STRAND_BULB_MAX = 48;
const strandBulbs = new THREE.InstancedMesh(strandBulbGeo, strandBulbMat, STRAND_BULB_MAX);
strandBulbs.count = 0;
strandBulbs.frustumCulled = false;
strandBulbs.layers.enable(BLOOM_LAYER);
strandBulbs.name = 'rooftop-strand-bulbs';
scene.add(strandBulbs);
const strandBulbBase = [];
const strandDummy = new THREE.Object3D();
const strandRoofs = pickStrandRoofs(harborBoxes);

function addStrand(a, b, sag, phase) {
  const span = a.distanceTo(b);
  if (span < 0.55) return;
  const postH = 0.34;
  for (const p of [a, b]) {
    const post = new THREE.Mesh(strandPostGeo, strandPostMat);
    post.scale.y = postH;
    post.position.set(p.x, p.y, p.z);
    strandGroup.add(post);
  }
  const topA = a.clone(); topA.y += postH;
  const topB = b.clone(); topB.y += postH;
  const pts = [];
  const segN = 16;
  for (let i = 0; i <= segN; i++) {
    const t = i / segN;
    const p = new THREE.Vector3().lerpVectors(topA, topB, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    pts.push(p);
  }
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segN, 0.006, 4, false),
    strandWireMat
  );
  strandGroup.add(tube);
  const side = new THREE.Vector3().subVectors(topB, topA);
  side.y = 0;
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.cross(new THREE.Vector3(0, 1, 0)).normalize();
  const bulbs = 8;
  for (let i = 0; i < bulbs; i++) {
    if (strandBulbs.count >= STRAND_BULB_MAX) break;
    const t = (i + 0.5) / bulbs;
    const p = new THREE.Vector3().lerpVectors(topA, topB, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    const idx = strandBulbs.count++;
    const amp = Math.sin(t * Math.PI) * 0.02;
    strandBulbBase.push({
      x: p.x, y: p.y, z: p.z, phase: phase + i * 0.45, ax: side.x, az: side.z, amp,
    });
    strandDummy.position.copy(p);
    strandDummy.scale.set(1, 1, 1);
    strandDummy.rotation.set(0, 0, 0);
    strandDummy.updateMatrix();
    strandBulbs.setMatrixAt(idx, strandDummy.matrix);
  }
  const mid = new THREE.Vector3().lerpVectors(topA, topB, 0.5);
  mid.y -= sag * 0.65;
  const pool = new THREE.PointLight(0xffb067, 11, 5.5, 2);
  pool.position.copy(mid);
  strandGroup.add(pool);
}

strandRoofs.forEach((b, i) => {
  const alongX = b.w >= b.d;
  const cross = alongX ? b.d : b.w;
  const offsets = cross > 1.35 && i < 2 ? [-0.22, 0.22] : [0];
  const sag = 0.14 + (i % 3) * 0.02;
  for (const off of offsets) {
    let a;
    let end;
    if (alongX) {
      const z = b.z + off;
      a = new THREE.Vector3(b.x - b.w * 0.5 + 0.18, b.h, z);
      end = new THREE.Vector3(b.x + b.w * 0.5 - 0.18, b.h, z);
    } else {
      const x = b.x + off;
      a = new THREE.Vector3(x, b.h, b.z - b.d * 0.5 + 0.18);
      end = new THREE.Vector3(x, b.h, b.z + b.d * 0.5 - 0.18);
    }
    addStrand(a, end, sag, i * 1.7 + off);
  }
});
strandBulbs.instanceMatrix.needsUpdate = true;
window.__harborStrands = {
  roofs: strandRoofs.map((b) => ({ x: b.x, z: b.z, w: b.w, h: b.h, d: b.d })),
  bulbs: strandBulbs.count,
};

function swayStrandBulbs(t) {
  if (!strandBulbs.count) return;
  const live = freezeMotion ? 0 : 1;
  for (let i = 0; i < strandBulbs.count; i++) {
    const b = strandBulbBase[i];
    const s = Math.sin(t * 0.8 + b.phase) * b.amp * live;
    strandDummy.position.set(b.x + b.ax * s, b.y + s * 0.35, b.z + b.az * s);
    strandDummy.scale.set(1, 1, 1);
    strandDummy.rotation.set(0, 0, 0);
    strandDummy.updateMatrix();
    strandBulbs.setMatrixAt(i, strandDummy.matrix);
  }
  strandBulbs.instanceMatrix.needsUpdate = true;
}

// ——— Night traffic signals ———
// A few corner heads on the existing grid, inland of the quay. The Rube plate,
// vessel, and crate deck stay clear (no poles on the quay-front street).
// Vertical 3-lamp heads, dark housing, one soft pool per crossing.
const SIGNAL_GREEN_T = 3.6;
const SIGNAL_AMBER_T = 1.2;
const SIGNAL_RED_T = 4.8;
const SIGNAL_CYCLE = SIGNAL_GREEN_T + SIGNAL_AMBER_T + SIGNAL_RED_T; // 9.6
const SIGNAL_ORBIT_CAM = new THREE.Vector3(16.5, 10.5, 20.5);
const SIGNAL_LAMP_HEX = [0xff2424, 0xffa010, 0x1ec85a]; // red, amber, green
const SIGNAL_LAMP_OFF = [0x3a1416, 0x3a2c12, 0x14301c];

function signalStage(t, phase) {
  let u = (t + phase) % SIGNAL_CYCLE;
  if (u < 0) u += SIGNAL_CYCLE;
  if (u < SIGNAL_GREEN_T) return 2;
  if (u < SIGNAL_GREEN_T + SIGNAL_AMBER_T) return 1;
  return 0;
}

function streetCrossing(c, r) {
  return {
    c,
    r,
    x: gridOriginX - STREET_W * 0.5 + c * cellW,
    z: gridOriginZ + STREET_W * 0.5 - r * cellD,
  };
}

function signalRayBlocked(origin, target) {
  const dirx = target.x - origin.x;
  const diry = target.y - origin.y;
  const dirz = target.z - origin.z;
  for (let i = 0; i < harborBoxes.length; i++) {
    const b = harborBoxes[i];
    const minX = b.x - b.w * 0.5;
    const maxX = b.x + b.w * 0.5;
    const minZ = b.z - b.d * 0.5;
    const maxZ = b.z + b.d * 0.5;
    let tmin = 0;
    let tmax = 1;
    const slabs = [
      [dirx, origin.x, minX, maxX],
      [diry, origin.y, 0, b.h],
      [dirz, origin.z, minZ, maxZ],
    ];
    let hit = true;
    for (let a = 0; a < 3; a++) {
      const d = slabs[a][0];
      const o = slabs[a][1];
      let t1 = slabs[a][2];
      let t2 = slabs[a][3];
      if (Math.abs(d) < 1e-8) {
        if (o < t1 || o > t2) { hit = false; break; }
        continue;
      }
      t1 = (t1 - o) / d;
      t2 = (t2 - o) / d;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { hit = false; break; }
    }
    if (hit && tmin < 0.9 && tmax > 0.04) return true;
  }
  return false;
}

function signalPoleBlocked(x, z) {
  for (let i = 0; i < harborBoxes.length; i++) {
    const b = harborBoxes[i];
    if (Math.abs(x - b.x) < b.w * 0.5 + 0.08 && Math.abs(z - b.z) < b.d * 0.5 + 0.08) return true;
  }
  return false;
}

function pickTrafficCorners() {
  const inset = STREET_W * 0.5 - SIDEWALK_W * 0.5;
  const signs = [1, -1];
  const cands = [];
  for (let r = 1; r <= GRID_ROWS - 1; r++) {
    for (let c = 1; c <= GRID_COLS - 1; c++) {
      const cross = streetCrossing(c, r);
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          const sx = signs[a];
          const sz = signs[b];
          const poleX = cross.x + sx * inset;
          const poleZ = cross.z + sz * inset;
          if (poleZ > 0.05) continue;
          if (signalPoleBlocked(poleX, poleZ)) continue;
          const dx = cross.x - poleX;
          const dz = cross.z - poleZ;
          const len = Math.hypot(dx, dz) || 1;
          const arm = 0.78;
          const headX = poleX + (dx / len) * arm;
          const headZ = poleZ + (dz / len) * arm;
          const headY = 2.52;
          if (Math.hypot(headX + 3.15, headZ - 3.12) < 4.2) continue;
          const open = !signalRayBlocked(SIGNAL_ORBIT_CAM, { x: headX, y: headY, z: headZ });
          const dist = Math.hypot(headX, headZ + 2.5);
          cands.push({
            c, r, poleX, poleZ, headX, headY, headZ, cross,
            score: (open ? 12 : 0) - dist * 0.22 + headZ * 0.08,
          });
        }
      }
    }
  }
  cands.sort((p, q) => q.score - p.score);
  const picked = [];
  for (let i = 0; i < cands.length; i++) {
    const cand = cands[i];
    let spread = true;
    for (let j = 0; j < picked.length; j++) {
      if (Math.hypot(picked[j].headX - cand.headX, picked[j].headZ - cand.headZ) < 6.2) {
        spread = false;
        break;
      }
    }
    if (!spread) continue;
    picked.push(cand);
    if (picked.length === 4) break;
  }
  return picked;
}

const trafficGroup = new THREE.Group();
trafficGroup.name = 'traffic-signals';
scene.add(trafficGroup);

const signalIron = new THREE.MeshStandardMaterial({
  color: 0x1a1c22, roughness: 0.55, metalness: 0.48,
});
const signalVisorMat = new THREE.MeshStandardMaterial({
  color: 0x101114, roughness: 0.72, metalness: 0.22,
});
const signalPoleGeo = new THREE.CylinderGeometry(0.04, 0.048, 1, 8);
signalPoleGeo.translate(0, 0.5, 0);
const signalBaseGeo = new THREE.BoxGeometry(0.18, 0.035, 0.18);
const signalArmGeo = new THREE.BoxGeometry(0.046, 0.042, 1);
const signalHangerGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 6);
signalHangerGeo.translate(0, -0.5, 0);
const signalHousingGeo = new THREE.BoxGeometry(0.26, 0.84, 0.15);
const signalBackGeo = new THREE.BoxGeometry(0.32, 0.9, 0.028);
const signalVisorGeo = new THREE.BoxGeometry(0.22, 0.02, 0.12);
const signalLampGeo = new THREE.SphereGeometry(0.072, 10, 8);

const SIGNAL_MAX = 4;
const signalPoles = new THREE.InstancedMesh(signalPoleGeo, signalIron, SIGNAL_MAX);
const signalBases = new THREE.InstancedMesh(signalBaseGeo, signalIron, SIGNAL_MAX);
const signalArms = new THREE.InstancedMesh(signalArmGeo, signalIron, SIGNAL_MAX);
const signalHangers = new THREE.InstancedMesh(signalHangerGeo, signalIron, SIGNAL_MAX * 2);
const signalHousings = new THREE.InstancedMesh(signalHousingGeo, signalIron, SIGNAL_MAX * 2);
const signalBacks = new THREE.InstancedMesh(signalBackGeo, signalVisorMat, SIGNAL_MAX * 2);
const signalVisors = new THREE.InstancedMesh(signalVisorGeo, signalVisorMat, SIGNAL_MAX * 6);
const signalLensMat = new THREE.MeshStandardMaterial({
  color: 0x221418, roughness: 0.42, metalness: 0.06,
  emissive: 0x120808, emissiveIntensity: 0.25,
});
const signalLenses = new THREE.InstancedMesh(signalLampGeo, signalLensMat, SIGNAL_MAX * 6);
const signalLitMat = [
  new THREE.MeshStandardMaterial({
    color: 0x3a1010, emissive: SIGNAL_LAMP_HEX[0], emissiveIntensity: 2.7,
    roughness: 0.28, metalness: 0.02,
  }),
  new THREE.MeshStandardMaterial({
    color: 0x3a2a10, emissive: SIGNAL_LAMP_HEX[1], emissiveIntensity: 2.45,
    roughness: 0.28, metalness: 0.02,
  }),
  new THREE.MeshStandardMaterial({
    color: 0x103018, emissive: SIGNAL_LAMP_HEX[2], emissiveIntensity: 2.55,
    roughness: 0.28, metalness: 0.02,
  }),
];
const signalLit = [
  new THREE.InstancedMesh(signalLampGeo, signalLitMat[0], SIGNAL_MAX * 2),
  new THREE.InstancedMesh(signalLampGeo, signalLitMat[1], SIGNAL_MAX * 2),
  new THREE.InstancedMesh(signalLampGeo, signalLitMat[2], SIGNAL_MAX * 2),
];
const signalMeshes = [
  signalPoles, signalBases, signalArms, signalHangers, signalHousings,
  signalBacks, signalVisors, signalLenses,
].concat(signalLit);
for (let i = 0; i < signalMeshes.length; i++) {
  signalMeshes[i].count = 0;
  signalMeshes[i].frustumCulled = false;
  scene.add(signalMeshes[i]);
}
for (let i = 0; i < signalLit.length; i++) signalLit[i].layers.enable(BLOOM_LAYER);
signalLenses.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SIGNAL_MAX * 6 * 3), 3);

const signalDummy = new THREE.Object3D();
const signalColor = new THREE.Color();
function signalSet(mesh, i, x, y, z, yaw, sx, sy, sz) {
  signalDummy.position.set(x, y, z);
  signalDummy.rotation.set(0, yaw, 0);
  signalDummy.scale.set(sx, sy, sz);
  signalDummy.updateMatrix();
  mesh.setMatrixAt(i, signalDummy.matrix);
  if (i + 1 > mesh.count) mesh.count = i + 1;
}

const signalCorners = pickTrafficCorners();
const signalRigs = [];
const signalLampHome = [[], [], []];

for (let n = 0; n < signalCorners.length; n++) {
  const corner = signalCorners[n];
  const phase = n * (SIGNAL_CYCLE / signalCorners.length);
  const poleH = 3.02;
  const dx = corner.cross.x - corner.poleX;
  const dz = corner.cross.z - corner.poleZ;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const armLen = 0.78;
  const endX = corner.poleX + ux * armLen;
  const endZ = corner.poleZ + uz * armLen;
  const armYaw = Math.atan2(ux, uz);
  const sideX = -uz;
  const sideZ = ux;
  const armY = poleH - 0.02;
  const hy = armY - 0.62;

  signalSet(signalPoles, n, corner.poleX, 0, corner.poleZ, 0, 1, poleH, 1);
  signalSet(signalBases, n, corner.poleX, 0.02, corner.poleZ, 0, 1, 1, 1);
  signalSet(
    signalArms, n,
    (corner.poleX + endX) * 0.5, armY, (corner.poleZ + endZ) * 0.5,
    armYaw, 1, 1, armLen
  );

  const heads = [
    { yaw: 0, ox: sideX * 0.16, oz: sideZ * 0.16, phase },
    { yaw: Math.PI / 2, ox: -sideX * 0.16, oz: -sideZ * 0.16, phase: phase + SIGNAL_RED_T },
  ];
  const lampY = [0.24, 0, -0.24];
  for (let h = 0; h < heads.length; h++) {
    const head = heads[h];
    const hx = endX + head.ox;
    const hz = endZ + head.oz;
    const faceX = Math.sin(head.yaw);
    const faceZ = Math.cos(head.yaw);
    const hi = n * 2 + h;
    const hangerLen = armY - (hy + 0.42);
    signalSet(signalHangers, hi, hx, armY, hz, 0, 1, hangerLen, 1);
    signalSet(signalHousings, hi, hx, hy, hz, head.yaw, 1, 1, 1);
    signalSet(signalBacks, hi, hx - faceX * 0.09, hy, hz - faceZ * 0.09, head.yaw, 1, 1, 1);
    for (let k = 0; k < 3; k++) {
      const ly = hy + lampY[k];
      const lx = hx + faceX * 0.09;
      const lz = hz + faceZ * 0.09;
      const vi = n * 6 + h * 3 + k;
      signalSet(signalVisors, vi, lx + faceX * 0.04, ly + 0.078, lz + faceZ * 0.04, head.yaw, 1, 1, 1);
      signalSet(signalLenses, vi, lx, ly, lz, 0, 1, 1, 1);
      signalColor.setHex(SIGNAL_LAMP_OFF[k]);
      signalLenses.setColorAt(vi, signalColor);
      const li = n * 2 + h;
      signalLampHome[k].push({ x: lx, y: ly, z: lz, phase: head.phase, color: k, index: li });
      signalSet(signalLit[k], li, lx, -40, lz, 0, 0.001, 0.001, 0.001);
    }
  }

  const pool = new THREE.PointLight(SIGNAL_LAMP_HEX[0], 1.7, 4.6, 2);
  pool.position.set(endX, hy, endZ);
  trafficGroup.add(pool);
  signalRigs.push({
    phase,
    ewPhase: phase + SIGNAL_RED_T,
    light: pool,
    pole: { x: corner.poleX, z: corner.poleZ },
    head: { x: endX, y: hy, z: endZ },
    crossing: { c: corner.c, r: corner.r, x: corner.cross.x, z: corner.cross.z },
  });
}

for (let i = 0; i < signalMeshes.length; i++) signalMeshes[i].instanceMatrix.needsUpdate = true;
if (signalLenses.instanceColor) signalLenses.instanceColor.needsUpdate = true;

function updateTrafficSignals(t) {
  if (!signalRigs.length) return;
  for (let k = 0; k < 3; k++) {
    const homes = signalLampHome[k];
    for (let i = 0; i < homes.length; i++) {
      const lamp = homes[i];
      const on = signalStage(t, lamp.phase) === lamp.color;
      const s = on ? 1.12 : 0.001;
      signalSet(
        signalLit[k], lamp.index,
        lamp.x, on ? lamp.y : -40, lamp.z,
        0, s, s, s
      );
    }
    signalLit[k].instanceMatrix.needsUpdate = true;
  }
  const stages = [];
  for (let i = 0; i < signalRigs.length; i++) {
    const rig = signalRigs[i];
    const stage = signalStage(t, rig.phase);
    stages.push(stage);
    const homes = signalLampHome[stage];
    let glow = null;
    for (let j = 0; j < homes.length; j++) {
      if (homes[j].phase === rig.phase) { glow = homes[j]; break; }
    }
    if (glow) {
      rig.light.color.setHex(SIGNAL_LAMP_HEX[stage]);
      rig.light.position.set(glow.x, glow.y, glow.z);
    }
  }
  if (window.__harborSignals) window.__harborSignals.stages = stages;
}

updateTrafficSignals(freezeMotion ? 1.25 : 0);
window.__harborSignals = {
  count: signalRigs.length,
  cycle: SIGNAL_CYCLE,
  meshes: {
    poles: signalPoles.count,
    housings: signalHousings.count,
    visors: signalVisors.count,
    lenses: signalLenses.count,
    lit: signalLit.map((m) => m.count),
  },
  heads: signalRigs.map((r) => ({
    x: r.head.x, y: r.head.y, z: r.head.z,
    poleX: r.pole.x, poleZ: r.pole.z,
    phase: r.phase,
    crossing: r.crossing,
  })),
  stages: signalRigs.map((r) => signalStage(freezeMotion ? 1.25 : 0, r.phase)),
};

// ——— Ground / district pad (under streets; darker than asphalt) ———
// Stop at quay/seawall — do NOT cover the outboard basin (was Plane 90×70 @ z=-4
// spanning to z≈+31, which hid the water plane under an opaque pad).
const GROUND_Z_MAX = 5.35; // under quay edge, landward of SEAWALL_Z≈5.42
const GROUND_Z_MIN = -40;
const groundDepth = GROUND_Z_MAX - GROUND_Z_MIN;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(90, groundDepth),
  new THREE.MeshStandardMaterial({ color: 0x080a12, roughness: 0.94, metalness: 0.04 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.04, (GROUND_Z_MAX + GROUND_Z_MIN) * 0.5);
scene.add(ground);

// ——— Hero quay slab — wet specular + fake skyline reflection ———
const quayMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector2(0, 0) },
    uAmp: { value: freezeMotion ? 0 : 0.1 },
  },
  vertexShader: /* glsl */`
    uniform float uTime;
    uniform float uAmp;
    uniform vec2 uPointer;
    varying vec2 vUv;
    varying vec3 vPos;
    varying vec3 vWorldPos;
    ${NOISE_GLSL}
    void main(){
      vUv = uv;
      vec3 p = position;
      // Flat deck. A swell here (old ~10–20 cm) rose through the gold plate,
      // whose rim sits only ~2 cm above y=0.04, and read as water on the quay.
      float n = fbm(uv * 4.0);
      p.z += (n - 0.5) * 0.003;
      vPos = p;
      vec4 wp = modelMatrix * vec4(p, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uTime;
    uniform vec2 uPointer;
    varying vec2 vUv;
    varying vec3 vPos;
    varying vec3 vWorldPos;
    ${NOISE_GLSL}
    void main(){
      vec3 stone = vec3(0.08, 0.09, 0.13);
      float grain = fbm(vUv * 18.0 + uTime * 0.05);
      stone += grain * 0.045;
      // plank / seam lines along quay
      float seam = smoothstep(0.02, 0.0, abs(fract(vUv.x * 14.0) - 0.5) - 0.46);
      stone *= 1.0 - seam * 0.18;
      float edge = smoothstep(0.025, 0.0, min(min(vUv.x, 1.0-vUv.x), min(vUv.y, 1.0-vUv.y)));
      stone = mix(stone, vec3(0.35, 0.3, 0.18), edge * 0.25);
      // Dry promenade. A static damp line only in the last strip against the
      // seawall (uv.y 0 is the water edge). No animated wash across the plate.
      float againstWall = 1.0 - smoothstep(0.0, 0.07, vUv.y);
      stone = mix(stone, vec3(0.045, 0.055, 0.07), againstWall * 0.55);
      vec3 col = clamp(stone, 0.0, 0.35);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const quay = new THREE.Mesh(new THREE.PlaneGeometry(22, 6, 80, 40), quayMat);
quay.rotation.x = -Math.PI / 2;
quay.position.set(0, 0.04, 2.4);
scene.add(quay);


const {
  water, waterMat, WATER_W, WATER_D, WATER_NEAR_Z, WATER_Y, WATER_WALL_Z, WATER_AMP,
} = createHarborWater({ scene, freezeMotion });


// ——— Seawall / quay bulkhead (promenade scale) ———
// Research: pedestrian promenade walls ~0.6–1.2m above walkway (Douglas/Belgian
// wave-return parapets). Not a flood bunker. depthTest ON so orbit never
// draws the wall through hinterland towers.
const SEAWALL_Z = WATER_WALL_Z; // 5.42 — shared with water foam/depth
const SEAWALL_W = 22.0; // match quay width — do not overhang into side massing
const quayDeckY = 0.04;
const parapetH = 0.72; // ~knee-to-waist above promenade
const faceBottom = -0.22; // waterline
const faceTop = quayDeckY + parapetH;
const faceH = faceTop - faceBottom;
const faceY = (faceBottom + faceTop) * 0.5;

const seawallFaceMat = new THREE.MeshStandardMaterial({
  color: 0x4a5160, roughness: 0.88, metalness: 0.04,
});
const seawallCapMat = new THREE.MeshStandardMaterial({
  color: 0x6a7180, roughness: 0.7, metalness: 0.08,
});
const seawallWetMat = new THREE.MeshStandardMaterial({
  color: 0x1c2430, roughness: 0.95, metalness: 0.02,
});

const seawallFace = new THREE.Mesh(new THREE.BoxGeometry(SEAWALL_W, faceH, 0.22), seawallFaceMat);
seawallFace.position.set(0, faceY, SEAWALL_Z);
scene.add(seawallFace);

const seawallWetCourse = new THREE.Mesh(new THREE.BoxGeometry(SEAWALL_W - 0.1, 0.14, 0.05), seawallWetMat);
seawallWetCourse.position.set(0, faceBottom + 0.1, SEAWALL_Z + 0.14);
scene.add(seawallWetCourse);

// Thin coping — sit-able parapet, not a fortress crown
const seawallCap = new THREE.Mesh(new THREE.BoxGeometry(SEAWALL_W + 0.25, 0.1, 0.38), seawallCapMat);
seawallCap.position.set(0, faceTop + 0.05, SEAWALL_Z + 0.04);
scene.add(seawallCap);

// Toe closes the gap between the wall's water face and the basin mesh so the
// surface cannot read through onto the promenade. Top stays below the coping
// and the graffiti band.
const seawallToeD = 0.38;
const seawallToeH = 0.72;
const seawallToe = new THREE.Mesh(
  new THREE.BoxGeometry(SEAWALL_W, seawallToeH, seawallToeD),
  seawallWetMat
);
seawallToe.position.set(
  0,
  -0.06 - seawallToeH * 0.5,
  SEAWALL_Z + 0.11 + seawallToeD * 0.5
);
scene.add(seawallToe);

// ——— Seawall graffiti (freight band, both faces) ———
// Original throw-ups only — bubble letters with fill, hard outline, and a 3D
// block, layered like railroad boxcar paint. No stencils, no figures, no
// copied crew names or railroad marks.
const GRAF_W = 4096;
const GRAF_H = 512;
const grafCanvas = document.createElement('canvas');
grafCanvas.width = GRAF_W;
grafCanvas.height = GRAF_H;
const grafCtx = grafCanvas.getContext('2d');

function grafRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GLYPH_W = {
  A: 0.84, B: 0.80, C: 0.76, D: 0.80, E: 0.72, F: 0.68, G: 0.80,
  H: 0.80, I: 0.40, K: 0.80, L: 0.70, M: 1.00, N: 0.82, O: 0.84,
  P: 0.74, R: 0.80, S: 0.74, T: 0.72, U: 0.80, W: 1.05,
};
const GLYPH = {
  A(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.16, y + h * 0.90);
    ctx.lineTo(x + w * 0.50, y + h * 0.10);
    ctx.lineTo(x + w * 0.84, y + h * 0.90);
    ctx.moveTo(x + w * 0.30, y + h * 0.58);
    ctx.lineTo(x + w * 0.70, y + h * 0.58);
    ctx.stroke();
  },
  B(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.26, y + h * 0.10);
    ctx.lineTo(x + w * 0.26, y + h * 0.90);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w * 0.42, y + h * 0.32, h * 0.20, -Math.PI * 0.55, Math.PI * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w * 0.40, y + h * 0.68, h * 0.22, -Math.PI * 0.5, Math.PI * 0.55);
    ctx.stroke();
  },
  C(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.arc(x + w * 0.54, y + h * 0.50, h * 0.36, 0.65, Math.PI * 2 - 0.65);
    ctx.stroke();
  },
  D(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.26, y + h * 0.10);
    ctx.lineTo(x + w * 0.26, y + h * 0.90);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w * 0.40, y + h * 0.50, h * 0.36, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();
  },
  E(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.28, y + h * 0.12);
    ctx.lineTo(x + w * 0.28, y + h * 0.88);
    ctx.moveTo(x + w * 0.24, y + h * 0.14);
    ctx.lineTo(x + w * 0.78, y + h * 0.14);
    ctx.moveTo(x + w * 0.24, y + h * 0.50);
    ctx.lineTo(x + w * 0.68, y + h * 0.50);
    ctx.moveTo(x + w * 0.24, y + h * 0.86);
    ctx.lineTo(x + w * 0.78, y + h * 0.86);
    ctx.stroke();
  },
  F(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.30, y + h * 0.12);
    ctx.lineTo(x + w * 0.30, y + h * 0.90);
    ctx.moveTo(x + w * 0.26, y + h * 0.14);
    ctx.lineTo(x + w * 0.80, y + h * 0.14);
    ctx.moveTo(x + w * 0.26, y + h * 0.50);
    ctx.lineTo(x + w * 0.70, y + h * 0.50);
    ctx.stroke();
  },
  G(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.arc(x + w * 0.52, y + h * 0.50, h * 0.36, 0.45, Math.PI * 2 - 0.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + w * 0.52, y + h * 0.50);
    ctx.lineTo(x + w * 0.82, y + h * 0.50);
    ctx.lineTo(x + w * 0.82, y + h * 0.72);
    ctx.stroke();
  },
  H(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.24, y + h * 0.10);
    ctx.lineTo(x + w * 0.24, y + h * 0.90);
    ctx.moveTo(x + w * 0.76, y + h * 0.10);
    ctx.lineTo(x + w * 0.76, y + h * 0.90);
    ctx.moveTo(x + w * 0.24, y + h * 0.50);
    ctx.lineTo(x + w * 0.76, y + h * 0.50);
    ctx.stroke();
  },
  I(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.50, y + h * 0.10);
    ctx.lineTo(x + w * 0.50, y + h * 0.90);
    ctx.stroke();
  },
  K(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.28, y + h * 0.10);
    ctx.lineTo(x + w * 0.28, y + h * 0.90);
    ctx.moveTo(x + w * 0.78, y + h * 0.12);
    ctx.quadraticCurveTo(x + w * 0.40, y + h * 0.42, x + w * 0.34, y + h * 0.48);
    ctx.quadraticCurveTo(x + w * 0.46, y + h * 0.58, x + w * 0.82, y + h * 0.90);
    ctx.stroke();
  },
  L(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.30, y + h * 0.10);
    ctx.lineTo(x + w * 0.30, y + h * 0.82);
    ctx.lineTo(x + w * 0.82, y + h * 0.82);
    ctx.stroke();
  },
  M(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.12, y + h * 0.90);
    ctx.lineTo(x + w * 0.12, y + h * 0.12);
    ctx.lineTo(x + w * 0.50, y + h * 0.58);
    ctx.lineTo(x + w * 0.88, y + h * 0.12);
    ctx.lineTo(x + w * 0.88, y + h * 0.90);
    ctx.stroke();
  },
  N(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.20, y + h * 0.90);
    ctx.lineTo(x + w * 0.20, y + h * 0.12);
    ctx.lineTo(x + w * 0.80, y + h * 0.88);
    ctx.lineTo(x + w * 0.80, y + h * 0.10);
    ctx.stroke();
  },
  O(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.ellipse(x + w * 0.50, y + h * 0.50, w * 0.32, h * 0.36, 0, 0, Math.PI * 2);
    ctx.stroke();
  },
  P(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.28, y + h * 0.10);
    ctx.lineTo(x + w * 0.28, y + h * 0.90);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w * 0.46, y + h * 0.34, h * 0.22, -Math.PI * 0.55, Math.PI * 0.6);
    ctx.stroke();
  },
  R(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.26, y + h * 0.10);
    ctx.lineTo(x + w * 0.26, y + h * 0.90);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w * 0.44, y + h * 0.32, h * 0.20, -Math.PI * 0.55, Math.PI * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + w * 0.42, y + h * 0.52);
    ctx.lineTo(x + w * 0.82, y + h * 0.90);
    ctx.stroke();
  },
  S(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.78, y + h * 0.22);
    ctx.bezierCurveTo(x + w * 0.70, y + h * 0.02, x + w * 0.18, y + h * 0.08, x + w * 0.22, y + h * 0.36);
    ctx.bezierCurveTo(x + w * 0.26, y + h * 0.58, x + w * 0.78, y + h * 0.48, x + w * 0.74, y + h * 0.70);
    ctx.bezierCurveTo(x + w * 0.70, y + h * 0.98, x + w * 0.16, y + h * 0.90, x + w * 0.20, y + h * 0.74);
    ctx.stroke();
  },
  T(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.12, y + h * 0.16);
    ctx.lineTo(x + w * 0.88, y + h * 0.16);
    ctx.moveTo(x + w * 0.50, y + h * 0.14);
    ctx.lineTo(x + w * 0.50, y + h * 0.90);
    ctx.stroke();
  },
  U(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.22, y + h * 0.12);
    ctx.lineTo(x + w * 0.22, y + h * 0.58);
    ctx.quadraticCurveTo(x + w * 0.22, y + h * 0.92, x + w * 0.50, y + h * 0.90);
    ctx.quadraticCurveTo(x + w * 0.78, y + h * 0.88, x + w * 0.78, y + h * 0.58);
    ctx.lineTo(x + w * 0.78, y + h * 0.12);
    ctx.stroke();
  },
  W(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.10, y + h * 0.12);
    ctx.lineTo(x + w * 0.28, y + h * 0.90);
    ctx.lineTo(x + w * 0.50, y + h * 0.40);
    ctx.lineTo(x + w * 0.72, y + h * 0.90);
    ctx.lineTo(x + w * 0.90, y + h * 0.12);
    ctx.stroke();
  },
};

function grafMeasure(word, h) {
  let x = 0;
  for (let i = 0; i < word.length; i++) {
    const gw = h * (GLYPH_W[word[i]] || 0.75);
    x += gw;
    if (i < word.length - 1) x -= h * 0.06;
  }
  return x;
}

function grafDrawWord(ctx, word, x, y, h) {
  let cursor = x;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const draw = GLYPH[ch];
    const gw = h * (GLYPH_W[ch] || 0.75);
    if (draw) {
      ctx.save();
      const cx = cursor + gw * 0.5;
      const cy = y + h * 0.5;
      ctx.translate(cx, cy);
      ctx.rotate(((i % 3) - 1) * 0.03);
      ctx.translate(-cx, -cy);
      draw(ctx, cursor, y + Math.sin(i * 1.6) * h * 0.012, gw, h);
      ctx.restore();
    }
    cursor += gw - h * 0.06;
  }
}

function grafPaintThrow(ctx, word, x, y, h, style, alpha, rot) {
  const width = grafMeasure(word, h);
  const pad = Math.ceil(h * 0.55);
  const offW = Math.ceil(width + pad * 2);
  const offH = Math.ceil(h * 1.9);
  const base = document.createElement('canvas');
  base.width = offW;
  base.height = offH;
  const fill = document.createElement('canvas');
  fill.width = offW;
  fill.height = offH;
  const ox = pad * 0.7;
  const oy = h * 0.18;
  const fillW = h * 0.33;
  const outlineW = fillW + h * 0.15;
  const keyW = outlineW + h * (style.key ? 0.09 : 0.0);

  function strokeLayer(g, lineW, color, dx, dy) {
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = lineW;
    g.strokeStyle = color;
    g.translate(dx, dy);
    grafDrawWord(g, word, ox, oy, h);
    g.restore();
  }

  const bg = base.getContext('2d');
  strokeLayer(bg, keyW, style.shadow, h * 0.065, h * 0.085);
  if (style.key) strokeLayer(bg, keyW, style.key, 0, 0);
  strokeLayer(bg, outlineW, style.outline, 0, 0);

  const fg = fill.getContext('2d');
  strokeLayer(fg, fillW, '#ffffff', 0, 0);
  fg.save();
  fg.globalCompositeOperation = 'source-atop';
  const grad = fg.createLinearGradient(0, oy, 0, oy + h);
  grad.addColorStop(0, style.top);
  grad.addColorStop(0.45, style.mid);
  grad.addColorStop(1, style.bot);
  fg.fillStyle = grad;
  fg.fillRect(0, 0, offW, offH);
  if (style.dots) {
    const rnd = grafRng(word.length * 17 + Math.floor(h));
    fg.fillStyle = style.dots;
    for (let i = 0; i < 70; i++) {
      const px = ox + rnd() * width;
      const py = oy + rnd() * h * 0.85;
      fg.beginPath();
      fg.arc(px, py, h * (0.012 + rnd() * 0.02), 0, Math.PI * 2);
      fg.fill();
    }
  }
  fg.globalAlpha = 0.42;
  fg.strokeStyle = 'rgba(255,255,255,0.9)';
  fg.lineWidth = fillW * 0.28;
  fg.lineCap = 'round';
  fg.lineJoin = 'round';
  fg.beginPath();
  fg.rect(0, 0, offW, oy + h * 0.42);
  fg.clip();
  grafDrawWord(fg, word, ox, oy, h);
  fg.restore();

  fg.strokeStyle = style.drip;
  fg.fillStyle = style.drip;
  fg.lineCap = 'round';
  const rnd = grafRng(4000 + word.charCodeAt(0) * 13 + Math.floor(x));
  const drips = style.ghost ? 2 : 4;
  for (let i = 0; i < drips; i++) {
    const px = ox + (0.15 + 0.7 * (i + rnd()) / drips) * width;
    const len = h * (0.18 + rnd() * 0.42);
    fg.globalAlpha = 0.75;
    fg.lineWidth = h * (0.018 + rnd() * 0.02);
    fg.beginPath();
    fg.moveTo(px, oy + h * 0.78);
    fg.lineTo(px + (rnd() - 0.5) * h * 0.06, oy + h * 0.78 + len);
    fg.stroke();
    fg.beginPath();
    fg.arc(px, oy + h * 0.78 + len, h * 0.02, 0, Math.PI * 2);
    fg.fill();
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rot || 0);
  ctx.drawImage(base, 0, 0);
  ctx.drawImage(fill, 0, 0);
  ctx.restore();
}

const GRAF_CHROME = {
  top: '#f4f7fa', mid: '#b7c2cc', bot: '#e3eaef',
  outline: '#14171c', key: '#f7fafc', shadow: '#0c0e12',
  drip: '#9aa6b0',
};
const GRAF_TEAL = {
  top: '#d5ebe4', mid: '#6e9e98', bot: '#c4ddd6',
  outline: '#101416', key: '#e7f3ef', shadow: '#0c1212',
  drip: '#5e8e88', dots: 'rgba(18, 42, 40, 0.45)',
};
const GRAF_OX = {
  top: '#e7c2b8', mid: '#a85a52', bot: '#d7a096',
  outline: '#1a1212', key: '#f3e6e2', shadow: '#120c0c',
  drip: '#8a4540',
};
const GRAF_SILVER = {
  top: '#eef2f4', mid: '#aeb6be', bot: '#d5dbe0',
  outline: '#1a1c20', key: '#ffffff', shadow: '#101216',
  drip: '#8b939c',
};
const GRAF_GHOST = {
  top: '#d5dbe2', mid: '#9aa3ad', bot: '#c5ccd4',
  outline: '#2a3038', key: null, shadow: '#1a1e24',
  drip: '#8a929c', ghost: true,
};

function grafRustRow(ctx, y0, rowH, seed) {
  const rnd = grafRng(seed);
  for (let i = 0; i < 22; i++) {
    const x = rnd() * GRAF_W;
    const y = y0 + rowH * (0.35 + rnd() * 0.6);
    const rad = 16 + rnd() * 54;
    const g = ctx.createRadialGradient(x, y, 2, x, y, rad);
    g.addColorStop(0, 'rgba(122, 68, 40, 0.42)');
    g.addColorStop(1, 'rgba(122, 68, 40, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rad * (0.7 + rnd() * 0.8), rad * 0.4, rnd() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function grafWearRow(ctx, y0, rowH, seed) {
  const rnd = grafRng(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 110; i++) {
    ctx.globalAlpha = 0.18 + rnd() * 0.55;
    const x = rnd() * GRAF_W;
    const y = y0 + rnd() * rowH;
    ctx.fillRect(x, y, 16 + rnd() * 160, 1 + rnd() * 2.4);
  }
  for (let i = 0; i < 10; i++) {
    ctx.globalAlpha = 0.28 + rnd() * 0.4;
    ctx.fillRect(rnd() * GRAF_W, y0 + rnd() * rowH, 24 + rnd() * 90, 6 + rnd() * 16);
  }
  ctx.restore();
}

function grafRow(ctx, row, pieces) {
  const rowH = GRAF_H / 2;
  const y0 = row * rowH;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y0, GRAF_W, rowH);
  ctx.clip();
  grafRustRow(ctx, y0, rowH, 1200 + row * 77);
  const baseY = y0 + rowH * 0.08;
  for (const p of pieces) {
    const h = rowH * p.h;
    const px = p.x * GRAF_W;
    const py = baseY + (p.y || 0) * rowH;
    grafPaintThrow(ctx, p.word, px, py, h, p.style, p.alpha, p.rot || 0);
  }
  grafWearRow(ctx, y0, rowH, 4400 + row * 19);
  ctx.restore();
}

// Smaller overlapping throw-ups fill the gaps between the big pieces.
// Original harbor words only — bubble throw-ups, not stencil figures.
function grafDenseOverlays(seed) {
  const words = [
    'TIDE', 'DOCK', 'PIER', 'BOOM', 'HOLD', 'LASH', 'CLEAT', 'GALE',
    'WHARF', 'QUAY', 'STOW', 'DRAFT', 'SOUND', 'FATHOM', 'LEE', 'CARGO',
    'NETS', 'BOLL',
  ];
  const styles = [GRAF_CHROME, GRAF_TEAL, GRAF_OX, GRAF_SILVER, GRAF_GHOST];
  const rnd = grafRng(seed);
  const pieces = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    pieces.push({
      word: words[i % words.length],
      x: (i / n) * 0.94 - 0.02 + (rnd() - 0.5) * 0.05,
      h: 0.26 + rnd() * 0.22,
      y: rnd() * 0.46,
      style: styles[Math.floor(rnd() * styles.length)],
      alpha: 0.74 + rnd() * 0.24,
      rot: (rnd() - 0.5) * 0.09,
    });
  }
  return pieces;
}

// Water face — long horizontal band, chrome and muted fills, ghosts underneath.
grafRow(grafCtx, 0, [
  { word: 'SLIP', x: 0.02, h: 0.46, y: 0.16, style: GRAF_GHOST, alpha: 0.34, rot: -0.04 },
  { word: 'KEEL', x: 0.08, h: 0.62, y: 0.06, style: GRAF_CHROME, alpha: 0.96, rot: -0.02 },
  { word: 'SPAR', x: 0.28, h: 0.40, y: 0.22, style: GRAF_GHOST, alpha: 0.30, rot: 0.05 },
  { word: 'BRINE', x: 0.30, h: 0.60, y: 0.08, style: GRAF_TEAL, alpha: 0.95, rot: 0.015 },
  { word: 'CASK', x: 0.50, h: 0.38, y: 0.26, style: GRAF_GHOST, alpha: 0.28, rot: -0.03 },
  { word: 'HULL', x: 0.52, h: 0.62, y: 0.05, style: GRAF_OX, alpha: 0.96, rot: -0.01 },
  { word: 'MOOR', x: 0.72, h: 0.58, y: 0.10, style: GRAF_SILVER, alpha: 0.94, rot: 0.02 },
  { word: 'REEF', x: 0.86, h: 0.42, y: 0.20, style: GRAF_GHOST, alpha: 0.36, rot: 0.04 },
  ...grafDenseOverlays(11),
]);
// Promenade face — same freight language, different original tags.
grafRow(grafCtx, 1, [
  { word: 'WAKE', x: 0.03, h: 0.60, y: 0.08, style: GRAF_CHROME, alpha: 0.96, rot: 0.02 },
  { word: 'SALT', x: 0.20, h: 0.40, y: 0.24, style: GRAF_GHOST, alpha: 0.32, rot: -0.04 },
  { word: 'BERTH', x: 0.22, h: 0.58, y: 0.06, style: GRAF_OX, alpha: 0.95, rot: -0.015 },
  { word: 'CORD', x: 0.46, h: 0.36, y: 0.28, style: GRAF_GHOST, alpha: 0.30, rot: 0.03 },
  { word: 'REEF', x: 0.48, h: 0.60, y: 0.07, style: GRAF_TEAL, alpha: 0.95, rot: 0.01 },
  { word: 'BILGE', x: 0.68, h: 0.56, y: 0.10, style: GRAF_SILVER, alpha: 0.94, rot: -0.02 },
  { word: 'KEEL', x: 0.86, h: 0.40, y: 0.22, style: GRAF_GHOST, alpha: 0.33, rot: 0.04 },
  ...grafDenseOverlays(29),
]);

const grafTex = new THREE.CanvasTexture(grafCanvas);
grafTex.colorSpace = THREE.SRGBColorSpace;
grafTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
grafTex.wrapS = THREE.ClampToEdgeWrapping;
grafTex.wrapT = THREE.ClampToEdgeWrapping;
grafTex.needsUpdate = true;
// Photographic freight atlas is the seawall paint. Letter paint is lifted off
// the concrete and stamped back in overlapping shifts so both faces are jammed
// with throw-ups. Original freight tags only — no stencil figures. The canvas
// throw-ups stay as the stand-in until the PNG arrives.
// [sourceRow, xShift, yShift, scaleX, scaleY, alpha] in row units.
const GRAF_PACK_SHIFTS = [
  [0, -0.22, -0.04, 1.00, 0.92, 0.96],
  [0, 0.28, 0.05, 0.96, 0.90, 0.94],
  [0, 0.48, -0.02, 0.78, 0.78, 0.90],
  [0, -0.46, 0.06, 0.72, 0.74, 0.88],
  [1, 0.12, -0.06, 0.84, 0.80, 0.90],
  [1, -0.30, 0.04, 0.70, 0.72, 0.86],
  [1, 0.55, 0.00, 0.64, 0.68, 0.84],
  [0, 0.08, 0.07, 0.88, 0.82, 0.86],
  [1, -0.10, -0.07, 0.86, 0.80, 0.86],
];

function grafLetterMask(img) {
  const c = document.createElement('canvas');
  c.width = GRAF_W;
  c.height = GRAF_H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, GRAF_W, GRAF_H);
  const im = g.getImageData(0, 0, GRAF_W, GRAF_H);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i + 3] = Math.max(0, Math.min(255, ((lum - 58) / 42) * 255)) | 0;
  }
  g.putImageData(im, 0, 0);
  return c;
}

function grafPackFreight(img) {
  const mask = grafLetterMask(img);
  const out = document.createElement('canvas');
  out.width = GRAF_W;
  out.height = GRAF_H;
  const ctx = out.getContext('2d');
  ctx.drawImage(img, 0, 0, GRAF_W, GRAF_H);
  const rowH = GRAF_H / 2;
  for (let row = 0; row < 2; row++) {
    const destY = row * rowH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, destY, GRAF_W, rowH);
    ctx.clip();
    for (const shift of GRAF_PACK_SHIFTS) {
      const src = shift[0];
      const xShift = shift[1];
      const yShift = shift[2];
      const scaleX = shift[3];
      const scaleY = shift[4];
      const alpha = shift[5];
      const srcUse = row === 0 ? src : 1 - src;
      const srcY = srcUse * rowH;
      const dw = GRAF_W * scaleX;
      const dh = rowH * scaleY;
      const dx = xShift * GRAF_W;
      const dy = destY + yShift * rowH + (rowH - dh) * 0.5;
      ctx.save();
      ctx.globalAlpha = alpha;
      const draw = (x) => ctx.drawImage(mask, 0, srcY, GRAF_W, rowH, x, dy, dw, dh);
      draw(dx);
      if (dx < 0) draw(dx + GRAF_W);
      if (dx + dw > GRAF_W) draw(dx - GRAF_W);
      ctx.restore();
    }
    ctx.restore();
  }
  return out;
}

const grafAtlasUrl = new URL('freight-graf-atlas.png' + atlasCache, atlasBase).href;
window.__grafAtlasUrl = grafAtlasUrl;
atlasLoader.load(grafAtlasUrl, (tex) => {
  const packed = grafPackFreight(tex.image);
  const packedTex = new THREE.CanvasTexture(packed);
  packedTex.colorSpace = THREE.SRGBColorSpace;
  packedTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  packedTex.wrapS = THREE.ClampToEdgeWrapping;
  packedTex.wrapT = THREE.ClampToEdgeWrapping;
  packedTex.minFilter = THREE.LinearFilter;
  packedTex.magFilter = THREE.LinearFilter;
  packedTex.generateMipmaps = false;
  packedTex.needsUpdate = true;
  grafMat.map = packedTex;
  grafMat.emissiveMap = packedTex;
  grafMat.emissive.set(0xffffff);
  // Night quay: the photo has to carry itself the way a lit atlas pane does.
  grafMat.emissiveIntensity = 0.82;
  grafMat.needsUpdate = true;
  if (tex.dispose) tex.dispose();
  window.__grafAtlas = 'freight-photo-packed';
  window.__grafPacked = packed;
}, undefined, () => {
  window.__grafAtlas = 'canvas-fallback';
});
const grafMat = new THREE.MeshStandardMaterial({
  map: grafTex,
  transparent: true,
  alphaTest: 0.05,
  roughness: 0.48,
  metalness: 0.16,
  emissive: new THREE.Color(0xd5dde4),
  emissiveMap: grafTex,
  emissiveIntensity: 0.22,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

function grafBandMesh(row, y, z, rotY) {
  const rowAspect = (GRAF_H * 0.5) / GRAF_W;
  const width = 19.6;
  const height = width * rowAspect;
  const geo = new THREE.PlaneGeometry(width, height);
  const uv = geo.attributes.uv;
  const vBase = row === 0 ? 0.5 : 0.0;
  for (let i = 0; i < uv.count; i++) {
    // Flip U so throw-ups read left-to-right from each face.
    uv.setXY(i, 1 - uv.getX(i), vBase + uv.getY(i) * 0.5);
  }
  uv.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, grafMat);
  mesh.position.set(0, y, z);
  mesh.rotation.y = rotY;
  mesh.renderOrder = 2;
  mesh.name = row === 0 ? 'seawall-graffiti-water' : 'seawall-graffiti-promenade';
  return mesh;
}

const seawallGraffiti = new THREE.Group();
seawallGraffiti.name = 'seawall-graffiti';
const grafMidY = (faceBottom + faceTop) * 0.5 + 0.04;
seawallGraffiti.add(grafBandMesh(0, grafMidY, SEAWALL_Z + 0.11 + 0.02, 0));
seawallGraffiti.add(grafBandMesh(1, grafMidY, SEAWALL_Z - 0.11 - 0.02, Math.PI));
scene.add(seawallGraffiti);
window.__harborGraffiti = seawallGraffiti;
window.__grafCanvas = grafCanvas;


// Debug probe (harbor water/seawall layout)
window.__harborWater = water;
window.__harborQuay = quay;
window.__harborSeawall = seawallFace;
water.frustumCulled = false;

window.__harborLayout = {
  waterZ: water.position.z,
  waterY: water.position.y,
  waterW: WATER_W,
  waterD: WATER_D,
  waterNearZ: WATER_NEAR_Z,
  waterFarZ: WATER_NEAR_Z + WATER_D,
  groundZMax: GROUND_Z_MAX,
  quayZ: quay.position.z,
  quayNearZ: quay.position.z - 3,
  quayFarZ: quay.position.z + 3,
  seawallZ: SEAWALL_Z,
  seawallOutboardZ: SEAWALL_Z + 0.11,
  wetCourseZ: SEAWALL_Z + 0.14,
  dry: WATER_NEAR_Z > SEAWALL_Z + 0.11 && GROUND_Z_MAX < SEAWALL_Z,
};


// ——— Instanced quay furniture: bollards / pier posts / lanterns (≥24) ———
const FURN_COUNT = 36;
const bollardGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.55, 8);
bollardGeo.translate(0, 0.275, 0);
const postGeo = new THREE.CylinderGeometry(0.055, 0.07, 1.35, 6);
postGeo.translate(0, 0.675, 0);
// merge-ish via one InstancedMesh using bollard geo + separate lantern heads
const furnMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0x05060a) },
    uFogDensity: { value: 0.024 },
    uIron: { value: null },
    uIronOn: { value: 0 },
    // quay-iron-atlas.png column. 0 pole · 1 bollard. Instanced posts override this.
    uCell: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec3 vColor;
    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying vec2 vUv;
    void main(){
      vUv = uv;
      vec4 world = instanceMatrix * vec4(position, 1.0);
      vWorldPos = world.xyz;
      vNormalW = normalize(mat3(instanceMatrix) * normal);
      #ifdef USE_INSTANCING_COLOR
        vColor = instanceColor;
      #else
        vColor = vec3(0.3);
      #endif
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */`
    varying vec3 vColor;
    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying vec2 vUv;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform sampler2D uIron;
    uniform float uIronOn;
    uniform float uCell;
    void main(){
      vec3 N = normalize(vNormalW);
      float ndl = clamp(dot(N, normalize(vec3(0.4, 0.85, 0.25))), 0.15, 1.0);
      vec3 plain = vColor * (0.35 + 0.55 * ndl);
      // Hardware sheet is 4 square columns. uCell picks pole vs bollard.
      float u = clamp(vUv.x, 0.02, 0.98);
      float v = clamp(vUv.y, 0.02, 0.98);
      vec3 photo = texture2D(uIron, vec2((u + uCell) * 0.25, v)).rgb;
      vec3 worn = photo * (0.72 + 0.55 * ndl);
      vec3 body = mix(plain, worn, uIronOn);
      // iron rim / cap highlight
      float cap = smoothstep(0.82, 0.95, vUv.y);
      body += vec3(0.15, 0.16, 0.2) * cap * (1.0 - uIronOn * 0.65);
      float dist = length(vWorldPos - cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 12.0);
      gl_FragColor = vec4(mix(body, uFogColor, clamp(fog, 0.0, 0.8)), 1.0);
    }
  `,
});
const ironStub = new THREE.DataTexture(new Uint8Array([42, 44, 52, 255]), 1, 1);
ironStub.needsUpdate = true;
furnMat.uniforms.uIron.value = ironStub;
const bollards = new THREE.InstancedMesh(bollardGeo, furnMat, FURN_COUNT);
const quayPostMat = furnMat.clone();
quayPostMat.uniforms.uCell.value = 0;
// Bollards keep the rim highlight. On posts it is a pale band on the upper
// shaft, and it reads as a bright collar where the lantern meets the crown.
// Pole wear (uCell 0) stays.
quayPostMat.fragmentShader = quayPostMat.fragmentShader.replace(
  '      float cap = smoothstep(0.82, 0.95, vUv.y);\n      body += vec3(0.15, 0.16, 0.2) * cap * (1.0 - uIronOn * 0.65);\n',
  ''
);
quayPostMat.needsUpdate = true;
const posts = new THREE.InstancedMesh(postGeo, quayPostMat, 18);
const iron = new THREE.Color(0x2a2e3a);
const ironWarm = new THREE.Color(0x3a3228);
let fi = 0;
for (let i = 0; i < FURN_COUNT; i++) {
  const x = -10.5 + i * 0.62 + (Math.random() - 0.5) * 0.08;
  const z = 4.55 + (i % 2) * 0.35 + (Math.random() - 0.5) * 0.12;
  dummy.position.set(x, 0.04, z);
  dummy.scale.set(1, 0.85 + Math.random() * 0.35, 1);
  dummy.rotation.set(0, Math.random() * 0.4, 0);
  dummy.updateMatrix();
  bollards.setMatrixAt(i, dummy.matrix);
  bollards.setColorAt(i, Math.random() > 0.35 ? iron : ironWarm);
}
bollards.instanceMatrix.needsUpdate = true;
if (bollards.instanceColor) bollards.instanceColor.needsUpdate = true;
bollards.frustumCulled = false;
scene.add(bollards);

const quayPostAnchor = [];
for (let i = 0; i < 18; i++) {
  const x = -10 + i * 1.2 + (Math.random() - 0.5) * 0.15;
  const z = 3.85 + (Math.random() - 0.5) * 0.2;
  const sy = 0.9 + Math.random() * 0.25;
  dummy.position.set(x, 0.04, z);
  dummy.scale.set(1, sy, 1);
  dummy.rotation.set(0, 0, 0);
  dummy.updateMatrix();
  posts.setMatrixAt(i, dummy.matrix);
  posts.setColorAt(i, iron);
  // Cylinder is translated so its top sits at local y = 1.35 before instance scale.
  quayPostAnchor.push({ x, z, top: 0.04 + 1.35 * sy });
}
posts.instanceMatrix.needsUpdate = true;
if (posts.instanceColor) posts.instanceColor.needsUpdate = true;
posts.frustumCulled = false;
scene.add(posts);

// Lantern heads — iron cage, sooty glass, filament.
// Atlas quadrants (flipY, UV v=1 at the top of the PNG): metal TL, glass TR, roughness BL, air-glow BR.
// Seat Y is the bottom of the iron foot. Instanced heads rest on the post crown.
const lanternTime = { value: 0 };
const lanternPulse = { value: freezeMotion ? 0.35 : 1 };
const lanternAtlasUniform = {
  value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1),
};
lanternAtlasUniform.value.needsUpdate = true;
const lampWarm = new THREE.Color(0xff9a3c);
const lampCool = new THREE.Color(0x7eb6ff);
const lanternPointLights = [];

function harborMerge(parts, label) {
  const merged = mergeGeometries(parts, false);
  for (let i = 0; i < parts.length; i++) parts[i].dispose();
  if (!merged) throw new Error('Harbor lantern merge failed: ' + label);
  return merged;
}

const LANTERN_FOOT_Y = -0.163;

function harborLanternGeos() {
  const housing = [];
  const cap = new THREE.CylinderGeometry(0.01, 0.104, 0.09, 10);
  cap.translate(0, 0.112, 0);
  housing.push(cap);
  const lip = new THREE.CylinderGeometry(0.112, 0.104, 0.014, 10);
  lip.translate(0, 0.064, 0);
  housing.push(lip);
  const capUnder = new THREE.CircleGeometry(0.098, 10);
  capUnder.rotateX(Math.PI / 2);
  capUnder.translate(0, 0.078, 0);
  housing.push(capUnder);
  const finial = new THREE.SphereGeometry(0.014, 8, 6);
  finial.translate(0, 0.164, 0);
  housing.push(finial);
  const bail = new THREE.TorusGeometry(0.022, 0.0045, 6, 14);
  bail.rotateX(Math.PI / 2);
  bail.translate(0, 0.178, 0);
  housing.push(bail);
  const stile = new THREE.BoxGeometry(0.015, 0.132, 0.015);
  const railX = new THREE.BoxGeometry(0.152, 0.012, 0.012);
  const railZ = new THREE.BoxGeometry(0.012, 0.012, 0.152);
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < corners.length; i++) {
    const s = stile.clone();
    s.translate(corners[i][0] * 0.076, 0.01, corners[i][1] * 0.076);
    housing.push(s);
  }
  stile.dispose();
  const railY = [0.07, 0.01, -0.05];
  for (let i = 0; i < railY.length; i++) {
    for (const z of [1, -1]) {
      const r = railX.clone();
      r.translate(0, railY[i], z * 0.076);
      housing.push(r);
    }
    for (const x of [1, -1]) {
      const r = railZ.clone();
      r.translate(x * 0.076, railY[i], 0);
      housing.push(r);
    }
  }
  railX.dispose();
  railZ.dispose();
  const cup = new THREE.CylinderGeometry(0.09, 0.056, 0.058, 10);
  cup.translate(0, -0.082, 0);
  housing.push(cup);
  // Skirt continues the cup (bottom y=-0.111, r=0.056) down to the seat.
  // Bottom radius stays just over the post crown (r=0.055) at the smallest
  // head scale (0.85), so the neck is not a stem floating above the pole.
  const skirt = new THREE.CylinderGeometry(0.062, 0.074, 0.048, 12);
  skirt.translate(0, -0.131, 0);
  housing.push(skirt);
  // Matte contact ring only. The lip is a few millimetres past the post,
  // not a saucer, and it covers the crown so the join is iron on iron.
  const footH = 0.016;
  const foot = new THREE.CylinderGeometry(0.082, 0.07, footH, 12);
  foot.translate(0, LANTERN_FOOT_Y + footH * 0.5, 0);

  const pane = new THREE.PlaneGeometry(0.136, 0.112);
  const glass = [];
  const panePos = [
    [0, 0.01, 0.067, 0],
    [0, 0.01, -0.067, Math.PI],
    [0.067, 0.01, 0, Math.PI / 2],
    [-0.067, 0.01, 0, -Math.PI / 2],
  ];
  for (let i = 0; i < panePos.length; i++) {
    const p = pane.clone();
    p.rotateY(panePos[i][3]);
    p.translate(panePos[i][0], panePos[i][1], panePos[i][2]);
    glass.push(p);
  }
  pane.dispose();

  const bulb = new THREE.SphereGeometry(0.03, 14, 12);
  bulb.scale(1, 1.22, 1);
  bulb.translate(0, 0.016, 0);
  const coil = new THREE.TorusGeometry(0.0095, 0.0026, 6, 16);
  coil.rotateX(Math.PI / 2);
  coil.scale(1, 2.2, 1);
  coil.translate(0, 0.018, 0);
  const stem = new THREE.CylinderGeometry(0.002, 0.002, 0.048, 5);
  stem.translate(0, 0.016, 0);
  const filament = harborMerge([coil, stem], 'filament');
  const pan = new THREE.CircleGeometry(0.072, 12);
  pan.rotateX(-Math.PI / 2);
  pan.translate(0, -0.046, 0);
  // Soft air halo around the glass. Kept above the foot so it does not paint the post.
  const glow = new THREE.PlaneGeometry(0.48, 0.4);
  glow.translate(0, 0.1, 0);
  return {
    housing: harborMerge(housing, 'housing'),
    foot,
    glass: harborMerge(glass, 'glass'),
    bulb,
    filament,
    pan,
    glow,
  };
}

const lanternGeos = harborLanternGeos();
const lanternHousingMat = new THREE.MeshStandardMaterial({
  color: 0x6a5d52,
  roughness: 1,
  metalness: 0.82,
  emissive: 0x120e0a,
  emissiveIntensity: 0.035,
});
// Atlas roughness still modulates. Floor + high metalness keeps highlights iron-colored.
lanternHousingMat.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <roughnessmap_fragment>',
    `#include <roughnessmap_fragment>
     roughnessFactor = max(roughnessFactor, 0.84);`
  );
};
const lanternFootMat = new THREE.MeshStandardMaterial({
  color: 0x3a342e,
  roughness: 1,
  metalness: 0.06,
});
const lanternPickMat = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false,
  side: THREE.DoubleSide,
});
const lanternPickGeo = new THREE.BoxGeometry(0.22, 0.34, 0.22);

const lanternVert = /* glsl */`
  uniform vec3 uTint;
  varying vec3 vColor;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec2 vUv;
  void main(){
    vUv = uv;
    #ifdef USE_INSTANCING
      vec4 world = instanceMatrix * vec4(position, 1.0);
      vNormalW = mat3(instanceMatrix) * normal;
    #else
      vec4 world = modelMatrix * vec4(position, 1.0);
      vNormalW = mat3(modelMatrix) * normal;
    #endif
    vWorldPos = world.xyz;
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = uTint;
    #endif
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

function makeLanternGlassMat(tint) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: lanternTime,
      uPulse: lanternPulse,
      uTint: { value: tint.clone() },
      uAtlas: lanternAtlasUniform,
    },
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    vertexShader: lanternVert,
    fragmentShader: /* glsl */`
      uniform sampler2D uAtlas;
      uniform float uTime;
      uniform float uPulse;
      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      varying vec2 vUv;
      void main(){
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = abs(dot(N, V));
        float fres = pow(1.0 - ndv, 1.45);
        vec2 auv = vec2(0.5 + clamp(vUv.x, 0.0, 1.0) * 0.5, 0.5 + clamp(vUv.y, 0.0, 1.0) * 0.5);
        vec3 tex = texture2D(uAtlas, auv).rgb;
        float lum = dot(tex, vec3(0.299, 0.587, 0.114));
        float missing = step(lum + tex.r + tex.g + tex.b, 0.004);
        vec2 p = vUv * 2.0 - 1.0;
        float radial = exp(-dot(p, p) * 1.6);
        float filament = exp(-p.x * p.x * 28.0 - p.y * p.y * 6.0);
        lum = mix(lum, 0.22 + 0.55 * radial + 0.7 * filament, missing);
        float soot = smoothstep(0.55, 0.12, lum);
        float pulse = 0.94 + 0.06 * sin(uTime * 2.15 + vWorldPos.x * 0.85) * uPulse;
        float paneEdge = smoothstep(0.42, 0.98, max(abs(p.x), abs(p.y)));
        // Stay under the bloom threshold so the pane does not blow the post crown white.
        // Hue comes from vColor: amber vs steel, not a shared warm highlight.
        vec3 hue = clamp((vColor - vec3(0.16)) * 1.4, 0.0, 1.15);
        vec3 interior = hue * (0.2 + 0.62 * lum) * mix(1.0, 0.4, soot) * mix(1.0, 0.34, paneEdge) * pulse;
        vec3 sky = mix(vColor, vec3(0.62, 0.7, 0.86), 0.42);
        vec3 L = normalize(vec3(0.42, 0.86, 0.22));
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 48.0);
        vec3 col = mix(interior, sky, fres * 0.32);
        col += mix(vColor, vec3(1.0), 0.22) * spec * 0.07;
        float dist = length(cameraPosition - vWorldPos);
        float fog = 1.0 - exp(-0.00032 * dist * dist);
        col = mix(col, vec3(0.02, 0.024, 0.04), clamp(fog, 0.0, 0.62));
        float alpha = mix(0.16, 0.72, fres);
        alpha = mix(alpha, min(alpha, 0.22), clamp(filament, 0.0, 1.0));
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

function makeLanternBulbMat(tint) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: lanternTime,
      uPulse: lanternPulse,
      uTint: { value: tint.clone() },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: lanternVert,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uPulse;
      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      void main(){
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - abs(dot(N, V)), 1.7);
        float pulse = 0.93 + 0.07 * sin(uTime * 2.4 + vWorldPos.x * 0.7) * uPulse;
        vec3 col = vColor * (0.18 + 0.42 * fres) * pulse;
        float alpha = mix(0.06, 0.38, fres);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

function makeLanternFilamentMat(tint) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: lanternTime,
      uPulse: lanternPulse,
      uTint: { value: tint.clone() },
    },
    vertexShader: lanternVert,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uPulse;
      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      void main(){
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float facing = pow(abs(dot(N, V)), 0.45);
        float pulse = 0.92 + 0.08 * sin(uTime * 3.0 + vWorldPos.x * 0.9) * uPulse;
        // Keep one channel dominant so the core stays amber or steel instead of clipping white.
        vec3 tint = clamp((vColor - vec3(0.22)) * 1.65, 0.0, 1.35);
        float heat = 0.82 + 0.2 * facing;
        vec3 col = tint * heat * pulse;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

const lanternGlowVert = /* glsl */`
  uniform vec3 uTint;
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main(){
    vUv = uv;
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = uTint;
    #endif
    vec3 centerLocal = vec3(0.0, 0.03, 0.0);
    #ifdef USE_INSTANCING
      vec3 center = (instanceMatrix * vec4(centerLocal, 1.0)).xyz;
      float s = length(instanceMatrix[0].xyz);
    #else
      vec3 center = (modelMatrix * vec4(centerLocal, 1.0)).xyz;
      float s = length(modelMatrix[0].xyz);
    #endif
    vec3 camRight = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
    vec3 camUp = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
    vec3 world = center + (camRight * position.x + camUp * position.y) * s;
    vWorldPos = world;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

function makeLanternGlowMat(tint) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: lanternTime,
      uPulse: lanternPulse,
      uTint: { value: tint.clone() },
      uAtlas: lanternAtlasUniform,
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexShader: lanternGlowVert,
    fragmentShader: /* glsl */`
      uniform sampler2D uAtlas;
      uniform float uTime;
      uniform float uPulse;
      varying vec3 vColor;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main(){
        vec2 guv = vec2(0.5 + vUv.x * 0.5, vUv.y * 0.5);
        vec4 g = texture2D(uAtlas, guv);
        float a = g.a;
        vec3 rgb = g.rgb;
        float missing = step(a + rgb.r, 0.004);
        vec2 p = vUv - 0.5;
        float d = length(p);
        float fall = exp(-d * d * 11.0) * (1.0 - smoothstep(0.22, 0.52, d));
        a = mix(a, fall, missing);
        rgb = mix(rgb, vec3(1.0), missing);
        float hem = smoothstep(0.0, 0.62, vUv.y);
        a *= mix(0.08, 1.0, hem);
        float pulse = 0.92 + 0.08 * sin(uTime * 2.15 + vWorldPos.x * 0.8) * uPulse;
        vec3 glowRgb = mix(vec3(1.0), rgb, 0.28);
        vec3 col = vColor * glowRgb * 0.14 * pulse;
        gl_FragColor = vec4(col, a * 0.2);
      }
    `,
  });
}

function makeLanternPanMat(tint) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: tint.clone() },
    },
    vertexShader: lanternVert,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        float d = length(p);
        float pool = exp(-d * d * 2.6) * (1.0 - smoothstep(0.25, 0.92, d));
        vec3 iron = vec3(0.045, 0.04, 0.036);
        vec3 col = mix(iron, vColor * 0.16, pool);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

const lanternGlassMat = makeLanternGlassMat(lampWarm);
const lanternBulbMat = makeLanternBulbMat(lampWarm);
const lanternFilamentMat = makeLanternFilamentMat(lampWarm);
const lanternGlowMat = makeLanternGlowMat(lampWarm);
const lanternPanMat = makeLanternPanMat(lampWarm);
const lanternGlassWarm = makeLanternGlassMat(lampWarm);
const lanternGlassCool = makeLanternGlassMat(lampCool);
const lanternBulbWarm = makeLanternBulbMat(lampWarm);
const lanternBulbCool = makeLanternBulbMat(lampCool);
const lanternFilamentWarm = makeLanternFilamentMat(lampWarm);
const lanternFilamentCool = makeLanternFilamentMat(lampCool);
const lanternGlowWarm = makeLanternGlowMat(lampWarm);
const lanternGlowCool = makeLanternGlowMat(lampCool);
const lanternPanWarm = makeLanternPanMat(lampWarm);
const lanternPanCool = makeLanternPanMat(lampCool);

const LANTERN_N = 18;
const lanterns = new THREE.InstancedMesh(lanternGeos.housing, lanternHousingMat, LANTERN_N);
const lanternGlass = new THREE.InstancedMesh(lanternGeos.glass, lanternGlassMat, LANTERN_N);
const lanternBulb = new THREE.InstancedMesh(lanternGeos.bulb, lanternBulbMat, LANTERN_N);
const lanternFilament = new THREE.InstancedMesh(lanternGeos.filament, lanternFilamentMat, LANTERN_N);
const lanternPan = new THREE.InstancedMesh(lanternGeos.pan, lanternPanMat, LANTERN_N);
const lanternGlow = new THREE.InstancedMesh(lanternGeos.glow, lanternGlowMat, LANTERN_N);
const lanternFoot = new THREE.InstancedMesh(lanternGeos.foot, lanternFootMat, LANTERN_N);
const lanternParts = [lanterns, lanternFoot, lanternGlass, lanternBulb, lanternFilament, lanternPan, lanternGlow];
const lanternTinted = [lanternGlass, lanternBulb, lanternFilament, lanternPan, lanternGlow];
const lanternTintAttr = new THREE.InstancedBufferAttribute(new Float32Array(LANTERN_N * 3), 3);
for (let i = 0; i < lanternParts.length; i++) {
  const part = lanternParts[i];
  part.instanceMatrix = lanterns.instanceMatrix;
  part.count = LANTERN_N;
  part.frustumCulled = false;
  part.name = 'harbor-lantern-part';
  scene.add(part);
}
for (let i = 0; i < lanternTinted.length; i++) lanternTinted[i].instanceColor = lanternTintAttr;
lanternGlass.renderOrder = 2;
lanternBulb.renderOrder = 1;
lanternFilament.renderOrder = 1;
lanternGlow.renderOrder = 3;
lanternGlow.userData.lanternAir = true;
lanternBulb.layers.enable(BLOOM_LAYER);
lanternFilament.layers.enable(BLOOM_LAYER);
lanternGlass.layers.enable(BLOOM_LAYER);
for (let i = 0; i < LANTERN_N; i++) {
  const post = quayPostAnchor[i];
  const s = 0.85 + (i % 3) * 0.08;
  // 1.5mm bite: the collar covers the crown without the cage sinking into the pole.
  const y = post.top - 0.0015 - LANTERN_FOOT_Y * s;
  dummy.position.set(post.x, y, post.z);
  dummy.scale.setScalar(s);
  dummy.rotation.set(0, 0, 0);
  dummy.updateMatrix();
  lanterns.setMatrixAt(i, dummy.matrix);
  lanternGlass.setColorAt(i, i % 3 === 0 ? lampCool : lampWarm);
}
lanterns.instanceMatrix.needsUpdate = true;
lanternTintAttr.needsUpdate = true;

atlasLoader.load(new URL('lantern-atlas.png' + atlasCache, atlasBase).href, (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  lanternAtlasUniform.value = tex;
  const metal = tex.clone();
  metal.colorSpace = THREE.SRGBColorSpace;
  metal.repeat.set(0.5, 0.5);
  metal.offset.set(0, 0.5);
  metal.wrapS = THREE.ClampToEdgeWrapping;
  metal.wrapT = THREE.ClampToEdgeWrapping;
  metal.anisotropy = tex.anisotropy;
  metal.needsUpdate = true;
  const rough = tex.clone();
  rough.colorSpace = THREE.LinearSRGBColorSpace;
  rough.repeat.set(0.5, 0.5);
  rough.offset.set(0, 0);
  rough.wrapS = THREE.ClampToEdgeWrapping;
  rough.wrapT = THREE.ClampToEdgeWrapping;
  rough.anisotropy = tex.anisotropy;
  rough.needsUpdate = true;
  lanternHousingMat.map = metal;
  lanternHousingMat.roughnessMap = rough;
  lanternHousingMat.roughness = 1;
  lanternHousingMat.color.set(0xffffff);
  lanternHousingMat.needsUpdate = true;
});

function makeHarborLanternMesh(warm) {
  const root = new THREE.Mesh(lanternPickGeo, lanternPickMat);
  root.name = 'harbor-lantern';
  root.layers.enable(BLOOM_LAYER);
  const housing = new THREE.Mesh(lanternGeos.housing, lanternHousingMat);
  const glass = new THREE.Mesh(lanternGeos.glass, warm ? lanternGlassWarm : lanternGlassCool);
  glass.layers.enable(BLOOM_LAYER);
  glass.renderOrder = 2;
  const bulb = new THREE.Mesh(lanternGeos.bulb, warm ? lanternBulbWarm : lanternBulbCool);
  bulb.layers.enable(BLOOM_LAYER);
  bulb.renderOrder = 1;
  const filament = new THREE.Mesh(lanternGeos.filament, warm ? lanternFilamentWarm : lanternFilamentCool);
  filament.layers.enable(BLOOM_LAYER);
  const pan = new THREE.Mesh(lanternGeos.pan, warm ? lanternPanWarm : lanternPanCool);
  const glow = new THREE.Mesh(lanternGeos.glow, warm ? lanternGlowWarm : lanternGlowCool);
  glow.userData.lanternAir = true;
  glow.renderOrder = 3;
  const foot = new THREE.Mesh(lanternGeos.foot, lanternFootMat);
  root.add(housing, foot, pan, filament, bulb, glass, glow);
  // Short pool on the quay. Cutoff stays inside the promenade, short of fenestra façades (~z 1.15).
  const lamp = new THREE.PointLight(warm ? 0xffb067 : 0xc5d6ff, warm ? 1.25 : 0.95, 2.25, 2);
  lamp.position.set(0, 0.02, 0);
  root.add(lamp);
  lanternPointLights.push({ light: lamp, base: lamp.intensity, phase: warm ? 0.35 : 2.2 });
  return root;
}


const harborPhysics = createHarborPhysics({
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
});
ironMatStd = harborPhysics.ironMatStd;
ironWarmStd = harborPhysics.ironWarmStd;
physCrates = harborPhysics.physCrates;
const {
  beaconLight, haloMat, harborWind, physFreeze,
  signalChip, signalGroup, signalMat, signalWorld, tipGlow,
  pennantSyncCloth, physStep,
} = harborPhysics;

const harborPost = createHarborPost({
  renderer, scene, camera, freezeMotion, bloomLayer, NOISE_GLSL,
  pointerSmooth, tier: perfTier, harborWind, physFreeze,
});
live.renderFrame = harborPost.renderFrame;
perfMonitor = createPerfMonitor({ renderer, tier: perfTier, post: harborPost });



const clock = new THREE.Clock();
installSwapGpu(renderer);
citizen = installCitizen({
  camera, renderer, controls, mesh, quay, clock,
  EYE_H, gridOriginZ, STREET_W, rearZ, districtW,
  ORBIT_FOV, WALK_FOV, blockRect, cellD, cellW, gridOriginX,
  quayTouchControls, syncWalkToggle, syncTourToggle, publishHarborMode,
  params, walkWanted, WALK_KEY,
});
window.__harborModules = {
  scene: true, water: true, physics: true, post: true, perf: true,
  load: true, swap: true, citizen: true,
};


// ——— Debug HUD (?debug=1) ———
const debugHud = document.getElementById('debug-hud');
const debugRay = new THREE.Raycaster();
const _dbgDir = new THREE.Vector3();
const _dbgEuler = new THREE.Euler();
let dbgFaceHint = '—';
let dbgRoomHint = '—';
let dbgHitDist = '—';
let dbgInst = '—';

function hash3js(x, y, z) {
  // Match shader hash3 enough for room index preview (not bit-identical).
  let n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function updateDebugHud(fps) {
  if (!debugMode || !debugHud) return;
  debugHud.classList.add('on');
  camera.getWorldDirection(_dbgDir);
  _dbgEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  const yaw = ((_dbgEuler.y * 180) / Math.PI).toFixed(1);
  const pitch = ((_dbgEuler.x * 180) / Math.PI).toFixed(1);
  // Ray into façades for room seed preview
  debugRay.set(camera.position, _dbgDir);
  debugRay.far = 28;
  const hits = debugRay.intersectObjects(collideMeshes, false);
  if (hits.length) {
    const h = hits[0];
    dbgHitDist = h.distance.toFixed(2);
    dbgInst = (h.instanceId != null) ? String(h.instanceId) : '—';
    const p = h.point;
    // Approximate shared room cell like shader (metre grid)
    const cellX = Math.floor(p.x / 1.2);
    const cellY = Math.floor(p.y / 0.95);
    const cellZ = Math.floor(p.z / 1.2);
    const h0 = hash3js(cellX + 0.17, cellY + 0.09, cellZ + 0.05);
    const ri = Math.floor(h0 * 7) % 7;
    dbgRoomHint = `${ri}:${ROOM_FACE_NAMES[ri] || '?'}`;
    // Face hint from normal world
    const n = h.face ? h.face.normal.clone() : new THREE.Vector3(0, 0, 1);
    if (h.object && h.object.isInstancedMesh && h.instanceId != null) {
      // world normal approx from camera-to-hit
      const toward = camera.position.clone().sub(p).normalize();
      const ax = Math.abs(toward.x), ay = Math.abs(toward.y), az = Math.abs(toward.z);
      if (ay > ax && ay > az) dbgFaceHint = toward.y > 0 ? 'floor~' : 'ceil~';
      else if (ax > az) dbgFaceHint = 'side-X';
      else dbgFaceHint = 'façade-Z';
    } else {
      dbgFaceHint = 'hit';
    }
  } else {
    dbgHitDist = '—';
    dbgInst = '—';
    dbgRoomHint = '—';
    dbgFaceHint = '—';
  }
  const mode = citizen ? citizen.mode() : 'orbit';
  debugHud.textContent =
    `Harbor debug\n` +
    `fps      ${fps}\n` +
    `mode     ${mode}\n` +
    `faces    ${facesMode ? 'on' : 'off'} · rooms 7\n` +
    `eye      ${camera.position.x.toFixed(2)} ${camera.position.y.toFixed(2)} ${camera.position.z.toFixed(2)}\n` +
    `eyeH     ${EYE_H.toFixed(2)} (locked)\n` +
    `yaw/pit  ${yaw}° / ${pitch}°\n` +
    `look     ${_dbgDir.x.toFixed(2)} ${_dbgDir.y.toFixed(2)} ${_dbgDir.z.toFixed(2)}\n` +
    `hitDist  ${dbgHitDist}  inst ${dbgInst}\n` +
    `room~    ${dbgRoomHint}\n` +
    `face~    ${dbgFaceHint}\n` +
    `keys     V walk · T tour · ?debug=1`;
}

// ——— Animate ———
let frames = 0;
let fpsAcc = 0;
let fpsShow = 0;
const fpsEl = document.getElementById('fps');
const motifEl = document.getElementById('motif');
const bloomModeEl = document.getElementById('bloom-mode');
bloomModeEl.textContent = freezeMotion ? 'off' : 'selective';


function tick() {
  renderer.info.reset();
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = freezeMotion ? 1.25 : clock.elapsedTime;

  pointerSmooth.lerp(pointer, freezeMotion ? 1 : 1 - Math.exp(-6 * dt));

  const pulse = freezeMotion ? 0.72 : 0.55 + 0.45 * Math.sin(t * 2.1);

  buildingMat.uniforms.uTime.value = t;
  if (typeof swayStrandBulbs === 'function') swayStrandBulbs(t);
  if (typeof pennantSyncCloth === 'function') pennantSyncCloth(t);
  if (typeof updateTrafficSignals === 'function') updateTrafficSignals(t);
  asphaltMat.uniforms.uTime.value = t;
  quayMat.uniforms.uTime.value = t;
  waterMat.uniforms.uTime.value = t;
  waterMat.uniforms.uCamPos.value.copy(camera.position);
  waterMat.uniforms.uAmp.value = freezeMotion ? 0.0 : WATER_AMP;
  // Quay lantern specular anchors (row at z≈3.85) — refresh if phys lanterns move later
  waterMat.uniforms.uLampA.value.set(-4.8, 1.55, 3.85);
  waterMat.uniforms.uLampB.value.set(4.8, 1.55, 3.85);
  quayMat.uniforms.uPointer.value.copy(pointerSmooth);
  harborPost.mistMat.uniforms.uTime.value = t;
  lanternTime.value = t;
  lanternPulse.value = freezeMotion ? 0.35 : 1.0;
  for (let li = 0; li < lanternPointLights.length; li++) {
    const lamp = lanternPointLights[li];
    const flick = freezeMotion ? 1 : 0.94 + 0.06 * Math.sin(t * 2.15 + lamp.phase);
    lamp.light.intensity = lamp.base * flick;
  }
  signalMat.uniforms.uTime.value = t;
  signalMat.uniforms.uPulse.value = pulse;
  haloMat.uniforms.uTime.value = t;
  haloMat.uniforms.uPulse.value = pulse;
  tipGlow.material.uniforms.uTime.value = t;
  tipGlow.material.uniforms.uPulse.value = pulse;

  if (!freezeMotion) {
    motifIdx = Math.floor(t / 4) % MOTIFS.length;
    motifEl.textContent = MOTIFS[motifIdx];
    if (perfMonitor) perfMonitor.noteChapter(MOTIFS[motifIdx]);
    fill.intensity = 24 + 8 * Math.sin(t * 0.8);
    beaconLight.intensity = 12 + 8 * pulse;
    // Idle auto-orbit only with ?spin=1 (default off — inspect window parallax by hand)
    const allowSpin = params.has('spin') && !(citizen && (citizen.walking() || citizen.touring()));
    if (allowSpin && !input.pointerDown) {
      input.idleOrbit += dt;
      if (input.idleOrbit > 1.2) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.35;
      }
    } else {
      if (!allowSpin) input.idleOrbit = 0;
      if (input.pointerDown) input.idleOrbit = 0;
      controls.autoRotate = false;
    }
  } else {
    motifEl.textContent = 'Harbor';
    if (perfMonitor) perfMonitor.noteChapter('Harbor');
    controls.autoRotate = false;
  }

  if (citizen && citizen.touring()) citizen.updateTour(dt);
  else if (citizen && citizen.walking()) citizen.updateWalk(dt);
  if (debugMode) updateDebugHud(fpsShow);

  // Signal proximity HUD chip
  signalGroup.getWorldPosition(signalWorld);
  const dist = camera.position.distanceTo(signalWorld);
  const near = dist < 14.5;
  signalChip.classList.toggle('on', near && !stillMode);
  if (near) motifEl.textContent = 'Signal';

  harborPost.pingPong(t, pulse);

  // Quay physics props (cannon-es) — skip under RM / ?still=1
  if (typeof physStep === 'function') physStep();

  if (!(citizen && (citizen.walking() || citizen.touring()))) controls.update();
  harborPost.renderFrame();

  frames++;
  fpsAcc += dt;
  if (fpsAcc >= 0.5) {
    fpsShow = Math.round(frames / fpsAcc);
    fpsEl.textContent = String(fpsShow);
    frames = 0;
    fpsAcc = 0;
  }

  if (perfMonitor) {
    perfMonitor.sample({
      fps: fpsShow,
      mode: citizen ? citizen.mode() : 'orbit',
    });
  }

  if (!stillMode) requestAnimationFrame(tick);
}

if (stillMode) {
  let n = 0;
  const settle = () => {
    tick();
    n++;
    if (n < 8) requestAnimationFrame(settle);
  };
  settle();
} else {
  requestAnimationFrame(tick);
}
