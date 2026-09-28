/**
 * Signal hologram
 * Journey Shaders · Hologram — fresnel rim, scrolling scanlines, bar glitch.
 * Dedicated meshes: a mast sheath, a façade plate, and a vertical plane
 * that projects the cyber-man map. The sheath stays rim chrome.
 * Not bloom, not the A03 volume pass, not the circuit-moss façade atlas.
 *
 * Sliced Model was the other candidate. A moving clip would cut the beacon
 * hero apart. A hologram shell keeps the mast and reads as night product
 * chrome: scan, fresnel, a buried-circuit trace, gold and violet on ink.
 */
import * as THREE from 'three';

const HOLO_VERT = /* glsl */`
uniform float uTime;
uniform float uLive;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
varying float vGlitch;

float holoRand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // Journey hologram glitch: stacked sines of (time − height), then a
  // horizontal slice jumps. uLive scales it; a frozen frame keeps one bar.
  float t = uTime;
  float glitchTime = t * (0.35 + 0.65 * uLive) - world.y * 0.42;
  float glitchStrength = sin(glitchTime) + sin(glitchTime * 3.45) + sin(glitchTime * 8.76);
  glitchStrength /= 3.0;
  glitchStrength = smoothstep(0.42, 0.9, glitchStrength);
  float slice = floor(world.y * 4.5);
  float gate = step(0.68, holoRand(vec2(slice, floor(t * 3.0))));
  // Short slice offset. Frozen stills keep the bar; uLive only speeds which slice.
  float amp = glitchStrength * (0.03 + 0.1 * gate);
  world.x += (holoRand(vec2(slice, 1.7)) - 0.5) * amp;
  world.z += (holoRand(vec2(slice, 4.2)) - 0.5) * amp;
  vGlitch = amp * 10.0;
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const HOLO_FRAG = /* glsl */`
uniform float uTime;
uniform float uPulse;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
varying float vGlitch;

float holoHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  // Journey fresnel: 1 − N·V, sharpened. Edges carry the rim.
  float fresnel = pow(1.0 - ndv, 2.15);

  // Coarse scanlines so a night orbit still reads them as lines, not a tint.
  float scroll = vWorld.y * 10.0 - uTime * 0.85;
  float stripes = fract(scroll);
  float line = smoothstep(0.86, 0.99, stripes);

  // Traveling scan band — the read that is not a bloom halo.
  float scanPhase = fract(uTime * 0.16 + 0.42);
  float scanY = 0.35 + scanPhase * 3.5;
  float scan = exp(-abs(vWorld.y - scanY) * 7.5);

  // Buried circuit on the plate / shell. Procedural, not the moss atlas.
  vec2 cell = vUv * vec2(4.0, 6.0);
  vec2 cf = fract(cell);
  float traces = 0.0;
  traces += smoothstep(0.055, 0.0, abs(cf.x - 0.5)) * step(0.42, holoHash(floor(cell)));
  traces += smoothstep(0.045, 0.0, abs(cf.y - 0.28)) * step(0.38, holoHash(floor(cell) + vec2(2.0, 0.0)));
  traces += smoothstep(0.04, 0.0, abs(cf.y - 0.74)) * step(0.55, holoHash(floor(cell) + vec2(0.0, 3.0)));
  float node = smoothstep(0.11, 0.0, length(cf - vec2(0.5, 0.28)));
  traces = clamp(traces * 0.85 + node, 0.0, 1.0);

  // Head-on façade faces have weak fresnel, so stripes stay visible there.
  // Curved sheath still picks up the rim the lesson is built on.
  vec3 gold = vec3(0.96, 0.74, 0.26);
  vec3 violet = vec3(0.62, 0.50, 0.84);
  vec3 body = vec3(0.04, 0.035, 0.07);
  vec3 col = body;
  col = mix(col, gold, clamp(line + scan * 0.95, 0.0, 1.0));
  col = mix(col, violet, clamp(fresnel * 0.85 + vGlitch * 0.3, 0.0, 1.0));
  col = mix(col, vec3(0.78, 0.84, 0.66), traces * 0.75);

  // Glass body stays thin so night shows through. Lines, rim, and the scan bar carry it.
  float alpha = 0.05;
  alpha += line * 0.78;
  alpha += fresnel * 0.82;
  alpha += scan * 0.72;
  alpha += traces * 0.5;
  alpha += vGlitch * 0.1;
  alpha *= 0.9 + 0.1 * uPulse;
  alpha = clamp(alpha, 0.0, 0.92);
  gl_FragColor = vec4(col, alpha);
}
`;

// Companion for the figure plane. Same scan, fresnel, and slice family as the
// sheath, with the cyber-man map as the body. Near-black is punched out.
const FIGURE_FRAG = /* glsl */`
uniform float uTime;
uniform float uPulse;
uniform float uLive;
uniform sampler2D uMap;
uniform vec4 uCrop;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
varying float vGlitch;

float holoHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 srgbToLinear(vec3 c) {
  return mix(
    c * 0.0773993808,
    pow(max(c * 0.9478672986 + 0.0521327014, 0.0), vec3(2.4)),
    step(vec3(0.04045), c)
  );
}

void main() {
  vec2 mapUv = mix(uCrop.xy, uCrop.zw, vUv);
  // Bar tear on the map itself, so a slice shifts the figure, not only the quad.
  float slice = floor(vUv.y * 22.0);
  float gate = step(0.74, holoHash(vec2(slice, floor(uTime * (0.8 + 2.2 * uLive)))));
  float tear = gate * 0.006;
  mapUv.x += (holoHash(vec2(slice, 2.2)) - 0.5) * 0.03 * gate;

  vec3 raw;
  raw.r = texture2D(uMap, mapUv + vec2(tear, 0.0)).r;
  raw.g = texture2D(uMap, mapUv).g;
  raw.b = texture2D(uMap, mapUv - vec2(tear, 0.0)).b;
  float peak = max(raw.r, max(raw.g, raw.b));
  // Plate black is empty. Night shows through around the body.
  float presence = smoothstep(0.028, 0.075, peak);
  if (presence < 0.02) discard;
  vec3 tex = srgbToLinear(raw);

  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = pow(1.0 - ndv, 2.15);

  float scroll = vWorld.y * 10.0 - uTime * 0.85;
  float stripes = fract(scroll);
  float line = smoothstep(0.86, 0.99, stripes);

  float scanPhase = fract(uTime * 0.16 + 0.42);
  float scanY = 0.35 + scanPhase * 3.5;
  float scan = exp(-abs(vWorld.y - scanY) * 7.5);

  // Head-on fresnel is weak on a plane, so the silhouette carries a rim too.
  float edge = smoothstep(0.12, 0.7, fwidth(presence));

  vec3 gold = vec3(0.96, 0.74, 0.26);
  vec3 violet = vec3(0.62, 0.50, 0.84);
  vec3 col = tex;
  col = mix(col, gold, clamp(line * 0.7 + scan * 0.58, 0.0, 1.0));
  col = mix(col, violet, clamp(fresnel * 0.62 + edge * 0.42 + vGlitch * 0.3, 0.0, 1.0));

  float alpha = presence * (0.74 + line * 0.18 + scan * 0.16);
  alpha += edge * 0.28;
  alpha += fresnel * presence * 0.14;
  alpha += vGlitch * presence * 0.08;
  alpha *= 0.9 + 0.1 * uPulse;
  alpha = clamp(alpha, 0.0, 0.92);
  gl_FragColor = vec4(col, alpha);
}
`;

export function mountSignalHolo(opts) {
  const parent = opts.parent;
  const enabled0 = opts.enabled !== false;

  const uniforms = {
    uTime: { value: 0 },
    uPulse: { value: 1 },
    uLive: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    name: 'SignalHolo',
    uniforms,
    vertexShader: HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });

  const root = new THREE.Group();
  root.name = 'signal-holo';

  // Open shell outside the solid beacon (radius ~0.15). Not a bloom layer.
  const sheathGeo = new THREE.CylinderGeometry(0.36, 0.42, 3.5, 28, 42, true);
  const sheath = new THREE.Mesh(sheathGeo, material);
  sheath.name = 'signal-holo-sheath';
  sheath.position.y = 2.02;
  sheath.renderOrder = 3;
  sheath.userData.signalHolo = true;
  root.add(sheath);

  // Façade plate beside the mast, toward the ?shot=signal camera and to its right.
  // signalGroup is (−6.5, 0, 3.2); this local offset lands near (−4.9, 2.4, 2.85).
  const panelGeo = new THREE.BoxGeometry(0.96, 1.72, 0.055, 8, 36, 1);
  const panel = new THREE.Mesh(panelGeo, material);
  panel.name = 'signal-holo-panel';
  panel.position.set(1.58, 2.42, -0.35);
  panel.rotation.y = 0.28;
  panel.renderOrder = 3;
  panel.userData.signalHolo = true;
  root.add(panel);

  // Full frame is 1280×720 with the figure in a portrait window of black.
  // Inclusive pixel bounds of that window, then flipY so the head is +V.
  const imgW = 1280;
  const imgH = 720;
  const x0 = 440;
  const x1 = 838;
  const y0 = 23;
  const y1 = 687;
  const figH = 2.15;
  const figW = figH * ((x1 - x0) / (y1 - y0));
  const map = new THREE.TextureLoader().load(
    new URL('./textures/signal-holo-cyber-man.png', import.meta.url).href
  );
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = true;
  map.anisotropy = Math.min(8, opts.anisotropy || 8);
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;

  const figureUniforms = {
    uTime: { value: 0 },
    uPulse: { value: 1 },
    uLive: { value: 1 },
    uMap: { value: map },
    uCrop: { value: new THREE.Vector4(x0 / imgW, 1 - y1 / imgH, x1 / imgW, 1 - y0 / imgH) },
  };
  const figureMat = new THREE.ShaderMaterial({
    name: 'SignalHoloPlane',
    uniforms: figureUniforms,
    vertexShader: HOLO_VERT,
    fragmentShader: FIGURE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });

  // Standing projection just outside the sheath, toward ?shot=holo and a
  // step camera-left so the plate stays camera-right of the mast.
  const planeGeo = new THREE.PlaneGeometry(figW, figH, 1, 40);
  const plane = new THREE.Mesh(planeGeo, figureMat);
  plane.name = 'signal-holo-plane';
  plane.position.set(0.16, 0.88 + figH * 0.5, 0.82);
  plane.rotation.y = 0.68;
  plane.renderOrder = 3;
  plane.userData.signalHolo = true;
  // Beauty only. An opaque bloom stand-in would punch the beacon out.
  plane.userData.signalHoloPlane = true;
  root.add(plane);

  root.visible = enabled0;
  parent.add(root);

  const api = {
    technique: 'hologram',
    lesson: 'Shaders · Hologram',
    enabled: enabled0,
    root,
    sheath,
    panel,
    plane,
    setEnabled(on) {
      api.enabled = !!on;
      root.visible = api.enabled;
    },
    update(time, pulse, live) {
      const t = time;
      const p = pulse == null ? 1 : pulse;
      const liveV = live == null ? 1 : live;
      uniforms.uTime.value = t;
      uniforms.uPulse.value = p;
      uniforms.uLive.value = liveV;
      figureUniforms.uTime.value = t;
      figureUniforms.uPulse.value = p;
      figureUniforms.uLive.value = liveV;
    },
  };

  return api;
}
