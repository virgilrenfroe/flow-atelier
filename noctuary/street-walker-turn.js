/**
 * How the street walker's card presents a yaw change.
 * The body is one double-sided plane. A sweep that passes the edge
 * (path-end about-face, or a drop that retargets through it) would
 * show the camera a zero-thickness line. Those sweeps hold the start
 * cell and the end cell and crossfade, so the silhouette stays the
 * walk width. A short yaw that never nears the edge still spins.
 *
 * Facing is |N·V| in XZ. The plane normal after rotation.y is
 * (sin yaw, cos yaw). That sinusoid has a zero on every half-turn.
 */

export const TURN_EDGE = 0.12;
export const TURN_ARC = 0.22;

export function wrapAngle(d) {
  let x = d;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

export function faceAmount(yaw, vx, vz) {
  const len = Math.hypot(vx, vz);
  if (len < 1e-4) return 1;
  return Math.abs(Math.sin(yaw) * vx + Math.cos(yaw) * vz) / len;
}

// Yaw that lays the card's normal along the view. Of the two (front / back),
// the one nearer `logical`, so a nudge does not flip the nose the long way.
export function cameraCardYaw(logical, vx, vz) {
  const len = Math.hypot(vx, vz);
  if (len < 1e-4) return logical;
  let face = Math.atan2(vx / len, vz / len);
  const alt = face + Math.PI;
  if (Math.abs(wrapAngle(alt - logical)) < Math.abs(wrapAngle(face - logical))) face = alt;
  return face;
}

export function safeCardYaw(logical, vx, vz, minFace = TURN_EDGE) {
  if (faceAmount(logical, vx, vz) >= minFace) return logical;
  const face = cameraCardYaw(logical, vx, vz);
  const maxA = Math.acos(Math.min(0.999, Math.max(0, minFace)));
  let d = wrapAngle(logical - face);
  if (Math.abs(d) > maxA) d = Math.sign(d || 1) * maxA;
  return face + d;
}

export function presentYaw(logical, vx, vz, minFace = TURN_EDGE) {
  if (Math.hypot(vx, vz) < 1e-4) return logical;
  if (faceAmount(logical, vx, vz) >= minFace) return logical;
  return safeCardYaw(logical, vx, vz, minFace);
}

// Minimum |N·V| on the short yaw arc. A zero of the facing sinusoid inside
// the open arc means the card would be seen edge-on.
export function arcMinFace(y0, delta, vx, vz) {
  const len = Math.hypot(vx, vz);
  if (len < 1e-4 || Math.abs(delta) < 1e-5) return faceAmount(y0, vx, vz);
  const y1 = y0 + delta;
  let m = Math.min(faceAmount(y0, vx, vz), faceAmount(y1, vx, vz));
  const p = Math.atan2(vz, vx);
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  for (let n = -3; n <= 5; n++) {
    const z = n * Math.PI - p;
    if (z > lo + 1e-4 && z < hi - 1e-4) return 0;
  }
  return m;
}

export function planCardTurn(yaw0, turnDelta, vx, vz) {
  const direct = wrapAngle(turnDelta);
  const end = yaw0 + direct;
  const minFace = arcMinFace(yaw0, direct, vx, vz);
  const startShown = presentYaw(yaw0, vx, vz);
  const endShown = presentYaw(end, vx, vz);
  if (Math.hypot(vx, vz) < 1e-4 || minFace >= TURN_ARC) {
    return { kind: 'spin', direct, startShown, endShown, minFace };
  }
  return { kind: 'cross', direct, startShown, endShown, minFace };
}

// A half-turn lands on the same plane, opposite face. Mirroring the cell
// is that facing. Anything else is two cards at two headings.
export function crossStyle(startShown, endShown) {
  const sep = Math.abs(wrapAngle(endShown - startShown));
  return sep > Math.PI - 0.5 ? 'flip' : 'pair';
}
