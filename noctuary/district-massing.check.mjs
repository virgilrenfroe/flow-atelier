/**
 * Corridor clearance for A04. Run: node noctuary/district-massing.check.mjs
 * Recomputes Harbor street bands independently of planDistrict's own report.
 */
import { planDistrict } from './district-massing.js';

const STREET_W = 1.65;
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

function hit(a, b, eps = 0.012) {
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

const plan = planDistrict({
  streetW: STREET_W,
  blockW: BLOCK_W,
  blockD: BLOCK_D,
  setback: SETBACK,
  originX,
  originZ,
  cols: GRID_COLS,
  rows,
  originalRows: GRID_ROWS,
});

const failures = [];
function expect(cond, msg) {
  if (!cond) failures.push(msg);
}

const streets = harborStreets();
let streetHits = 0;
let alleyHits = 0;
const alleys = plan.corridors.filter((c) => c.kind === 'alley');
for (const inst of plan.instances) {
  for (const s of streets) if (hit(inst, s)) streetHits++;
  for (const a of alleys) if (hit(inst, a)) alleyHits++;
}

expect(plan.report.corridorsClear, `report overlaps ${plan.report.overlaps}`);
expect(streetHits === 0, `independent street hits ${streetHits}`);
expect(alleyHits === 0, `alley hits ${alleyHits}`);
expect(plan.instances.length > 40, `too few masses ${plan.instances.length}`);
expect(plan.report.heightMax - plan.report.heightMin > 3, 'skyline is flat');
expect(plan.report.slices.shaft > 0, 'no shaft slices');
expect(plan.report.slices.crown > 0, 'no signal crowns');
expect(plan.roads.some((r) => r.kind === 'street'), 'extension streets missing');

const quayH = plan.instances.filter((i) => i.role === 'quay').map((i) => i.h);
const signal = plan.instances.filter((i) => i.role === 'signal');
expect(quayH.length > 0, 'quay row empty');
expect(Math.max(...quayH) < 5, `quay mass too tall ${Math.max(...quayH)}`);
expect(signal.length > 0, 'no signal peaks');

const hinterZ = originZ - GRID_ROWS * cellD;
expect(plan.instances.some((i) => i.z < hinterZ), 'generator did not extend past the hand grid');

const roles = new Set(plan.instances.map((i) => i.role));
for (const role of ['quay', 'harbor', 'signal', 'hinter']) {
  expect(roles.has(role), `missing role ${role}`);
}

if (failures.length) {
  console.error(JSON.stringify(plan.report, null, 2));
  for (const f of failures) console.error('FAIL', f);
  process.exit(1);
}

console.log(JSON.stringify(plan.report, null, 2));
console.log('district massing corridors clear');
