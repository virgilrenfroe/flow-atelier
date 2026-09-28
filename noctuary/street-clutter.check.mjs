/**
 * Placement check for the first street-clutter pass.
 * Run: node noctuary/street-clutter.check.mjs
 */
import fs from "fs";
import {
  CLUTTER_SPEC,
  WIDER_CORRIDORS,
  narrowAnchors,
  planStreetClutter,
  widerAnchors,
} from "./street-clutter-plan.mjs";

const ALLOWED = new Set(Object.keys(CLUTTER_SPEC));
const CAP = {
  manhole: 8,
  inlet: 12,
  grate: 10,
  can: 12,
  dumpster: 3,
  bag: 10,
  litter: 16,
  cardboard: 8,
  hydrant: 8,
  bench: 8,
  pit: 8,
  weed: 14,
  planter: 6,
};

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function acrossOf(item) {
  return item.acrossAxis === "x" ? item.x : item.z;
}

function halfAcross(item) {
  // Length runs along the walk (local X). Depth faces the street (local Z)
  // and yaw aims that axis across the sidewalk.
  return item.hz || CLUTTER_SPEC[item.kind].depth * 0.5;
}

function checkPlan(label, anchors) {
  const plan = planStreetClutter(anchors);
  assert(plan.total >= 24 && plan.total <= 80, `${label} total ${plan.total} outside 24–80`);
  assert(plan.live.streetW === anchors.streetW, `${label} live streetW`);
  assert(plan.live.sidewalkW === anchors.sidewalkW, `${label} live sidewalkW`);
  const counts = {};
  for (let i = 0; i < plan.items.length; i++) {
    const it = plan.items[i];
    assert(ALLOWED.has(it.kind), `${label} unknown kind ${it.kind}`);
    counts[it.kind] = (counts[it.kind] || 0) + 1;
    const across = acrossOf(it);
    const pad = it.surface === "carriageway" || it.surface === "curb" ? 0.04 : 0.03;
    assert(
      across >= it.acrossLo - pad && across <= it.acrossHi + pad,
      `${label} ${it.kind} across ${across.toFixed(3)} outside [${it.acrossLo.toFixed(3)}, ${it.acrossHi.toFixed(3)}]`
    );
    if (it.surface === "sidewalk" && it.solid) {
      const half = halfAcross(it);
      assert(
        across - half >= it.acrossLo - 0.02 && across + half <= it.acrossHi + 0.02,
        `${label} ${it.kind} footprint leaves the sidewalk`
      );
    }
    if (it.surface === "quay") {
      const center = anchors.gridOriginZ + anchors.streetW * 0.5;
      const inStreet = Math.abs(it.z - center) < anchors.streetW * 0.49;
      assert(!inStreet, `${label} quay ${it.kind} sits in the carriageway`);
    }
  }
  for (const kind of Object.keys(counts)) {
    assert(counts[kind] <= CAP[kind], `${label} ${kind} count ${counts[kind]} over cap`);
  }
  assert(counts.hydrant >= 1, `${label} missing hydrant`);
  assert(counts.bench >= 1, `${label} missing bench`);
  assert(counts.can >= 1, `${label} missing can`);
  assert(counts.pit >= 1, `${label} missing tree pit`);
  assert(counts.manhole >= 1, `${label} missing manhole`);
  assert(counts.inlet >= 1, `${label} missing inlet`);
  assert(counts.grate >= 1, `${label} missing grate`);
  assert((counts.dumpster || 0) >= 1 && counts.dumpster <= 3, `${label} dumpster density`);
  return plan;
}

const narrow = checkPlan("narrow", narrowAnchors());
const wide = checkPlan("wide", widerAnchors());

assert(WIDER_CORRIDORS.streetW === 3.70, "wider STREET_W");
assert(WIDER_CORRIDORS.sidewalkW === 0.78, "wider SIDEWALK_W");
assert(WIDER_CORRIDORS.quayWalkW === 1.25, "wider QUAY_WALK_W");
assert(Math.abs(WIDER_CORRIDORS.carriageway - 2.14) < 0.001, "wider carriageway");
assert(wide.live.streetW === 3.70 && wide.live.sidewalkW === 0.78, "wide plan uses #31 widths");
assert(narrow.live.streetW === 1.65 && narrow.live.sidewalkW === 0.50, "narrow plan uses live main widths");

const narrowHydrant = narrow.items.find((it) => it.hero && it.kind === "hydrant");
const wideHydrant = wide.items.find((it) => it.hero && it.kind === "hydrant");
assert(narrowHydrant && wideHydrant, "hero hydrant on both modules");
const blockZ = 1.15;
const narrowInset = Math.abs(narrowHydrant.z - blockZ);
const wideInset = Math.abs(wideHydrant.z - blockZ);
assert(wideInset > narrowInset * 1.25, `hydrant did not follow the wider walk (${narrowInset.toFixed(3)} → ${wideInset.toFixed(3)})`);

function onStreetCenter(anchors, item) {
  const across = acrossOf(item);
  if (item.acrossAxis === "z") {
    for (let r = 0; r <= anchors.gridRows; r++) {
      const z = anchors.gridOriginZ + anchors.streetW * 0.5 - r * anchors.cellD;
      if (Math.abs(across - z) < 0.06) return true;
    }
  } else {
    for (let c = 0; c <= anchors.gridCols; c++) {
      const x = anchors.gridOriginX - anchors.streetW * 0.5 + c * anchors.cellW;
      if (Math.abs(across - x) < 0.06) return true;
    }
  }
  return false;
}

const narrowHole = narrow.items.find((it) => it.hero && it.kind === "manhole");
assert(narrowHole, "narrow hero manhole missing");
assert(Math.abs(narrowHole.z - (blockZ + 1.65 * 0.5)) < 0.06, "narrow manhole left the live street center");
assert(narrow.items.filter((it) => it.kind === "manhole").every((it) => onStreetCenter(narrowAnchors(), it)), "narrow manhole off center");
assert(wide.items.filter((it) => it.kind === "manhole").every((it) => onStreetCenter(widerAnchors(), it)), "wide manhole off center");
const wideHole = wide.items.find((it) => it.hero && it.kind === "manhole")
  || wide.items.find((it) => it.kind === "manhole");
assert(wideHole && onStreetCenter(widerAnchors(), wideHole), "wide manhole did not follow STREET_W 3.70");

assert(narrow.items.some((it) => it.surface === "quay"), "narrow promenade props missing");
assert(
  wide.items.filter((it) => it.surface === "quay").length === 0
    || wide.items.filter((it) => it.surface === "quay").every((it) => {
      const center = 1.15 + 3.70 * 0.5;
      return Math.abs(it.z - center) >= 3.70 * 0.49;
    }),
  "wide promenade props fell into the carriageway"
);

const png = fs.readFileSync(new URL("../06-intermediate-assets/street-clutter-atlas.png", import.meta.url));
assert(png.readUInt32BE(16) === 2048 && png.readUInt32BE(20) === 2048, "atlas is not 2048²");
assert(png[25] === 6, "atlas is not RGBA");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("street-clutter check ok", {
  narrow: narrow.counts,
  narrowTotal: narrow.total,
  wide: wide.counts,
  wideTotal: wide.total,
  hydrantInset: [narrowInset, wideInset],
});
