import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { live } from './live.js';

// Quay-tied boats and a quieter pair of fish schools.
// Hulls are Cannon bodies on the crate Archimedes path. Sealed soles and the
// water footprint discard stay with the meshes and water.js.
// Painters end on the coping cleats. Nothing in this module stands in the basin.
// Paint, wear, and night response come from the quay crate atlas. Marks are
// the sheet's own stencils: HARBOR, SIGNAL, QUAY, FENESTRA.
export function installHarborCraft(deps) {
  const {
    scene, camera, controls, params, BLOOM_LAYER,
    ORBIT_FOV, WATER_NEAR_Z, WATER_D, WATER_AMP, WATER_Y, waterMat, freezeMotion,
    SEAWALL_Z, faceTop, atlasBase, atlasLoader,
    basinBuoy, physFreeze, physCrateMat, physAdd, physHooks, physCrates, crateInBasinXZ,
    crateWearMat, stampHarborCrateUVs, CRATE_FACE_ROW,
  } = deps;

  // ——— Basin craft: working boats + surface fish ———
  // Hulls join the crate buoyancy path. Painters are visual and end on the coping.
  // Wave height copies the water shader's Gerstner vertical.
  const harborCraftRoot = new THREE.Group();
  harborCraftRoot.name = 'harbor-craft';
  scene.add(harborCraftRoot);

  const harborFishTime = { value: 0 };
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

  // Same cell math as crateAtlasUV, with the 2% inset the box stamper uses.
  function harborAtlasUV(col, row, lu, lv) {
    const du = 0.2;
    const dv = 0.25;
    const inset = 0.02;
    const u = inset + THREE.MathUtils.clamp(lu, 0, 1) * (1 - inset * 2);
    const v = inset + THREE.MathUtils.clamp(lv, 0, 1) * (1 - inset * 2);
    return [
      col * du + u * du,
      (1 - (row + 1) * dv) + v * dv,
    ];
  }

  function harborFinishGeo(geo) {
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    geo.computeTangents();
    return geo;
  }

  function harborStampCell(geo, col, row) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const at = harborAtlasUV(col, row, uv.getX(i), uv.getY(i));
      uv.setXY(i, at[0], at[1]);
    }
    uv.needsUpdate = true;
    return harborFinishGeo(geo);
  }

  // Plank scale of a quay crate. Packed UV is (column * 16 + repeats, row * 16 + repeats).
  // The fragment fold lives in harborInstallRepeat so a quad can cross a seam
  // without smearing into the next atlas cell.
  const HARBOR_PLANK = 0.38;
  function harborPackedUV(col, row, lu, lv) {
    return [col * 16 + lu, row * 16 + lv];
  }

  function harborInstallRepeat(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          `vec2 harborCrateUv(vec2 p) {
            float col = floor(p.x / 16.0);
            float row = floor(p.y / 16.0);
            float lu = fract(p.x - col * 16.0);
            float lv = fract(p.y - row * 16.0);
            return vec2(
              (col + 0.02 + lu * 0.96) * 0.2,
              (1.0 - (row + 1.0) * 0.25) + (0.02 + lv * 0.96) * 0.25
            );
          }
          void main() {`
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          #ifdef USE_MAP
            vMapUv = harborCrateUv(uv);
          #endif
          #ifdef USE_NORMALMAP
            vNormalMapUv = harborCrateUv(uv);
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = harborCrateUv(uv);
          #endif
          #ifdef USE_EMISSIVEMAP
            vEmissiveMapUv = harborCrateUv(uv);
          #endif`
        );
    };
    mat.customProgramCacheKey = () => 'harbor-crate-repeat-v1';
  }

  function harborHull(spec) {
    const S = 16;
    const R = 7;
    const P = R * 2 - 1;
    const positions = [];
    const uvs = [];
    const indices = [];
    const sheerS = [];
    const sheerP = [];
    const wlS = [];
    const wlP = [];
    const sternRing = [];
    const col = spec.atlasCol;
    const side = CRATE_FACE_ROW.side;
    const sternZ = -spec.length * 0.5;
    // Side row, keel to sheer, repeated along the length at crate-plank size.
    // Port and starboard share u so the keel quads stay in one repeat.
    const push = (x, y, z, lv) => {
      positions.push(x, y, z);
      const at = harborPackedUV(col, side, (z - sternZ) / HARBOR_PLANK, lv);
      uvs.push(at[0], at[1]);
    };

    const bowPow = spec.bowPow == null ? 0.8 : spec.bowPow;
    for (let i = 0; i < S; i++) {
      const t = i / (S - 1);
      let beamK;
      if (t < 0.14) beamK = spec.transom * 0.82 + (0.94 - spec.transom * 0.82) * (t / 0.14);
      else if (t < 0.56) beamK = 0.94 + 0.06 * Math.sin(((t - 0.14) / 0.42) * Math.PI);
      else beamK = Math.max(0.04, Math.pow(1 - (t - 0.56) / 0.44, bowPow));
      const halfB = spec.beam * 0.5 * beamK;
      const keelY = -spec.draft * (0.52 + 0.48 * Math.sin(Math.min(t, 0.94) * Math.PI));
      const sheer = spec.freeboard * (0.86 + spec.bowRise * Math.pow(t, 1.4) + 0.16 * Math.pow(1 - t, 2));
      const z = -spec.length * 0.5 + t * spec.length;
      const ring = [];
      for (let j = 0; j < R; j++) {
        const v = j / (R - 1);
        const y = keelY + (sheer - keelY) * v;
        const x = halfB * Math.pow(Math.sin(v * Math.PI * 0.5), spec.bilge);
        ring.push({ x, y, z, v });
      }
      sheerS.push({ x: ring[R - 1].x, y: ring[R - 1].y, z });
      sheerP.push({ x: -ring[R - 1].x, y: ring[R - 1].y, z });
      if (i === 0) {
        for (let j = R - 1; j >= 0; j--) sternRing.push({ x: ring[j].x, y: ring[j].y, z });
        for (let j = 1; j < R; j++) sternRing.push({ x: -ring[j].x, y: ring[j].y, z });
      }
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
        push(p.x, p.y, p.z, p.v);
      }
      for (let j = 1; j < R; j++) {
        const p = ring[j];
        push(-p.x, p.y, p.z, p.v);
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
    push(0, stemY, stemZ, 0.55);
    const bowRing = (S - 1) * P;
    for (let k = 0; k < P - 1; k++) indices.push(stemIndex, bowRing + k, bowRing + k + 1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(harborOrientShell(positions, indices));
    harborFinishGeo(geo);
    return { geo, sheerS, sheerP, wlS, wlP, sternRing };
  }

  // Stern is its own mesh so the front-row stencil does not share vertices
  // with the side planks (that interpolation would smear across atlas cells).
  function harborTransomMesh(spec, ring) {
    const positions = [];
    const uvs = [];
    const indices = [];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      sx += p.x;
      sy += p.y;
      sz += p.z;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const n = ring.length;
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const push = (p) => {
      positions.push(p.x, p.y, p.z);
      const at = harborAtlasUV(
        spec.atlasCol,
        CRATE_FACE_ROW.front,
        (p.x - minX) / spanX,
        (p.y - minY) / spanY,
      );
      uvs.push(at[0], at[1]);
    };
    push({ x: sx / n, y: sy / n, z: sz / n - 0.012 });
    for (let i = 0; i < n; i++) push(ring[i]);
    for (let k = 0; k < n; k++) indices.push(0, k + 1, ((k + 1) % n) + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(harborOrientShell(positions, indices));
    harborFinishGeo(geo);
    const mesh = new THREE.Mesh(geo, harborFitWear);
    mesh.name = 'transom';
    mesh.renderOrder = 2;
    return mesh;
  }

  // Clones of the quay crate material. UVs pick the column; maps arrive
  // asynchronously and syncHarborBoatWear copies them onto every clone.
  // Polygon offset stays off the shared crateWearMat.
  const harborBoatWear = [];
  function harborWearClone(side, factor) {
    const mat = crateWearMat.clone();
    mat.vertexColors = false;
    mat.side = side;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = factor;
    mat.polygonOffsetUnits = -2;
    harborBoatWear.push(mat);
    return mat;
  }
  const harborHullWear = harborWearClone(THREE.FrontSide, -1.5);
  const harborDeckWear = harborWearClone(THREE.DoubleSide, -2);
  const harborFitWear = harborWearClone(THREE.DoubleSide, -2);
  harborInstallRepeat(harborHullWear);
  harborInstallRepeat(harborDeckWear);
  function syncHarborBoatWear() {
    for (let i = 0; i < harborBoatWear.length; i++) {
      const mat = harborBoatWear[i];
      mat.map = crateWearMat.map;
      mat.emissiveMap = crateWearMat.emissiveMap;
      mat.normalMap = crateWearMat.normalMap;
      if (crateWearMat.normalMap) mat.normalScale.copy(crateWearMat.normalScale);
      mat.roughnessMap = crateWearMat.roughnessMap;
      mat.roughness = crateWearMat.roughness;
      mat.metalness = crateWearMat.metalness;
      mat.color.copy(crateWearMat.color);
      mat.emissive.copy(crateWearMat.emissive);
      mat.emissiveIntensity = crateWearMat.emissiveIntensity;
      mat.needsUpdate = true;
    }
  }
  live.syncBoatWear = syncHarborBoatWear;
  syncHarborBoatWear();
  const HARBOR_DECK_Y = 0.052;
  const harborIronMat = new THREE.MeshStandardMaterial({
    color: 0x2c3138, roughness: 0.42, metalness: 0.64,
  });
  // Three-strand laid dock line. One tile is a turn of the lay; the tube
  // repeats it along arc length so the braid stays the same size on every painter.
  function harborBraidMaps() {
    const w = 512;
    const h = 128;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const height = new Float32Array(w * h);
    const dyes = [
      [214, 176, 122],
      [156, 108, 64],
      [186, 142, 92],
    ];
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        let rr = 62;
        let gg = 44;
        let bb = 28;
        let weight = 0.22;
        let crest = 0;
        for (let s = 0; s < 3; s++) {
          let center = (s / 3 + u * 1.05) % 1;
          let dv = Math.abs(v - center);
          if (dv > 0.5) dv = 1 - dv;
          const ridge = Math.exp(-(dv * 6.4) * (dv * 6.4));
          const yarn = 0.8 + 0.2 * Math.sin((u * 34 + s * 1.7) * Math.PI * 2);
          const dye = dyes[s];
          const wgt = ridge * ridge;
          rr += dye[0] * wgt * yarn;
          gg += dye[1] * wgt * yarn;
          bb += dye[2] * wgt * yarn;
          weight += wgt;
          if (ridge > crest) crest = ridge;
        }
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const spec = (n - Math.floor(n) - 0.5) * 8;
        const o = (y * w + x) * 4;
        img.data[o] = Math.max(0, Math.min(255, rr / weight + spec));
        img.data[o + 1] = Math.max(0, Math.min(255, gg / weight + spec * 0.75));
        img.data[o + 2] = Math.max(0, Math.min(255, bb / weight + spec * 0.45));
        img.data[o + 3] = 255;
        height[y * w + x] = crest;
      }
    }
    ctx.putImageData(img, 0, 0);
    const color = new THREE.CanvasTexture(canvas);
    color.colorSpace = THREE.SRGBColorSpace;
    color.wrapS = THREE.RepeatWrapping;
    color.wrapT = THREE.RepeatWrapping;
    color.anisotropy = 8;
    color.needsUpdate = true;

    const ncanvas = document.createElement('canvas');
    ncanvas.width = w;
    ncanvas.height = h;
    const nctx = ncanvas.getContext('2d');
    const nimg = nctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const hl = height[y * w + x];
        const hr = height[y * w + ((x + 1) % w)];
        const hu = height[((y + 1) % h) * w + x];
        let nx = (hl - hr) * 3.2;
        let ny = (hl - hu) * 3.2;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        const o = (y * w + x) * 4;
        nimg.data[o] = (nx * 0.5 + 0.5) * 255;
        nimg.data[o + 1] = (ny * 0.5 + 0.5) * 255;
        nimg.data[o + 2] = (nz * 0.5 + 0.5) * 255;
        nimg.data[o + 3] = 255;
      }
    }
    nctx.putImageData(nimg, 0, 0);
    const normal = new THREE.CanvasTexture(ncanvas);
    normal.colorSpace = THREE.NoColorSpace;
    normal.wrapS = THREE.RepeatWrapping;
    normal.wrapT = THREE.RepeatWrapping;
    normal.needsUpdate = true;
    return { color, normal };
  }
  const harborBraid = harborBraidMaps();
  const harborRopeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: harborBraid.color,
    normalMap: harborBraid.normal,
    normalScale: new THREE.Vector2(1.05, 1.05),
    roughness: 0.94,
    metalness: 0.0,
    emissive: 0xffe4c4,
    emissiveMap: harborBraid.color,
    emissiveIntensity: 0.22,
  });
  const harborFenderMat = new THREE.MeshStandardMaterial({
    color: 0x16181c, roughness: 0.74, metalness: 0.06,
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
  // Painter gauge, metres. Every hull on this berth is under 14 ft LOA
  // (pram 1.32, tender 1.58, skiff 2.15, scow 2.60, launch 3.50, dory 4.15).
  // West Marine, Orion Cordage, Anchoring.com, and Better Boat all chart
  // boats through 20–27 ft at 3/8 in (9.5 mm), and call 3/8 in the minimum
  // even when the 1/8-in-per-9-ft rule would go thinner. RHADC Bermuda
  // splits the same way: 3/8 in through 17 ft. One size for the fleet.
  const HARBOR_ROPE_D = 0.009525;
  const HARBOR_ROPE_R = HARBOR_ROPE_D * 0.5;
  // One turn of a three-strand lay is a handful of diameters, not a long smear.
  const HARBOR_ROPE_LAY = HARBOR_ROPE_D * 7.5;
  const HARBOR_ROPE_RINGS = 26;
  const HARBOR_ROPE_RADIAL = 9;
  // Paid-out tail past the straight berth span. A settled hull hangs this
  // as a catenary; a wave that opens the span past it snatches the line taut.
  const HARBOR_ROPE_SLACK = 0.006;

  function harborMakeRope() {
    const rings = HARBOR_ROPE_RINGS;
    const radial = HARBOR_ROPE_RADIAL;
    const positions = new Float32Array(rings * radial * 3);
    const uvs = new Float32Array(rings * radial * 2);
    const indices = [];
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const j2 = (j + 1) % radial;
        const a = i * radial + j;
        const b = i * radial + j2;
        const c = (i + 1) * radial + j2;
        const d = (i + 1) * radial + j;
        indices.push(a, d, b, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    const mesh = new THREE.Mesh(geo, harborRopeMat);
    mesh.name = 'painter';
    mesh.frustumCulled = false;
    harborCraftRoot.add(mesh);
    return {
      mesh,
      positions,
      uvs,
      rings,
      radial,
      pts: Array.from({ length: rings }, () => new THREE.Vector3()),
      rest: 0,
      lastD: 0,
      lastSag: 0,
      lastTaut: false,
    };
  }
  // Coping horn, same station as the BatchedMesh cleats (batch.js).
  const QUAY_CLEAT_Y = faceTop + 0.1 + 0.09;
  const QUAY_CLEAT_Z = SEAWALL_Z + 0.04;
  const QUAY_CLEATS = [];
  for (let i = 0; i < 13; i++) QUAY_CLEATS.push(-9.6 + i * 1.6);
  const quayCleatUsed = new Set();

  function harborNamePlate(col, w, h) {
    const geo = harborStampCell(new THREE.PlaneGeometry(w, h), col, CRATE_FACE_ROW.front);
    const plate = new THREE.Mesh(geo, harborFitWear);
    plate.name = 'mark-plate';
    return plate;
  }

  function harborTakeCleat(x) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < QUAY_CLEATS.length; i++) {
      if (quayCleatUsed.has(i)) continue;
      const d = Math.abs(QUAY_CLEATS[i] - x);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    quayCleatUsed.add(bestI);
    return new THREE.Vector3(QUAY_CLEATS[bestI], QUAY_CLEAT_Y, QUAY_CLEAT_Z);
  }

  // Closed sole on the sheer planform, plus a coaming up to the rail.
  // The sole meets the stem and the transom. Water inside that outline is
  // discarded in the basin shader, so a crest cannot draw over the sole.
  function harborSeal(spec, sheerS, sheerP) {
    const group = new THREE.Group();
    const positions = [];
    const uvs = [];
    const indices = [];
    const n = sheerS.length;
    const deckY = HARBOR_DECK_Y;
    const col = spec.atlasCol;
    const lid = CRATE_FACE_ROW.lid;
    const push = (x, y, z) => {
      positions.push(x, y, z);
      const at = harborPackedUV(
        col,
        lid,
        (x + spec.beam * 0.5) / HARBOR_PLANK,
        (z + spec.length * 0.5) / HARBOR_PLANK,
      );
      uvs.push(at[0], at[1]);
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
      const pRim = rim[ring.length - 1 - i];
      const sRim = rim[i];
      port.push(push(pRim.x, deckY, pRim.z));
      stbd.push(push(sRim.x, deckY, sRim.z));
    }
    const stemRim = rim[n];
    const stem = push(stemRim.x, deckY, stemRim.z);
    for (let i = 0; i < n - 1; i++) {
      indices.push(port[i], stbd[i], stbd[i + 1], port[i], stbd[i + 1], port[i + 1]);
    }
    indices.push(port[n - 1], stbd[n - 1], stem);
    const gBot = [];
    const gTop = [];
    for (let i = 0; i < rim.length; i++) {
      const p = rim[i];
      const yTop = Math.max(p.y, deckY + 0.02);
      gBot.push(push(p.x, deckY, p.z));
      gTop.push(push(p.x, yTop, p.z));
    }
    for (let i = 0; i < rim.length; i++) {
      const j = (i + 1) % rim.length;
      indices.push(gBot[i], gBot[j], gTop[j], gBot[i], gTop[j], gTop[i]);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    harborFinishGeo(geo);
    const sole = new THREE.Mesh(geo, harborDeckWear);
    sole.renderOrder = 2;
    sole.frustumCulled = false;
    sole.name = 'hull-seal';
    group.add(sole);
    return group;
  }

  // Parabola is the dock-line catenary for this span. Sag is zero when the
  // hull has pulled the ends out to the paid-out length, and grows with the
  // spare line when the boat settles back toward the cleat.
  function harborLayPainter(painter, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const dist = Math.max(Math.hypot(dx, dy, dz), 1e-4);
    if (painter.rest <= 0) painter.rest = dist + HARBOR_ROPE_SLACK;
    const excess = Math.max(0, painter.rest - dist);
    const horiz = Math.max(Math.hypot(dx, dz), 1e-4);
    // Spare line hangs below the chord. The berth only opens the span by a
    // few centimetres, so the belly is sized to read, then clamped so it
    // stays a curve across the water and never a vertical drop.
    const sag = Math.min(Math.sqrt(excess * dist * 1.35), horiz * 0.36);
    const rings = painter.rings;
    const pts = painter.pts;
    for (let i = 0; i < rings; i++) {
      const t = i / (rings - 1);
      pts[i].set(
        a.x + dx * t,
        a.y + dy * t - sag * 4 * t * (1 - t),
        a.z + dz * t,
      );
    }
    painter.lastD = dist;
    painter.lastSag = sag;
    painter.lastTaut = sag < 0.04;

    const radial = painter.radial;
    const pos = painter.positions;
    const uv = painter.uvs;
    const radius = HARBOR_ROPE_R;
    let tx = pts[1].x - pts[0].x;
    let ty = pts[1].y - pts[0].y;
    let tz = pts[1].z - pts[0].z;
    let tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    let bx = -tz;
    let by = 0;
    let bz = tx;
    let bl = Math.hypot(bx, bz) || 1;
    bx /= bl; bz /= bl;
    let nx = by * tz - bz * ty;
    let ny = bz * tx - bx * tz;
    let nz = bx * ty - by * tx;
    let arc = 0;
    for (let i = 0; i < rings; i++) {
      if (i > 0) {
        const i0 = i - 1;
        const i1 = Math.min(i + 1, rings - 1);
        tx = pts[i1].x - pts[i0].x;
        ty = pts[i1].y - pts[i0].y;
        tz = pts[i1].z - pts[i0].z;
        tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        const dot = bx * tx + by * ty + bz * tz;
        bx -= tx * dot;
        by -= ty * dot;
        bz -= tz * dot;
        bl = Math.hypot(bx, by, bz) || 1;
        bx /= bl; by /= bl; bz /= bl;
        nx = by * tz - bz * ty;
        ny = bz * tx - bx * tz;
        nz = bx * ty - by * tx;
        arc += pts[i].distanceTo(pts[i - 1]);
      }
      for (let j = 0; j < radial; j++) {
        const ang = (j / radial) * Math.PI * 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const o = (i * radial + j) * 3;
        pos[o] = pts[i].x + (nx * c + bx * s) * radius;
        pos[o + 1] = pts[i].y + (ny * c + by * s) * radius;
        pos[o + 2] = pts[i].z + (nz * c + bz * s) * radius;
        const uo = (i * radial + j) * 2;
        uv[uo] = arc / HARBOR_ROPE_LAY;
        uv[uo + 1] = j / radial;
      }
    }
    const geo = painter.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
    geo.computeVertexNormals();
  }

  function harborAddBoat(spec) {
    const group = new THREE.Group();
    group.name = spec.id;
    const hull = harborHull(spec);
    const shell = new THREE.Mesh(hull.geo, harborHullWear);
    shell.castShadow = false;
    shell.renderOrder = 1;
    shell.name = 'hull-shell';
    group.add(shell);
    group.add(harborTransomMesh(spec, hull.sternRing));
    group.add(harborSeal(spec, hull.sheerS, hull.sheerP));

    const deckY = HARBOR_DECK_Y;
    const openBoat = spec.kind === 'skiff' || spec.kind === 'tender' || spec.kind === 'pram' || spec.kind === 'dory';
    if (openBoat) {
      const seatW = spec.beam * (spec.kind === 'dory' ? 0.7 : 0.62);
      const seats = spec.kind === 'skiff' ? [-0.28, 0.38]
        : spec.kind === 'dory' ? [-0.62, -0.08, 0.42]
          : spec.kind === 'pram' ? [0.02]
            : [0.05];
      for (const z of seats) {
        const seatD = spec.kind === 'dory' ? 0.055 : 0.07;
        const seatGeo = new THREE.BoxGeometry(seatW, 0.028, seatD);
        stampHarborCrateUVs(seatGeo, spec.atlasCol, seatW, 0.028, seatD);
        const seat = new THREE.Mesh(seatGeo, harborFitWear);
        seat.position.set(0, deckY + 0.06, z * (spec.length / 2.2));
        group.add(seat);
      }
      const oarCount = spec.kind === 'dory' ? 2 : 1;
      for (let i = 0; i < oarCount; i++) {
        const oarGeo = new THREE.CylinderGeometry(0.012, 0.01, spec.length * (spec.kind === 'dory' ? 0.55 : 0.72), 5);
        harborStampCell(oarGeo, spec.atlasCol, CRATE_FACE_ROW.side);
        const oar = new THREE.Mesh(oarGeo, harborFitWear);
        oar.rotation.z = Math.PI / 2;
        oar.rotation.y = 0.35 + i * 0.5;
        oar.position.set(spec.beam * (0.08 + i * 0.08), spec.freeboard * 0.72, -0.08 + i * 0.22);
        group.add(oar);
      }
      const bladeGeo = new THREE.BoxGeometry(0.05, 0.012, 0.16);
      stampHarborCrateUVs(bladeGeo, spec.atlasCol, 0.05, 0.012, 0.16);
      const blade = new THREE.Mesh(bladeGeo, harborFitWear);
      blade.position.set(spec.beam * 0.42, spec.freeboard * 0.7, spec.length * 0.22);
      group.add(blade);
    }

    if (spec.kind === 'scow') {
      const wellSx = spec.beam * 0.5;
      const wellSy = 0.24;
      const wellSz = spec.length * 0.32;
      const wellGeo = new THREE.BoxGeometry(wellSx, wellSy, wellSz);
      // Cargo is a quay crate (ochre column) sitting in an HARBOR hull.
      stampHarborCrateUVs(wellGeo, 2, wellSx, wellSy, wellSz);
      const well = new THREE.Mesh(wellGeo, harborFitWear);
      well.name = 'scow-crate';
      well.position.set(0, deckY + wellSy * 0.5 + 0.02, -spec.length * 0.02);
      group.add(well);
      const coamSx = spec.beam * 0.78;
      const coamSy = 0.06;
      const coamSz = spec.length * 0.55;
      const coamGeo = new THREE.BoxGeometry(coamSx, coamSy, coamSz);
      stampHarborCrateUVs(coamGeo, spec.atlasCol, coamSx, coamSy, coamSz);
      const coam = new THREE.Mesh(coamGeo, harborFitWear);
      coam.position.set(0, deckY + 0.05, 0.02);
      group.add(coam);
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
      const cabGeo = new THREE.BoxGeometry(cabW, cabH, cabL);
      stampHarborCrateUVs(cabGeo, spec.atlasCol, cabW, cabH, cabL);
      const cab = new THREE.Mesh(cabGeo, harborFitWear);
      cab.position.set(0, deckY + cabH * 0.5, -spec.length * 0.06);
      group.add(cab);
      const roofW = cabW + 0.06;
      const roofH = 0.028;
      const roofL = cabL + 0.08;
      const roofGeo = new THREE.BoxGeometry(roofW, roofH, roofL);
      stampHarborCrateUVs(roofGeo, spec.atlasCol, roofW, roofH, roofL);
      const roof = new THREE.Mesh(roofGeo, harborFitWear);
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
      const mastGeo = new THREE.CylinderGeometry(0.016, 0.022, 1.15, 6);
      harborStampCell(mastGeo, spec.atlasCol, CRATE_FACE_ROW.side);
      const mast = new THREE.Mesh(mastGeo, harborFitWear);
      mast.position.set(0, deckY + 0.58, spec.length * 0.2);
      group.add(mast);
      const boomGeo = new THREE.CylinderGeometry(0.012, 0.012, spec.length * 0.28, 5);
      harborStampCell(boomGeo, spec.atlasCol, CRATE_FACE_ROW.side);
      const boom = new THREE.Mesh(boomGeo, harborFitWear);
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
      const h = Math.max(0.24, spec.freeboard * 1.15);
      const w = h * 1.15;
      const mid = hull.sheerS[8];
      for (const sign of [1, -1]) {
        const plate = harborNamePlate(spec.atlasCol, w, h);
        plate.position.set(sign * (Math.abs(mid.x) + 0.015), spec.freeboard * 0.62, mid.z * 0.2);
        plate.rotation.y = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(plate);
      }
    }

    // Alongside mooring: bow and stern painters to coping cleats.
    // The quayward gunwale is local ±X, never a pile in the basin.
    const quaySign = Math.sin(spec.yaw) >= 0 ? 1 : -1;
    const gunnelX = quaySign * spec.beam * 0.46;
    const gunnelY = spec.freeboard * 0.55;
    const painters = [-0.42, 0.4].map((along) => {
      const local = new THREE.Vector3(gunnelX, gunnelY, spec.length * along);
      const worldX = spec.x + Math.sin(spec.yaw) * local.z + Math.cos(spec.yaw) * local.x;
      const rope = harborMakeRope();
      return { local, cleat: harborTakeCleat(worldX), rope };
    });

    group.position.set(spec.x, WATER_Y, spec.z);
    group.rotation.y = spec.yaw;
    harborCraftRoot.add(group);
    return {
      spec, group, painters,
      phase: spec.x * 0.37 + spec.z * 0.11,
    };
  }

  // Alongside, a couple of metres off the coping, so the painter runs
  // across the water to the cleat instead of standing up like a pile.
  const berthZ = (beam) => 8.05 + beam * 0.5;
  const HARBOR_BOAT_DEFS = [
    {
      id: 'west-pram', kind: 'pram', mark: 'HARBOR', atlasCol: 4,
      x: -8.7, z: berthZ(0.68), yaw: Math.PI / 2,
      length: 1.32, beam: 0.68, draft: 0.08, freeboard: 0.11,
      bilge: 0.34, transom: 0.92, bowRise: 0.06, bowPow: 0.38,
      color: 0x3d4a46, stripe: 0xd2c6ae, clear: 1.15,
    },
    {
      id: 'quay-skiff', kind: 'skiff', mark: 'QUAY', atlasCol: 2,
      x: -5.85, z: berthZ(0.78), yaw: -Math.PI / 2,
      length: 2.15, beam: 0.78, draft: 0.13, freeboard: 0.16,
      bilge: 0.5, transom: 0.8, bowRise: 0.26, bowPow: 0.8,
      color: 0x1c2a24, stripe: 0xcbbfa6, clear: 1.55,
    },
    {
      id: 'basin-tender', kind: 'tender', mark: 'FENESTRA', atlasCol: 3,
      x: -3.2, z: berthZ(0.6), yaw: Math.PI / 2,
      length: 1.58, beam: 0.6, draft: 0.09, freeboard: 0.12,
      bilge: 0.44, transom: 0.72, bowRise: 0.18, bowPow: 0.7,
      color: 0x5c4332, stripe: 0xd5c6aa, clear: 1.25,
    },
    {
      id: 'signal-dory', kind: 'dory', mark: 'SIGNAL', atlasCol: 1,
      x: 0.45, z: berthZ(0.64), yaw: -Math.PI / 2,
      length: 4.15, beam: 0.64, draft: 0.12, freeboard: 0.18,
      bilge: 0.95, transom: 0.38, bowRise: 0.62, bowPow: 1.45,
      color: 0x243028, stripe: 0xc4b48a, clear: 2.35,
    },
    {
      id: 'harbor-launch', kind: 'launch', mark: 'HARBOR', atlasCol: 0, cabin: true,
      x: 4.85, z: berthZ(1.12), yaw: Math.PI / 2,
      length: 3.5, beam: 1.12, draft: 0.22, freeboard: 0.2,
      bilge: 0.64, transom: 0.68, bowRise: 0.4, bowPow: 0.85,
      color: 0x151a22, stripe: 0x7a3030, clear: 2.15,
    },
    {
      id: 'harbor-scow', kind: 'scow', mark: 'HARBOR', atlasCol: 0,
      x: 8.55, z: berthZ(1.42), yaw: -Math.PI / 2,
      length: 2.6, beam: 1.42, draft: 0.18, freeboard: 0.15,
      bilge: 0.2, transom: 0.98, bowRise: 0.05, bowPow: 0.28,
      color: 0x2a2420, stripe: 0x8d7348, clear: 1.85,
    },
  ];

  const harborBoats = HARBOR_BOAT_DEFS.map(harborAddBoat);

  function harborFishGeometry() {
    const positions = [];
    const colors = [];
    const uvs = [];
    const indices = [];
    const paper = new THREE.Color(0xffffff);
    const shade = new THREE.Color(0xd5dbe2);
    const bodySeg = 16;
    const radial = 10;
    const fishUv = (x, z) => {
      // Top-down into one atlas row. u stays under 0.90 so the HARBOR margin is not sampled.
      const u = THREE.MathUtils.clamp(0.46 + x / 0.24, 0.04, 0.90);
      const v = THREE.MathUtils.clamp((z + 0.82) / 1.56, 0.04, 0.96);
      uvs.push(u, v);
    };
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
        fishUv(x, z);
        const up = y / Math.max(ry, 1e-4);
        const col = paper.clone().lerp(shade, up > 0.2 ? 0.0 : 0.22);
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
    fishUv(0, 0.66);
    colors.push(paper.r, paper.g, paper.b);
    const noseRing = bodySeg * radial;
    for (let j = 0; j < radial; j++) {
      indices.push(tip, noseRing + j, noseRing + ((j + 1) % radial));
    }
    const pushVert = (x, y, z, col) => {
      positions.push(x, y, z);
      fishUv(x, z);
      colors.push(col.r, col.g, col.b);
    };
    const pushTri = (a, b, c, col) => {
      const base = positions.length / 3;
      for (const p of [a, b, c]) pushVert(p[0], p[1], p[2], col);
      indices.push(base, base + 1, base + 2);
    };
    // Horizontal caudal fork — readable from above, not an edge-on vertical fin.
    pushTri([0.0, 0.012, -0.36], [0.11, 0.01, -0.78], [0.0, 0.012, -0.52], paper);
    pushTri([0.0, 0.012, -0.36], [-0.11, 0.01, -0.78], [0.0, 0.012, -0.52], paper);
    pushTri([0.0, 0.006, -0.36], [0.11, 0.004, -0.78], [0.0, 0.006, -0.52], paper);
    pushTri([0.0, 0.006, -0.36], [-0.11, 0.004, -0.78], [0.0, 0.006, -0.52], paper);
    // Low dorsal: a dark ridge with a little thickness so the top-down outline holds.
    pushTri([-0.012, 0.05, -0.02], [0.012, 0.05, 0.16], [0.0, 0.15, 0.05], shade);
    pushTri([-0.012, 0.045, -0.02], [0.0, 0.14, 0.05], [0.012, 0.045, 0.16], shade);
    // Pectoral flashes, held out flat.
    pushTri([0.05, 0.0, 0.08], [0.2, -0.008, 0.0], [0.16, 0.008, 0.12], paper);
    pushTri([-0.05, 0.0, 0.08], [-0.2, -0.008, 0.0], [-0.16, 0.008, 0.12], paper);
    // Eyes, so the head has a facing.
    const eye = new THREE.Color(0x14181c);
    pushTri([0.028, 0.012, 0.4], [0.04, 0.02, 0.43], [0.03, 0.008, 0.45], eye);
    pushTri([-0.028, 0.012, 0.4], [-0.04, 0.02, 0.43], [-0.03, 0.008, 0.45], eye);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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
        scale: def.scale * (0.92 + (i % 3) * 0.05),
        depth: (def.depth || 0.04) + (i % 3) * 0.012,
        skin: ((def.skin0 || 0) + i) % 4,
        nose: def.nose || 0,
      });
    }
    return out;
  }

  const harborFishPaths = [
    // One loose school in the deeper basin, clear of the quay berths.
    ...harborRibbon({
      cx: -1.6, cz: 18.4, rx: 2.15, rz: 0.82, speed: 0.16,
      phase: 0.5, count: 4, spread: 0.62, lag: 0.7, scale: 0.92,
      depth: 0.016, skin0: 0,
    }),
    // A second, smaller school farther out and a little deeper.
    ...harborRibbon({
      cx: 5.2, cz: 23.2, rx: 1.65, rz: 0.95, speed: 0.11,
      phase: 1.9, count: 3, spread: 0.7, lag: 0.85, scale: 1.05,
      depth: 0.024, skin0: 2, nose: -0.04,
    }),
  ];
  const harborFishGeo = harborFishGeometry();
  const harborFishPhases = new Float32Array(harborFishPaths.length);
  const harborFishSkins = new Float32Array(harborFishPaths.length);
  harborFishPaths.forEach((f, i) => {
    harborFishPhases[i] = f.phase + f.lag * 2.6 + f.lat;
    harborFishSkins[i] = f.skin;
  });
  harborFishGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(harborFishPhases, 1));
  harborFishGeo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(harborFishSkins, 1));

  const fishPlaceholder = new THREE.DataTexture(new Uint8Array([176, 186, 196, 255]), 1, 1);
  fishPlaceholder.colorSpace = THREE.SRGBColorSpace;
  fishPlaceholder.needsUpdate = true;
  const harborFishMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: fishPlaceholder,
    roughness: 0.58,
    metalness: 0.16,
    emissive: 0x1a2834,
    emissiveIntensity: 0.28,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  harborFishMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = harborFishTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nattribute float aPhase;\nattribute float aSkin;\n'
      )
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.y = (vMapUv.y + aSkin) * 0.25;\n#endif\n'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'float along = transformed.z;\n' +
        'float tail = smoothstep(0.12, -0.7, along);\n' +
        'float wag = sin(uTime * 3.2 + aPhase - along * 7.0) * (0.008 + 0.14 * tail);\n' +
        'transformed.x += wag;\n' +
        'transformed.y += -0.03 * smoothstep(-0.05, 0.5, along);\n' +
        'transformed.y += -0.035 * smoothstep(0.0, -0.45, along);\n'
      );
    harborFishMat.userData.shader = shader;
  };
  harborFishMat.customProgramCacheKey = () => 'harbor-fish-atlas-v1';

  const harborFishMesh = new THREE.InstancedMesh(harborFishGeo, harborFishMat, harborFishPaths.length);
  harborFishMesh.name = 'harbor-fish';
  harborFishMesh.frustumCulled = false;
  harborFishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const harborFishTint = new THREE.Color(0xffffff);
  harborFishPaths.forEach((f, i) => {
    harborFishMesh.setColorAt(i, harborFishTint);
  });
  if (harborFishMesh.instanceColor) harborFishMesh.instanceColor.needsUpdate = true;
  harborCraftRoot.add(harborFishMesh);
  if (atlasLoader && atlasBase) {
    atlasLoader.load(new URL('fish-atlas.png?craft=2', atlasBase).href, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      harborFishMat.map = tex;
      harborFishMat.needsUpdate = true;
      if (window.__harborCraft) window.__harborCraft.fishAtlas = tex.image ? tex.image.width : 1;
    });
  }

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
    waterMat.uniforms.uHull0, waterMat.uniforms.uHull1, waterMat.uniforms.uHull2,
    waterMat.uniforms.uHull3, waterMat.uniforms.uHull4, waterMat.uniforms.uHull5,
  ];
  const harborHullExtU = [
    waterMat.uniforms.uHullExt0, waterMat.uniforms.uHullExt1, waterMat.uniforms.uHullExt2,
    waterMat.uniforms.uHullExt3, waterMat.uniforms.uHullExt4, waterMat.uniforms.uHullExt5,
  ];
  const harborHullBowU = [
    waterMat.uniforms.uBow0, waterMat.uniforms.uBow1, waterMat.uniforms.uBow2,
    waterMat.uniforms.uBow3, waterMat.uniforms.uBow4, waterMat.uniforms.uBow5,
  ];

  function harborPoseCraft() {
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
        harborHullBowU[i].value = spec.bowPow == null ? 0.8 : spec.bowPow;
      }
      for (let p = 0; p < boat.painters.length; p++) {
        const painter = boat.painters[p];
        harborA.copy(painter.local).applyMatrix4(boat.group.matrixWorld);
        harborB.copy(painter.cleat);
        harborLayPainter(painter.rope, harborA, harborB);
      }
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
      // Fewer schools, farther out. High enough that the back and atlas read above the sheet.
      const y = harborWaveY(x, z, t) + 0.07 - f.depth * 0.25 + Math.sin(t * 0.55 + f.phase) * 0.004;
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
    schools: 2,
    waterPosts: 0,
    moor: 'quay-coping',
    rope: 'braid',
    finish: 'quay-crate-atlas',
    marks: harborBoats.map((b) => b.spec.mark),
    waveY: (x, z) => harborWaveY(x, z, harborFishTime.value),
    fishNow() {
      const t = harborFishTime.value;
      return harborFishPaths.map((f) => {
        const p = harborClearCraft(harborFishAt(f, t).x, harborFishAt(f, t).z);
        return {
          x: +p.x.toFixed(2),
          z: +p.z.toFixed(2),
          y: +(harborWaveY(p.x, p.z, t) + 0.07 - f.depth * 0.25).toFixed(3),
          skin: f.skin,
        };
      });
    },
    pose() {
      return harborBoats.map((b) => {
        b.group.updateWorldMatrix(true, false);
        b.group.getWorldPosition(harborBoatWorld);
        const e = b.entry;
        return {
          id: b.spec.id,
          kind: b.spec.kind,
          mark: b.spec.mark,
          atlasCol: b.spec.atlasCol,
          x: +harborBoatWorld.x.toFixed(3),
          y: +harborBoatWorld.y.toFixed(3),
          z: +harborBoatWorld.z.toFixed(3),
          mass: e ? +e.mass.toFixed(1) : 0,
          floatable: !!(e && e.floatable),
          inBasin: !!(e && crateInBasinXZ(e.body.position)),
          cleats: b.painters.map((p) => {
            harborA.copy(p.local).applyMatrix4(b.group.matrixWorld);
            return {
              x: +p.cleat.x.toFixed(2),
              y: +p.cleat.y.toFixed(2),
              z: +p.cleat.z.toFixed(2),
              d: +p.rope.lastD.toFixed(3),
              rest: +p.rope.rest.toFixed(3),
              sag: +p.rope.lastSag.toFixed(3),
              taut: p.rope.lastTaut,
              from: {
                x: +harborA.x.toFixed(2),
                y: +harborA.y.toFixed(2),
                z: +harborA.z.toFixed(2),
              },
            };
          }),
        };
      });
    },
  };
  window.__frameHarborBasin = (mode) => {
    camera.up.set(0, 1, 0);
    camera.fov = ORBIT_FOV;
    const boatAt = (id) => {
      const b = harborBoats.find((boat) => boat.spec.id === id);
      b.group.updateWorldMatrix(true, false);
      b.group.getWorldPosition(harborBoatWorld);
      return harborBoatWorld;
    };
    const top = (id, dist) => {
      const p = boatAt(id);
      camera.position.set(p.x, dist, p.z + 0.04);
      controls.target.set(p.x, -0.12, p.z);
    };
    const beside = (id, zOff, y) => {
      const p = boatAt(id);
      camera.position.set(p.x + 0.15, y, p.z + zOff);
      controls.target.set(p.x, 0.05, p.z);
    };
    if (mode === 'launch') beside('harbor-launch', 3.4, 1.55);
    else if (mode === 'skiff') beside('quay-skiff', 3.1, 1.35);
    else if (mode === 'dory') beside('signal-dory', 3.6, 1.7);
    else if (mode === 'scow') beside('harbor-scow', 3.8, 1.85);
    else if (mode === 'pram') beside('west-pram', 2.6, 1.25);
    else if (mode === 'fish') {
      camera.position.set(-2.4, 2.6, 16.05);
      controls.target.set(-1.5, -0.32, 18.5);
    } else if (mode === 'fish-top') {
      camera.position.set(-1.5, 3.4, 18.46);
      controls.target.set(-1.5, -0.36, 18.35);
    } else if (mode === 'above' || mode === 'lineup') {
      camera.position.set(-0.6, 10.4, 19.2);
      controls.target.set(0.3, 0.0, 8.2);
    } else if (mode === 'moor') {
      // Along the berth, so painters read across the water to the coping.
      camera.position.set(-12.6, 2.6, 12.4);
      controls.target.set(-2.2, 0.2, 7.4);
    } else if (mode === 'painter') {
      // Close profile of the scow's quayward painter: cleat, belly, and hull.
      camera.position.set(10.35, 0.72, 6.72);
      controls.target.set(8.85, 0.22, 6.95);
    } else if (mode === 'skiff-top') top('quay-skiff', 4.6);
    else if (mode === 'launch-top') top('harbor-launch', 6.4);
    else if (mode === 'tender-top') top('basin-tender', 3.8);
    else if (mode === 'dory-top') top('signal-dory', 7.2);
    else if (mode === 'scow-top') top('harbor-scow', 5.4);
    else if (mode === 'match') {
      // Alongside the scow, looking quayward: hull planks and the east pile share the frame.
      camera.position.set(6.2, 1.85, 7.9);
      controls.target.set(8.5, 0.18, 7.4);
    } else if (mode === 'match-close') {
      // Quayward side of the scow, hull planks and the cargo crate.
      camera.position.set(8.55, 1.15, 6.15);
      controls.target.set(8.55, 0.16, 8.72);
    } else if (mode === 'match-west') {
      // QUAY skiff and worn HARBOR pram beside the west pile.
      camera.position.set(-4.4, 1.95, 2.3);
      controls.target.set(-7.1, 0.28, 7.2);
    } else if (mode === 'match-top') {
      camera.position.set(8.5, 5.4, 6.7);
      controls.target.set(8.48, 0.08, 6.55);
    } else if (mode === 'orbit') {
      camera.position.set(11.2, 4.6, 14.4);
      controls.target.set(0.4, 0.05, 7.2);
    } else {
      camera.position.set(10.4, 5.6, 18.2);
      controls.target.set(0.2, 0.0, 6.8);
    }
    camera.updateProjectionMatrix();
    controls.update();
  };
  if (params.has('frame')) window.__frameHarborBasin(params.get('frame'));

  return { update: updateHarborCraft };
}
