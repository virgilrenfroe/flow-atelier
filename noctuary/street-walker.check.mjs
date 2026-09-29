/**
 * The street card must not sweep through an edge-on yaw.
 * Run: node noctuary/street-walker.check.mjs
 */
import {
  TURN_ARC,
  TURN_EDGE,
  arcMinFace,
  faceAmount,
  crossStyle,
  planCardTurn,
  presentYaw,
  safeCardYaw,
} from './street-walker-turn.js';

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function near(a, b, eps, msg) {
  assert(Math.abs(a - b) < eps, `${msg} (${a} vs ${b})`);
}

// Dense sample agrees with the analytic minimum.
function denseMin(y0, delta, vx, vz) {
  let m = 1;
  for (let i = 0; i <= 720; i++) {
    m = Math.min(m, faceAmount(y0 + delta * (i / 720), vx, vz));
  }
  return m;
}

{
  const vx = 0;
  const vz = 4;
  assert(arcMinFace(0, Math.PI, vx, vz) === 0, 'half-turn from +Z includes the edge');
  assert(arcMinFace(0, 0.2, vx, vz) > 0.9, 'a small yaw from face-on stays broad');
  const d = denseMin(0.4, Math.PI, 3.2, 1.1);
  const a = arcMinFace(0.4, Math.PI, 3.2, 1.1);
  near(a, d < 0.02 ? 0 : d, 0.03, 'analytic min matches a dense sweep');
}

// Safe yaw stays at least TURN_EDGE wide and does not jump to the far side
// when the card is only a few degrees past broadside.
{
  const vx = 2;
  const vz = 5;
  const logical = 1.35;
  const shown = safeCardYaw(logical, vx, vz, TURN_EDGE);
  assert(faceAmount(shown, vx, vz) >= TURN_EDGE - 1e-3, 'safe yaw meets the edge floor');
  const broad = faceAmount(0.2, vx, vz);
  if (broad >= TURN_EDGE) near(presentYaw(0.2, vx, vz), 0.2, 1e-6, 'a broad yaw is left alone');
}

// Default harbor camera. Quay walk and the street about-face.
const defaultCam = { x: 16.5, z: 20.5 };
function viewFrom(cam, x, z) {
  return { vx: cam.x - x, vz: cam.z - z };
}

{
  const quay = viewFrom(defaultCam, 0, 2.22);
  const walk = faceAmount(0, quay.vx, quay.vz);
  assert(walk > 0.45, `default quay walk is broad (${walk})`);
  near(presentYaw(0, quay.vx, quay.vz), 0, 1e-6, 'default quay yaw is not biased');
  const plan = planCardTurn(0, Math.PI, quay.vx, quay.vz);
  assert(plan.kind === 'cross', 'default-camera about-face crossfades');
  assert(crossStyle(plan.startShown, plan.endShown) === 'flip', 'about-face mirrors on one card');
  assert(plan.minFace < 0.05, 'the spun about-face would pass the edge');
  assert(faceAmount(plan.startShown, quay.vx, quay.vz) > 0.45, 'crossfade start stays broad');
  assert(faceAmount(plan.endShown, quay.vx, quay.vz) > 0.45, 'crossfade end stays broad');
}

{
  // Street end, walking south (yaw = π/2), about-face.
  const street = viewFrom(defaultCam, 2.75, -2.55);
  const yaw0 = Math.PI / 2;
  const walk = faceAmount(yaw0, street.vx, street.vz);
  assert(walk > 0.4, `default street walk is broad (${walk})`);
  const plan = planCardTurn(yaw0, Math.PI, street.vx, street.vz);
  assert(plan.kind === 'cross', 'street-end about-face crossfades');
  assert(faceAmount(plan.startShown, street.vx, street.vz) >= walk - 1e-6, 'start cell unchanged');
  assert(faceAmount(plan.endShown, street.vx, street.vz) >= walk - 1e-6, 'end cell unchanged');
}

// ?shot=walker camera. The corner walk stays on the real heading.
const shotCam = { x: 5.85, z: 4.35 };
{
  let minWalk = 1;
  for (let x = -3.9; x <= 2.05; x += 0.35) {
    const v = viewFrom(shotCam, x, 2.22);
    const f = faceAmount(0, v.vx, v.vz);
    minWalk = Math.min(minWalk, f);
    if (f >= TURN_EDGE) near(presentYaw(0, v.vx, v.vz), 0, 1e-6, `shot quay x=${x} yaw unchanged`);
  }
  assert(minWalk > TURN_EDGE, `shot quay walk stays above the bias floor (${minWalk})`);
  const corner = viewFrom(shotCam, 2.0, 2.22);
  const plan = planCardTurn(0, Math.PI, corner.vx, corner.vz);
  assert(plan.kind === 'cross', 'shot-camera about-face crossfades');
  assert(faceAmount(plan.startShown, corner.vx, corner.vz) > 0.35, 'shot crossfade stays readable');
  assert(faceAmount(plan.endShown, corner.vx, corner.vz) > 0.35, 'shot crossfade end stays readable');
}

// A drop that only needs a small heading change still spins.
{
  const v = viewFrom(defaultCam, 1.2, 2.22);
  const plan = planCardTurn(0, 0.25, v.vx, v.vz);
  assert(plan.kind === 'spin', 'a short yaw still spins');
  assert(plan.minFace >= TURN_ARC, 'short yaw stays above the arc floor');
}

// Heading change after a drop that would sweep the edge crossfades,
// and a paper-thin destination is lifted off the edge.
{
  const v = viewFrom(shotCam, 2.4, 2.1);
  const yaw0 = 0;
  // Aim the nose at the camera: edge-on destination.
  const edgeYaw = Math.atan2(-(v.vz), v.vx);
  let delta = edgeYaw - yaw0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const plan = planCardTurn(yaw0, delta, v.vx, v.vz);
  assert(plan.kind === 'cross' || plan.minFace >= TURN_ARC, 'drop heading is either safe or a crossfade');
  assert(faceAmount(plan.endShown, v.vx, v.vz) >= TURN_EDGE - 1e-3, 'drop destination is not a line');
  assert(faceAmount(plan.startShown, v.vx, v.vz) >= TURN_EDGE - 1e-3, 'drop start is not a line');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('street-walker turn check ok');
