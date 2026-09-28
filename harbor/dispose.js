// Harbor is one district. The motif cycle (Harbor / Quay / Signal) is a label,
// not a scene unload. Walk, tour, and orbit share the same graph.
//
// trackDisposable(scope, fn) — run once, then drop. Use for GPU resources.
// onScope(scope, fn) — run on every swap. Use for cleanup that must repeat.
// Scopes: 'chapter' (motif change), 'mode' (orbit / walk / tour), 'page' (pagehide).

const once = { chapter: [], mode: [], page: [] };
const repeat = { chapter: [], mode: [], page: [] };

export function trackDisposable(scope, fn) {
  const bag = once[scope];
  if (!bag) throw new Error('unknown dispose scope ' + scope);
  bag.push(fn);
}

export function onScope(scope, fn) {
  const bag = repeat[scope];
  if (!bag) throw new Error('unknown dispose scope ' + scope);
  bag.push(fn);
}

export function emitDispose(scope, reason) {
  let n = 0;
  const reps = repeat[scope] || [];
  for (let i = 0; i < reps.length; i++) {
    try {
      const r = reps[i](reason);
      n += typeof r === 'number' ? r : 0;
    } catch (err) {
      console.warn('Harbor dispose hook', scope, err);
    }
  }
  const bag = once[scope] || [];
  const fns = bag.splice(0);
  const ordered = scope === 'page' ? fns.reverse() : fns;
  for (let i = 0; i < ordered.length; i++) {
    try {
      const r = ordered[i](reason);
      n += typeof r === 'number' ? r : 1;
    } catch (err) {
      console.warn('Harbor dispose', scope, err);
    }
  }
  return n;
}

let pagehideInstalled = false;
export function installPagehide() {
  if (pagehideInstalled) return;
  pagehideInstalled = true;
  addEventListener('pagehide', (ev) => {
    if (ev && ev.persisted) return;
    emitDispose('page', 'pagehide');
  });
}
