import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// QUAY skiff, HARBOR launch, tender, and surface fish.
// Hulls are Cannon bodies on the crate Archimedes path. Sealed soles and the
// water footprint discard stay with the meshes and water.js.
export function installHarborCraft(deps) {
  const {
    scene, camera, controls, params, BLOOM_LAYER,
    ORBIT_FOV, WATER_NEAR_Z, WATER_D, WATER_AMP, WATER_Y, waterMat, freezeMotion,
    basinBuoy, physFreeze, physCrateMat, physAdd, physHooks, physCrates, crateInBasinXZ,
  } = deps;

  // ——— Basin craft: working boats + surface fish ———
  // Visual only. No cannon bodies, so crate buoyancy, the Rube chain, shatter,
  // pennants, and collision stay on their existing bodies. Wave height copies the
  // water shader's Gerstner vertical so hulls and fish sit on that surface.
  const harborCraftRoot = new THREE.Group();
  harborCraftRoot.name = 'harbor-craft';
  scene.add(harborCraftRoot);

  const harborFishTime = { value: 0 };
  const harborUp = new THREE.Vector3(0, 1, 0);
  const harborA = new THREE.Vector3();
  const harborB = new THREE.Vector3();
  const harborC = new THREE.Vector3();
  const harborD = new THREE.Vector3();
  const harborBasis = new THREE.Matrix4();
  const harborDummy = new THREE.Object3D();
  const harborBoatWorld = new THREE.Vector3();
  const harborBoatQuat = new THREE.Quaternion();
  const HARBOR_WAVE_MESH_Z = WATER_NEAR_Z + WATER_D * 0.5;

  function harborWaveY(x, z, t) {
    const a = WATER_AMP;
    if (!(a > 0)) return WATER_Y;
    const lx = x;
    const ly = HARBOR_WAVE_MESH_Z - z;
    const gy = (dx, dz, amp, len, speed, phase) => {
      const k = 6.28318530718 / Math.max(len, 0.001);
      const inv = 1 / Math.hypot(dx, dz);
      const f = k * ((dx * inv) * lx + (dz * inv) * ly - speed * t) + phase;
      return amp * Math.sin(f);
    };
    return WATER_Y
      + gy(1.00, 0.35, a * 0.95, 4.20, 0.48, 0.0)
      + gy(-0.55, 1.00, a * 0.58, 2.40, 0.65, 1.3)
      + gy(0.40, -0.85, a * 0.32, 1.35, 0.85, 2.1)
      + gy(0.90, 0.70, a * 0.18, 0.75, 1.20, 0.7);
  }

  function harborOrientShell(positions, indices) {
    const kept = [];
    for (let t = 0; t < indices.length; t += 3) {
      let ia = indices[t];
      let ib = indices[t + 1];
      let ic = indices[t + 2];
      const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
      const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
      const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) < 1e-7) continue;
      const mx = (ax + bx + cx) / 3;
      const my = (ay + by + cy) / 3;
      const mz = (az + bz + cz) / 3;
      if (nx * mx + ny * my + nz * mz < 0) {
        const swap = ib; ib = ic; ic = swap;
      }
      kept.push(ia, ib, ic);
    }
    return kept;
  }

  function harborHull(spec) {
    const S = 16;
    const R = 7;
    const P = R * 2 - 1;
    const positions = [];
    const colors = [];
    const indices = [];
    const cHull = new THREE.Color(spec.color);
    const cWet = cHull.clone().multiplyScalar(0.38);
    const cStripe = new THREE.Color(spec.stripe);
    const cStrake = cHull.clone().lerp(new THREE.Color(0xd5cbb8), 0.55);
    const sheerS = [];
    const sheerP = [];
    const wlS = [];
    const wlP = [];
    const tint = (y, sheer) => {
      if (y < -0.012) return cWet.clone().lerp(cHull, THREE.MathUtils.smoothstep(y, -0.1, -0.012));
      if (Math.abs(y) <= 0.026) return cStripe;
      if (sheer > 0.05 && y > sheer * 0.8) return cStrake;
      return cHull;
    };
    const push = (x, y, z, col) => {
      positions.push(x, y, z);
      colors.push(col.r, col.g, col.b);
    };

    for (let i = 0; i < S; i++) {
      const t = i / (S - 1);
      let beamK;
      if (t < 0.14) beamK = spec.transom * 0.82 + (0.94 - spec.transom * 0.82) * (t / 0.14);
      else if (t < 0.56) beamK = 0.94 + 0.06 * Math.sin(((t - 0.14) / 0.42) * Math.PI);
      else beamK = Math.max(0.04, Math.pow(1 - (t - 0.56) / 0.44, 0.8));
      const halfB = spec.beam * 0.5 * beamK;
      const keelY = -spec.draft * (0.52 + 0.48 * Math.sin(Math.min(t, 0.94) * Math.PI));
      const sheer = spec.freeboard * (0.86 + spec.bowRise * Math.pow(t, 1.4) + 0.16 * Math.pow(1 - t, 2));
      const z = -spec.length * 0.5 + t * spec.length;
      const ring = [];
      for (let j = 0; j < R; j++) {
        const v = j / (R - 1);
        const y = keelY + (sheer - keelY) * v;
        const x = halfB * Math.pow(Math.sin(v * Math.PI * 0.5), spec.bilge);
        ring.push({ x, y, z });
      }
      sheerS.push({ x: ring[R - 1].x, y: ring[R - 1].y, z });
      sheerP.push({ x: -ring[R - 1].x, y: ring[R - 1].y, z });
      let wlX = ring[0].x;
      for (let j = 0; j < R - 1; j++) {
        const y0 = ring[j].y;
        const y1 = ring[j + 1].y;
        if ((y0 <= 0 && y1 >= 0) || (y0 >= 0 && y1 <= 0)) {
          const u = (0 - y0) / (y1 - y0 || 1e-4);
          wlX = ring[j].x + (ring[j + 1].x - ring[j].x) * THREE.MathUtils.clamp(u, 0, 1);
          break;
        }
      }
      wlS.push({ x: Math.max(wlX, 0.012), z });
      wlP.push({ x: -Math.max(wlX, 0.012), z });
      for (let j = R - 1; j >= 0; j--) {
        const p = ring[j];
        push(p.x, p.y, p.z, tint(p.y, sheer));
      }
      for (let j = 1; j < R; j++) {
        const p = ring[j];
        push(-p.x, p.y, p.z, tint(p.y, sheer));
      }
    }

    for (let i = 0; i < S - 1; i++) {
      for (let k = 0; k < P - 1; k++) {
        const a = i * P + k;
        const b = i * P + k + 1;
        const c = (i + 1) * P + k + 1;
        const d = (i + 1) * P + k;
        indices.push(a, d, b, b, d, c);
      }
    }

    const bowSheer = sheerS[S - 1].y;
    const stemY = bowSheer * 0.42 + (-spec.draft * 0.25);
    const stemZ = spec.length * 0.5 + spec.length * 0.028;
    const stemIndex = positions.length / 3;
    push(0, stemY, stemZ, tint(stemY, bowSheer));
    const bowRing = (S - 1) * P;
    for (let k = 0; k < P - 1; k++) indices.push(stemIndex, bowRing + k, bowRing + k + 1);

    let sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < P; k++) {
      sx += positions[k * 3];
      sy += positions[k * 3 + 1];
      sz += positions[k * 3 + 2];
    }
    const sternIndex = positions.length / 3;
    push(sx / P, sy / P, sz / P - 0.01, cStrake);
    for (let k = 0; k < P; k++) {
      const k2 = (k + 1) % P;
      indices.push(sternIndex, k, k2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(harborOrientShell(positions, indices));
    geo.computeVertexNormals();
    return { geo, sheerS, sheerP, wlS, wlP };
  }

  const harborHullMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0.05,
    clearcoat: 0.28,
    clearcoatRoughness: 0.45,
    vertexColors: true,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1.5,
    polygonOffsetUnits: -2,
  });
  const harborWoodMat = new THREE.MeshStandardMaterial({
    color: 0x6b5340, roughness: 0.88, metalness: 0.02,
  });
  const harborInsideMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.84,
    metalness: 0.03,
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const HARBOR_DECK_Y = 0.052;
  const harborIronMat = new THREE.MeshStandardMaterial({
    color: 0x2c3138, roughness: 0.42, metalness: 0.64,
  });
  const harborRopeMat = new THREE.MeshStandardMaterial({
    color: 0x8d7b62, roughness: 0.92, metalness: 0.0,
  });
  const harborFenderMat = new THREE.MeshStandardMaterial({
    color: 0x16181c, roughness: 0.74, metalness: 0.06,
  });
  const harborCabinMat = new THREE.MeshStandardMaterial({
    color: 0xcfc4b2, roughness: 0.72, metalness: 0.04,
  });
  const harborGlassMat = new THREE.MeshStandardMaterial({
    color: 0xffe2b8, emissive: 0xffb15e, emissiveIntensity: 1.15,
    roughness: 0.22, metalness: 0.0,
  });
  const harborPortMat = new THREE.MeshStandardMaterial({
    color: 0xff4040, emissive: 0xff2020, emissiveIntensity: 1.8, roughness: 0.35,
  });
  const harborStbdMat = new THREE.MeshStandardMaterial({
    color: 0x3dff7a, emissive: 0x1ec85a, emissiveIntensity: 1.6, roughness: 0.35,
  });
  const harborRopeGeo = new THREE.CylinderGeometry(1, 1, 1, 5);
  const harborBuoyGeo = new THREE.SphereGeometry(0.07, 10, 8);
  const harborBandGeo = new THREE.CylinderGeometry(0.074, 0.074, 0.028, 10);

  function harborMarkTexture(word) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = '#16130f';
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#b6a27e';
    g.lineWidth = 8;
    g.strokeRect(10, 10, 492, 108);
    g.fillStyle = '#f3eadc';
    g.font = '700 78px ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(word, 256, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  function harborNamePlate(word, w, h) {
    const map = harborMarkTexture(word);
    const mat = new THREE.MeshStandardMaterial({
      map, emissive: 0x4a3c2c, emissiveMap: map, emissiveIntensity: 0.35,
      roughness: 0.58, metalness: 0.04,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  }

  const harborBuoyBandMat = new THREE.MeshStandardMaterial({
    color: 0xc4a05a, roughness: 0.55, metalness: 0.08,
  });

  // Closed sole on the sheer planform, plus a coaming up to the rail.
  // The sole meets the stem and the transom. Water inside that outline is
  // discarded in the basin shader, so a crest cannot draw over the sole.
  function harborSeal(spec, sheerS, sheerP) {
    const group = new THREE.Group();
    const positions = [];
    const colors = [];
    const indices = [];
    const strake = new THREE.Color(spec.color).lerp(new THREE.Color(0xd8cebc), 0.5);
    const inner = new THREE.Color(spec.color).multiplyScalar(0.72);
    const plankA = new THREE.Color(0x7c5e46);
    const plankB = new THREE.Color(0x6a4e3a);
    const n = sheerS.length;
    const deckY = HARBOR_DECK_Y;
    const push = (x, y, z, col) => {
      positions.push(x, y, z);
      colors.push(col.r, col.g, col.b);
      return positions.length / 3 - 1;
    };
    const stemZ = spec.length * 0.5 + spec.length * 0.028;
    const ring = [];
    for (let i = 0; i < n; i++) ring.push(sheerS[i]);
    ring.push({ x: 0, y: sheerS[n - 1].y, z: stemZ });
    for (let i = n - 1; i >= 0; i--) ring.push(sheerP[i]);
    // Cap rail a hair outside the sheer so the sole covers the water clip.
    const cap = 0.028;
    const rim = ring.map((p, i) => {
      const prev = ring[(i + ring.length - 1) % ring.length];
      const next = ring[(i + 1) % ring.length];
      let ax = p.x - prev.x;
      let az = p.z - prev.z;
      let bx = next.x - p.x;
      let bz = next.z - p.z;
      const al = Math.hypot(ax, az) || 1;
      const bl = Math.hypot(bx, bz) || 1;
      ax /= al; az /= al; bx /= bl; bz /= bl;
      const rx = az;
      const rz = -ax;
      let mx = rx + bz;
      let mz = rz - bx;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const denom = Math.max(0.5, mx * rx + mz * rz);
      const m = Math.min(cap / denom, cap);
      return { x: p.x + mx * m, y: p.y, z: p.z + mz * m };
    });
    const port = [];
    const stbd = [];
    for (let i = 0; i < n; i++) {
      const plank = i % 2 ? plankA : plankB;
      const pRim = rim[ring.length - 1 - i];
      const sRim = rim[i];
      port.push(push(pRim.x, deckY, pRim.z, plank));
      stbd.push(push(sRim.x, deckY, sRim.z, plank));
    }
    const stemRim = rim[n];
    const stem = push(stemRim.x, deckY, stemRim.z, plankA);
    for (let i = 0; i < n - 1; i++) {
      indices.push(port[i], stbd[i], stbd[i + 1], port[i], stbd[i + 1], port[i + 1]);
    }
    indices.push(port[n - 1], stbd[n - 1], stem);
    const gBot = [];
    const gTop = [];
    for (let i = 0; i < rim.length; i++) {
      const p = rim[i];
      const yTop = Math.max(p.y, deckY + 0.02);
      gBot.push(push(p.x, deckY, p.z, inner));
      gTop.push(push(p.x, yTop, p.z, strake));
    }
    for (let i = 0; i < rim.length; i++) {
      const j = (i + 1) % rim.length;
      indices.push(gBot[i], gBot[j], gTop[j], gBot[i], gTop[j], gTop[i]);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const sole = new THREE.Mesh(geo, harborInsideMat);
    sole.renderOrder = 2;
    sole.frustumCulled = false;
    sole.name = 'hull-seal';
    group.add(sole);
    return group;
  }

  function harborSpan(mesh, a, b, radius) {
    harborD.subVectors(b, a);
    const len = Math.max(harborD.length(), 1e-4);
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.scale.set(radius, len, radius);
    mesh.quaternion.setFromUnitVectors(harborUp, harborD.multiplyScalar(1 / len));
  }

  function harborAddBoat(spec) {
    const group = new THREE.Group();
    group.name = spec.id;
    const hull = harborHull(spec);
    const shell = new THREE.Mesh(hull.geo, harborHullMat);
    shell.castShadow = false;
    shell.renderOrder = 1;
    group.add(shell);
    group.add(harborSeal(spec, hull.sheerS, hull.sheerP));

    const deckY = HARBOR_DECK_Y;
    if (spec.kind === 'skiff' || spec.kind === 'tender') {
      const seatW = spec.beam * 0.62;
      for (const z of spec.kind === 'skiff' ? [-0.28, 0.38] : [0.05]) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(seatW, 0.028, 0.07), harborWoodMat);
        seat.position.set(0, deckY + 0.06, z * (spec.length / 2.2));
        group.add(seat);
      }
      const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.01, spec.length * 0.72, 5), harborWoodMat);
      oar.rotation.z = Math.PI / 2;
      oar.rotation.y = 0.5;
      oar.position.set(spec.beam * 0.12, spec.freeboard * 0.72, 0.05);
      group.add(oar);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.16), harborWoodMat);
      blade.position.set(spec.beam * 0.42, spec.freeboard * 0.7, spec.length * 0.22);
      group.add(blade);
    }

    if (spec.kind === 'skiff') {
      const motor = new THREE.Group();
      const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.2), harborIronMat);
      cowl.position.set(0, spec.freeboard * 0.45, 0);
      motor.add(cowl);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.05), harborIronMat);
      leg.position.set(0, -0.02, 0.02);
      motor.add(leg);
      motor.position.set(0, 0.02, -spec.length * 0.5 - 0.02);
      group.add(motor);
      for (let i = 0; i < 3; i++) {
        const fender = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), harborFenderMat);
        fender.position.set(-spec.beam * 0.46, spec.freeboard * 0.35, -0.35 + i * 0.38);
        group.add(fender);
      }
    }

    if (spec.cabin) {
      const cabL = spec.length * 0.22;
      const cabW = spec.beam * 0.62;
      const cabH = 0.4;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(cabW, cabH, cabL), harborCabinMat);
      cab.position.set(0, deckY + cabH * 0.5, -spec.length * 0.06);
      group.add(cab);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(cabW + 0.06, 0.028, cabL + 0.08), harborCabinMat);
      roof.position.set(0, deckY + cabH + 0.01, -spec.length * 0.06);
      group.add(roof);
      const win = (x, y, z, ry, w, h) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), harborGlassMat);
        m.position.set(x, y, z);
        m.rotation.y = ry;
        m.layers.enable(BLOOM_LAYER);
        group.add(m);
      };
      const wy = deckY + cabH * 0.58;
      const cz = -spec.length * 0.06;
      win(cabW * 0.5 + 0.01, wy, cz, Math.PI / 2, cabL * 0.62, cabH * 0.42);
      win(-cabW * 0.5 - 0.01, wy, cz, -Math.PI / 2, cabL * 0.62, cabH * 0.42);
      win(0, wy, cz + cabL * 0.5 + 0.01, 0, cabW * 0.46, cabH * 0.38);
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, 0.16, 6), harborIronMat);
      stack.position.set(cabW * 0.22, deckY + cabH + 0.1, cz - cabL * 0.12);
      group.add(stack);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, 1.15, 6), harborWoodMat);
      mast.position.set(0, deckY + 0.58, spec.length * 0.2);
      group.add(mast);
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, spec.length * 0.28, 5), harborWoodMat);
      boom.rotation.x = Math.PI / 2;
      boom.position.set(0, deckY + cabH + 0.06, spec.length * 0.2 + spec.length * 0.12);
      group.add(boom);
      const port = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), harborPortMat);
      port.position.set(-cabW * 0.42, wy, cz + cabL * 0.42);
      port.layers.enable(BLOOM_LAYER);
      group.add(port);
      const stbd = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), harborStbdMat);
      stbd.position.set(cabW * 0.42, wy, cz + cabL * 0.42);
      stbd.layers.enable(BLOOM_LAYER);
      group.add(stbd);
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 6, 10), harborRopeMat);
      coil.rotation.x = Math.PI / 2;
      coil.position.set(spec.beam * 0.16, deckY + 0.02, spec.length * 0.28);
      group.add(coil);
      const lamp = new THREE.PointLight(0xffc48a, 0.9, 3.2, 2);
      lamp.position.set(0, deckY + cabH * 0.4, cz);
      group.add(lamp);
    }

    if (spec.mark) {
      const plate = harborNamePlate(spec.mark, spec.kind === 'launch' ? 0.62 : 0.42, spec.kind === 'launch' ? 0.15 : 0.11);
      const mid = hull.sheerS[8];
      plate.position.set(mid.x + 0.02, spec.freeboard * 0.48, mid.z * 0.15);
      plate.rotation.y = Math.PI / 2;
      group.add(plate);
      const stern = harborNamePlate(spec.mark, spec.kind === 'launch' ? 0.5 : 0.36, 0.1);
      stern.position.set(0, spec.freeboard * 0.42, -spec.length * 0.5 - 0.02);
      stern.rotation.y = Math.PI;
      group.add(stern);
    }

    const buoy = new THREE.Group();
    buoy.name = spec.id + '-buoy';
    const ball = new THREE.Mesh(harborBuoyGeo, harborFenderMat);
    buoy.add(ball);
    const band = new THREE.Mesh(harborBandGeo, harborBuoyBandMat);
    band.position.y = 0.01;
    buoy.add(band);
    const reach = spec.length * 0.5 + 0.7;
    const buoyHome = {
      x: spec.x + Math.sin(spec.yaw) * reach,
      z: spec.z + Math.cos(spec.yaw) * reach,
    };
    buoyHome.x = Math.max(-10.2, Math.min(10.2, buoyHome.x));
    buoyHome.z = Math.max(7.6, Math.min(25.6, buoyHome.z));
    harborCraftRoot.add(buoy);
    const ropeA = new THREE.Mesh(harborRopeGeo, harborRopeMat);
    const ropeB = new THREE.Mesh(harborRopeGeo, harborRopeMat);
    harborCraftRoot.add(ropeA, ropeB);

    group.position.set(spec.x, WATER_Y, spec.z);
    group.rotation.y = spec.yaw;
    harborCraftRoot.add(group);
    return {
      spec, group, buoy, buoyHome, ropeA, ropeB,
      bowLocal: new THREE.Vector3(0, spec.freeboard * 0.42, spec.length * 0.48),
      phase: spec.x * 0.37 + spec.z * 0.11,
    };
  }

  const HARBOR_BOAT_DEFS = [
    {
      id: 'quay-skiff', kind: 'skiff', mark: 'QUAY',
      x: -7.55, z: 12.35, yaw: 0.42,
      length: 2.15, beam: 0.78, draft: 0.13, freeboard: 0.16,
      bilge: 0.5, transom: 0.8, bowRise: 0.26,
      color: 0x1c2a24, stripe: 0xcbbfa6, clear: 1.95,
    },
    {
      id: 'harbor-launch', kind: 'launch', mark: 'HARBOR', cabin: true,
      x: 4.85, z: 16.85, yaw: -0.55,
      length: 3.5, beam: 1.12, draft: 0.22, freeboard: 0.2,
      bilge: 0.64, transom: 0.68, bowRise: 0.4,
      color: 0x151a22, stripe: 0x7a3030, clear: 2.75,
    },
    {
      id: 'basin-tender', kind: 'tender', mark: '',
      x: -3.65, z: 19.15, yaw: 1.12,
      length: 1.58, beam: 0.6, draft: 0.09, freeboard: 0.12,
      bilge: 0.44, transom: 0.72, bowRise: 0.18,
      color: 0x5c4332, stripe: 0xd5c6aa, clear: 1.45,
    },
  ];

  const harborBoats = HARBOR_BOAT_DEFS.map(harborAddBoat);

  function harborFishGeometry() {
    const positions = [];
    const colors = [];
    const indices = [];
    const back = new THREE.Color(0x1a242e);
    const flank = new THREE.Color(0xd7e1ea);
    const belly = new THREE.Color(0xc9c3b2);
    const fin = new THREE.Color(0x24303a);
    const tailCol = new THREE.Color(0x8ea0ae);
    const bodySeg = 16;
    const radial = 10;
    // Planform is the night read (camera is above). Wide shoulder, fine nose,
    // narrow peduncle. Height stays modest so the break is a back, not a balloon.
    const profile = (t) => {
      const body = Math.pow(Math.sin(Math.min(Math.max(t, 0), 1) * Math.PI), 0.72);
      const ped = THREE.MathUtils.smoothstep(0, 0.14, t);
      const nose = 1 - THREE.MathUtils.smoothstep(0.8, 1, t);
      return Math.max(0.011, 0.078 * body * (0.28 + 0.72 * ped) * (0.22 + 0.78 * nose));
    };
    for (let i = 0; i <= bodySeg; i++) {
      const t = i / bodySeg;
      const z = -0.42 + t * 1.02;
      const ry = profile(t);
      const rx = ry * (t > 0.72 ? 0.7 : 1.15);
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const y = Math.sin(a) * ry;
        const x = Math.cos(a) * rx;
        positions.push(x, y, z);
        const up = y / Math.max(ry, 1e-4);
        const col = flank.clone();
        if (up > 0.15) col.lerp(back, THREE.MathUtils.smoothstep(0.15, 0.92, up));
        else col.lerp(belly, THREE.MathUtils.smoothstep(0.15, -0.85, up) * 0.65);
        colors.push(col.r, col.g, col.b);
      }
    }
    for (let i = 0; i < bodySeg; i++) {
      for (let j = 0; j < radial; j++) {
        const j2 = (j + 1) % radial;
        const a = i * radial + j;
        const b = i * radial + j2;
        const c = (i + 1) * radial + j2;
        const d = (i + 1) * radial + j;
        indices.push(a, d, b, b, d, c);
      }
    }
    const tip = positions.length / 3;
    positions.push(0, 0.012, 0.66);
    colors.push(flank.r, flank.g, flank.b);
    const noseRing = bodySeg * radial;
    for (let j = 0; j < radial; j++) {
      indices.push(tip, noseRing + j, noseRing + ((j + 1) % radial));
    }
    const pushVert = (x, y, z, col) => {
      positions.push(x, y, z);
      colors.push(col.r, col.g, col.b);
    };
    const pushTri = (a, b, c, col) => {
      const base = positions.length / 3;
      for (const p of [a, b, c]) pushVert(p[0], p[1], p[2], col);
      indices.push(base, base + 1, base + 2);
    };
    // Horizontal caudal fork — readable from above, not an edge-on vertical fin.
    pushTri([0.0, 0.012, -0.36], [0.11, 0.01, -0.78], [0.0, 0.012, -0.52], tailCol);
    pushTri([0.0, 0.012, -0.36], [-0.11, 0.01, -0.78], [0.0, 0.012, -0.52], tailCol);
    pushTri([0.0, 0.006, -0.36], [0.11, 0.004, -0.78], [0.0, 0.006, -0.52], tailCol);
    pushTri([0.0, 0.006, -0.36], [-0.11, 0.004, -0.78], [0.0, 0.006, -0.52], tailCol);
    // Low dorsal: a dark ridge with a little thickness so the top-down outline holds.
    pushTri([-0.012, 0.05, -0.02], [0.012, 0.05, 0.16], [0.0, 0.15, 0.05], fin);
    pushTri([-0.012, 0.045, -0.02], [0.0, 0.14, 0.05], [0.012, 0.045, 0.16], fin);
    // Pectoral flashes, held out flat.
    pushTri([0.05, 0.0, 0.08], [0.2, -0.008, 0.0], [0.16, 0.008, 0.12], flank);
    pushTri([-0.05, 0.0, 0.08], [-0.2, -0.008, 0.0], [-0.16, 0.008, 0.12], flank);
    // Eyes, so the head has a facing.
    const eye = new THREE.Color(0x0c1014);
    pushTri([0.028, 0.012, 0.4], [0.04, 0.02, 0.43], [0.03, 0.008, 0.45], eye);
    pushTri([-0.028, 0.012, 0.4], [-0.04, 0.02, 0.43], [-0.03, 0.008, 0.45], eye);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function harborRibbon(def) {
    const out = [];
    const mid = (def.count - 1) * 0.5;
    for (let i = 0; i < def.count; i++) {
      out.push({
        cx: def.cx,
        cz: def.cz,
        rx: def.rx,
        rz: def.rz,
        speed: def.speed,
        phase: def.phase,
        lat: (i - mid) * def.spread,
        lag: i * def.lag,
        scale: def.scale * (0.86 + (i % 4) * 0.06),
        lift: (i % 3) * 0.01,
        nose: def.nose || 0,
      });
    }
    return out;
  }

  const harborFishPaths = [
    // Tight ribbon in open water between the skiff and the launch.
    ...harborRibbon({
      cx: -0.35, cz: 15.15, rx: 1.35, rz: 0.72, speed: 0.42,
      phase: 0.4, count: 7, spread: 0.16, lag: 0.34, scale: 0.58,
    }),
    // Two-plus larger fish rolling just outboard of the launch.
    ...harborRibbon({
      cx: 8.95, cz: 20.45, rx: 0.95, rz: 0.78, speed: 0.28,
      phase: 1.7, count: 4, spread: 0.22, lag: 0.48, scale: 0.86, nose: -0.12,
    }),
    // Smaller school along the port water, clear of the skiff.
    ...harborRibbon({
      cx: -9.05, cz: 16.55, rx: 0.72, rz: 0.95, speed: 0.36,
      phase: 2.4, count: 5, spread: 0.12, lag: 0.28, scale: 0.5,
    }),
  ];
  const harborFishGeo = harborFishGeometry();
  const harborFishPhases = new Float32Array(harborFishPaths.length);
  harborFishPaths.forEach((f, i) => { harborFishPhases[i] = f.phase + f.lag * 2.6 + f.lat; });
  harborFishGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(harborFishPhases, 1));

  const harborFishMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.28,
    emissive: 0x121820,
    emissiveIntensity: 0.22,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  harborFishMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = harborFishTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nattribute float aPhase;\n'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'float along = transformed.z;\n' +
        'float tail = smoothstep(0.12, -0.7, along);\n' +
        'float wag = sin(uTime * 5.4 + aPhase - along * 8.0) * (0.012 + 0.2 * tail);\n' +
        'transformed.x += wag;\n' +
        'transformed.y += -0.035 * smoothstep(-0.05, 0.5, along);\n' +
        'transformed.y += -0.04 * smoothstep(0.0, -0.45, along);\n'
      );
    harborFishMat.userData.shader = shader;
  };
  harborFishMat.customProgramCacheKey = () => 'harbor-fish-v2';

  const harborFishMesh = new THREE.InstancedMesh(harborFishGeo, harborFishMat, harborFishPaths.length);
  harborFishMesh.name = 'harbor-fish';
  harborFishMesh.frustumCulled = false;
  harborFishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const harborFishTint = new THREE.Color();
  harborFishPaths.forEach((f, i) => {
    const cool = 0.45 + (i % 5) * 0.08;
    harborFishTint.setRGB(0.78 + cool * 0.1, 0.84 + (i % 3) * 0.03, 0.9);
    harborFishMesh.setColorAt(i, harborFishTint);
  });
  if (harborFishMesh.instanceColor) harborFishMesh.instanceColor.needsUpdate = true;
  harborCraftRoot.add(harborFishMesh);

  function harborFishAt(f, t) {
    const a = f.phase + t * f.speed - f.lag;
    const x0 = f.cx + Math.sin(a) * f.rx;
    const z0 = f.cz + Math.sin(a * 2.0) * f.rz;
    const dx = Math.cos(a) * f.rx;
    const dz = Math.cos(a * 2.0) * 2.0 * f.rz;
    const len = Math.hypot(dx, dz) || 1;
    return {
      x: x0 + (-dz / len) * f.lat,
      z: z0 + (dx / len) * f.lat,
    };
  }

  function harborClearCraft(x, z) {
    for (let i = 0; i < harborBoats.length; i++) {
      const b = harborBoats[i].spec;
      let dx = x - b.x;
      let dz = z - b.z;
      const r = b.clear + 0.28;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) {
        const k = (r - d) / d;
        x += dx * k;
        z += dz * k;
      }
    }
    x = Math.max(-10.3, Math.min(10.3, x));
    z = Math.max(7.6, Math.min(25.6, z));
    return { x, z };
  }

  const harborHullPoseU = [
    waterMat.uniforms.uHull0,
    waterMat.uniforms.uHull1,
    waterMat.uniforms.uHull2,
  ];
  const harborHullExtU = [
    waterMat.uniforms.uHullExt0,
    waterMat.uniforms.uHullExt1,
    waterMat.uniforms.uHullExt2,
  ];

  function harborPoseCraft() {
    const t = harborFishTime.value;
    for (let i = 0; i < harborBoats.length; i++) {
      const boat = harborBoats[i];
      const spec = boat.spec;
      if (boat.anchor) boat.anchor.updateMatrixWorld(true);
      else boat.group.updateMatrixWorld(true);
      boat.group.getWorldPosition(harborBoatWorld);
      boat.group.getWorldQuaternion(harborBoatQuat);
      const x = harborBoatWorld.x;
      const z = harborBoatWorld.z;
      if (i < harborHullPoseU.length) {
        harborD.set(0, 0, 1).applyQuaternion(harborBoatQuat);
        harborHullPoseU[i].value.set(x, z, Math.atan2(harborD.x, harborD.z), 1);
        harborHullExtU[i].value.set(spec.length * 0.5, spec.beam * 0.5, spec.transom, 0.034);
      }
      harborA.copy(boat.bowLocal).applyMatrix4(boat.group.matrixWorld);
      const by = harborWaveY(boat.buoyHome.x, boat.buoyHome.z, t) + 0.045
        + Math.sin(t * 1.35 + boat.phase) * 0.012;
      boat.buoy.position.set(boat.buoyHome.x, by, boat.buoyHome.z);
      harborB.set(boat.buoyHome.x, by, boat.buoyHome.z);
      harborC.copy(harborA).lerp(harborB, 0.5);
      harborC.y -= 0.07;
      harborSpan(boat.ropeA, harborA, harborC, 0.008);
      harborSpan(boat.ropeB, harborC, harborB, 0.008);
    }
  }

  // Same Archimedes entry as a quay crate: box hull, mass/volume sets the draft,
  // buoyancyApplyForces supplies the lift and the wave couple.
  function harborFloatCraft() {
    for (let i = 0; i < harborBoats.length; i++) {
      const boat = harborBoats[i];
      const spec = boat.spec;
      const height = spec.draft + spec.freeboard;
      const hx = spec.beam * 0.5;
      const hy = height * 0.5;
      const hz = spec.length * 0.5;
      const volume = Math.max(spec.length * spec.beam * height, 1e-4);
      const frac = spec.draft / height;
      const mass = frac * basinBuoy.density * volume;
      const centerY = basinBuoy.waterY + (spec.freeboard - spec.draft) * 0.5;
      const body = new CANNON.Body({
        mass: physFreeze ? 0 : mass,
        material: physCrateMat,
        shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
        position: new CANNON.Vec3(spec.x, centerY, spec.z),
        linearDamping: 0.22,
        angularDamping: 0.72,
        allowSleep: true,
      });
      body.quaternion.setFromEuler(0, spec.yaw, 0);
      if (physFreeze) {
        body.type = CANNON.Body.STATIC;
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
      }
      const anchor = new THREE.Object3D();
      anchor.name = spec.id + '-float';
      harborCraftRoot.remove(boat.group);
      boat.group.position.set(0, (spec.draft - spec.freeboard) * 0.5, 0);
      boat.group.rotation.set(0, 0, 0);
      anchor.add(boat.group);
      const entry = physAdd(anchor, body, 'boat', mass);
      entry.halfExtents = new CANNON.Vec3(hx, hy, hz);
      entry.volume = volume;
      entry.density = mass / volume;
      entry.densityLabel = spec.id;
      entry.floatable = true;
      entry.craft = true;
      entry.moor = { x: spec.x, z: spec.z, yaw: spec.yaw };
      entry.spawn.position.copy(body.position);
      entry.spawn.quaternion.copy(body.quaternion);
      physCrates.push(entry);
      boat.anchor = anchor;
      boat.entry = entry;
    }
    const prevAfter = physHooks.afterStep;
    physHooks.afterStep = () => {
      if (typeof prevAfter === 'function') prevAfter();
      harborPoseCraft();
    };
  }

  function updateHarborCraft(t) {
    harborFishTime.value = t;
    harborPoseCraft();

    const dummy = harborDummy;
    for (let i = 0; i < harborFishPaths.length; i++) {
      const f = harborFishPaths[i];
      const now = harborClearCraft(harborFishAt(f, t).x, harborFishAt(f, t).z);
      const ahead = harborClearCraft(harborFishAt(f, t + 0.12).x, harborFishAt(f, t + 0.12).z);
      const x = now.x;
      const z = now.z;
      // Equator just above the wave so the planform reads; the belly stays clipped.
      const y = harborWaveY(x, z, t) + 0.012 + f.lift + Math.sin(t * 1.35 + f.phase) * 0.006;
      const fwd = harborA.set(ahead.x - x, 0, ahead.z - z);
      if (fwd.lengthSq() < 1e-8) fwd.set(Math.cos(f.phase), 0, Math.sin(f.phase));
      else fwd.normalize();
      const up = harborB.set(0, 1, 0);
      const right = harborC.crossVectors(up, fwd).normalize();
      up.crossVectors(fwd, right).normalize();
      const bank = Math.max(-0.35, Math.min(0.35, (ahead.x - x) * -1.4));
      const cr = Math.cos(bank);
      const sr = Math.sin(bank);
      const rx = right.x, ry = right.y, rz = right.z;
      const ux = up.x, uy = up.y, uz = up.z;
      right.set(rx * cr + ux * sr, ry * cr + uy * sr, rz * cr + uz * sr);
      up.set(ux * cr - rx * sr, uy * cr - ry * sr, uz * cr - rz * sr);
      // Nose slightly down into the surface so the shoulder is what breaks it.
      fwd.addScaledVector(up, f.nose || 0);
      fwd.normalize();
      right.crossVectors(up, fwd).normalize();
      up.crossVectors(fwd, right).normalize();
      harborBasis.makeBasis(right, up, fwd);
      dummy.position.set(x, y, z);
      dummy.quaternion.setFromRotationMatrix(harborBasis);
      dummy.scale.set(f.scale, f.scale * 0.92, f.scale);
      dummy.updateMatrix();
      harborFishMesh.setMatrixAt(i, dummy.matrix);
    }
    harborFishMesh.instanceMatrix.needsUpdate = true;
  }

  harborFloatCraft();
  updateHarborCraft(freezeMotion ? 1.25 : 0);
  window.__harborCraft = {
    boats: harborBoats.length,
    fish: harborFishPaths.length,
    waveY: (x, z) => harborWaveY(x, z, harborFishTime.value),
    pose() {
      return harborBoats.map((b) => {
        b.group.updateWorldMatrix(true, false);
        b.group.getWorldPosition(harborBoatWorld);
        const e = b.entry;
        return {
          id: b.spec.id,
          x: +harborBoatWorld.x.toFixed(3),
          y: +harborBoatWorld.y.toFixed(3),
          z: +harborBoatWorld.z.toFixed(3),
          mass: e ? +e.mass.toFixed(1) : 0,
          floatable: !!(e && e.floatable),
          inBasin: !!(e && crateInBasinXZ(e.body.position)),
        };
      });
    },
  };
  window.__frameHarborBasin = (mode) => {
    camera.up.set(0, 1, 0);
    camera.fov = ORBIT_FOV;
    const top = (id, dist) => {
      const b = harborBoats.find((boat) => boat.spec.id === id);
      b.group.updateWorldMatrix(true, false);
      b.group.getWorldPosition(harborBoatWorld);
      const x = harborBoatWorld.x;
      const z = harborBoatWorld.z;
      camera.position.set(x, dist, z + 0.04);
      controls.target.set(x, -0.12, z);
    };
    if (mode === 'launch') {
      camera.position.set(6.4, 1.7, 18.2);
      controls.target.set(4.7, -0.1, 16.7);
    } else if (mode === 'skiff') {
      camera.position.set(-4.6, 1.45, 14.6);
      controls.target.set(-7.3, -0.15, 12.4);
    } else if (mode === 'fish') {
      camera.position.set(1.2, 2.15, 16.55);
      controls.target.set(-0.35, -0.22, 15.15);
    } else if (mode === 'above') {
      camera.position.set(5.15, 2.55, 17.55);
      controls.target.set(4.85, -0.05, 16.85);
    } else if (mode === 'skiff-top') {
      top('quay-skiff', 4.6);
    } else if (mode === 'launch-top') {
      top('harbor-launch', 6.4);
    } else if (mode === 'tender-top') {
      top('basin-tender', 3.8);
    } else if (mode === 'orbit') {
      camera.position.set(9.6, 5.4, 12.8);
      controls.target.set(0.2, -0.2, 16.2);
    } else {
      camera.position.set(11.2, 5.2, 22.4);
      controls.target.set(-0.2, -0.05, 15.2);
    }
    camera.updateProjectionMatrix();
    controls.update();
  };
  if (params.has('frame')) window.__frameHarborBasin(params.get('frame'));

  return { update: updateHarborCraft };
}
