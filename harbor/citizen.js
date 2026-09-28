import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { live } from './live.js';

// Citizen walk (PointerLock) and the quay street tour.
// Same district graph — these modes move the camera. GPU stamps release on swap.

export function installCitizen(deps) {
  const {
    camera, renderer, controls, mesh, quay, clock,
    EYE_H, gridOriginZ, STREET_W, rearZ, districtW,
    ORBIT_FOV, WALK_FOV, blockRect, cellD, cellW, gridOriginX,
    quayTouchControls, syncWalkToggle, syncTourToggle, publishHarborMode,
    params, walkWanted, WALK_KEY,
  } = deps;

  // ——— Citizen first-person walk (PointerLock) ———
  // Eye height scaled to storey (~0.58) on street cell near quay.
  const walkHint = document.getElementById('walk-hint');
  const walkControls = new PointerLockControls(camera, renderer.domElement);
  walkControls.disconnect(); // start disconnected; Orbit owns the canvas

  const WALK_SPAWN = new THREE.Vector3(
    0,
    EYE_H,
    gridOriginZ + STREET_W * 0.5 // first quay-side street center (~1.925)
  );
  const walkKeys = { f: false, b: false, l: false, r: false, sprint: false };
  const walkRay = new THREE.Raycaster();
  walkRay.near = 0;
  walkRay.far = 0.42;
  const _wOrigin = new THREE.Vector3();
  const _wDir = new THREE.Vector3();
  const _wForward = new THREE.Vector3();
  const _wRight = new THREE.Vector3();
  const WALK_DIRS = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];
  const BODY_R = 0.22;
  const CHEST_Y = EYE_H * 0.72;
  const collideMeshes = [mesh];
  if (typeof quay !== 'undefined' && quay) collideMeshes.push(quay);

  let walkMode = false;
  const orbitSave = {
    pos: new THREE.Vector3(),
    target: new THREE.Vector3(),
    fov: ORBIT_FOV,
  };

  function walkBlockedAt(x, z) {
    // Soft district / water bounds (quay deck ~z 2.4, water beyond seawall ~5+)
    if (z > 5.15 || z < rearZ - 2.0) return true;
    if (Math.abs(x) > districtW * 0.58) return true;
    _wOrigin.set(x, CHEST_Y, z);
    for (let i = 0; i < 4; i++) {
      walkRay.set(_wOrigin, WALK_DIRS[i]);
      walkRay.far = BODY_R;
      const hits = walkRay.intersectObjects(collideMeshes, false);
      if (hits.length && hits[0].distance < BODY_R) return true;
    }
    return false;
  }

  function tryWalkStep(dx, dz) {
    const x0 = camera.position.x;
    const z0 = camera.position.z;
    const nx = x0 + dx;
    const nz = z0 + dz;
    if (!walkBlockedAt(nx, nz)) {
      camera.position.x = nx;
      camera.position.z = nz;
    } else if (!walkBlockedAt(nx, z0)) {
      camera.position.x = nx;
    } else if (!walkBlockedAt(x0, nz)) {
      camera.position.z = nz;
    }
    camera.position.y = EYE_H;
  }

  function updateWalk(dt) {
    if (!walkMode) return;
    camera.position.y = EYE_H;
    // Touch has no pointer lock. The pad drives walkKeys; drag on the view looks.
    const touchDrive = quayTouchControls();
    if (!walkControls.isLocked && !touchDrive) return;
    // Compressed scene units (EYE_H≈0.58 ≈ citizen): was ~0.85/1.55 — too fast vs eye.
    const speed = (walkKeys.sprint ? 0.88 : 0.50) * dt;
    let fwd = 0;
    let strafe = 0;
    if (walkKeys.f) fwd += 1;
    if (walkKeys.b) fwd -= 1;
    if (walkKeys.r) strafe += 1;
    if (walkKeys.l) strafe -= 1;
    if (fwd === 0 && strafe === 0) return; // idle: base EYE_H already restored
    // Move relative to look yaw (PointerLock yaw on camera)
    walkControls.getDirection(_wForward);
    _wForward.y = 0;
    if (_wForward.lengthSq() < 1e-6) _wForward.set(0, 0, -1);
    else _wForward.normalize();
    _wRight.crossVectors(_wForward, camera.up).normalize();
    _wDir.set(0, 0, 0);
    _wDir.addScaledVector(_wForward, fwd);
    _wDir.addScaledVector(_wRight, strafe);
    if (_wDir.lengthSq() < 1e-6) return;
    _wDir.normalize().multiplyScalar(speed);
    tryWalkStep(_wDir.x, _wDir.z);
    // Light head-bob while moving + locked (night-street gait)
    camera.position.y = EYE_H + Math.sin(clock.elapsedTime * 9.0) * 0.008;
  }

  function setWalkMode(on) {
    if (on === walkMode) {
      if (on && walkHint) walkHint.classList.add('on');
      syncWalkToggle(on);
      return;
    }
    const prevMode = tourMode ? 'tour' : (walkMode ? 'walk' : 'orbit');
    if (on) stopTour(false);
    walkMode = on;
    live.walkMode = walkMode;
    syncWalkToggle(on);
    try { localStorage.setItem(WALK_KEY, on ? 'on' : 'off'); } catch (_) {}
    if (on) {
      orbitSave.pos.copy(camera.position);
      orbitSave.target.copy(controls.target);
      orbitSave.fov = camera.fov;
      controls.autoRotate = false;
      controls.enabled = false;
      walkControls.enabled = true;
      walkControls.connect();
      camera.fov = WALK_FOV;
      camera.updateProjectionMatrix();
      // Street spawn — look into district (−Z)
      camera.position.copy(WALK_SPAWN);
      camera.rotation.set(0, 0, 0);
      camera.up.set(0, 1, 0);
      camera.lookAt(WALK_SPAWN.x, EYE_H, WALK_SPAWN.z - 4);
      camera.position.y = EYE_H;
      // Nudge if spawn somehow overlaps (rare)
      if (walkBlockedAt(camera.position.x, camera.position.z)) {
        camera.position.z = gridOriginZ + STREET_W * 0.5;
        camera.position.x = 0;
        for (let k = 0; k < 8 && walkBlockedAt(camera.position.x, camera.position.z); k++) {
          camera.position.x += (k % 2 === 0 ? 1 : -1) * 0.5 * (1 + (k >> 1));
        }
      }
      if (walkHint) {
        walkHint.textContent = quayTouchControls()
          ? 'Citizen · drag to look · pad to move'
          : 'Citizen · WASD · click to look · V to exit';
        walkHint.classList.add('on');
      }
    } else {
      if (walkControls.isLocked) walkControls.unlock();
      walkControls.enabled = false;
      walkControls.disconnect();
      controls.enabled = true;
      camera.position.copy(orbitSave.pos);
      controls.target.copy(orbitSave.target);
      camera.fov = orbitSave.fov || ORBIT_FOV;
      camera.updateProjectionMatrix();
      controls.update();
      if (walkHint) walkHint.classList.remove('on');
      walkKeys.f = walkKeys.b = walkKeys.l = walkKeys.r = walkKeys.sprint = false;
    }
    publishHarborMode(prevMode);
  }

  window.addEventListener('noctuary-toggle-walk', () => setWalkMode(!walkMode));

  renderer.domElement.addEventListener('click', () => {
    if (walkMode && !walkControls.isLocked && !quayTouchControls()) walkControls.lock();
  });

  // Touch look — yaw/pitch without pointer lock (iOS lock() is a dead end).
  const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  let lookPid = null;
  let lookLast = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!walkMode || !quayTouchControls()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    lookPid = e.pointerId;
    lookLast = { x: e.clientX, y: e.clientY };
    lookEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) {}
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (lookPid !== e.pointerId || !lookLast) return;
    const dx = e.clientX - lookLast.x;
    const dy = e.clientY - lookLast.y;
    lookLast.x = e.clientX;
    lookLast.y = e.clientY;
    if (!dx && !dy) return;
    lookEuler.y -= dx * 0.0045;
    lookEuler.x -= dy * 0.0045;
    const lim = Math.PI / 2 - 0.08;
    lookEuler.x = Math.max(-lim, Math.min(lim, lookEuler.x));
    camera.quaternion.setFromEuler(lookEuler);
  });
  function endTouchLook(e) {
    if (lookPid !== e.pointerId) return;
    lookPid = null;
    lookLast = null;
  }
  renderer.domElement.addEventListener('pointerup', endTouchLook);
  renderer.domElement.addEventListener('pointercancel', endTouchLook);

  const walkPad = document.getElementById('walk-pad');
  if (walkPad) {
    walkPad.querySelectorAll('button[data-move]').forEach((btn) => {
      const key = btn.getAttribute('data-move');
      const down = (e) => {
        if (!walkMode) return;
        e.preventDefault();
        e.stopPropagation();
        walkKeys[key] = true;
        btn.classList.add('on');
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      };
      const up = (e) => {
        walkKeys[key] = false;
        btn.classList.remove('on');
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
    });
  }

  addEventListener('keydown', (e) => {
    if (!walkMode) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': walkKeys.f = true; e.preventDefault(); break;
      case 'KeyS': case 'ArrowDown': walkKeys.b = true; e.preventDefault(); break;
      case 'KeyA': case 'ArrowLeft': walkKeys.l = true; e.preventDefault(); break;
      case 'KeyD': case 'ArrowRight': walkKeys.r = true; e.preventDefault(); break;
      case 'ShiftLeft': case 'ShiftRight': walkKeys.sprint = true; break;
    }
  });
  addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': walkKeys.f = false; break;
      case 'KeyS': case 'ArrowDown': walkKeys.b = false; break;
      case 'KeyA': case 'ArrowLeft': walkKeys.l = false; break;
      case 'KeyD': case 'ArrowRight': walkKeys.r = false; break;
      case 'ShiftLeft': case 'ShiftRight': walkKeys.sprint = false; break;
    }
  });

  // ——— Citizen auto-tour (?tour=1 / key T) — no PointerLock ———
  const tourHint = document.getElementById('tour-hint');
  const tourLogEl = document.getElementById('tour-log');
  window.__harborTourLog = [];

  const TOUR_SEG_S = 1.5;
  let tourMode = false;
  let tourIdx = 0;
  let tourT = 0;
  let tourWaypoints = [];

  function buildTourWaypoints() {
    // Polyline around first block (bx=0,bz=0) at street centers, eye height.
    const b = blockRect(0, 0);
    const quayZ = gridOriginZ + STREET_W * 0.5;
    const northZ = gridOriginZ - cellD + STREET_W * 0.5;
    const westX = gridOriginX - STREET_W * 0.5;
    const eastX = gridOriginX - STREET_W * 0.5 + cellW;
    const midX = (b.x0 + b.x1) * 0.5;
    const midZ = (b.z0 + b.z1) * 0.5;
    const y = EYE_H;
    // look targets: block center or along street façades
    const cx = midX;
    const cz = midZ;
    return [
      { p: [midX, y, quayZ], look: [midX, y, cz], note: 'Quay street · face south façade' },
      { p: [(midX + eastX) * 0.5, y, quayZ], look: [midX, y, b.z1], note: 'Quay eastbound · approach SE corner' },
      { p: [eastX, y, quayZ], look: [b.x1, y, b.z1], note: 'SE corner · watch edge kill / shared seed' },
      { p: [eastX, y, (quayZ + midZ) * 0.5], look: [b.x1, y, midZ], note: 'East street · +X façade' },
      { p: [eastX, y, midZ], look: [cx, y, cz], note: 'East mid · look into block' },
      { p: [eastX, y, (midZ + northZ) * 0.5], look: [b.x1, y, midZ], note: 'East northbound · approach NE' },
      { p: [eastX, y, northZ], look: [b.x1, y, b.z0], note: 'NE corner' },
      { p: [midX, y, northZ], look: [cx, y, b.z0], note: 'North street · rear façade' },
      { p: [westX, y, northZ], look: [b.x0, y, b.z0], note: 'NW corner' },
      { p: [westX, y, midZ], look: [cx, y, cz], note: 'West street · −X façade (same rooms as +Z?)' },
      { p: [westX, y, quayZ], look: [b.x0, y, b.z1], note: 'SW corner · back to quay' },
      { p: [midX, y, quayZ], look: [midX, y, cz], note: 'Quay return · tour end' },
    ];
  }

  function tourLog(msg) {
    window.__harborTourLog.push(msg);
    console.log('[harbor-tour]', msg);
  }

  function fillTourChecklist() {
    const lines = [
      'CITIZEN TOUR CHECKLIST (auto)',
      '=============================',
      `Eye height EYE_H = ${EYE_H.toFixed(3)}  CHEST_Y = ${CHEST_Y.toFixed(3)}  BODY_R = ${BODY_R.toFixed(3)}`,
      `Waypoints: ${tourWaypoints.length} · segment ${TOUR_SEG_S}s · no PointerLock`,
      '',
      'Heuristic / code-known:',
      '• [x] Shared 3D room seed from lpM cellX/Y/Z (+ vId) — not façade UV cell',
      '• [x] Corner back-wall band: thin edgeKill + sideMute=1 near edge/glancing + camM.x damp',
      '• [x] Atlas path: skip edgeKill/edgeFade→wallCol (tan side-wall panes after cool127)',
      '• [x] Distance LOD impostor (lodFlat mix to flat back atlas 16–36u)',
      '• [x] Night-street gait: walk 0.50 / sprint 0.88 + head-bob',
      '• [x] Street widths: SIDEWALK_W 0.50 · STREET_W 1.65',
      '• [x] Collision chest = EYE_H*0.72 (was stale 1.15)',
      '• [x] Face-map default + V walk unchanged',
      '',
      'Parent (manual / screenshots):',
      '• [ ] Walk past a corner — same room lit/seed from +X and +Z?',
      '• [ ] Vertical edges read as solid wall / mullion (no reoriented room)?',
      '• [ ] Street-level eye height feels citizen-scale vs storey?',
      '• [ ] WASD walk + click look still works (V)?',
      '',
      'Log:',
      ...window.__harborTourLog.map((m) => `• ${m}`),
    ];
    const body = lines.join('\n');
    if (tourLogEl) {
      tourLogEl.textContent = body;
      tourLogEl.classList.add('on');
    }
    document.title = 'Harbor tour done · shared-seed + edge kill';
    tourLog('checklist written to #tour-log');
  }

  function stopTour(restoreOrbit = true) {
    if (!tourMode) return;
    const prevMode = 'tour';
    tourMode = false;
    live.tourMode = false;
    syncTourToggle(false);
    if (tourHint) tourHint.classList.remove('on');
    if (restoreOrbit && !walkMode) {
      controls.enabled = true;
      camera.position.copy(orbitSave.pos);
      controls.target.copy(orbitSave.target);
      camera.fov = orbitSave.fov || ORBIT_FOV;
      camera.updateProjectionMatrix();
      controls.update();
    }
    publishHarborMode(prevMode);
  }

  function startTour() {
    if (tourMode) return;
    const prevMode = walkMode ? 'walk' : 'orbit';
    // Exit pointer-lock walk if active (tour is non-lock citizen path)
    if (walkMode) {
      if (walkControls.isLocked) walkControls.unlock();
      walkControls.enabled = false;
      walkControls.disconnect();
      walkMode = false;
      live.walkMode = false;
      syncWalkToggle(false);
      try { localStorage.setItem(WALK_KEY, 'off'); } catch (_) {}
      if (walkHint) walkHint.classList.remove('on');
      walkKeys.f = walkKeys.b = walkKeys.l = walkKeys.r = walkKeys.sprint = false;
    }
    tourWaypoints = buildTourWaypoints();
    tourIdx = 0;
    tourT = 0;
    tourMode = true;
    live.tourMode = true;
    window.__harborTourLog = [];
    if (tourLogEl) {
      tourLogEl.classList.remove('on');
      tourLogEl.textContent = '';
    }
    orbitSave.pos.copy(camera.position);
    orbitSave.target.copy(controls.target);
    orbitSave.fov = camera.fov;
    controls.autoRotate = false;
    controls.enabled = false;
    camera.fov = WALK_FOV;
    camera.updateProjectionMatrix();
    const w0 = tourWaypoints[0];
    camera.position.set(w0.p[0], EYE_H, w0.p[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(w0.look[0], w0.look[1], w0.look[2]);
    if (walkHint) walkHint.classList.remove('on');
    if (tourHint) {
      tourHint.textContent = `Tour 1/${tourWaypoints.length} · ${w0.note}`;
      tourHint.classList.add('on');
    }
    tourLog(`start · ${tourWaypoints.length} waypoints · EYE_H=${EYE_H}`);
    tourLog(w0.note);
    syncTourToggle(true);
    publishHarborMode(prevMode);
  }

  function updateTour(dt) {
    if (!tourMode || tourWaypoints.length < 2) return;
    tourT += dt;
    const i0 = Math.min(tourIdx, tourWaypoints.length - 1);
    const i1 = Math.min(tourIdx + 1, tourWaypoints.length - 1);
    const a = tourWaypoints[i0];
    const b = tourWaypoints[i1];
    let u = tourT / TOUR_SEG_S;
    if (u >= 1) {
      tourIdx++;
      tourT = 0;
      u = 0;
      if (tourIdx >= tourWaypoints.length - 1) {
        camera.position.set(b.p[0], EYE_H, b.p[2]);
        camera.lookAt(b.look[0], b.look[1], b.look[2]);
        tourLog(b.note);
        tourLog('complete');
        if (tourHint) tourHint.textContent = 'Tour complete · see #tour-log · V to walk · T to replay';
        fillTourChecklist();
        // Stay at final street eye view; V enters walk, T replays. Orbit restored on walk exit.
        tourMode = false;
        live.tourMode = false;
        syncTourToggle(false);
        publishHarborMode('tour');
        if (walkHint) {
          walkHint.textContent = quayTouchControls()
            ? 'Tour done · Walk to stroll · Tour to replay'
            : 'Tour done · V walk · T replay';
          walkHint.classList.add('on');
        }
        return;
      }
      const n = tourWaypoints[tourIdx];
      tourLog(n.note);
      if (tourHint) {
        tourHint.textContent = `Tour ${tourIdx + 1}/${tourWaypoints.length} · ${n.note}`;
      }
    }
    const iA = Math.min(tourIdx, tourWaypoints.length - 1);
    const iB = Math.min(tourIdx + 1, tourWaypoints.length - 1);
    const A = tourWaypoints[iA];
    const B = tourWaypoints[iB];
    const uu = Math.min(1, tourT / TOUR_SEG_S);
    // smoothstep
    const s = uu * uu * (3 - 2 * uu);
    camera.position.set(
      A.p[0] + (B.p[0] - A.p[0]) * s,
      EYE_H,
      A.p[2] + (B.p[2] - A.p[2]) * s
    );
    const lx = A.look[0] + (B.look[0] - A.look[0]) * s;
    const ly = A.look[1] + (B.look[1] - A.look[1]) * s;
    const lz = A.look[2] + (B.look[2] - A.look[2]) * s;
    camera.lookAt(lx, ly, lz);
  }

  window.addEventListener('noctuary-start-tour', () => startTour());

  // Boot from ?walk=1 / localStorage after meshes exist — tour wins if ?tour
  const tourWanted = params.has('tour');
  if (tourWanted) startTour();
  else if (walkWanted) setWalkMode(true);

  return {
    updateWalk,
    updateTour,
    stopTour,
    mode() {
      return tourMode ? 'tour' : (walkMode ? 'walk' : 'orbit');
    },
    walking() { return walkMode; },
    touring() { return tourMode; },
  };
}
