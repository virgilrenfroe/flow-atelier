import * as THREE from 'three';

// One LoadingManager for every Harbor texture. The perf HUD row is the
// detailed readout (visible with H / ?hud=1). The hairline is a brief
// exhibit load state: 2px, then it fades. It is not district chrome.

export function createHarborLoad() {
  const bar = document.getElementById('load-bar');
  const fill = bar ? bar.querySelector('i') : null;
  const label = document.getElementById('perf-load');
  const manager = new THREE.LoadingManager();
  let failed = 0;

  function paint(text, frac) {
    if (label) label.textContent = text;
    if (fill) {
      const x = Math.max(0.04, Math.min(1, frac));
      fill.style.transform = 'scaleX(' + x + ')';
    }
    if (bar && frac >= 1) bar.classList.add('done');
  }

  paint('loading', 0.04);

  manager.onStart = (_url, loaded, total) => {
    const t = Math.max(total, 1);
    paint(loaded + '/' + t + ' · ' + Math.round((100 * loaded) / t) + '%', loaded / t);
  };
  manager.onProgress = (_url, loaded, total) => {
    const t = Math.max(total, 1);
    paint(loaded + '/' + t + ' · ' + Math.round((100 * loaded) / t) + '%', loaded / t);
  };
  manager.onLoad = () => {
    paint(failed ? ('ready · ' + failed + ' failed') : 'ready', 1);
  };
  manager.onError = () => {
    failed += 1;
  };

  const loader = new THREE.TextureLoader(manager);
  return { manager, loader };
}
