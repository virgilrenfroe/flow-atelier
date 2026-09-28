/**
 * A03 · Signal volume air
 * Raymarched umber shafts through the Signal beacon — a depth-aware
 * fullscreen pass, separate from the mist Points / ember FBO.
 * Façade sheath, quay, water, and physics are not touched.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VOLUME_STEPS = 22;

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
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
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

float columnMask(vec3 q) {
  float mast = exp(-dot(q.xz, q.xz) * 0.85);
  vec2 off = q.xz - vec2(0.38, -0.16);
  float wisp = exp(-dot(off, off) * 2.4);
  float yLo = smoothstep(-2.45, -0.85, q.y);
  float yHi = smoothstep(2.45, 0.75, q.y);
  return (mast + wisp * 0.42) * yLo * yHi;
}

float smokeDensity(vec3 p, vec3 q) {
  float rise = uTime * 0.16;
  vec3 wq = q;
  wq.y -= rise;
  float ang = q.y * 0.72 + uTime * 0.11;
  wq.x += sin(ang) * 0.38 + uWind.x * (q.y + 1.4) * 0.55 + q.y * 0.12;
  wq.z += cos(ang * 0.8) * 0.28 + uWind.y * (q.y + 1.4) * 0.55;

  float nA = fbm(wq * 0.7 + vec3(0.0, rise, 2.0));
  vec3 warped = wq + vec3(
    fbm(wq + vec3(2.2, 0.4, 0.0)),
    fbm(wq.yxz + vec3(4.1, 1.3, 0.6)),
    fbm(wq.zyx + vec3(0.7, 3.4, 1.1))
  ) * 0.48;
  vec3 filaments = warped * vec3(1.05, 0.58, 1.05);
  float n = fbm(filaments);
  float n2 = fbm(filaments * 1.7 + vec3(0.0, rise * 0.35, 5.5));
  float ribbons = smoothstep(0.47, 0.73, n * 0.64 + n2 * 0.36);
  ribbons *= smoothstep(0.28, 0.62, nA);
  return ribbons * columnMask(q);
}

float moteField(vec3 p) {
  float m = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float seed = fi * 1.73 + 0.4;
    float cycle = fract(uTime * 0.065 + seed * 0.17);
    vec3 mp = uCenter + vec3(
      sin(seed * 4.2) * 0.48 + uWind.x * cycle * 1.4,
      mix(-1.35, 2.55, cycle),
      cos(seed * 2.4) * 0.36 + uWind.y * cycle * 1.4
    );
    float d = length(p - mp);
    float life = smoothstep(0.0, 0.12, cycle) * smoothstep(1.0, 0.72, cycle);
    m += exp(-d * d * 110.0) * life;
  }
  return m;
}

vec3 volumeShade(vec3 p, vec3 q, vec3 rd, float dens) {
  vec3 toL = uLamp - p;
  float ld = length(toL);
  vec3 L = toL / max(ld, 1e-3);
  float atten = exp(-ld * 0.32);
  float phase = pow(max(dot(L, -rd), 0.0), 2.4);
  float warm = smoothstep(1.8, -0.4, q.y);
  vec3 umber = mix(vec3(0.07, 0.07, 0.11), vec3(0.22, 0.13, 0.07), warm);
  vec3 gold = vec3(0.92, 0.68, 0.26);
  float shaft = exp(-dot(q.xz, q.xz) * 2.6) * atten;
  vec3 col = umber * (0.7 + 0.25 * uPulse);
  col += gold * (phase * 1.15 + shaft * 0.8) * (0.75 + 0.25 * uPulse);
  col += gold * moteField(p) * 1.35 * max(shaft, 0.25);
  return col * dens;
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
  float t1 = min(hit.y, tSurf - 0.035);
  if (hit.y < hit.x || t1 <= t0) {
    gl_FragColor = base;
    return;
  }

  float span = t1 - t0;
  float steps = float(${VOLUME_STEPS});
  float stepLen = span / steps;
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float t = t0 + dither * stepLen;

  vec3 acc = vec3(0.0);
  float transmit = 1.0;
  for (int i = 0; i < ${VOLUME_STEPS}; i++) {
    if (transmit < 0.05) break;
    vec3 p = ro + rd * t;
    vec3 q = p - uCenter;
    float dens = smokeDensity(p, q);
    if (dens > 0.004) {
      acc += volumeShade(p, q, rd, dens) * uGain * stepLen * transmit;
      transmit *= exp(-dens * 0.28 * stepLen);
    }
    t += stepLen;
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

class SignalVolumePass extends Pass {
  constructor(camera, material) {
    super();
    this.camera = camera;
    this.material = material;
    this.uniforms = material.uniforms;
    this.fsQuad = new FullScreenQuad(material);
    this.needsSwap = true;
    this.clear = false;
  }

  render(renderer, writeBuffer, readBuffer) {
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

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    }
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

export function mountSignalVolume(opts) {
  const camera = opts.camera;
  const enabled0 = opts.enabled !== false;
  const debug = !!opts.debug;
  const center = opts.center;
  const lamp = opts.lamp;
  const half = opts.half;
  const composers = opts.composers;

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
      uGain: { value: opts.gain != null ? opts.gain : 1.85 },
      uDebug: { value: debug ? 1 : 0 },
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

  for (let i = 0; i < composers.length; i++) {
    attachComposerDepth(composers[i]);
    composers[i].insertPass(pass, 1);
  }

  const api = {
    technique: 'raymarch',
    steps: VOLUME_STEPS,
    enabled: enabled0,
    pass,
    center: [center.x, center.y, center.z],
    half: [half.x, half.y, half.z],
    lamp: [lamp.x, lamp.y, lamp.z],
    setEnabled(on) {
      api.enabled = !!on;
      pass.enabled = api.enabled;
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
