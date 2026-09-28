/**
 * Soft contact under quay lanterns.
 * Orthographic shadow map of the posts and housings (lowest surface wins),
 * separable blur, then PCF taps in the quay shader. Not a second bloom.
 */
import * as THREE from 'three';

const CONTACT_LAYER = 2;

const DEPTH_VERT = /* glsl */`
  void main(){
    #ifdef USE_INSTANCING
      vec4 world = instanceMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * viewMatrix * world;
    #else
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #endif
  }
`;

const DEPTH_FRAG = /* glsl */`
  uniform float uFade0;
  uniform float uFade1;
  void main(){
    float contact = smoothstep(uFade0, uFade1, gl_FragCoord.z);
    gl_FragColor = vec4(vec3(contact), 1.0);
  }
`;

const BLUR_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */`
  uniform sampler2D tMap;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main(){
    vec2 t = uDir;
    vec3 c = texture2D(tMap, vUv).rgb * 0.227027;
    c += texture2D(tMap, vUv + t * 1.0).rgb * 0.1945946;
    c += texture2D(tMap, vUv - t * 1.0).rgb * 0.1945946;
    c += texture2D(tMap, vUv + t * 2.0).rgb * 0.1216216;
    c += texture2D(tMap, vUv - t * 2.0).rgb * 0.1216216;
    c += texture2D(tMap, vUv + t * 3.0).rgb * 0.054054;
    c += texture2D(tMap, vUv - t * 3.0).rgb * 0.054054;
    c += texture2D(tMap, vUv + t * 4.0).rgb * 0.016216;
    c += texture2D(tMap, vUv - t * 4.0).rgb * 0.016216;
    gl_FragColor = vec4(c, 1.0);
  }
`;

function makeTarget(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  rt.texture.generateMipmaps = false;
  return rt;
}

export function mountLanternContact(opts) {
  const renderer = opts.renderer;
  const scene = opts.scene;
  const casters = opts.casters || [];
  const uniforms = opts.uniforms;
  const deckY = opts.deckY != null ? opts.deckY : 0.04;
  const center = opts.center || new THREE.Vector3(0, deckY, 3.85);
  const halfX = opts.halfX != null ? opts.halfX : 12;
  const halfZ = opts.halfZ != null ? opts.halfZ : 3;
  const camH = opts.camH != null ? opts.camH : 2.25;
  const mapW = opts.mapW || 1024;
  const mapH = opts.mapH || 256;
  const blurPx = opts.blurPx != null ? opts.blurPx : 7;

  for (let i = 0; i < casters.length; i++) {
    const obj = casters[i];
    if (!obj) continue;
    obj.layers.enable(CONTACT_LAYER);
    obj.frustumCulled = false;
  }

  const cam = new THREE.OrthographicCamera(-halfX, halfX, halfZ, -halfZ, 0.04, camH + 0.45);
  cam.layers.set(CONTACT_LAYER);
  cam.position.set(center.x, deckY + camH, center.z);
  cam.up.set(0, 0, -1);
  cam.lookAt(center.x, deckY, center.z);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);

  const depthMat = new THREE.ShaderMaterial({
    uniforms: {
      uFade0: { value: 0.38 },
      uFade1: { value: 0.9 },
    },
    vertexShader: DEPTH_VERT,
    fragmentShader: DEPTH_FRAG,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    depthFunc: THREE.GreaterEqualDepth,
    toneMapped: false,
  });

  const rtA = makeTarget(mapW, mapH);
  const rtB = makeTarget(mapW, mapH);

  const blurMat = new THREE.ShaderMaterial({
    uniforms: {
      tMap: { value: rtA.texture },
      uDir: { value: new THREE.Vector2() },
    },
    vertexShader: BLUR_VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const blurScene = new THREE.Scene();
  const blurCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3);
  blurCam.position.z = 1;
  blurScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat));

  const clearColor = new THREE.Color();
  const matrix = new THREE.Matrix4();

  if (uniforms) {
    uniforms.uContactMap.value = rtA.texture;
    uniforms.uContactTexel.value.set(1 / mapW, 1 / mapH);
    matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    uniforms.uContactMatrix.value.copy(matrix);
  }

  const api = {
    technique: 'pcf-contact',
    enabled: opts.enabled !== false,
    mask: !!opts.mask,
    layer: CONTACT_LAYER,
    resolution: [mapW, mapH],
    blurPx,
    half: [halfX, halfZ],
    center: [center.x, deckY, center.z],
    casters: casters.length,
    setEnabled(on) {
      api.enabled = !!on;
      if (uniforms) uniforms.uContactOn.value = api.enabled ? 1 : 0;
    },
    render() {
      if (!api.enabled) return;
      const prevTarget = renderer.getRenderTarget();
      const prevOverride = scene.overrideMaterial;
      const prevBg = scene.background;
      const prevFog = scene.fog;
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clearColor);
      const prevAuto = renderer.autoClear;

      scene.background = null;
      scene.fog = null;
      scene.overrideMaterial = depthMat;
      renderer.autoClear = false;

      renderer.setRenderTarget(rtA);
      renderer.setClearColor(0x000000, 1);
      renderer.state.buffers.depth.setClear(0);
      renderer.clear(true, true, false);
      renderer.state.buffers.depth.setClear(1);
      renderer.render(scene, cam);

      blurMat.uniforms.tMap.value = rtA.texture;
      blurMat.uniforms.uDir.value.set(blurPx / mapW, 0);
      renderer.setRenderTarget(rtB);
      renderer.clear(true, true, false);
      renderer.render(blurScene, blurCam);

      blurMat.uniforms.tMap.value = rtB.texture;
      blurMat.uniforms.uDir.value.set(0, blurPx / mapH);
      renderer.setRenderTarget(rtA);
      renderer.clear(true, true, false);
      renderer.render(blurScene, blurCam);

      cam.updateMatrixWorld(true);
      matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      if (uniforms) uniforms.uContactMatrix.value.copy(matrix);

      scene.overrideMaterial = prevOverride;
      scene.background = prevBg;
      scene.fog = prevFog;
      renderer.autoClear = prevAuto;
      renderer.setClearColor(clearColor, prevAlpha);
      renderer.setRenderTarget(prevTarget);
    },
  };

  if (uniforms) {
    uniforms.uContactOn.value = api.enabled ? 1 : 0;
    if (uniforms.uContactDebug) uniforms.uContactDebug.value = api.mask ? 1 : 0;
  }

  return api;
}
