// Desktop exhibit defaults match the pre-split Harbor frame:
// pixel ratio cap 2, full-resolution bloom, sim FBO locked at 64² (mist parity).
// ?perf=mid|lean opts into smaller bloom targets. Sim resolution stays 64.

import { emitDispose, installPagehide } from './dispose.js';

export const FBO_TIERS = {
  exhibit: {
    id: 'exhibit',
    pixelRatioCap: 2,
    bloomScale: 1,
    sim: 64,
    maxCalls: 560,
    maxTris: 250000,
  },
  mid: {
    id: 'mid',
    pixelRatioCap: 1.5,
    bloomScale: 0.75,
    sim: 64,
    maxCalls: 560,
    maxTris: 250000,
  },
  lean: {
    id: 'lean',
    pixelRatioCap: 1,
    bloomScale: 0.5,
    sim: 64,
    maxCalls: 560,
    maxTris: 250000,
  },
};

export function resolveFboTier(params) {
  const q = (params.get('perf') || params.get('fbo') || '').toLowerCase();
  if (q === 'lean' || q === 'low' || q === '1') return FBO_TIERS.lean;
  if (q === 'mid' || q === 'medium' || q === 'balanced') return FBO_TIERS.mid;
  if (q === 'exhibit' || q === 'high' || q === 'desktop') return FBO_TIERS.exhibit;
  return FBO_TIERS.exhibit;
}

function compact(n) {
  const v = n | 0;
  if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
  if (v >= 10000) return Math.round(v / 1000) + 'k';
  return String(v);
}

export function createPerfMonitor({ renderer, tier, post }) {
  installPagehide();
  const callsEl = document.getElementById('perf-calls');
  const callsMini = document.getElementById('perf-calls-mini');
  const trisEl = document.getElementById('perf-tris');
  const simEl = document.getElementById('perf-sim');
  const bloomEl = document.getElementById('perf-bloom');
  const pxEl = document.getElementById('perf-px');
  const memEl = document.getElementById('perf-mem');
  const modeEl = document.getElementById('perf-mode');
  const disposeEl = document.getElementById('perf-dispose');
  const tierEl = document.getElementById('perf-tier');
  const chapterEl = document.getElementById('perf-chapter');

  let chapter = null;
  let lastSwap = 'hooks live';
  const totals = { chapter: 0, mode: 0, page: 0 };

  if (tierEl) tierEl.textContent = tier.id;
  if (simEl) simEl.textContent = tier.sim + '²';

  function noteChapter(next) {
    if (!next || next === chapter) return;
    const prev = chapter;
    chapter = next;
    if (chapterEl) chapterEl.textContent = next;
    if (prev == null) return;
    const n = emitDispose('chapter', { from: prev, to: next });
    totals.chapter += n;
    lastSwap = 'chapter ' + prev + ' → ' + next;
    paintDispose();
  }

  function onModeSwap(from, to) {
    if (!from || from === to) return;
    const n = emitDispose('mode', { from, to });
    totals.mode += n;
    lastSwap = 'mode ' + from + ' → ' + to;
    paintDispose();
  }

  function paintDispose() {
    if (!disposeEl) return;
    const n = totals.chapter + totals.mode;
    disposeEl.textContent = lastSwap === 'hooks live' ? lastSwap : (lastSwap + ' · ' + n);
  }

  function sample(frame) {
    const info = renderer.info;
    const calls = info.render.calls;
    const tris = info.render.triangles;
    const overCalls = calls > tier.maxCalls;
    const label = calls + ' / ' + tier.maxCalls;
    if (callsEl) {
      callsEl.textContent = label;
      callsEl.classList.toggle('over', overCalls);
    }
    if (callsMini) {
      callsMini.textContent = label;
      callsMini.classList.toggle('over', overCalls);
    }
    if (trisEl) {
      const overTris = tris > tier.maxTris;
      trisEl.textContent = compact(tris) + ' / ' + compact(tier.maxTris);
      trisEl.classList.toggle('over', overTris);
    }
    const targets = post.targetInfo();
    if (bloomEl) bloomEl.textContent = targets.bloomW + '×' + targets.bloomH;
    if (pxEl) pxEl.textContent = targets.pixelRatio.toFixed(2) + ' · ×' + tier.bloomScale.toFixed(2);
    if (memEl) {
      const mem = info.memory || {};
      memEl.textContent = (mem.geometries || 0) + ' geo · ' + (mem.textures || 0) + ' tex';
    }
    if (modeEl && frame && frame.mode) modeEl.textContent = frame.mode;
    if (chapterEl && chapter) chapterEl.textContent = chapter;
    const fpsEl = document.getElementById('perf-fps');
    if (fpsEl && frame && frame.fps != null) fpsEl.textContent = String(frame.fps);
    paintDispose();
  }

  paintDispose();
  if (chapterEl) chapterEl.textContent = 'Harbor';

  return {
    tier,
    noteChapter,
    onModeSwap,
    sample,
    get chapter() { return chapter; },
  };
}
