/**
 * A03 · Signal volume air
 * Depth-aware raymarch around the Signal mast: a tight lamp column with
 * Journey coffee-smoke ribbons, plus secondary firework spark filaments.
 * Not the mist Points field and not the ember GPGPU path.
 * Façade sheath, quay, water, and physics are not touched.
 *
 * A05 perf hook (A05 is not in the repo yet):
 *   Tiers live here until a structure/perf module owns them.
 *   api.setQuality('low'|'med'|'high')
 *   api.applyPerfTier('med' | { quality|id|volume, steps|volumeSteps,
 *     resolution|volumeResolution, gain|volumeGain, sparks|sparkBudget|sparkDensity,
 *     octaves|volumeOctaves })
 *   ?volumeQuality=low|med|high
 *   ?volume=0|off is a hard off. Tiers do not turn the pass back on.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const STEP_MAX = 32;
const SPARK_MAX = 10;
const OCTAVE_MAX = 4;

export const SIGNAL_VOLUME_TIERS = Object.freeze({
  low: Object.freeze({ id: 'low', steps: 10, resolution: 0.5, gain: 1.78, sparks: 3, octaves: 2 }),
  med: Object.freeze({ id: 'med', steps: 18, resolution: 0.75, gain: 1.96, sparks: 6, octaves: 3 }),
  high: Object.freeze({ id: 'high', steps: 28, resolution: 1, gain: 2.05, sparks: 9, octaves: 3 }),
});

export function resolveSignalVolumeQuality(name) {
  if (name == null) return null;
  const key = String(name).trim().toLowerCase();
  if (key === 'low' || key === 'l' || key === '0') return 'low';
  if (key === 'med' || key === 'medium' || key === 'm' || key === '1') return 'med';
  if (key === 'high' || key === 'h' || key === '2') return 'high';
  return null;
}

const VOLUME_FRAG = /* glsl */`
#include <packing>

uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform mat4 uProjection;
uniform mat4 uInvProjection;
uniform mat4 uCameraMatrixWorld;
uniform vec3 uCamPos;
uniform vec3 uCenter;
uniform vec3 uHalf;
uniform vec3 uLamp;
uniform float uTime;
uniform float uPulse;
uniform vec2 uWind;
uniform float uGain;
uniform float uDebug;
uniform float uSteps;
uniform float uOctaves;
uniform float uSparkBudget;
uniform float uResolve;

varying vec2 vUv;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < ${OCTAVE_MAX}; i++) {
    if (float(i) >= uOctaves) break;
    v += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 2.4);
    a *= 0.5;
  }
  return v;
}

vec2 hitBox(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 invRd = 1.0 / rd;
  vec3 t0s = (bmin - ro) * invRd;
  vec3 t1s = (bmax - ro) * invRd;
  vec3 tsm = min(t0s, t1s);
  vec3 tbg = max(t0s, t1s);
  float tEnter = max(max(tsm.x, tsm.y), tsm.z);
  float tExit = min(min(tbg.x, tbg.y), tbg.z);
  return vec2(tEnter, tExit);
}

float yWindow(vec3 q) {
  float yLo = smoothstep(-2.25, -1.15, q.y);
  float yHi = smoothstep(2.35, 0.7, q.y);
  return yLo * yHi;
}

float coffeeRibbons(vec3 q) {
  float rise = uTime * 0.17;
  vec3 wq = q;
  wq.y -= rise;
  float ang = q.y * 0.9 + uTime * 0.12;
  wq.x += sin(ang) * 0.16 + uWind.x * (q.y + 1.15) * 0.3;
  wq.z += cos(ang * 0.82) * 0.12 + uWind.y * (q.y + 1.15) * 0.3;

  float nA = fbm(wq * 0.82 + vec3(0.0, rise, 2.0));
  vec3 warped = wq + vec3(
    vnoise(wq + vec3(2.2, 0.4, 0.0)),
    vnoise(wq.yxz + vec3(4.1, 1.3, 0.6)),
    vnoise(wq.zyx + vec3(0.7, 3.4, 1.1))
  ) * 0.26;
  vec3 filaments = warped * vec3(1.2, 0.42, 1.2);
  float n = fbm(filaments);
  float n2 = fbm(filaments * 1.9 + vec3(0.0, rise * 0.4, 5.5));
  float ribbons = smoothstep(0.46, 0.74, n * 0.62 + n2 * 0.38);
  ribbons *= smoothstep(0.34, 0.66, nA);
  return ribbons;
}

float lampCore(vec3 p) {
  vec3 lp = p - uLamp;
  float axial = exp(-dot(lp.xz, lp.xz) * 18.0);
  float below = smoothstep(-2.45, -0.05, lp.y);
  float above = smoothstep(0.55, 0.0, lp.y);
  return axial * below * above;
}

float sparkFilaments(vec3 p) {
  float m = 0.0;
  for (int i = 0; i < ${SPARK_MAX}; i++) {
    if (float(i) >= uSparkBudget) break;
    float fi = float(i);
    float seed = fi * 1.618034 + 0.37;
    float rate = 0.05 + fract(seed * 2.7) * 0.035;
    float cycle = fract(uTime * rate + seed * 0.41);
    float life = smoothstep(0.0, 0.05, cycle) * smoothstep(1.0, 0.55, cycle);
    vec2 radial = vec2(sin(seed * 12.9898), cos(seed * 78.233));
    float spread = 0.02 + 0.09 * cycle;
    vec3 head = uCenter + vec3(
      radial.x * spread + uWind.x * cycle * 0.22,
      mix(-1.55, 1.55, cycle),
      radial.y * spread * 0.75 + uWind.y * cycle * 0.22
    );
    vec3 tailDir = normalize(vec3(
      -radial.x * 0.18 - uWind.x * 0.25,
      -1.0,
      -radial.y * 0.14 - uWind.y * 0.25
    ));
    float trail = 0.09 + 0.16 * (1.0 - cycle);
    vec3 rel = p - head;
    float along = clamp(dot(rel, tailDir), 0.0, trail);
    vec3 perp = rel - tailDir * along;
    float alongFade = 1.0 - smoothstep(0.0, trail, along);
    float streak = exp(-dot(perp, perp) * 340.0) * alongFade;
    float headHot = exp(-dot(rel, rel) * 480.0);
    float tw = 0.55 + 0.45 * abs(sin(uTime * (8.0 + fi * 1.7) + seed * 36.0));
    vec2 hq = head.xz - uCenter.xz;
    float inShaft = exp(-dot(hq, hq) * 14.0);
    m += (streak * 0.7 + headHot * 1.35) * life * tw * inShaft;
  }
  return m;
}

void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float depth = texture2D(tDepth, vUv).x;

  float viewZ = perspectiveDepthToViewZ(depth, uNear, uFar);
  float clipW = uProjection[2][3] * viewZ + uProjection[3][3];
  vec4 clipPosition = vec4((vec3(vUv, depth) - 0.5) * 2.0, 1.0);
  clipPosition *= clipW;
  vec3 viewPos = (uInvProjection * clipPosition).xyz;
  vec3 worldHit = (uCameraMatrixWorld * vec4(viewPos, 1.0)).xyz;

  vec3 ro = uCamPos;
  vec3 toHit = worldHit - ro;
  float tSurf = length(toHit);
  vec3 rd = toHit / max(tSurf, 1e-4);

  vec3 bmin = uCenter - uHalf;
  vec3 bmax = uCenter + uHalf;
  vec2 hit = hitBox(ro, rd, bmin, bmax);
  float t0 = max(hit.x, 0.0);
  float t1 = min(hit.y, tSurf - 0.04);
  if (hit.y < hit.x || t1 <= t0) {
    if (uResolve < 0.5) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    gl_FragColor = base;
    return;
  }

  float steps = clamp(uSteps, 1.0, float(${STEP_MAX}));
  float span = t1 - t0;
  float stepLen = span / steps;
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float t = t0 + dither * stepLen;

  vec3 acc = vec3(0.0);
  float transmit = 1.0;
  for (int i = 0; i < ${STEP_MAX}; i++) {
    if (float(i) >= steps || transmit < 0.04) break;
    vec3 p = ro + rd * t;
    vec3 q = p - uCenter;
    float r2 = dot(q.xz, q.xz);
    float yMask = yWindow(q);
    float sheath = exp(-r2 * 14.0) * yMask;
    float core = lampCore(p);
    float surf = smoothstep(0.0, 0.16, tSurf - t);
    if ((sheath > 0.035 || core > 0.03) && surf > 0.002) {
      float ribbons = coffeeRibbons(q);
      float densCore = core * (0.78 + 0.45 * ribbons) * surf;
      float densWisp = ribbons * sheath * 0.5 * surf;
      vec3 toL = uLamp - p;
      float ld = length(toL);
      vec3 L = toL / max(ld, 1e-3);
      float atten = exp(-ld * 0.22);
      float phase = pow(max(dot(L, -rd), 0.0), 3.2);
      vec3 umber = vec3(0.18, 0.1, 0.05);
      vec3 gold = vec3(0.95, 0.62, 0.2);
      vec3 hot = vec3(1.0, 0.84, 0.46);
      vec3 shade = umber * densWisp * (0.42 + 0.12 * uPulse);
      shade += gold * densWisp * phase * 0.28 * atten;
      shade += hot * densCore * atten * (0.95 + 0.7 * phase) * (0.82 + 0.18 * uPulse);
      float spark = 0.0;
      if (uSparkBudget > 0.5 && sheath > 0.04) spark = sparkFilaments(p) * surf;
      vec3 sparkCol = mix(vec3(0.72, 0.32, 0.1), vec3(1.0, 0.9, 0.58), clamp(spark, 0.0, 1.0));
      acc += (shade + sparkCol * spark * 18.0) * uGain * stepLen * transmit;
      transmit *= exp(-(densCore * 0.72 + densWisp * 0.16) * stepLen);
    }
    t += stepLen;
  }

  if (uResolve < 0.5) {
    gl_FragColor = vec4(acc, transmit);
    return;
  }

  vec3 rgb = base.rgb * transmit + acc;
  if (uDebug > 0.5) {
    rgb = base.rgb * 0.22 + acc * 1.6 + vec3(1.0 - transmit) * vec3(0.45, 0.28, 0.12);
  }
  gl_FragColor = vec4(rgb, base.a);
}
`;

const VOLUME_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tVolume;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(tScene, vUv);
  vec4 vol = texture2D(tVolume, vUv);
  gl_FragColor = vec4(scene.rgb * vol.a + vol.rgb, scene.a);
}
`;

function attachComposerDepth(composer) {
  const targets = [composer.renderTarget1, composer.renderTarget2];
  for (let i = 0; i < targets.length; i++) {
    const rt = targets[i];
    if (!rt.depthTexture) {
      rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height);
      rt.depthBuffer = true;
    }
    rt.dispose();
  }
}

function syncComposerDepth(composer) {
  const targets = [composer.renderTarget1, composer.renderTarget2];
  for (let i = 0; i < targets.length; i++) {
    const rt = targets[i];
    const depthTex = rt.depthTexture;
    if (!depthTex) continue;
    if (depthTex.image.width !== rt.width || depthTex.image.height !== rt.height) {
      depthTex.image.width = rt.width;
      depthTex.image.height = rt.height;
      depthTex.needsUpdate = true;
      depthTex.dispose();
      rt.dispose();
    }
  }
}

function clampTier(tier) {
  const id = resolveSignalVolumeQuality(tier.id) || 'high';
  return {
    id,
    steps: Math.round(Math.min(STEP_MAX, Math.max(4, Number(tier.steps) || SIGNAL_VOLUME_TIERS[id].steps))),
    resolution: Math.min(1, Math.max(0.35, Number(tier.resolution) || SIGNAL_VOLUME_TIERS[id].resolution)),
    gain: Math.min(4, Math.max(0, Number(tier.gain) || 0)),
    sparks: Math.round(Math.min(SPARK_MAX, Math.max(0, Number(tier.sparks) || 0))),
    octaves: Math.round(Math.min(OCTAVE_MAX, Math.max(1, Number(tier.octaves) || SIGNAL_VOLUME_TIERS[id].octaves))),
  };
}

class SignalVolumePass extends Pass {
  constructor(camera, material) {
    super();
    this.camera = camera;
    this.material = material;
    this.uniforms = material.uniforms;
    this.fsQuad = new FullScreenQuad(material);
    this.needsSwap = true;
    this.clear = false;
    this._resolution = 1;
    this._rt = null;
    this._composite = new THREE.ShaderMaterial({
      name: 'SignalVolumeComposite',
      uniforms: {
        tScene: { value: null },
        tVolume: { value: null },
      },
      vertexShader: VOLUME_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this._compositeQuad = new FullScreenQuad(this._composite);
  }

  setResolution(scale) {
    this._resolution = scale;
  }

  _ensureTarget(w, h) {
    if (this._rt && this._rt.width === w && this._rt.height === h) return;
    if (this._rt) this._rt.dispose();
    this._rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this._rt.texture.generateMipmaps = false;
    this._rt.texture.name = 'SignalVolume.lowres';
  }

  _bindCamera(readBuffer) {
    const cam = this.camera;
    const u = this.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uProjection.value.copy(cam.projectionMatrix);
    u.uInvProjection.value.copy(cam.projectionMatrixInverse);
    u.uCameraMatrixWorld.value.copy(cam.matrixWorld);
    u.uCamPos.value.copy(cam.position);
  }

  _targetFor(renderer, writeBuffer) {
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      return;
    }
    renderer.setRenderTarget(writeBuffer);
    if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
  }

  render(renderer, writeBuffer, readBuffer) {
    this._bindCamera(readBuffer);
    const debug = this.uniforms.uDebug.value > 0.5;
    const scale = debug ? 1 : this._resolution;
    if (scale >= 0.999) {
      this.uniforms.uResolve.value = 1;
      this._targetFor(renderer, writeBuffer);
      this.fsQuad.render(renderer);
      return;
    }

    const w = Math.max(1, Math.floor(readBuffer.width * scale));
    const h = Math.max(1, Math.floor(readBuffer.height * scale));
    this._ensureTarget(w, h);
    this.uniforms.uResolve.value = 0;
    renderer.setRenderTarget(this._rt);
    this.fsQuad.render(renderer);

    this._composite.uniforms.tScene.value = readBuffer.texture;
    this._composite.uniforms.tVolume.value = this._rt.texture;
    this._targetFor(renderer, writeBuffer);
    this._compositeQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
    this._composite.dispose();
    this._compositeQuad.dispose();
    if (this._rt) this._rt.dispose();
  }
}

export function mountSignalVolume(opts) {
  const camera = opts.camera;
  const hardOff = !!opts.hardOff;
  const enabled0 = !hardOff && opts.enabled !== false;
  const debug = !!opts.debug;
  const center = opts.center;
  const lamp = opts.lamp;
  const half = opts.half;
  const composers = opts.composers;
  const initialName = resolveSignalVolumeQuality(opts.quality) || 'high';
  let tier = clampTier({ ...SIGNAL_VOLUME_TIERS[initialName] });
  if (opts.gain != null && Number.isFinite(Number(opts.gain))) {
    tier = clampTier({ ...tier, gain: Number(opts.gain) });
  }

  const material = new THREE.ShaderMaterial({
    name: 'SignalVolume',
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uProjection: { value: new THREE.Matrix4() },
      uInvProjection: { value: new THREE.Matrix4() },
      uCameraMatrixWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uCenter: { value: center.clone() },
      uHalf: { value: half.clone() },
      uLamp: { value: lamp.clone() },
      uTime: { value: 0 },
      uPulse: { value: 1 },
      uWind: { value: new THREE.Vector2() },
      uGain: { value: tier.gain },
      uDebug: { value: debug ? 1 : 0 },
      uSteps: { value: tier.steps },
      uOctaves: { value: tier.octaves },
      uSparkBudget: { value: tier.sparks },
      uResolve: { value: 1 },
    },
    vertexShader: VOLUME_VERT,
    fragmentShader: VOLUME_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });

  const pass = new SignalVolumePass(camera, material);
  pass.enabled = enabled0;
  pass.setResolution(tier.resolution);

  for (let i = 0; i < composers.length; i++) {
    attachComposerDepth(composers[i]);
    composers[i].insertPass(pass, 1);
  }

  function publish(next) {
    tier = clampTier(next);
    material.uniforms.uSteps.value = tier.steps;
    material.uniforms.uOctaves.value = tier.octaves;
    material.uniforms.uSparkBudget.value = tier.sparks;
    material.uniforms.uGain.value = tier.gain;
    pass.setResolution(tier.resolution);
    api.quality = tier.id;
    api.tier = { ...tier };
    api.steps = tier.steps;
    api.resolution = tier.resolution;
    api.gain = tier.gain;
    api.sparks = tier.sparks;
    api.octaves = tier.octaves;
  }

  function readNumber() {
    for (let i = 0; i < arguments.length; i++) {
      const n = Number(arguments[i]);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  const api = {
    technique: 'raymarch',
    secondary: 'spark-filaments',
    steps: tier.steps,
    resolution: tier.resolution,
    gain: tier.gain,
    sparks: tier.sparks,
    octaves: tier.octaves,
    quality: tier.id,
    tier: { ...tier },
    tiers: SIGNAL_VOLUME_TIERS,
    hardOff,
    enabled: enabled0,
    pass,
    center: [center.x, center.y, center.z],
    half: [half.x, half.y, half.z],
    lamp: [lamp.x, lamp.y, lamp.z],
    setEnabled(on) {
      if (hardOff && on) return;
      api.enabled = !!on;
      pass.enabled = api.enabled;
    },
    setQuality(name) {
      const resolved = resolveSignalVolumeQuality(name);
      if (!resolved) return false;
      publish({ ...SIGNAL_VOLUME_TIERS[resolved] });
      return true;
    },
    applyPerfTier(input) {
      if (typeof input === 'string' || typeof input === 'number') {
        return api.setQuality(input);
      }
      if (!input || typeof input !== 'object') return false;
      const named = resolveSignalVolumeQuality(input.quality ?? input.id ?? input.volume ?? input.tier);
      const next = named ? { ...SIGNAL_VOLUME_TIERS[named] } : { ...tier };
      const steps = readNumber(input.steps, input.volumeSteps);
      const resolution = readNumber(input.resolution, input.volumeResolution);
      const gain = readNumber(input.gain, input.volumeGain);
      const sparks = readNumber(input.sparks, input.sparkBudget, input.sparkDensity);
      const octaves = readNumber(input.octaves, input.volumeOctaves);
      if (!named && steps == null && resolution == null && gain == null && sparks == null && octaves == null) {
        return false;
      }
      if (steps != null) next.steps = steps;
      if (resolution != null) next.resolution = resolution;
      if (gain != null) next.gain = gain;
      if (sparks != null) next.sparks = sparks;
      if (octaves != null) next.octaves = octaves;
      publish(next);
      return true;
    },
    update(time, pulse, wind) {
      material.uniforms.uTime.value = time;
      material.uniforms.uPulse.value = pulse == null ? 1 : pulse;
      const w = material.uniforms.uWind.value;
      if (wind && wind.on && wind.dir) {
        const gust = (wind.gust == null) ? 1 : wind.gust;
        const scale = wind.strength * (0.35 + 0.65 * Math.max(0, gust));
        w.set(wind.dir.x * scale, wind.dir.z * scale);
      } else {
        w.set(0, 0);
      }
    },
    syncDepth() {
      for (let i = 0; i < composers.length; i++) syncComposerDepth(composers[i]);
    },
  };

  return api;
}
