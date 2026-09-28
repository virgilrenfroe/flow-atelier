import * as THREE from 'three';

// One LoadingManager for every Harbor texture. The perf HUD row is the
// detailed readout (visible with H / ?hud=1). The hairline is a brief
// exhibit load state: 2px, then it fades. It is not district chrome.

export function createHarborLoad() {
  const bar = document.getElementById('load-bar');
  const fill = bar ? bar.querySelector('i') : null;
  const label = document.getElementById('perf-load');
  const manager = new THREE.LoadingManager();
  let total = 0;
  let done = 0;
  let failed = 0;
  let closed = false;

  function paint(text, frac) {
    if (label) label.textContent = text;
    if (fill) {
      const x = Math.max(0.04, Math.min(1, frac));
      fill.style.transform = 'scaleX(' + x + ')';
    }
  }

  function fraction() {
    if (!total) {
      paint('loading', 0.04);
      return;
    }
    const frac = done / total;
    paint(done + '/' + total + ' · ' + Math.round(100 * frac) + '%', frac);
  }

  paint('loading', 0.04);

  const itemStart = manager.itemStart.bind(manager);
  const itemEnd = manager.itemEnd.bind(manager);
  const itemError = manager.itemError.bind(manager);

  // itemStart only notifies onStart for the first URL in a batch, which
  // reads as 0/1. Count every texture so the HUD shows the real total
  // before the scene's first frame, then each completion after that.
  manager.itemStart = (url) => {
    total += 1;
    fraction();
    itemStart(url);
  };
  manager.itemEnd = (url) => {
    done += 1;
    fraction();
    itemEnd(url);
  };
  manager.itemError = (url) => {
    failed += 1;
    itemError(url);
  };
  manager.onLoad = () => {
    if (closed) return;
    closed = true;
    fraction();
    const text = failed ? ('ready · ' + failed + ' failed') : 'ready';
    setTimeout(() => {
      paint(text, 1);
      if (bar) bar.classList.add('done');
    }, 360);
  };

  const loader = new THREE.TextureLoader(manager);
  return { manager, loader };
}
