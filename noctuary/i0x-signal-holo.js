/**
 * Signal hologram sheath
 * Journey Shaders · Hologram — fresnel rim, scrolling scanlines, bar glitch.
 * Dedicated meshes only: a mast shell and a nearby façade plate.
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

export function mountSignalHolo(opts) {
  const parent = opts.parent;
  const enabled0 = opts.enabled !== false;

  const material = new THREE.ShaderMaterial({
    name: 'SignalHolo',
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 1 },
      uLive: { value: 1 },
    },
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

  root.visible = enabled0;
  parent.add(root);

  const api = {
    technique: 'hologram',
    lesson: 'Shaders · Hologram',
    enabled: enabled0,
    root,
    sheath,
    panel,
    setEnabled(on) {
      api.enabled = !!on;
      root.visible = api.enabled;
    },
    update(time, pulse, live) {
      material.uniforms.uTime.value = time;
      material.uniforms.uPulse.value = pulse == null ? 1 : pulse;
      material.uniforms.uLive.value = live == null ? 1 : live;
    },
  };

  return api;
}
