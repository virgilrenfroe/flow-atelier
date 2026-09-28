/**
 * Street-clutter placement. No Three.js.
 *
 * Props sit on the live sidewalk band, curb, carriageway, or quay slab
 * passed in as anchors — the same edges Harbor builds. They are not pinned
 * to the old 1.65 lane. WIDER_CORRIDORS records draft PR #31 (STREET_W 3.70,
 * SIDEWALK_W 0.78, QUAY_WALK_W 1.25, carriageway ~2.14) so the same planner
 * can be checked against that module without merging it.
 */

export const WIDER_CORRIDORS = {
  streetW: 3.70,
  sidewalkW: 0.78,
  quayWalkW: 1.25,
  carriageway: 2.14,
};

/** Scene-unit footprints. Eye height in Harbor is ~0.58. */
export const CLUTTER_SPEC = {
  manhole: { foot: 0.15, depth: 0.30, solid: false },
  inlet: { foot: 0.12, depth: 0.07, solid: false },
  grate: { foot: 0.16, depth: 0.12, solid: false },
  can: { foot: 0.13, depth: 0.26, solid: true, hx: 0.125, hy: 0.22, hz: 0.125 },
  dumpster: { foot: 0.30, depth: 0.28, solid: true, hx: 0.26, hy: 0.18, hz: 0.15 },
  bag: { foot: 0.09, depth: 0.16, solid: false },
  litter: { foot: 0.05, depth: 0.08, solid: false },
  cardboard: { foot: 0.08, depth: 0.12, solid: false },
  hydrant: { foot: 0.14, depth: 0.26, solid: true, hx: 0.13, hy: 0.16, hz: 0.13 },
  bench: { foot: 0.32, depth: 0.18, solid: true, hx: 0.30, hy: 0.17, hz: 0.10 },
  pit: { foot: 0.18, depth: 0.32, solid: true, hx: 0.16, hy: 0.035, hz: 0.16 },
  weed: { foot: 0.06, depth: 0.10, solid: false },
  planter: { foot: 0.14, depth: 0.26, solid: true, hx: 0.13, hy: 0.09, hz: 0.13 },
};

const SIDE = {
  n: { yaw: 0 },
  s: { yaw: Math.PI },
  e: { yaw: Math.PI / 2 },
  w: { yaw: -Math.PI / 2 },
};

function blockRect(bx, bz, a) {
  const x0 = a.gridOriginX + bx * a.cellW;
  const z1 = a.gridOriginZ - bz * a.cellD;
  return { x0, x1: x0 + a.blockW, z0: z1 - a.blockD, z1 };
}

function walkWidth(a, bz, side) {
  if (bz === 0 && side === "n" && a.quayWalkW) return a.quayWalkW;
  return a.sidewalkW;
}

function streetCoversZ(a, z) {
  const center = a.gridOriginZ + a.streetW * 0.5;
  return Math.abs(z - center) < a.streetW * 0.49;
}

function bandsForBlock(bx, bz, a) {
  const b = blockRect(bx, bz, a);
  const sw = a.sidewalkW;
  const north = walkWidth(a, bz, "n");
  const cw = a.curbW;
  const inset = Math.min(sw * 0.9, 0.42);
  const insetN = Math.min(north * 0.55, 0.42);
  return [
    {
      bx, bz, side: "n", along: "x",
      a0: b.x0 + insetN, a1: b.x1 - insetN,
      inner: b.z1, outer: b.z1 + north, street: 1,
      curbCenter: b.z1 + north + cw * 0.5,
      streetCenter: b.z1 + a.streetW * 0.5,
      yaw: SIDE.n.yaw,
    },
    {
      bx, bz, side: "s", along: "x",
      a0: b.x0 + inset, a1: b.x1 - inset,
      inner: b.z0, outer: b.z0 - sw, street: -1,
      curbCenter: b.z0 - sw - cw * 0.5,
      streetCenter: b.z0 - a.streetW * 0.5,
      yaw: SIDE.s.yaw,
    },
    {
      bx, bz, side: "e", along: "z",
      a0: b.z0 + inset, a1: b.z1 - inset,
      inner: b.x1, outer: b.x1 + sw, street: 1,
      curbCenter: b.x1 + sw + cw * 0.5,
      streetCenter: b.x1 + a.streetW * 0.5,
      yaw: SIDE.e.yaw,
    },
    {
      bx, bz, side: "w", along: "z",
      a0: b.z0 + inset, a1: b.z1 - inset,
      inner: b.x0, outer: b.x0 - sw, street: -1,
      curbCenter: b.x0 - sw - cw * 0.5,
      streetCenter: b.x0 - a.streetW * 0.5,
      yaw: SIDE.w.yaw,
    },
  ];
}

function alongOf(band, t) {
  return band.a0 + (band.a1 - band.a0) * t;
}

function acrossPos(band, depth, bias) {
  const span = band.outer - band.inner;
  const dir = Math.sign(span) || 1;
  const width = Math.abs(span);
  const half = Math.min(depth * 0.5, width * 0.42);
  const usable = Math.max(0.01, width - half * 2);
  const dist = half + usable * Math.min(1, Math.max(0, bias));
  return band.inner + dir * dist;
}

function setAcross(item, band, value) {
  if (band.along === "x") item.z = value;
  else item.x = value;
}

function interval(band, lo, hi) {
  return {
    acrossAxis: band.along === "x" ? "z" : "x",
    acrossLo: Math.min(lo, hi),
    acrossHi: Math.max(lo, hi),
  };
}

function blocked(x, z, anchors) {
  const list = anchors.avoid || [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.hw != null && a.hd != null) {
      if (Math.abs(x - a.x) < a.hw && Math.abs(z - a.z) < a.hd) return true;
    } else if (a.r != null) {
      const dx = x - a.x;
      const dz = z - a.z;
      if (dx * dx + dz * dz < a.r * a.r) return true;
    }
  }
  const bands = anchors.keepOut || [];
  for (let i = 0; i < bands.length; i++) {
    if (z >= bands[i].z0 && z <= bands[i].z1) return true;
  }
  return false;
}

function tooClose(items, x, z, foot) {
  for (let i = 0; i < items.length; i++) {
    const o = items[i];
    const need = (foot + (CLUTTER_SPEC[o.kind].foot || 0.1)) * 0.82;
    const dx = x - o.x;
    const dz = z - o.z;
    if (dx * dx + dz * dz < need * need) return true;
  }
  return false;
}

function pushItem(items, item) {
  if (blocked(item.x, item.z, item._anchors)) return false;
  if (tooClose(items, item.x, item.z, CLUTTER_SPEC[item.kind].foot)) return false;
  delete item._anchors;
  items.push(item);
  return true;
}

function makeItem(anchors, band, kind, t, bias, extra) {
  const spec = CLUTTER_SPEC[kind];
  const along = alongOf(band, t);
  const item = {
    kind,
    x: band.along === "x" ? along : 0,
    z: band.along === "z" ? along : 0,
    yaw: band.yaw,
    solid: spec.solid,
    hx: spec.hx || 0,
    hy: spec.hy || 0,
    hz: spec.hz || 0,
    _anchors: anchors,
  };
  if (kind === "manhole") {
    setAcross(item, band, band.streetCenter);
    item.y = anchors.roadY + 0.01;
    item.surface = "carriageway";
    const half = anchors.streetW * 0.42;
    Object.assign(item, interval(band, band.streetCenter - half, band.streetCenter + half));
  } else if (kind === "grate") {
    const dir = Math.sign(band.outer - band.inner) || 1;
    const curbStreet = band.curbCenter + dir * (anchors.curbW * 0.5);
    const across = curbStreet + dir * (spec.depth * 0.5 + 0.025);
    setAcross(item, band, across);
    item.y = anchors.roadY + 0.012;
    item.surface = "carriageway";
    Object.assign(item, interval(band, curbStreet, band.streetCenter));
  } else if (kind === "inlet") {
    setAcross(item, band, band.curbCenter);
    item.y = anchors.roadY;
    item.surface = "curb";
    Object.assign(item, interval(
      band,
      band.curbCenter - anchors.curbW,
      band.curbCenter + anchors.curbW
    ));
  } else {
    const depth = Math.min(spec.depth, Math.abs(band.outer - band.inner) - 0.04);
    const across = acrossPos(band, depth, bias);
    setAcross(item, band, across);
    item.y = anchors.sidewalkTop;
    item.surface = "sidewalk";
    Object.assign(item, interval(band, band.inner, band.outer));
    item.fitDepth = depth;
  }
  if (extra) Object.assign(item, extra);
  return item;
}

function quayItem(anchors, kind, x, z, yaw, extra) {
  const spec = CLUTTER_SPEC[kind];
  return Object.assign({
    kind,
    x, z, yaw,
    y: anchors.quayY,
    solid: spec.solid,
    hx: spec.hx || 0,
    hy: spec.hy || 0,
    hz: spec.hz || 0,
    surface: "quay",
    acrossAxis: "z",
    acrossLo: anchors.quay.z - anchors.quay.halfZ,
    acrossHi: anchors.seawallZ - 0.28,
    quay: true,
    _anchors: anchors,
  }, extra || {});
}

/**
 * @param {object} anchors live Harbor street module + quay slab
 */
export function planStreetClutter(anchors) {
  const a = anchors;
  const items = [];
  const bands = [];
  for (let bz = 0; bz < a.gridRows; bz++) {
    for (let bx = 0; bx < a.gridCols; bx++) {
      const blockBands = bandsForBlock(bx, bz, a);
      for (let i = 0; i < blockBands.length; i++) {
        const band = blockBands[i];
        if (band.a1 - band.a0 > 0.55) bands.push(band);
      }
    }
  }

  function find(bx, bz, side) {
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      if (b.bx === bx && b.bz === bz && b.side === side) return b;
    }
    return null;
  }

  function add(band, kind, t, bias, extra) {
    if (!band) return false;
    return pushItem(items, makeItem(a, band, kind, t, bias, extra));
  }

  // Hero cluster — center block, quay-facing sidewalk. One lived corner, not a row of copies.
  const hero = find(2, 0, "n");
  const heroTag = { hero: true };
  add(hero, "pit", 0.20, 0.48, heroTag);
  add(hero, "hydrant", 0.36, 0.78, heroTag);
  add(hero, "can", 0.52, 0.42, heroTag);
  add(hero, "litter", 0.56, 0.62, Object.assign({ rx: -Math.PI / 2, yawSpin: 0.4 }, heroTag));
  add(hero, "litter", 0.64, 0.55, Object.assign({ rx: -Math.PI / 2, yawSpin: 1.7 }, heroTag));
  add(hero, "cardboard", 0.70, 0.36, Object.assign({ rx: -1.15, lean: true }, heroTag));
  add(hero, "bench", 0.84, 0.28, heroTag);
  add(hero, "inlet", 0.16, 0.5, heroTag);
  add(hero, "grate", 0.46, 0.5, heroTag);
  add(hero, "manhole", 0.67, 0.5, heroTag);
  add(hero, "weed", 0.28, 0.88, heroTag);

  // Two dumpsters on the hinterland sidewalk, not the quay. Placed before the
  // scatter so a random can cannot steal the service pocket.
  const rear = a.gridRows - 1;
  add(find(1, rear, "s"), "dumpster", 0.42, 0.5, {});
  add(find(3, rear, "s"), "dumpster", 0.66, 0.5, { yawSpin: 0.08 });
  add(find(1, rear, "s"), "cardboard", 0.58, 0.30, { rx: -Math.PI / 2 });
  add(find(3, rear, "s"), "bag", 0.78, 0.34, {});
  add(find(0, 1, "w"), "bench", 0.62, 0.22, {});
  add(find(4, 2, "e"), "bench", 0.40, 0.24, {});

  // Sparse remainder. Step a prime through the other edges so life is uneven.
  const rest = bands.filter((b) => !(b.bx === 2 && b.bz === 0 && b.side === "n"));
  const menu = [
    ["can", 0.44, 0.40],
    ["hydrant", 0.76, 0.80],
    ["pit", 0.26, 0.50],
    ["inlet", 0.18, 0.5],
    ["grate", 0.62, 0.5],
    ["weed", 0.70, 0.90],
    ["litter", 0.38, 0.60],
    ["bag", 0.48, 0.32],
    ["manhole", 0.50, 0.5],
    ["cardboard", 0.58, 0.34],
    null, null, null,
  ];
  let placedRest = 0;
  const restCap = 28;
  for (let i = 0; i < rest.length && placedRest < restCap; i++) {
    const slot = menu[(i * 5 + 2) % menu.length];
    if (!slot) continue;
    const band = rest[i];
    // Skip the quay-edge north walk of the rube / signal blocks; the plate owns that corner.
    if (band.bz === 0 && band.side === "n" && band.bx <= 1) continue;
    const [kind, t, bias] = slot;
    const extra = {};
    if (kind === "litter" || (kind === "cardboard" && (i % 2) === 0)) {
      extra.rx = kind === "litter" ? -Math.PI / 2 : -1.2;
      extra.yawSpin = (i % 5) * 0.55;
      if (kind === "cardboard") extra.lean = true;
    }
    if (kind === "cardboard" && !extra.rx) extra.rx = -Math.PI / 2;
    if (add(band, kind, t, bias, extra)) placedRest++;
  }

  // Quay promenade — east of the plate, Signal, and crate cluster.
  // Landward of the lantern posts, and a planter row between posts and bollards.
  const quaySpots = [
    ["bench", 6.15, 3.02, 0],
    ["bench", 8.55, 3.02, 0],
    ["bench", 9.85, 3.02, 0.04],
    ["planter", 6.20, 4.12, 0.2],
    ["planter", 7.40, 4.12, -0.15],
    ["planter", 8.60, 4.12, 0.1],
    ["planter", 9.80, 4.12, 0.4],
    ["litter", 7.10, 3.22, 0.8],
    ["weed", 5.55, 4.22, 0.3],
  ];
  for (let i = 0; i < quaySpots.length; i++) {
    const [kind, x, z, yaw] = quaySpots[i];
    const extra = { quay: true };
    if (kind === "litter") extra.rx = -Math.PI / 2;
    const q = a.quay;
    const onSlab = Math.abs(x - q.x) <= q.halfX - 0.4
      && z >= q.z - q.halfZ + 0.3
      && z <= a.seawallZ - 0.35;
    // Open promenade on the live (narrow) quay. If a wider carriageway
    // swallows that z, seat the same piece on the quay-edge walk instead.
    if (onSlab && !streetCoversZ(a, z)) {
      pushItem(items, quayItem(a, kind, x, z, yaw, extra));
      continue;
    }
    const band = find(x < 0 ? 1 : 3, 0, "n");
    const t = 0.22 + (i % 4) * 0.16;
    const bias = kind === "bench" || kind === "planter" ? 0.55 : 0.7;
    add(band, kind, t, bias, extra);
  }

  // Apply yaw spin on top of the street-facing yaw (litter / cardboard).
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.yawSpin) it.yaw += it.yawSpin;
    if (it.kind === "litter" || (it.kind === "cardboard" && it.rx == null)) {
      it.rx = -Math.PI / 2;
    }
  }

  const counts = {};
  for (let i = 0; i < items.length; i++) {
    const k = items[i].kind;
    counts[k] = (counts[k] || 0) + 1;
  }
  return {
    items,
    counts,
    total: items.length,
    wider: WIDER_CORRIDORS,
    live: { streetW: a.streetW, sidewalkW: a.sidewalkW },
  };
}

/** Main-branch street module, for the check and for callers that have not widened yet. */
export function narrowAnchors(extra) {
  const streetW = 1.65;
  const blockW = 5.0;
  const blockD = 4.4;
  const gridCols = 5;
  const gridRows = 4;
  const cellW = blockW + streetW;
  const cellD = blockD + streetW;
  const districtW = gridCols * blockW + (gridCols + 1) * streetW;
  const districtD = gridRows * blockD + (gridRows + 1) * streetW;
  return Object.assign({
    streetW,
    sidewalkW: 0.50,
    curbW: 0.08,
    blockW,
    blockD,
    gridCols,
    gridRows,
    cellW,
    cellD,
    gridOriginX: -districtW * 0.5 + streetW,
    gridOriginZ: 1.15,
    sidewalkTop: 0.085,
    roadY: 0.018,
    quayY: 0.04,
    quay: { x: 0, y: 0.04, z: 2.4, halfX: 11, halfZ: 3 },
    seawallZ: 5.42,
    keepOut: [
      { z0: 3.70, z1: 4.02 },
      { z0: 4.40, z1: 5.20 },
    ],
    avoid: [
      { x: -9.46, z: 2.45, hw: 1.85, hd: 1.6 },
      { x: -6.5, z: 3.2, r: 1.05 },
      { x: -5.15, z: 2.55, hw: 0.9, hd: 0.55 },
      { x: -4.55, z: 2.88, r: 0.55 },
      { x: -4.1, z: 3.5, r: 0.5 },
      { x: -2.4, z: 3.35, r: 0.5 },
      { x: -0.3, z: 3.55, r: 0.5 },
      { x: 1.5, z: 3.25, r: 0.5 },
      { x: 3.4, z: 3.45, r: 0.5 },
    ],
  }, extra || {});
}

export function widerAnchors(extra) {
  const base = narrowAnchors();
  const streetW = WIDER_CORRIDORS.streetW;
  const sidewalkW = WIDER_CORRIDORS.sidewalkW;
  const cellW = base.blockW + streetW;
  const cellD = base.blockD + streetW;
  const districtW = base.gridCols * base.blockW + (base.gridCols + 1) * streetW;
  const districtD = base.gridRows * base.blockD + (base.gridRows + 1) * streetW;
  return Object.assign({}, base, {
    streetW,
    sidewalkW,
    quayWalkW: WIDER_CORRIDORS.quayWalkW,
    cellW,
    cellD,
    gridOriginX: -districtW * 0.5 + streetW,
    gridOriginZ: base.gridOriginZ,
  }, extra || {});
}
