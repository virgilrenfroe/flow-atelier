import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { live } from './live.js';

// Basin / pier clutter. Heterogeneous cleats, rings, bitts, fenders, piles,
// barrels, and rope share four BatchedMesh material batches. Instanced
// bollards stay as they are. Called from main.js after physics exists.
export function installBasinClutter(deps) {
  const {
    renderer, scene, camera,
    faceTop, SEAWALL_Z, FURN_COUNT, bollards, harborMerge,
    ironMatStd, crateWearMat, ironWearMats, physWorld, physGroundMat,
    stampIronCell, IRON_CELL, stampHarborCrateUVs,
    CRATE_ATLAS_COLS, CRATE_ATLAS_ROWS, CRATE_FACE_ROW,
  } = deps;

  let basinTimberMat = null;
  function syncBasinBatchWear() {
    if (!basinTimberMat) return;
    basinTimberMat.map = crateWearMat.map;
    basinTimberMat.emissiveMap = crateWearMat.emissiveMap;
    basinTimberMat.normalMap = crateWearMat.normalMap;
    basinTimberMat.normalScale.copy(crateWearMat.normalScale);
    basinTimberMat.roughnessMap = crateWearMat.roughnessMap;
    basinTimberMat.roughness = crateWearMat.roughness;
    basinTimberMat.metalness = crateWearMat.metalness;
    basinTimberMat.color.copy(crateWearMat.color);
    basinTimberMat.emissive.copy(crateWearMat.emissive);
    basinTimberMat.emissiveIntensity = crateWearMat.emissiveIntensity;
    basinTimberMat.needsUpdate = true;
  }
  live.syncBasinBatchWear = syncBasinBatchWear;

  // ——— Basin / pier clutter · BatchedMesh (r170) ———
  // InstancedMesh already draws identical bollards, posts, and lanterns.
  // This set is heterogeneous on purpose: horn cleats, mooring rings, rope
  // bitts, two fender shapes, crate piles, barrels, and rope. One material
  // family shares one BatchedMesh, so different geometries do not each become
  // a draw. Visual only — not cannon bodies, not the free crates, not boats.
  // Quay iron / crate wear sheets are reused. Asphalt, sidewalk, curb, and
  // quayMat are not touched.
  const BASIN_DECK_Y = 0.04;
  const BASIN_CAP_TOP = faceTop + 0.1;
  const BASIN_CAP_Z = SEAWALL_Z + 0.04;
  const BASIN_FACE_Z = SEAWALL_Z + 0.11;
  const basinDummy = new THREE.Object3D();
  const basinCatalog = [];
  const basinHidePoints = [];
  let basinIronMat = null;
  const basinBatches = [];

  function basinCanvasTex(paint, wrap) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    paint(canvas.getContext('2d'), canvas.width);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    return tex;
  }

  function basinPaintRubber(g, n) {
    g.fillStyle = '#1a1d24';
    g.fillRect(0, 0, n, n);
    g.strokeStyle = '#3c414c';
    g.lineWidth = 3;
    for (let y = 10; y < n; y += 18) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(n, y + 4);
      g.stroke();
    }
    g.strokeStyle = 'rgba(8,8,10,0.85)';
    g.lineWidth = 2;
    g.strokeRect(6, 6, n - 12, n - 12);
    g.fillStyle = 'rgba(90,94,104,0.35)';
    g.beginPath();
    g.ellipse(40, 36, 16, 7, 0.4, 0, Math.PI * 2);
    g.fill();
  }

  function basinPaintRope(g, n) {
    g.fillStyle = '#5c4a36';
    g.fillRect(0, 0, n, n);
    g.strokeStyle = '#3a2e22';
    g.lineWidth = 5;
    for (let i = -2; i < 8; i++) {
      g.beginPath();
      g.moveTo(i * 22, 0);
      g.lineTo(i * 22 + 36, n);
      g.stroke();
    }
    g.strokeStyle = '#8a7054';
    g.lineWidth = 2;
    for (let i = -2; i < 8; i++) {
      g.beginPath();
      g.moveTo(i * 22 + 8, 0);
      g.lineTo(i * 22 + 44, n);
      g.stroke();
    }
  }

  function basinFinalize(geo) {
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (!geo.getAttribute('tangent')) geo.computeTangents();
    return geo;
  }

  function basinStampCell(geo, cols, rows, col, row) {
    const uv = geo.attributes.uv;
    const du = 1 / cols;
    const dv = 1 / rows;
    const inset = 0.02;
    for (let i = 0; i < uv.count; i++) {
      const u = inset + uv.getX(i) * (1 - inset * 2);
      const v = inset + uv.getY(i) * (1 - inset * 2);
      uv.setXY(i, col * du + u * du, (1 - (row + 1) * dv) + v * dv);
    }
    uv.needsUpdate = true;
    return geo;
  }

  function basinMakeCleat() {
    const sole = new THREE.BoxGeometry(0.26, 0.02, 0.08);
    sole.translate(0, 0.01, 0);
    const stem = new THREE.BoxGeometry(0.045, 0.055, 0.042);
    stem.translate(0, 0.046, 0);
    const horn = new THREE.CylinderGeometry(0.016, 0.02, 0.32, 8);
    horn.rotateZ(Math.PI / 2);
    horn.translate(0, 0.086, 0);
    const tipA = new THREE.SphereGeometry(0.022, 8, 6);
    tipA.translate(-0.15, 0.098, 0);
    const tipB = tipA.clone();
    tipB.translate(0.3, 0, 0);
    const geo = basinFinalize(harborMerge([sole, stem, horn, tipA, tipB], 'cleat'));
    stampIronCell(geo, IRON_CELL.bollard);
    return geo;
  }

  function basinMakeRing() {
    const plate = new THREE.BoxGeometry(0.05, 0.11, 0.018);
    plate.translate(0, 0, -0.02);
    const ring = new THREE.TorusGeometry(0.058, 0.012, 6, 14);
    const geo = basinFinalize(harborMerge([plate, ring], 'ring'));
    stampIronCell(geo, IRON_CELL.bollard);
    return geo;
  }

  function basinMakeBitt() {
    const flange = new THREE.CylinderGeometry(0.1, 0.11, 0.04, 10);
    flange.translate(0, 0.02, 0);
    const post = new THREE.CylinderGeometry(0.04, 0.05, 0.48, 8);
    post.translate(0, 0.28, 0);
    const pin = new THREE.CylinderGeometry(0.014, 0.014, 0.18, 6);
    pin.rotateZ(Math.PI / 2);
    pin.translate(0, 0.46, 0);
    const geo = basinFinalize(harborMerge([flange, post, pin], 'bitt'));
    stampIronCell(geo, IRON_CELL.bollard);
    return geo;
  }

  function basinMakeHoop() {
    const hoop = new THREE.TorusGeometry(0.122, 0.012, 6, 16);
    hoop.rotateX(Math.PI / 2);
    stampIronCell(hoop, IRON_CELL.arm);
    return basinFinalize(hoop);
  }

  function basinMakeSausage() {
    const body = new THREE.CylinderGeometry(0.11, 0.11, 0.58, 12);
    const capA = new THREE.SphereGeometry(0.11, 10, 8);
    capA.translate(0, 0.29, 0);
    const capB = new THREE.SphereGeometry(0.11, 10, 8);
    capB.translate(0, -0.29, 0);
    return basinFinalize(harborMerge([body, capA, capB], 'fender-sausage'));
  }

  function basinMakeBlock() {
    const slab = new THREE.BoxGeometry(0.26, 0.56, 0.14);
    const strap = new THREE.BoxGeometry(0.28, 0.04, 0.16);
    strap.translate(0, 0.18, 0);
    return basinFinalize(harborMerge([slab, strap], 'fender-block'));
  }

  function basinMakeCrate(sx, sy, sz, col) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    geo.translate(0, sy * 0.5, 0);
    stampHarborCrateUVs(geo, col, sx, sy, sz);
    return basinFinalize(geo);
  }

  function basinMakePallet() {
    const parts = [];
    for (let i = -1; i <= 1; i++) {
      const bearer = new THREE.BoxGeometry(0.46, 0.036, 0.045);
      bearer.translate(0, 0.018, i * 0.15);
      stampHarborCrateUVs(bearer, 4, 0.46, 0.036, 0.045);
      parts.push(bearer);
    }
    const deck = new THREE.BoxGeometry(0.52, 0.022, 0.4);
    deck.translate(0, 0.047, 0);
    stampHarborCrateUVs(deck, 4, 0.52, 0.022, 0.4);
    parts.push(deck);
    return basinFinalize(harborMerge(parts, 'pallet'));
  }

  function basinMakeBarrel() {
    const geo = new THREE.CylinderGeometry(0.115, 0.115, 0.3, 12);
    geo.translate(0, 0.15, 0);
    basinStampCell(geo, CRATE_ATLAS_COLS, CRATE_ATLAS_ROWS, 4, CRATE_FACE_ROW.side);
    return basinFinalize(geo);
  }

  function basinMakeCoil() {
    const outer = new THREE.TorusGeometry(0.1, 0.026, 6, 16);
    outer.rotateX(Math.PI / 2);
    const inner = new THREE.TorusGeometry(0.052, 0.02, 6, 12);
    inner.rotateX(Math.PI / 2);
    const geo = basinFinalize(harborMerge([outer, inner], 'coil'));
    geo.translate(0, 0.026, 0);
    return geo;
  }

  function basinMakeHank() {
    const geo = new THREE.TorusGeometry(0.05, 0.013, 6, 14);
    geo.rotateY(Math.PI / 2);
    geo.translate(0, -0.05, 0);
    return basinFinalize(geo);
  }

  function basinMatrix(x, y, z, ry, s) {
    basinDummy.position.set(x, y, z);
    basinDummy.rotation.set(0, ry || 0, 0);
    basinDummy.scale.setScalar(s == null ? 1 : s);
    basinDummy.updateMatrix();
    return basinDummy.matrix.clone();
  }

  function basinPut(kind, geo, materialName, material, x, y, z, ry, s, color) {
    basinCatalog.push({
      kind,
      geo,
      materialName,
      material,
      matrix: basinMatrix(x, y, z, ry, s),
      color: new THREE.Color(color),
    });
  }

  function basinPrepTex(tex) {
    if (!tex) return;
    tex.generateMipmaps = false;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
  }

  function basinMakeBatch(name, material, entries) {
    const geos = [];
    const geoSlot = new Map();
    let verts = 0;
    let indices = 0;
    for (let i = 0; i < entries.length; i++) {
      const geo = entries[i].geo;
      if (geoSlot.has(geo)) continue;
      geoSlot.set(geo, geos.length);
      geos.push(geo);
      verts += geo.getAttribute('position').count;
      indices += geo.getIndex().count;
    }
    const batch = new THREE.BatchedMesh(entries.length, verts, indices, material);
    batch.name = name;
    batch.frustumCulled = false;
    batch.perObjectFrustumCulled = true;
    batch.sortObjects = true;
    const geometryIds = geos.map((geo) => batch.addGeometry(geo));
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const id = batch.addInstance(geometryIds[geoSlot.get(entry.geo)]);
      batch.setMatrixAt(id, entry.matrix);
      batch.setColorAt(id, entry.color);
    }
    basinPrepTex(batch._matricesTexture);
    basinPrepTex(batch._indirectTexture);
    basinPrepTex(batch._colorsTexture);
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    const info = {
      name,
      mesh: batch,
      material: entries[0] ? entries[0].materialName : name,
      geometries: geos.length,
      instances: entries.length,
      vertices: verts,
      indices,
      kinds: [...new Set(entries.map((e) => e.kind))],
    };
    basinBatches.push(info);
    return batch;
  }

  function basinHideBollards(points) {
    const tmp = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (let i = 0; i < FURN_COUNT; i++) {
      bollards.getMatrixAt(i, tmp);
      pos.setFromMatrixPosition(tmp);
      for (let p = 0; p < points.length; p++) {
        const spot = points[p];
        const dx = pos.x - spot.x;
        const dz = pos.z - spot.z;
        if (dx * dx + dz * dz < spot.r * spot.r) {
          basinDummy.position.copy(pos);
          basinDummy.rotation.set(0, 0, 0);
          basinDummy.scale.set(0.001, 0.001, 0.001);
          basinDummy.updateMatrix();
          bollards.setMatrixAt(i, basinDummy.matrix);
          break;
        }
      }
    }
    bollards.instanceMatrix.needsUpdate = true;
  }

  function basinStaticBox(x, y, z, hx, hy, hz) {
    physWorld.addBody(new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: physGroundMat,
      shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
      position: new CANNON.Vec3(x, y, z),
    }));
  }

  function basinCountPass(draw) {
    renderer.setRenderTarget(null);
    renderer.info.autoReset = true;
    renderer.info.reset();
    draw();
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  }

  function basinMeasure() {
    const multiDraw = !!(renderer.extensions && renderer.extensions.has('WEBGL_multi_draw'));
    const meshes = basinBatches.map((b) => b.mesh);
    const cullState = meshes.map((mesh) => mesh.perObjectFrustumCulled);
    meshes.forEach((mesh) => {
      mesh.perObjectFrustumCulled = false;
      mesh._visibilityChanged = true;
    });

    function renderObjects(objects) {
      const iso = new THREE.Scene();
      const prev = objects.map((obj) => obj.parent);
      objects.forEach((obj) => iso.add(obj));
      const info = basinCountPass(() => renderer.render(iso, camera));
      objects.forEach((obj, i) => {
        if (prev[i]) prev[i].add(obj);
      });
      return info;
    }

    function buildNaive() {
      const group = new THREE.Group();
      group.name = 'basin-naive-baseline';
      for (let i = 0; i < basinCatalog.length; i++) {
        const item = basinCatalog[i];
        const mesh = new THREE.Mesh(item.geo, item.material);
        mesh.matrix.copy(item.matrix);
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      return group;
    }

    function buildInstanced() {
      const group = new THREE.Group();
      group.name = 'basin-instanced-baseline';
      const packs = new Map();
      for (let i = 0; i < basinCatalog.length; i++) {
        const item = basinCatalog[i];
        if (!packs.has(item.geo)) packs.set(item.geo, []);
        packs.get(item.geo).push(item);
      }
      packs.forEach((items, geo) => {
        const inst = new THREE.InstancedMesh(geo, items[0].material, items.length);
        inst.frustumCulled = false;
        for (let i = 0; i < items.length; i++) inst.setMatrixAt(i, items[i].matrix);
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
      });
      return group;
    }

    const naive = buildNaive();
    const instanced = buildInstanced();
    let result;
    try {
      const clutterBatched = renderObjects(meshes);
      const clutterNaive = basinCountPass(() => {
        const iso = new THREE.Scene();
        iso.add(naive);
        renderer.render(iso, camera);
      });
      const clutterInstanced = basinCountPass(() => {
        const iso = new THREE.Scene();
        iso.add(instanced);
        renderer.render(iso, camera);
      });
      const harborBatched = basinCountPass(() => renderer.render(scene, camera));
      meshes.forEach((mesh) => { mesh.visible = false; });
      scene.add(naive);
      const harborNaive = basinCountPass(() => renderer.render(scene, camera));
      scene.remove(naive);
      scene.add(instanced);
      const harborInstanced = basinCountPass(() => renderer.render(scene, camera));
      scene.remove(instanced);
      meshes.forEach((mesh) => { mesh.visible = true; });
      result = {
        multiDraw,
        note: multiDraw
          ? 'WEBGL_multi_draw collapses each BatchedMesh to one renderer.info call.'
          : 'This browser has no WEBGL_multi_draw. BatchedMesh falls back to one draw per instance, so renderer.info.calls does not drop. InstancedMesh-per-geometry is the lower call count here.',
        clutter: {
          batched: clutterBatched,
          naiveMeshes: clutterNaive,
          instancedPerGeometry: clutterInstanced,
        },
        harborColorPass: {
          batched: harborBatched,
          naiveMeshes: harborNaive,
          instancedPerGeometry: harborInstanced,
        },
      };
    } finally {
      if (naive.parent) naive.parent.remove(naive);
      if (instanced.parent) instanced.parent.remove(instanced);
      meshes.forEach((mesh, i) => {
        mesh.visible = true;
        mesh.perObjectFrustumCulled = cullState[i];
        mesh._visibilityChanged = true;
        scene.add(mesh);
      });
      renderer.setRenderTarget(null);
    }
    window.__harborBatch.measureResult = result;
    return result;
  }

  try {
    const ropeTex = basinCanvasTex(basinPaintRope, true);
    ropeTex.repeat.set(3, 8);
    const basinRopeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: ropeTex,
      roughness: 0.96,
      metalness: 0.02,
    });
    const basinRubberMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: basinCanvasTex(basinPaintRubber, false),
      roughness: 1,
      metalness: 0.04,
    });
    basinIronMat = ironMatStd.clone();
    basinIronMat.name = 'basin-iron';
    ironWearMats.push(basinIronMat);
    basinTimberMat = crateWearMat.clone();
    basinTimberMat.name = 'basin-timber';
    syncBasinBatchWear();

    const cleatGeo = basinMakeCleat();
    const ringGeo = basinMakeRing();
    const bittGeo = basinMakeBitt();
    const hoopGeo = basinMakeHoop();
    const sausageGeo = basinMakeSausage();
    const blockGeo = basinMakeBlock();
    const palletGeo = basinMakePallet();
    const crateHarborGeo = basinMakeCrate(0.3, 0.22, 0.26, 0);
    const crateQuayGeo = basinMakeCrate(0.24, 0.2, 0.22, 2);
    const barrelGeo = basinMakeBarrel();
    const coilGeo = basinMakeCoil();
    const hankGeo = basinMakeHank();

    const edgeX = [];
    for (let i = 0; i < 13; i++) edgeX.push(-9.6 + i * 1.6);
    edgeX.forEach((x, i) => {
      const yaw = (i % 2 === 0 ? -1 : 1) * 0.06;
      basinPut('cleat', cleatGeo, 'iron', basinIronMat, x, BASIN_CAP_TOP + 0.004, BASIN_CAP_Z, yaw, 1, 0xfff6ee);
      if (i % 2 === 0) {
        basinPut('ring', ringGeo, 'iron', basinIronMat, x + 0.08, 0.46, BASIN_FACE_Z + 0.078, 0, 1, 0xf4f1ea);
      }
    });
    const fenderX = [-8.8, -5.6, -2.4, 0.8, 4.0, 7.2];
    fenderX.forEach((x, i) => {
      const block = i % 2 === 1;
      basinPut(
        block ? 'fender-block' : 'fender-sausage',
        block ? blockGeo : sausageGeo,
        'rubber',
        basinRubberMat,
        x,
        0.42,
        BASIN_FACE_Z + 0.14,
        block ? 0.04 : 0,
        1,
        i % 3 === 0 ? 0xd8dbe2 : 0xffffff
      );
    });

    const piles = [
      { x: -7.15, z: 4.32, yaw: 0.14 },
      { x: 8.42, z: 4.28, yaw: -0.1 },
    ];
    const PALLET_TOP = 0.058;
    const pileCenters = [];
    piles.forEach((pile) => {
      pileCenters.push(pile);
      basinHidePoints.push({ x: pile.x, z: pile.z, r: 0.62 });
      basinPut('pallet', palletGeo, 'timber', basinTimberMat, pile.x, BASIN_DECK_Y, pile.z, pile.yaw, 1, 0xfff8f2);
      basinPut(
        'crate-harbor', crateHarborGeo, 'timber', basinTimberMat,
        pile.x - 0.02, BASIN_DECK_Y + PALLET_TOP, pile.z + 0.01, pile.yaw + 0.08, 1, 0xffffff
      );
      basinPut(
        'crate-quay', crateQuayGeo, 'timber', basinTimberMat,
        pile.x + 0.34, BASIN_DECK_Y, pile.z + 0.08, pile.yaw - 0.35, 1, 0xfff4e8
      );
      const barrelX = pile.x - 0.3;
      const barrelZ = pile.z + 0.16;
      basinPut('barrel', barrelGeo, 'timber', basinTimberMat, barrelX, BASIN_DECK_Y, barrelZ, pile.yaw, 1, 0xfff8f0);
      basinPut('hoop', hoopGeo, 'iron', basinIronMat, barrelX, BASIN_DECK_Y + 0.08, barrelZ, 0, 1, 0xffffff);
      basinPut('hoop', hoopGeo, 'iron', basinIronMat, barrelX, BASIN_DECK_Y + 0.22, barrelZ, 0, 1, 0xf0ebe4);
      basinPut(
        'coil', coilGeo, 'rope', basinRopeMat,
        pile.x + 0.02, BASIN_DECK_Y + PALLET_TOP + 0.22, pile.z + 0.02, pile.yaw, 1, 0xfff1e4
      );
      basinStaticBox(pile.x, BASIN_DECK_Y + 0.2, pile.z + 0.04, 0.46, 0.2, 0.28);
    });

    const bittSpots = [
      { x: -9.55, z: 4.78 },
      { x: -7.15, z: 4.86 },
      { x: -4.9, z: 4.8 },
      { x: 5.55, z: 4.8 },
      { x: 8.42, z: 4.86 },
      { x: 9.7, z: 4.76 },
    ];
    bittSpots.forEach((spot) => {
      basinHidePoints.push({ x: spot.x, z: spot.z, r: 0.36 });
      basinPut('bitt', bittGeo, 'iron', basinIronMat, spot.x, BASIN_DECK_Y, spot.z, 0.2, 1, 0xf7f2ea);
      basinPut('hank', hankGeo, 'rope', basinRopeMat, spot.x + 0.09, BASIN_DECK_Y + 0.46, spot.z, 0, 1, 0xfff6ee);
      basinPut('coil', coilGeo, 'rope', basinRopeMat, spot.x - 0.16, BASIN_DECK_Y, spot.z - 0.12, 0.4, 0.85, 0xf3e6d4);
      basinStaticBox(spot.x, BASIN_DECK_Y + 0.24, spot.z, 0.12, 0.24, 0.12);
    });

    const byMaterial = new Map();
    for (let i = 0; i < basinCatalog.length; i++) {
      const item = basinCatalog[i];
      if (!byMaterial.has(item.material)) byMaterial.set(item.material, []);
      byMaterial.get(item.material).push(item);
    }
    const batchNames = new Map([
      [basinIronMat, 'harbor-basin-iron'],
      [basinRubberMat, 'harbor-basin-rubber'],
      [basinTimberMat, 'harbor-basin-timber'],
      [basinRopeMat, 'harbor-basin-rope'],
    ]);
    byMaterial.forEach((entries, material) => {
      const mesh = basinMakeBatch(batchNames.get(material) || 'harbor-basin', material, entries);
      scene.add(mesh);
    });
    basinHideBollards(basinHidePoints);

    const kindCount = {};
    for (let i = 0; i < basinCatalog.length; i++) {
      const kind = basinCatalog[i].kind;
      kindCount[kind] = (kindCount[kind] || 0) + 1;
    }
    window.__harborBatch = {
      ok: true,
      api: 'THREE.BatchedMesh',
      revision: '0.170.0',
      visualOnly: true,
      physicsBodies: false,
      boats: false,
      kinds: kindCount,
      instances: basinCatalog.length,
      geometries: new Set(basinCatalog.map((item) => item.geo)).size,
      batches: basinBatches.map((b) => ({
        name: b.name,
        material: b.material,
        geometries: b.geometries,
        instances: b.instances,
        vertices: b.vertices,
        indices: b.indices,
        kinds: b.kinds,
      })),
      piles: pileCenters.map((p) => ({ x: p.x, z: p.z })),
      measure: basinMeasure,
      measureResult: null,
    };
  } catch (err) {
    console.error('Harbor BatchedMesh clutter failed', err);
    window.__harborBatch = { ok: false, error: String(err && err.stack || err) };
  }
}
