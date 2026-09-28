import * as THREE from 'three';
import { trackDisposable } from './dispose.js';

// Gerstner basin. Shader body is the Harbor water lesson, unchanged.
export function createHarborWater({ scene, freezeMotion }) {
// ——— Water — Gerstner + Beer-Lambert + Schlick + lantern specular (from water lesson) ———
// Placement locks unchanged: WATER_NEAR_Z outboard of seawall, Y below deck, dry quay.
const WATER_W = 24.0;
const WATER_D = 22.0;
const WATER_NEAR_Z = 5.92; // past SEAWALL_Z≈5.42 + half-thickness 0.11
const WATER_Y = -0.38;
const WATER_WALL_Z = 5.42; // matches SEAWALL_Z below — foam/depth cue
const WATER_AMP = freezeMotion ? 0.0 : 0.045;

const waterMat = new THREE.ShaderMaterial({
  lights: false,
  uniforms: {
    uTime: { value: 0 },
    uDepth: { value: 1 },
    uFresnel: { value: 1 },
    uFoam: { value: 1 },
    uReflect: { value: 1 },
    uAmp: { value: WATER_AMP },
    uWallZ: { value: WATER_WALL_Z },
    uWaterY: { value: WATER_Y },
    uLampA: { value: new THREE.Vector3(-4.8, 1.55, 3.85) },
    uLampB: { value: new THREE.Vector3(4.8, 1.55, 3.85) },
    uKeyDir: { value: new THREE.Vector3(0.35, 0.9, 0.2).normalize() },
    uCamPos: { value: new THREE.Vector3() },
    // Boat footprints: xyz = world x, world z, yaw; w = enabled.
    // ext = half length, half beam, transom blend, outward margin.
    uHull0: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHull1: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHull2: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHullExt0: { value: new THREE.Vector4(1, 0.4, 0.8, 0.02) },
    uHullExt1: { value: new THREE.Vector4(1, 0.4, 0.8, 0.02) },
    uHullExt2: { value: new THREE.Vector4(1, 0.4, 0.8, 0.02) },
  },
  vertexShader: /* glsl */`
    uniform float uTime;
    uniform float uAmp;
    uniform float uWallZ;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldN;
    varying float vCrest;
    varying float vDepthHint;

    void gerstner(
      vec2 xz, float dx, float dz, float steep, float amp, float len, float speed, float phase,
      inout vec3 disp, inout vec3 tang, inout vec3 binorm
    ){
      float k = 6.28318530718 / max(len, 0.001);
      vec2 d = normalize(vec2(dx, dz));
      float f = k * (dot(d, xz) - speed * uTime) + phase;
      float s = sin(f);
      float c = cos(f);
      float qa = steep * amp;
      disp.x += d.x * qa * c;
      disp.y += d.y * qa * c;
      disp.z += amp * s;
      tang.x  += -d.x * d.x * steep * s;
      tang.y  += -d.x * d.y * steep * s;
      tang.z  +=  d.x * k * amp * c;
      binorm.x += -d.x * d.y * steep * s;
      binorm.y += -d.y * d.y * steep * s;
      binorm.z +=  d.y * k * amp * c;
    }

    void main(){
      vUv = uv;
      vec3 p = position;
      vec3 disp = vec3(0.0);
      vec3 tang = vec3(1.0, 0.0, 0.0);
      vec3 binorm = vec3(0.0, 1.0, 0.0);
      vec2 xz = p.xy;

      float a = uAmp;
      // Slightly longer wavelengths for Harbor's wider basin
      gerstner(xz,  1.00,  0.35, 0.32, a * 0.95, 4.20, 0.48, 0.0, disp, tang, binorm);
      gerstner(xz, -0.55,  1.00, 0.28, a * 0.58, 2.40, 0.65, 1.3, disp, tang, binorm);
      gerstner(xz,  0.40, -0.85, 0.40, a * 0.32, 1.35, 0.85, 2.1, disp, tang, binorm);
      gerstner(xz,  0.90,  0.70, 0.22, a * 0.18, 0.75, 1.20, 0.7, disp, tang, binorm);

      p += disp;
      vCrest = clamp(disp.z / max(a * 1.8, 0.0001), 0.0, 1.0);

      vec3 nLocal = normalize(cross(tang, binorm));
      if (nLocal.z < 0.0) nLocal = -nLocal;

      vec4 wp = modelMatrix * vec4(p, 1.0);
      // Basin stays outboard of the seawall. Smaller Z is the promenade.
      // Clamp so a crest cannot slide the surface onto the dry quay.
      float clipZ = uWallZ + 0.20;
      wp.z = max(wp.z, clipZ);
      vWorldPos = wp.xyz;
      vWorldN = normalize(mat3(modelMatrix) * nLocal);
      // Depth outboard of seawall (world +Z)
      vDepthHint = max(0.0, vWorldPos.z - uWallZ);

      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uDepth, uFresnel, uFoam, uReflect, uWallZ, uWaterY, uTime, uAmp;
    uniform vec3 uLampA, uLampB, uKeyDir, uCamPos;
    uniform vec4 uHull0, uHull1, uHull2;
    uniform vec4 uHullExt0, uHullExt1, uHullExt2;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldN;
    varying float vCrest;
    varying float vDepthHint;

    float hash(vec2 p){
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p){
      vec2 i = floor(p); vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }
    float fbm(vec2 p){
      float v = 0.0; float a = 0.5;
      for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.05; a *= 0.5; }
      return v;
    }
    float schlick(float cosTheta, float F0){
      return F0 + (1.0 - F0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
    }
    // Same station curve as harborHull: transom, midship, bow pinch.
    float harborBeamK(float t, float transom){
      if (t < 0.14) return transom * 0.82 + (0.94 - transom * 0.82) * (t / 0.14);
      if (t < 0.56) return 0.94 + 0.06 * sin(((t - 0.14) / 0.42) * 3.14159265);
      return max(0.04, pow(max(1.0 - (t - 0.56) / 0.44, 0.0), 0.8));
    }
    bool harborInHull(vec2 xz, vec4 pose, vec4 ext){
      if (pose.w < 0.5) return false;
      float dx = xz.x - pose.x;
      float dz = xz.y - pose.y;
      float c = cos(pose.z);
      float s = sin(pose.z);
      float lx = dx * c - dz * s;
      float lz = dx * s + dz * c;
      float halfL = ext.x;
      float margin = ext.w;
      float zStern = -halfL - margin;
      float zBow = halfL;
      float zStem = halfL + halfL * 0.056 + margin;
      if (lz < zStern || lz > zStem) return false;
      float t = clamp((lz + halfL) / max(halfL * 2.0, 0.001), 0.0, 1.0);
      float bk = harborBeamK(t, ext.z);
      if (lz > zBow) bk *= 1.0 - clamp((lz - zBow) / max(zStem - zBow, 0.001), 0.0, 1.0);
      return abs(lx) <= ext.y * bk + margin;
    }

    void main(){
      // Nothing landward of the seawall's water face — no sheet, no splash.
      if (vWorldPos.z < uWallZ + 0.20) discard;
      if (abs(vWorldPos.x) > 11.05) discard;
      // Closed boats: the sheet does not draw inside the sheer planform.
      if (harborInHull(vWorldPos.xz, uHull0, uHullExt0)) discard;
      if (harborInHull(vWorldPos.xz, uHull1, uHullExt1)) discard;
      if (harborInHull(vWorldPos.xz, uHull2, uHullExt2)) discard;
      vec3 N = normalize(vWorldN);
      float ampK = clamp(uAmp / 0.045, 0.0, 1.0);
      N = normalize(mix(vec3(0.0, 1.0, 0.0), N, ampK));
      vec2 np = vWorldPos.xz * 2.8 + vec2(uTime * 0.08, uTime * 0.05);
      float n1 = fbm(np);
      float n2 = fbm(np * 2.3 + 7.1);
      float bump = mix(0.12, 0.28, ampK);
      float dx = (n1 - fbm(np + vec2(0.04, 0.0))) * bump * 1.8;
      float dz = (n2 - fbm(np + vec2(0.0, 0.04))) * bump * 1.8;
      N = normalize(N + vec3(dx, 0.0, dz));
      vec3 V = normalize(uCamPos - vWorldPos);
      float NdotV = max(dot(N, V), 0.0);

      float depthM = clamp(vDepthHint / 10.0, 0.0, 1.0);
      float path = mix(1.0, 1.0 + (1.0 - NdotV) * 0.35, uDepth);
      vec3 shallowCol = vec3(0.07, 0.11, 0.14);
      vec3 midCol     = vec3(0.032, 0.058, 0.088);
      vec3 deepCol    = vec3(0.010, 0.018, 0.038);
      vec3 absorb = mix(shallowCol, midCol, smoothstep(0.0, 0.45, depthM));
      absorb = mix(absorb, deepCol, smoothstep(0.35, 1.0, depthM * path));
      float nearLamp = exp(-distance(vWorldPos, uLampA) * 0.35)
                     + 0.7 * exp(-distance(vWorldPos, uLampB) * 0.38);
      vec3 scatter = vec3(0.09, 0.07, 0.035) * nearLamp * 0.07;
      vec3 body = absorb + scatter * uDepth;
      body = mix(vec3(0.06, 0.09, 0.12), body, uDepth);

      float F0 = 0.02;
      float fres = schlick(NdotV, F0);
      vec3 skyCol = vec3(0.12, 0.16, 0.24);
      vec3 horizonCol = vec3(0.18, 0.20, 0.28);
      float upness = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 reflCol = mix(horizonCol, skyCol, upness);
      // edge0 must be < edge1 (GLSL smoothstep is undefined the other way).
      float quayBand = smoothstep(uWallZ - 0.2, uWallZ + 1.6, vWorldPos.z);
      quayBand = 1.0 - quayBand;
      reflCol = mix(reflCol, vec3(0.08, 0.07, 0.06), quayBand * 0.35 * uReflect);
      float streakA = pow(max(0.0, 1.0 - abs(vWorldPos.x - uLampA.x) * 0.55), 10.0);
      float streakB = pow(max(0.0, 1.0 - abs(vWorldPos.x - uLampB.x) * 0.55), 10.0);
      float wobble = 0.5 + 0.5 * sin(vWorldPos.z * 2.4 + uTime * 0.55 + N.x * 4.0);
      vec3 lampRefl = vec3(0.55, 0.42, 0.18) * (streakA * 0.55 + streakB * 0.4) * wobble;
      reflCol += lampRefl * uReflect;

      float fresW = smoothstep(0.05, 0.85, fres) * uFresnel;
      vec3 col = mix(body, reflCol, fresW);
      if (uFresnel < 0.5) col = body;

      vec3 Hkey = normalize(normalize(uKeyDir) + V);
      float specKey = pow(max(dot(N, Hkey), 0.0), 160.0);
      vec3 LA = normalize(uLampA - vWorldPos);
      vec3 LB = normalize(uLampB - vWorldPos);
      float specA = pow(max(dot(N, normalize(LA + V)), 0.0), 220.0);
      float specB = pow(max(dot(N, normalize(LB + V)), 0.0), 220.0);
      float streakMaskA = pow(max(0.0, 1.0 - abs(vWorldPos.x - uLampA.x) * 0.35), 3.0);
      float streakMaskB = pow(max(0.0, 1.0 - abs(vWorldPos.x - uLampB.x) * 0.38), 3.0);
      float attenA = 1.0 / (1.0 + distance(vWorldPos, uLampA) * 0.18);
      float attenB = 1.0 / (1.0 + distance(vWorldPos, uLampB) * 0.2);
      vec3 spec = vec3(0.55, 0.62, 0.75) * specKey * 0.28
                + vec3(1.0, 0.84, 0.45) * (specA * 0.55 + streakMaskA * 0.12 * fres) * attenA
                + vec3(0.95, 0.74, 0.38) * (specB * 0.4 + streakMaskB * 0.1 * fres) * attenB;
      col += spec * mix(0.2, 1.0, uReflect);

      // Removed leftover caustics-lite scroll bands (old night-streak grid):
      // sin(x*5) brown stripes read as ghost lines under the Gerstner basin.
      // Keep lantern X-streaks + foam + Fresnel above.

      col = min(col, vec3(0.24));

      float wallDist = vWorldPos.z - uWallZ;
      float wallEdge = (1.0 - smoothstep(0.08, 1.15, wallDist)) * smoothstep(-0.08, 0.12, wallDist);
      float foamNoise = fbm(vec2(vWorldPos.x * 5.0, vWorldPos.z * 3.5 + uTime * 0.5));
      float chop = 0.55 + 0.45 * sin(vWorldPos.x * 22.0 + uTime * 1.4 + foamNoise * 3.0);
      float lineFoam = wallEdge * chop * (0.75 + 0.25 * foamNoise);
      float crestFoam = smoothstep(0.5, 0.9, vCrest) * (0.35 + 0.4 * foamNoise);
      crestFoam *= smoothstep(0.08, 0.6, depthM);
      float foam = clamp(lineFoam * 1.2 + crestFoam * 0.5, 0.0, 1.0) * uFoam;
      vec3 foamCol = vec3(0.48, 0.54, 0.60);
      col = mix(col, foamCol, foam * 0.9);
      col = min(col, vec3(0.55));

      float fogF = 1.0 - exp(-0.018 * length(uCamPos - vWorldPos));
      col = mix(col, vec3(0.02, 0.023, 0.035), fogF * 0.55);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
waterMat.transparent = false;
waterMat.depthWrite = true;
// Dense mesh for Gerstner (Harbor basin wider than lesson — 128×96 keeps cost sane)
const water = new THREE.Mesh(new THREE.PlaneGeometry(WATER_W, WATER_D, 128, 96), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.set(0, WATER_Y, WATER_NEAR_Z + WATER_D * 0.5);
water.renderOrder = -1;
scene.add(water);

  function disposeWater() {
    scene.remove(water);
    water.geometry.dispose();
    waterMat.dispose();
    return 1;
  }
  trackDisposable('page', disposeWater);

  return {
    water, waterMat,
    WATER_W, WATER_D, WATER_NEAR_Z, WATER_Y, WATER_WALL_Z, WATER_AMP,
    disposeWater,
  };
}
