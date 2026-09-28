import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { trackDisposable } from './dispose.js';

// Renderer, camera, orbit, and night key. District geometry stays in main.js.
export function createHarborScene({ freezeMotion, stillMode, tier }) {
// ——— Renderer / scene ———
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, tier.pixelRatioCap));
renderer.info.autoReset = false;
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
if ('dithering' in renderer) renderer.dithering = false;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.FogExp2(0x05060a, 0.018);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
camera.position.set(16.5, 10.5, 20.5);
const ORBIT_FOV = camera.fov;
const WALK_FOV = 72;
// Scene units ≠ metres: residential storey ≈ cellH 0.72–1.0, short walk-ups ≈ 2–3 tall.
// Real eye ≈ 1.7/3.0 of a storey → ~0.55–0.6 here (was 1.7 = mid 2nd floor).
const EYE_H = 0.58;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
// minDistance was 8 — blocked street-close fenestra reads (panes stayed mushy/distant).
controls.minDistance = 0.35;
controls.maxDistance = 48;
controls.maxPolarAngle = Math.PI * 0.495;
controls.target.set(0, 1.6, -2.5);
controls.update();
if (freezeMotion) {
  controls.enableDamping = false;
  controls.enableRotate = !stillMode;
}

// Idle auto-orbit (disabled while pointer is down)
const input = { pointerDown: false, idleOrbit: 0 };
renderer.domElement.addEventListener('pointerdown', () => { input.pointerDown = true; });
addEventListener('pointerup', () => { input.pointerDown = false; });
addEventListener('pointercancel', () => { input.pointerDown = false; });

// Lights
const hemi = new THREE.HemisphereLight(0x8a7bb8, 0x0a0c14, 0.55);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffe6c8, 1.35);
key.position.set(8, 14, 6);
scene.add(key);
const fill = new THREE.PointLight(0xf0c24b, 28, 40, 2);
fill.position.set(-2, 3.2, 3.2);
scene.add(fill);
const violetLamp = new THREE.PointLight(0x8a7bb8, 18, 28, 2);
violetLamp.position.set(4, 4.5, -6);
scene.add(violetLamp);

// Pointer (NDC) for water / mist / quay
const pointer = new THREE.Vector2(0.0, 0.0);
const pointerSmooth = new THREE.Vector2(0.0, 0.0);
addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -((e.clientY / innerHeight) * 2 - 1);
});

  function disposeScene() {
    controls.dispose();
    renderer.dispose();
    return 1;
  }
  trackDisposable('page', disposeScene);

  return {
    renderer, scene, camera, controls,
    ORBIT_FOV, WALK_FOV, EYE_H,
    fill, key, pointer, pointerSmooth, input,
    disposeScene,
  };
}
