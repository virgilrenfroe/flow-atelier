import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { onScope, trackDisposable } from './dispose.js';

// Mist ping-pong FBO + selective bloom. Sim stays 64²; bloom RT follows the perf tier.
export function createHarborPost(deps) {
  const {
    renderer, scene, camera, freezeMotion, bloomLayer, NOISE_GLSL,
    pointerSmooth, tier, harborWind, physFreeze,
  } = deps;
  const fboEl = document.getElementById('fbo-state');

// ——— Ping-pong FBO — denser mist + wind bias + Signal ember channel ———
const FBO_SIZE = tier.sim;
const fboA = new THREE.WebGLRenderTarget(FBO_SIZE, FBO_SIZE, {
  type: THREE.HalfFloatType,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  format: THREE.RGBAFormat,
});
const fboB = fboA.clone();
let fboRead = fboA;
let fboWrite = fboB;
let fboFlip = false;

const fboScene = new THREE.Scene();
const fboCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fboMat = new THREE.ShaderMaterial({
  uniforms: {
    uTex: { value: null },
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector2(0, 0) },
    uSeed: { value: freezeMotion ? 1.0 : 0.0 },
    uSignalUV: { value: new THREE.Vector2(0.28, 0.42) },
    uSignalBright: { value: 1.0 },
    uWindBias: { value: new THREE.Vector2(0.045, 0.008) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D uTex;
    uniform float uTime;
    uniform vec2 uPointer;
    uniform float uSeed;
    uniform vec2 uSignalUV;
    uniform float uSignalBright;
    uniform vec2 uWindBias;
    varying vec2 vUv;
    ${NOISE_GLSL}
    void main(){
      if (uSeed > 0.5) {
        float d = fbm(vUv * 4.5) * 1.15;
        float emb = exp(-dot(vUv - uSignalUV, vUv - uSignalUV) * 18.0) * 0.55;
        gl_FragColor = vec4(clamp(d,0.,1.), emb, 0.25, 1.0);
        return;
      }
      // scene wind bias (Harbor wind → mist/ember drift)
      vec2 wind = uWindBias;
      vec2 vel = vec2(
        noise(vUv * 3.0 + uTime * 0.08) - 0.5,
        noise(vUv * 3.0 + 17.0 + uTime * 0.07) - 0.5
      );
      vel += wind;
      vel += (uPointer - vUv * 2.0 + 1.0) * 0.012;
      vec2 uv2 = fract(vUv - vel * 0.02);
      vec4 prev = texture2D(uTex, uv2);
      float inject = exp(-dot(vUv - (uPointer * 0.5 + 0.5), vUv - (uPointer * 0.5 + 0.5)) * 36.0) * 0.4;
      // Signal brightens nearby ember / spark channel (g)
      float sig = exp(-dot(vUv - uSignalUV, vUv - uSignalUV) * 22.0) * uSignalBright;
      float ember = (inject * 0.55 + sig * 0.7) * (0.55 + 0.45 * sin(uTime * 3.2));
      float dens = prev.r * 0.982 + inject * 0.14 + noise(vUv * 8.0 + uTime) * 0.01 + sig * 0.04;
      dens = clamp(dens, 0.0, 1.0);
      float g = clamp(prev.g * 0.965 + ember * 0.5, 0.0, 1.0);
      float b = clamp(prev.b * 0.978 + sig * 0.08, 0.0, 1.0);
      gl_FragColor = vec4(dens, g, b, 1.0);
    }
  `,
});
const fboQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fboMat);
fboScene.add(fboQuad);

fboMat.uniforms.uSeed.value = 1.0;
fboMat.uniforms.uTex.value = fboRead.texture;
renderer.setRenderTarget(fboWrite);
renderer.render(fboScene, fboCam);
renderer.setRenderTarget(null);
{ const t = fboRead; fboRead = fboWrite; fboWrite = t; fboFlip = !fboFlip; }
fboMat.uniforms.uSeed.value = freezeMotion ? 1.0 : 0.0;

const MIST_N = 1200;
const mistPos = new Float32Array(MIST_N * 3);
const mistUV = new Float32Array(MIST_N * 2);
const cols = 36;
const rows = Math.ceil(MIST_N / cols);
for (let i = 0; i < MIST_N; i++) {
  const u = (i % cols) / (cols - 1);
  const v = Math.floor(i / cols) / Math.max(rows - 1, 1);
  mistUV[i * 2] = u;
  mistUV[i * 2 + 1] = v;
  mistPos[i * 3] = (u - 0.5) * 30;
  mistPos[i * 3 + 1] = 0.35 + v * 7.2;
  mistPos[i * 3 + 2] = 3.5 + (v - 0.5) * 12;
}
const mistGeo = new THREE.BufferGeometry();
mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
mistGeo.setAttribute('aUv', new THREE.BufferAttribute(mistUV, 2));

const mistMat = new THREE.ShaderMaterial({
  uniforms: {
    uTex: { value: fboRead.texture },
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(devicePixelRatio, tier.pixelRatioCap) },
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    attribute vec2 aUv;
    uniform sampler2D uTex;
    uniform float uTime;
    uniform float uPixelRatio;
    varying float vAlpha;
    varying vec3 vCol;
    void main(){
      vec4 dens = texture2D(uTex, aUv);
      vec3 p = position;
      p.y += dens.r * 2.1;
      p.x += (dens.g - 0.25) * 2.4 + dens.b * 0.8;
      p.z += sin(uTime * 0.3 + aUv.x * 6.0) * dens.r * 0.35;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float s = 5.0 + dens.r * 32.0 + dens.g * 22.0;
      gl_PointSize = s * uPixelRatio * (1.2 / -mv.z);
      vAlpha = dens.r * 0.62 + dens.g * 0.42;
      // Spray stays in the basin. The promenade (and the gold plate) stay dry.
      vAlpha *= smoothstep(5.35, 6.15, p.z);
      vCol = mix(vec3(0.54, 0.48, 0.72), vec3(0.94, 0.76, 0.29), dens.g);
      vCol = mix(vCol, vec3(1.0, 0.55, 0.28), dens.b * 0.55);
    }
  `,
  fragmentShader: /* glsl */`
    varying float vAlpha;
    varying vec3 vCol;
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.08, d) * vAlpha;
      gl_FragColor = vec4(vCol, a);
    }
  `,
});
const mist = new THREE.Points(mistGeo, mistMat);
scene.add(mist);

// ——— Selective bloom (layers + darken non-bloomed → bloom RT → composite) ———
const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const darkClearMat = new THREE.MeshBasicMaterial({
  color: 0x000000, transparent: true, opacity: 0, depthWrite: false,
});
const darkPointsMat = new THREE.PointsMaterial({ color: 0x000000, size: 0.001, opacity: 0, transparent: true });
const savedMats = new Map();

function darkenNonBloomed(obj) {
  // Air halo is beauty-only. An opaque black stand-in would cover the filament.
  if (obj.userData && obj.userData.lanternAir) {
    savedMats.set(obj.uuid, obj.material);
    obj.material = darkClearMat;
    return;
  }
  if (obj.isMesh && bloomLayer.test(obj.layers) === false) {
    savedMats.set(obj.uuid, obj.material);
    obj.material = darkMaterial;
  } else if (obj.isPoints && bloomLayer.test(obj.layers) === false) {
    savedMats.set(obj.uuid, obj.material);
    obj.material = darkPointsMat;
  }
}
function restoreBloomed(obj) {
  const m = savedMats.get(obj.uuid);
  if (m !== undefined) {
    obj.material = m;
    savedMats.delete(obj.uuid);
  }
}

const renderScenePass = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.35, 0.72);
bloomPass.threshold = 0.72; // quay/water stay out of bloom; lanterns/windows/Signal in
bloomPass.strength = freezeMotion ? 0 : 0.55;
bloomPass.radius = 0.35;

const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderScenePass);
bloomComposer.addPass(bloomPass);

const mixPass = new ShaderPass(
  new THREE.ShaderMaterial({
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D baseTexture;
      uniform sampler2D bloomTexture;
      varying vec2 vUv;
      void main(){
        vec4 base = texture2D(baseTexture, vUv);
        vec4 bloom = texture2D(bloomTexture, vUv);
        gl_FragColor = vec4(base.rgb + bloom.rgb, max(base.a, bloom.a));
      }
    `,
  }),
  'baseTexture'
);
mixPass.needsSwap = true;

const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(new RenderPass(scene, camera));
finalComposer.addPass(mixPass);
finalComposer.addPass(new OutputPass());

// still / RM: skip heavy bloom — single composer path without selective
const stillComposer = new EffectComposer(renderer);
stillComposer.addPass(new RenderPass(scene, camera));
const softBloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0, 0.4, 0.9);
softBloom.enabled = false;
stillComposer.addPass(softBloom);
stillComposer.addPass(new OutputPass());

function renderFrame() {
  if (freezeMotion) {
    stillComposer.render();
    return;
  }
  const bg = scene.background;
  const fog = scene.fog;
  scene.background = null;
  scene.fog = null;
  scene.traverse(darkenNonBloomed);
  bloomComposer.render();
  scene.traverse(restoreBloomed);
  scene.background = bg;
  scene.fog = fog;
  finalComposer.render();
}

function applyPostTargets() {
  const bw = Math.max(1, Math.floor(innerWidth * tier.bloomScale));
  const bh = Math.max(1, Math.floor(innerHeight * tier.bloomScale));
  bloomComposer.setSize(bw, bh);
  finalComposer.setSize(innerWidth, innerHeight);
  stillComposer.setSize(innerWidth, innerHeight);
  bloomPass.setSize(bw, bh);
  mistMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  applyPostTargets();
});
if (tier.bloomScale !== 1) applyPostTargets();

function pingPong(t, pulse) {
  if (freezeMotion) {
    mistMat.uniforms.uTex.value = fboRead.texture;
    fboEl.textContent = 'frozen';
    return;
  }
  fboMat.uniforms.uTex.value = fboRead.texture;
  fboMat.uniforms.uTime.value = t;
  fboMat.uniforms.uPointer.value.set(pointerSmooth.x * 0.5 + 0.5, pointerSmooth.y * 0.5 + 0.5);
  fboMat.uniforms.uSignalBright.value = 0.75 + 0.45 * pulse;
  // Cheap mist/ember drift from scene wind (crates+lanterns are primary)
  if (typeof harborWind !== 'undefined') {
    const live = harborWind.on && !physFreeze;
    const g = live ? (0.035 + 0.025 * harborWind.strength * Math.max(0.4, harborWind.gust)) : 0;
    fboMat.uniforms.uWindBias.value.set(
      live ? harborWind.dir.x * g : 0.0,
      live ? harborWind.dir.z * g * 0.35 : 0.0
    );
  }
  renderer.setRenderTarget(fboWrite);
  renderer.render(fboScene, fboCam);
  renderer.setRenderTarget(null);
  const tmp = fboRead; fboRead = fboWrite; fboWrite = tmp;
  fboFlip = !fboFlip;
  mistMat.uniforms.uTex.value = fboRead.texture;
  fboEl.textContent = fboFlip ? 'B→A' : 'A→B';
}

  function onModeSwap() {
    const leaked = savedMats.size;
    if (leaked) scene.traverse(restoreBloomed);
    savedMats.clear();
    return leaked;
  }
  onScope('mode', onModeSwap);

  function disposePost() {
    fboA.dispose();
    fboB.dispose();
    fboQuad.geometry.dispose();
    fboMat.dispose();
    mistGeo.dispose();
    mistMat.dispose();
    darkMaterial.dispose();
    darkClearMat.dispose();
    darkPointsMat.dispose();
    bloomComposer.dispose();
    finalComposer.dispose();
    stillComposer.dispose();
    return 8;
  }
  trackDisposable('page', disposePost);

  function targetInfo() {
    const rt = bloomComposer.renderTarget2;
    return {
      sim: FBO_SIZE,
      bloomW: rt.width,
      bloomH: rt.height,
      pixelRatio: renderer.getPixelRatio(),
      bloomScale: tier.bloomScale,
    };
  }

  return { renderFrame, pingPong, mistMat, targetInfo, disposePost, onModeSwap };
}
