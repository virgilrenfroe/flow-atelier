import * as THREE from 'three';
import { onScope } from './dispose.js';

// Motif and mode swaps do not unload the district. Each swap still releases a
// small GPU stamp (data texture, render target, material, geometry) so the
// dispose count is a real free. Stamps are not drawn into the beauty pass —
// water, buoyancy, collision, and the street graph stay put.
// Page-hide still runs the district teardown in dispose.js.

const STAMP = 8;

function allocStamp(renderer, label) {
  const data = new Uint8Array(STAMP * STAMP * 4);
  const tag = String(label || 'stamp');
  for (let i = 0; i < tag.length && i < 24; i++) data[i] = tag.charCodeAt(i) & 255;
  data[data.length - 1] = 255;
  const tex = new THREE.DataTexture(data, STAMP, STAMP);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const rt = new THREE.WebGLRenderTarget(STAMP, STAMP, {
    depthBuffer: false,
    stencilBuffer: false,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
  });
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const geo = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geo, mat);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget();
  const info = renderer.info && renderer.info.render;
  const calls = info ? info.calls : 0;
  const tris = info ? info.triangles : 0;
  if (typeof renderer.initTexture === 'function') renderer.initTexture(tex);
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  // The stamp is not district work. Keep the draw-call HUD on the harbor pass.
  if (info) {
    info.calls = calls;
    info.triangles = tris;
  }
  return { tex, rt, mat, geo };
}

function releaseStamp(stamp) {
  if (!stamp) return 0;
  stamp.tex.dispose();
  stamp.rt.dispose();
  stamp.mat.dispose();
  stamp.geo.dispose();
  return 4;
}

export function installSwapGpu(renderer) {
  let chapterStamp = allocStamp(renderer, 'Harbor');
  let modeStamp = allocStamp(renderer, 'orbit');

  onScope('chapter', (reason) => {
    const n = releaseStamp(chapterStamp);
    const label = reason && reason.to ? String(reason.to) : 'chapter';
    chapterStamp = allocStamp(renderer, label);
    return n;
  });
  onScope('mode', (reason) => {
    const n = releaseStamp(modeStamp);
    const label = reason && reason.to ? String(reason.to) : 'mode';
    modeStamp = allocStamp(renderer, label);
    return n;
  });
  onScope('page', () => {
    const n = releaseStamp(chapterStamp) + releaseStamp(modeStamp);
    chapterStamp = null;
    modeStamp = null;
    return n;
  });

  return {
    primed: true,
  };
}
