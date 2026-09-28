/**
 * I06 · Projected decals
 * Quay wear and freight marks via THREE.DecalGeometry (projector-box clip).
 * Additive meshes only — quay-crate / quay-iron atlases and street sheets stay put.
 * Marks: HARBOR / SIGNAL / QUAY / FENESTRA.
 */
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

const MARKS = ['HARBOR', 'SIGNAL', 'QUAY', 'FENESTRA'];

const INK = {
  gold: '#f0c24b',
  violet: '#c9bce8',
  paper: '#f2ebe0',
};

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function makeCanvasTexture(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  const paint = () => {
    g.clearRect(0, 0, 512, 512);
    draw(g);
  };
  paint();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  tex.userData.repaint = () => {
    paint();
    tex.needsUpdate = true;
  };
  return tex;
}

function spray(g, rnd, color, n, spread) {
  for (let i = 0; i < n; i++) {
    const x = 256 + (rnd() - 0.5) * spread;
    const y = 256 + (rnd() - 0.5) * spread * 0.72;
    const r = 1.2 + rnd() * 3.4;
    g.fillStyle = color;
    g.globalAlpha = 0.15 + rnd() * 0.45;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function drawMark(word, tone) {
  const ink = INK[tone] || INK.paper;
  return (g) => {
    const rnd = mulberry(word.length * 17 + tone.length * 3);
    g.fillStyle = 'rgba(6, 5, 8, 0.62)';
    roundRect(g, 36, 148, 440, 216, 18);
    g.fill();

    g.save();
    g.strokeStyle = ink;
    g.globalAlpha = 0.85;
    g.lineWidth = 6;
    g.setLineDash([16, 10]);
    roundRect(g, 52, 164, 408, 184, 10);
    g.stroke();
    g.restore();

    // Corner ticks — stencil registration, not a copied mark.
    g.strokeStyle = ink;
    g.lineWidth = 4;
    g.globalAlpha = 0.9;
    const ticks = [[48, 156], [464, 156], [48, 356], [464, 356]];
    for (let i = 0; i < ticks.length; i++) {
      const x = ticks[i][0];
      const y = ticks[i][1];
      const s = 18;
      g.beginPath();
      g.moveTo(x - s, y);
      g.lineTo(x + s, y);
      g.moveTo(x, y - s);
      g.lineTo(x, y + s);
      g.stroke();
    }

    const size = word.length >= 8 ? 58 : word.length >= 6 ? 72 : 96;
    g.globalAlpha = 1;
    g.fillStyle = ink;
    g.font = `700 ${size}px "Space Mono", ui-monospace, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(word, 256, 258);

    spray(g, rnd, ink, 48, 400);
  };
}

function drawRust(seed) {
  return (g) => {
    const rnd = mulberry(seed);
    const cores = ['#6b3018', '#a85a2e', '#c4783a', '#4a2414', '#8a7bb8'];
    for (let i = 0; i < 14; i++) {
      const x = 70 + rnd() * 370;
      const y = 80 + rnd() * 350;
      const r = 28 + rnd() * 90;
      const col = cores[i % cores.length];
      const grd = g.createRadialGradient(x, y, r * 0.08, x, y, r);
      grd.addColorStop(0, col);
      grd.addColorStop(0.55, col);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.28 + rnd() * 0.45;
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 0.35;
    g.strokeStyle = '#3a2014';
    g.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(40 + rnd() * 80, 60 + rnd() * 400);
      g.bezierCurveTo(180, 120 + rnd() * 280, 300, 80 + rnd() * 320, 460, 100 + rnd() * 300);
      g.stroke();
    }
    g.globalAlpha = 1;
  };
}

function drawScuff(seed) {
  return (g) => {
    const rnd = mulberry(seed);
    for (let i = 0; i < 9; i++) {
      const y = 40 + rnd() * 430;
      const pale = rnd() > 0.45;
      g.strokeStyle = pale ? 'rgba(232, 224, 208, 0.82)' : 'rgba(12, 10, 14, 0.78)';
      g.lineWidth = pale ? 2 + rnd() * 4 : 3 + rnd() * 7;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(16 + rnd() * 40, y);
      g.bezierCurveTo(
        140, y + (rnd() - 0.5) * 36,
        320, y + (rnd() - 0.5) * 28,
        490, y + (rnd() - 0.5) * 18
      );
      g.stroke();
    }
    g.globalAlpha = 0.35;
    g.fillStyle = '#f2ebe0';
    for (let i = 0; i < 18; i++) {
      g.fillRect(30 + rnd() * 450, 40 + rnd() * 430, 8 + rnd() * 22, 1.5);
    }
    g.globalAlpha = 1;
  };
}

function decalMaterial(map, emissiveHex, intensity) {
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.04,
    transparent: true,
    alphaTest: 0.04,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -12,
    polygonOffsetUnits: -12,
    emissive: new THREE.Color(emissiveHex),
    emissiveMap: map,
    emissiveIntensity: intensity,
  });
}

const RX = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const RY = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);

function eulerOf(q) {
  return new THREE.Euler().setFromQuaternion(q, 'XYZ');
}

/** Ground projector: local XY on the deck, local Z along world up. */
function groundEuler(yaw) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw || 0);
  q.multiply(RX(-Math.PI / 2));
  return eulerOf(q);
}

function meshEuler(mesh, extra) {
  const q = mesh.quaternion.clone();
  if (extra) q.multiply(extra);
  return eulerOf(q);
}

/**
 * DecalGeometry writes world-space vertices. Parenting to a moving crate
 * means baking that pose back into the mesh's local frame.
 */
function project(mesh, position, orientation, size, material, opts) {
  mesh.updateWorldMatrix(true, false);
  let geo;
  try {
    geo = new DecalGeometry(mesh, position, orientation, size);
  } catch (err) {
    console.warn('DecalGeometry failed', opts && opts.name, err);
    return null;
  }
  const attr = geo.getAttribute('position');
  if (!attr || attr.count < 3) {
    geo.dispose();
    return null;
  }
  const parentToMesh = !!(opts && opts.parentToMesh);
  if (parentToMesh) geo.applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert());
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const decal = new THREE.Mesh(geo, material);
  decal.name = (opts && opts.name) || 'projected-decal';
  decal.renderOrder = 4;
  decal.userData.decal = {
    target: (opts && opts.target) || mesh.name || 'mesh',
    mark: (opts && opts.mark) || '',
    vertices: attr.count,
  };
  // Crate grabs raycast the body mesh only. A child decal must not steal hits.
  decal.raycast = () => {};
  if (parentToMesh) mesh.add(decal);
  return decal;
}

function localPoint(mesh, x, y, z) {
  return mesh.localToWorld(new THREE.Vector3(x, y, z));
}

export function mountProjectedDecals(opts) {
  const scene = opts.scene;
  const quay = opts.quay;
  const seawallCap = opts.seawallCap;
  const crates = opts.crates || [];
  const enabled0 = opts.enabled !== false;

  const markTex = {
    HARBOR: makeCanvasTexture(drawMark('HARBOR', 'gold')),
    SIGNAL: makeCanvasTexture(drawMark('SIGNAL', 'violet')),
    QUAY: makeCanvasTexture(drawMark('QUAY', 'paper')),
    FENESTRA: makeCanvasTexture(drawMark('FENESTRA', 'gold')),
  };
  const rustTex = [
    makeCanvasTexture(drawRust(11)),
    makeCanvasTexture(drawRust(29)),
    makeCanvasTexture(drawRust(47)),
  ];
  const scuffTex = [
    makeCanvasTexture(drawScuff(13)),
    makeCanvasTexture(drawScuff(71)),
  ];

  const mat = {
    HARBOR: decalMaterial(markTex.HARBOR, 0xf0c24b, 0.55),
    SIGNAL: decalMaterial(markTex.SIGNAL, 0x8a7bb8, 0.5),
    QUAY: decalMaterial(markTex.QUAY, 0xf2ebe0, 0.42),
    FENESTRA: decalMaterial(markTex.FENESTRA, 0xf0c24b, 0.5),
    rust: rustTex.map((tex, i) => decalMaterial(tex, 0x8a3e22, 0.28 + i * 0.04)),
    scuff: scuffTex.map((tex) => decalMaterial(tex, 0xc8c0b0, 0.22)),
  };

  const group = new THREE.Group();
  group.name = 'projected-decals';
  scene.add(group);

  const records = [];

  function place(mesh, position, orientation, size, material, meta) {
    const parentToMesh = meta.parentToMesh === true;
    const decal = project(mesh, position, orientation, size, material, {
      name: meta.name,
      target: meta.target,
      mark: meta.mark || '',
      parentToMesh,
    });
    if (!decal) {
      console.warn('Projected decal missed', meta.name);
      return;
    }
    if (!parentToMesh) group.add(decal);
    records.push(decal);
  }

  const deckY = quay ? quay.position.y + 0.01 : 0.05;

  // Quay deck wear — projector sits on the slab, not in its UV.
  if (quay) {
    const deck = [
      { name: 'quay-harbor', mark: 'HARBOR', x: -5.4, z: 1.7, w: 2.15, d: 0.78, yaw: 0.06 },
      { name: 'quay-signal', mark: 'SIGNAL', x: -1.6, z: 3.55, w: 1.7, d: 0.7, yaw: -0.42 },
      { name: 'quay-quay', mark: 'QUAY', x: 2.15, z: 2.05, w: 1.85, d: 0.66, yaw: 0.12 },
      { name: 'quay-fenestra', mark: 'FENESTRA', x: 5.35, z: 3.15, w: 2.25, d: 0.62, yaw: -0.08 },
    ];
    for (let i = 0; i < deck.length; i++) {
      const s = deck[i];
      place(
        quay,
        new THREE.Vector3(s.x, deckY, s.z),
        groundEuler(s.yaw),
        new THREE.Vector3(s.w, s.d, 0.36),
        mat[s.mark],
        { name: s.name, target: 'quay', mark: s.mark }
      );
    }
    const rusts = [
      { x: -3.5, z: 4.45, w: 1.45, d: 1.05, yaw: 0.4, tex: 0 },
      { x: 3.15, z: 4.55, w: 1.25, d: 0.9, yaw: 1.1, tex: 1 },
      { x: 0.35, z: 1.05, w: 1.7, d: 1.05, yaw: -0.2, tex: 2 },
    ];
    for (let i = 0; i < rusts.length; i++) {
      const s = rusts[i];
      place(
        quay,
        new THREE.Vector3(s.x, deckY, s.z),
        groundEuler(s.yaw),
        new THREE.Vector3(s.w, s.d, 0.4),
        mat.rust[s.tex],
        { name: `quay-rust-${i}`, target: 'quay', mark: 'rust' }
      );
    }
    const scuffs = [
      { x: -0.4, z: 2.7, w: 2.8, d: 0.42, yaw: 0.18, tex: 0 },
      { x: 3.6, z: 1.45, w: 2.1, d: 0.32, yaw: -0.55, tex: 1 },
    ];
    for (let i = 0; i < scuffs.length; i++) {
      const s = scuffs[i];
      place(
        quay,
        new THREE.Vector3(s.x, deckY, s.z),
        groundEuler(s.yaw),
        new THREE.Vector3(s.w, s.d, 0.32),
        mat.scuff[s.tex],
        { name: `quay-scuff-${i}`, target: 'quay', mark: 'scuff' }
      );
    }
  }

  // Coping: a flat freight stencil on the cap, plus one projector that
  // clips both the top and the water face so the mark bends over the edge.
  if (seawallCap) {
    const cap = seawallCap;
    cap.updateWorldMatrix(true, false);
    const topY = cap.position.y + 0.05;
    const waterEdgeZ = cap.position.z + 0.19;
    const flats = [
      { mark: 'HARBOR', x: -6.2 },
      { mark: 'QUAY', x: 0.4 },
      { mark: 'FENESTRA', x: 6.6 },
    ];
    for (let i = 0; i < flats.length; i++) {
      const s = flats[i];
      place(
        cap,
        new THREE.Vector3(s.x, topY, cap.position.z),
        groundEuler(0),
        new THREE.Vector3(s.mark === 'FENESTRA' ? 2.05 : 1.7, 0.26, 0.22),
        mat[s.mark],
        { name: `coping-${s.mark.toLowerCase()}`, target: 'seawall-cap', mark: s.mark }
      );
    }
    place(
      cap,
      new THREE.Vector3(-3.4, topY, waterEdgeZ),
      eulerOf(RX(Math.PI / 4)),
      new THREE.Vector3(1.8, 0.42, 0.28),
      mat.SIGNAL,
      { name: 'coping-signal-wrap', target: 'seawall-cap', mark: 'SIGNAL' }
    );
  }

  // Freight stamps parented to crates so toss / buoyancy carries the paint.
  // The corner projector is tilted 45° so one clip crosses lid and front.
  crates.forEach((mesh, i) => {
    if (!mesh || !mesh.geometry || !mesh.geometry.parameters) return;
    const p = mesh.geometry.parameters;
    const sx = p.width;
    const sy = p.height;
    const sz = p.depth;
    const word = MARKS[i % MARKS.length];
    mesh.updateWorldMatrix(true, false);
    place(
      mesh,
      localPoint(mesh, 0, sy * 0.5, sz * 0.5),
      meshEuler(mesh, RX(-Math.PI / 4)),
      new THREE.Vector3(sx * 0.92, Math.max(sy, sz) * 0.85, Math.min(sy, sz) * 0.55),
      mat[word],
      { name: `crate-${i}-${word.toLowerCase()}`, target: 'crate', mark: word, parentToMesh: true }
    );
    if (i % 2 === 0) {
      place(
        mesh,
        localPoint(mesh, 0, sy * 0.5, 0),
        meshEuler(mesh, RX(-Math.PI / 2)),
        new THREE.Vector3(sx * 0.7, sz * 0.55, 0.12),
        mat.rust[i % mat.rust.length],
        { name: `crate-${i}-rust`, target: 'crate', mark: 'rust', parentToMesh: true }
      );
    } else {
      place(
        mesh,
        localPoint(mesh, sx * 0.5, 0, 0),
        meshEuler(mesh, RY(-Math.PI / 2)),
        new THREE.Vector3(sz * 0.72, sy * 0.62, 0.1),
        mat.scuff[i % mat.scuff.length],
        { name: `crate-${i}-scuff`, target: 'crate', mark: 'scuff', parentToMesh: true }
      );
    }
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      MARKS.forEach((word) => {
        const tex = markTex[word];
        if (tex.userData.repaint) tex.userData.repaint();
      });
    });
  }

  const api = {
    technique: 'DecalGeometry',
    marks: MARKS.slice(),
    enabled: enabled0,
    group,
    records,
    count: records.length,
    vertices() {
      return records.map((d) => ({
        name: d.name,
        target: d.userData.decal.target,
        mark: d.userData.decal.mark,
        vertices: d.userData.decal.vertices,
      }));
    },
    setEnabled(on) {
      api.enabled = !!on;
      group.visible = api.enabled;
      for (let i = 0; i < records.length; i++) {
        if (records[i].parent !== group) records[i].visible = api.enabled;
      }
      if (opts.onChange) opts.onChange(api.enabled);
    },
  };

  api.setEnabled(enabled0);
  return api;
}
