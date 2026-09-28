/**
 * Corridor clearance for A04. Run: node noctuary/district-massing.check.mjs
 * Recomputes Harbor street bands independently of planDistrict's own report.
 */
import { planDistrict, parseMassingSeed, SEED_PRESETS } from './district-massing.js';

const STREET_W = 1.65;
const SIDEWALK_W = 0.18;
const QUAY_WALK_W = 0.22;
const BLOCK_W = 5;
const BLOCK_D = 4.4;
const SETBACK = 0.32;
const GRID_COLS = 5;
const GRID_ROWS = 4;
const cellW = BLOCK_W + STREET_W;
const cellD = BLOCK_D + STREET_W;
const districtW = GRID_COLS * BLOCK_W + (GRID_COLS + 1) * STREET_W;
const originX = -districtW * 0.5 + STREET_W;
const originZ = 1.15;
const rows = GRID_ROWS + 2;

const failures = [];
function expect(cond, msg) {
  if (!cond) failures.push(msg);
}

function hit(a, b, eps = 0.08) {
  return Math.abs(a.x - b.x) < (a.hx + b.hx) - eps
    && Math.abs(a.z - b.z) < (a.hz + b.hz) - eps;
}

function harborStreets() {
  const streets = [];
  const left = originX - STREET_W;
  const right = originX + GRID_COLS * cellW;
  const hx = (right - left) * 0.5;
  const cx = (left + right) * 0.5;
  for (let r = 0; r <= rows; r++) {
    streets.push({
      x: cx,
      z: originZ + STREET_W * 0.5 - r * cellD,
      hx,
      hz: STREET_W * 0.5,
    });
  }
  const zNear = originZ + STREET_W * 0.5;
  const zFar = originZ + STREET_W * 0.5 - rows * cellD;
  for (let c = 0; c <= GRID_COLS; c++) {
    streets.push({
      x: originX - STREET_W * 0.5 + c * cellW,
      z: (zNear + zFar) * 0.5,
      hx: STREET_W * 0.5,
      hz: Math.abs(zNear - zFar) * 0.5,
    });
  }
  return streets;
}

function grammar(seed, seedLabel) {
  return {
    streetW: STREET_W,
    sidewalkW: SIDEWALK_W,
    blockW: BLOCK_W,
    blockD: BLOCK_D,
    setback: SETBACK,
    originX,
    originZ,
    cols: GRID_COLS,
    rows,
    originalRows: GRID_ROWS,
    seed,
    seedLabel,
  };
}

function signature(plan) {
  return plan.instances
    .map((i) => `${i.bid}:${i.slice}:${i.h.toFixed(2)}:${i.x.toFixed(2)}:${i.z.toFixed(2)}`)
    .join('|');
}

function assertPlan(plan, label) {
  const streets = harborStreets();
  let streetHits = 0;
  let alleyHits = 0;
  const alleys = plan.corridors.filter((c) => c.kind === 'alley');
  for (const inst of plan.instances) {
    for (const s of streets) if (hit(inst, s)) streetHits++;
    for (const a of alleys) if (hit(inst, a)) alleyHits++;
  }
  expect(plan.report.corridorsClear, `${label} report overlaps ${plan.report.overlaps} gap ${plan.report.gapHits}`);
  expect(streetHits === 0, `${label} street hits ${streetHits}`);
  expect(alleyHits === 0, `${label} alley hits ${alleyHits}`);
  expect(plan.instances.length > 40, `${label} too few masses ${plan.instances.length}`);
  expect(plan.report.slices.crown > 0, `${label} no signal crowns`);
  expect(plan.report.slices.shaft > 0, `${label} no shafts`);

  const byBid = new Map();
  for (const inst of plan.instances) {
    if (!byBid.has(inst.bid)) byBid.set(inst.bid, []);
    byBid.get(inst.bid).push(inst);
  }
  const crownsPerBlock = new Map();
  for (const slices of byBid.values()) {
    const podium = slices.find((s) => s.slice === 0);
    const shaft = slices.find((s) => s.slice === 1);
    const crown = slices.find((s) => s.slice === 2);
    if (shaft && podium) {
      expect(shaft.w < podium.w - 0.04 && shaft.d < podium.d - 0.04, `${label} shaft not inside podium`);
      expect(Math.abs(podium.h - plan.report.podiumH) < 0.02, `${label} podium height drifted`);
    }
    if (crown) {
      expect(shaft, `${label} crown without shaft`);
      expect(crown.role === 'signal', `${label} crown on ${crown.role}`);
      expect(crown.w < shaft.w - 0.04 && crown.d < shaft.d - 0.04, `${label} crown spills past shaft`);
      expect(Math.abs(crown.x - shaft.x) < 1e-6 && Math.abs(crown.z - shaft.z) < 1e-6, `${label} crown off center`);
      const key = `${crown.bx},${crown.bz}`;
      crownsPerBlock.set(key, (crownsPerBlock.get(key) || 0) + 1);
    }
    if (slices.some((s) => s.role === 'quay' && s.slice === 2)) {
      expect(false, `${label} quay crown`);
    }
  }
  for (const [key, n] of crownsPerBlock) {
    expect(n === 1, `${label} block ${key} has ${n} crowns`);
  }
}

const parsed = parseMassingSeed('signal');
expect(parsed.label === 'signal', 'parse signal label');
expect(parsed.value === SEED_PRESETS[1].value, 'parse signal value');
expect(parseMassingSeed('').label === 'A04', 'default seed label');

const plan = planDistrict(grammar(SEED_PRESETS[0].value, 'A04'));
assertPlan(plan, 'A04');
const carriageway = STREET_W - 2 * SIDEWALK_W;
expect(plan.report.streetW === STREET_W, `street mask ${plan.report.streetW} != ${STREET_W}`);
expect(Math.abs(plan.report.sidewalkW - SIDEWALK_W) < 1e-6, 'sidewalk split drifted');
expect(Math.abs(plan.report.carriageway - carriageway) < 1e-6, 'carriageway split drifted');
expect(STREET_W === 1.65, 'outer corridor footprint left the main module');
expect(Math.abs(SIDEWALK_W - 0.18) < 1e-6, 'sidewalk left the 0.18 split');
expect(Math.abs(carriageway - 1.29) < 1e-6, `carriageway ${carriageway.toFixed(2)} is not 1.29`);
expect(carriageway > 0.65 + 0.3, `carriageway ${carriageway.toFixed(2)} is not wider than main's 0.65 lane`);
expect(2 * (SIDEWALK_W + 0.08) < STREET_W, 'sidewalks and curbs do not fit in the street gap');
expect(Math.abs(QUAY_WALK_W - 0.22) < 1e-6, 'quay walk left 0.22');
expect(QUAY_WALK_W + 0.08 < STREET_W, 'quay walk expands the promenade');
expect(plan.report.heightMax - plan.report.heightMin > 3, 'skyline is flat');
expect(plan.roads.some((r) => r.kind === 'street'), 'extension streets missing');
const quayH = plan.instances.filter((i) => i.role === 'quay').map((i) => i.h);
expect(quayH.length > 0, 'quay row empty');
expect(Math.max(...quayH) < 5, `quay mass too tall ${Math.max(...quayH)}`);
expect(plan.instances.some((i) => i.role === 'signal'), 'no signal peaks');
const hinterZ = originZ - GRID_ROWS * cellD;
expect(plan.instances.some((i) => i.z < hinterZ), 'generator did not extend past the hand grid');
const roles = new Set(plan.instances.map((i) => i.role));
for (const role of ['quay', 'harbor', 'signal', 'hinter']) {
  expect(roles.has(role), `missing role ${role}`);
}

const other = planDistrict(grammar(SEED_PRESETS[1].value, 'signal'));
assertPlan(other, 'signal');
expect(signature(plan) !== signature(other), 'seeds produced the same district');

for (const preset of SEED_PRESETS) {
  assertPlan(planDistrict(grammar(preset.value, preset.label)), preset.label);
}

if (failures.length) {
  console.error(JSON.stringify(plan.report, null, 2));
  for (const f of failures) console.error('FAIL', f);
  process.exit(1);
}

console.log(JSON.stringify({ a04: plan.report, signal: other.report }, null, 2));
console.log('district massing corridors clear');
