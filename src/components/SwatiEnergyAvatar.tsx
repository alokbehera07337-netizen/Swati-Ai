import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { OrbState } from "../types";

interface SwatiEnergyAvatarProps {
  orbState: OrbState;
  audioLevelRef: MutableRefObject<number>;
  onTap: () => void;
  compact?: boolean;
  statusLabel: string;
}

const HERO_AVATAR_ASSET = "/assets/aistudio/IMG-20261121-WA1228_9a3e3f43.jpg";

const CORE_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uAudio;
  uniform float uMotion;
  varying vec2 vUv;
  varying float vWave;

  void main() {
    vUv = uv;
    vec3 pos = position;

    float waveA = sin(pos.y * 2.6 - uTime * 1.45 + pos.x * 1.2);
    float waveB = cos(pos.x * 3.1 + uTime * 1.1 - pos.y * 1.6);
    float edgeMask = smoothstep(0.05, 0.45, uv.x) * smoothstep(0.95, 0.55, uv.x)
                   * smoothstep(0.05, 0.45, uv.y) * smoothstep(0.95, 0.55, uv.y);

    float disp = (waveA * 0.045 + waveB * 0.032) * (0.65 + uAudio * 1.6) * uMotion;
    pos.z += disp * (0.4 + 0.6 * edgeMask);
    pos.x += sin(pos.y * 2.2 - uTime * 1.1) * (0.015 + uAudio * 0.03) * uMotion;

    vWave = waveA * 0.5 + 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const CORE_FRAGMENT_SHADER = `
  uniform sampler2D uTexture;
  uniform float uTime;
  uniform float uAudio;
  uniform float uPulse;
  uniform float uListening;
  uniform float uSpeaking;
  uniform float uThinking;
  uniform float uError;
  varying vec2 vUv;
  varying float vWave;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Subtle organic UV smoke drift synchronized with speech energy
    vec2 centered = vUv - vec2(0.5);
    float dist = length(centered * vec2(1.12, 0.94));
    float flow1 = fbm(vUv * 4.2 + vec2(0.0, -uTime * (0.28 + uAudio * 0.55)));
    float flow2 = fbm(vUv * 6.8 + vec2(uTime * 0.14, -uTime * 0.42));

    vec2 uvOffset = vec2(
      (flow1 - 0.5) * (0.012 + uAudio * 0.024),
      (flow2 - 0.5) * (0.010 + uAudio * 0.020)
    );

    vec3 texColor = texture2D(uTexture, clamp(vUv + uvOffset, 0.002, 0.998)).rgb;
    float lum = dot(texColor, vec3(0.299, 0.587, 0.114));

    // Smoothly feather the outer dark square edges so only the smoke figure remains
    float radialFade = 1.0 - smoothstep(0.32, 0.52, dist);
    float smokeMask = smoothstep(0.045, 0.28, lum) * radialFade;

    // Flowing energy shimmer running upward through the smoke ribbons
    float shimmer = smoothstep(0.35, 0.85, flow1 * 0.65 + flow2 * 0.35);
    float energyBoost = 1.0 + uPulse * 0.25 + uAudio * 0.85 + shimmer * (0.22 + uAudio * 0.45);

    vec3 speakTint = vec3(0.45, 0.82, 1.05);
    vec3 listenTint = vec3(0.28, 0.76, 1.02);
    vec3 thinkTint = vec3(0.48, 0.56, 1.05);
    vec3 errorTint = vec3(1.0, 0.68, 0.28);

    vec3 finalColor = texColor * energyBoost;
    finalColor += texColor * speakTint * (uSpeaking * (0.28 + uAudio * 0.65));
    finalColor += texColor * listenTint * (uListening * (0.22 + uAudio * 0.45));
    finalColor += texColor * thinkTint * (uThinking * 0.28);
    finalColor = mix(finalColor, vec3(dot(finalColor, vec3(0.33))) * errorTint * 1.15, uError * 0.72);

    // Core chest/hood ethereal breath glow
    float coreGlow = exp(-dist * 4.2) * (0.14 + uPulse * 0.16 + uAudio * 0.42);
    vec3 glowHue = mix(vec3(0.18, 0.58, 1.0), errorTint, uError);
    finalColor += glowHue * coreGlow;

    float alpha = clamp(smokeMask * (0.95 + uAudio * 0.2) + coreGlow * 0.35, 0.0, 1.0);
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

const SMOKE_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uAudio;
  uniform float uLayerOffset;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position;
    float sway = sin(pos.y * 2.1 - uTime * 1.2 + uLayerOffset) * (0.08 + uAudio * 0.14);
    pos.x += sway;
    pos.z += cos(pos.x * 2.4 + uTime * 0.9 + uLayerOffset) * 0.07;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const SMOKE_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uAudio;
  uniform float uPulse;
  uniform float uLayerOffset;
  uniform float uError;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.05;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 centered = vUv - vec2(0.5);
    float dist = length(centered * vec2(1.25, 0.92));
    float mask = 1.0 - smoothstep(0.18, 0.5, dist);

    vec2 q = vec2(
      fbm(vUv * 3.0 + vec2(uLayerOffset, -uTime * (0.22 + uAudio * 0.38))),
      fbm(vUv * 3.0 + vec2(5.2, -uTime * 0.18 + uLayerOffset))
    );
    float wisp = fbm(vUv * 3.5 + 1.8 * q - vec2(0.0, uTime * (0.3 + uAudio * 0.45)));
    float ribbon = smoothstep(0.42, 0.78, wisp) * mask;

    vec3 blueCol = mix(vec3(0.08, 0.38, 0.95), vec3(0.48, 0.88, 1.0), wisp);
    vec3 errCol = mix(vec3(0.85, 0.42, 0.08), vec3(1.0, 0.78, 0.32), wisp);
    vec3 col = mix(blueCol, errCol, uError);

    float intensity = (0.14 + uPulse * 0.08 + uAudio * 0.26) * ribbon;
    gl_FragColor = vec4(col * (1.2 + uAudio * 0.9), intensity);
  }
`;

const PARTICLE_VERTEX_SHADER = `
  attribute float aScale;
  attribute float aPhase;
  uniform float uTime;
  uniform float uAudio;
  uniform float uMotion;
  varying float vAlpha;
  varying float vColorMix;

  void main() {
    vec3 pos = position;

    // Gentle upward cosmic smoke drift & organic swirl
    float drift = mod(uTime * (0.14 + uAudio * 0.22) * uMotion + aPhase, 1.0);
    pos.y = mix(-1.05, 1.15, drift);
    float swirlAngle = uTime * 0.45 * uMotion + aPhase * 6.2831;
    pos.x += sin(swirlAngle + pos.y * 2.2) * (0.07 + uAudio * 0.11);
    pos.z += cos(swirlAngle * 0.8 + pos.y * 1.8) * (0.07 + uAudio * 0.09);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float lifeFade = sin(drift * 3.14159265);
    float twinkle = 0.55 + 0.45 * sin(uTime * (3.2 + uAudio * 5.0) + aPhase * 24.0);
    vAlpha = lifeFade * twinkle * (0.68 + uAudio * 0.45);
    vColorMix = fract(aPhase * 3.7);

    float sizeScale = aScale * (1.0 + uAudio * 0.95) * (240.0 / max(0.8, -mvPosition.z));
    gl_PointSize = clamp(sizeScale, 1.5, 28.0);
  }
`;

const PARTICLE_FRAGMENT_SHADER = `
  uniform float uError;
  varying float vAlpha;
  varying float vColorMix;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;

    // Soft glowing halo + crisp star sparkle cross
    float glow = exp(-d * 6.5);
    float crossSpark = exp(-abs(uv.x) * 26.0) * exp(-abs(uv.y) * 6.0)
                     + exp(-abs(uv.y) * 26.0) * exp(-abs(uv.x) * 6.0);
    float core = smoothstep(0.18, 0.0, d);

    vec3 iceBlue = vec3(0.82, 0.95, 1.0);
    vec3 skyCyan = vec3(0.22, 0.74, 0.98);
    vec3 baseCol = mix(skyCyan, iceBlue, vColorMix);
    vec3 errCol = vec3(1.0, 0.75, 0.35);
    vec3 col = mix(baseCol, errCol, uError);

    float alpha = (glow * 0.8 + crossSpark * 0.45 + core * 0.65) * vAlpha;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

export function SwatiEnergyAvatar({
  orbState,
  audioLevelRef,
  onTap,
  compact = false,
  statusLabel,
}: SwatiEnergyAvatarProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<OrbState>(orbState);
  const pointerLookRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });
  const dragYawRef = useRef<number>(0);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const movedDuringDragRef = useRef<boolean>(false);

  stateRef.current = orbState;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement("canvas");
      const gl = probeCanvas.getContext("webgl2");
      if (!gl) return true;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param) ?? "");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const initW = Math.max(container.clientWidth, 1);
    const initH = Math.max(container.clientHeight, 1);
    const camera = new THREE.PerspectiveCamera(38, initW / initH, 0.1, 30);

    const updateCameraFraming = (width: number, height: number) => {
      const safeW = Math.max(width, 1);
      const safeH = Math.max(height, 1);
      const aspect = safeW / safeH;
      camera.aspect = aspect;
      if (aspect < 0.85) {
        camera.fov = 42;
        camera.position.set(0, 0.02, 3.25);
      } else if (aspect < 1.2) {
        camera.fov = 39;
        camera.position.set(0, 0.02, 2.9);
      } else {
        camera.fov = 37;
        camera.position.set(0, 0.02, 2.75);
      }
      camera.lookAt(0, 0.02, 0);
      camera.updateProjectionMatrix();
      renderer.setSize(safeW, safeH, false);
    };

    updateCameraFraming(initW, initH);

    // Pulsing blue core point light illuminating surrounding volumetric depth layers
    const pulsingLight = new THREE.PointLight(0x38bdf8, 2.4, 8, 1.5);
    pulsingLight.position.set(0, 0.12, 0.85);
    scene.add(pulsingLight);

    const entityGroup = new THREE.Group();
    scene.add(entityGroup);

    // Load attached blue smoke energy portrait texture directly from /assets/aistudio/
    const textureLoader = new THREE.TextureLoader();
    const heroTexture = textureLoader.load(HERO_AVATAR_ASSET);
    heroTexture.colorSpace = THREE.SRGBColorSpace;
    heroTexture.anisotropy = Math.max(
      1,
      Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1)
    );

    const coreGeo = new THREE.PlaneGeometry(2.1, 2.1, 44, 44);
    const coreUniforms = {
      uTexture: { value: heroTexture },
      uTime: { value: 0 },
      uAudio: { value: 0 },
      uPulse: { value: 0.5 },
      uListening: { value: 0 },
      uSpeaking: { value: 0 },
      uThinking: { value: 0 },
      uError: { value: 0 },
      uMotion: { value: prefersReducedMotion ? 0.25 : 1.0 },
    };
    const coreMat = new THREE.ShaderMaterial({
      uniforms: coreUniforms,
      vertexShader: CORE_VERTEX_SHADER,
      fragmentShader: CORE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.renderOrder = 2;
    entityGroup.add(coreMesh);

    // Layered 3D volumetric flowing smoke veils (in front & behind the energy character)
    const smokeLayers: Array<{
      mesh: THREE.Mesh;
      geo: THREE.PlaneGeometry;
      mat: THREE.ShaderMaterial;
    }> = [];
    const layerSpecs = [
      { z: -0.32, scale: 2.55, rotY: -0.14, offset: 0.0, order: 1 },
      { z: -0.14, scale: 2.25, rotY: 0.12, offset: 2.1, order: 1 },
      { z: 0.16, scale: 2.18, rotY: -0.1, offset: 4.3, order: 3 },
      { z: 0.34, scale: 2.4, rotY: 0.16, offset: 6.7, order: 3 },
    ];

    for (const spec of layerSpecs) {
      const sGeo = new THREE.PlaneGeometry(spec.scale, spec.scale, 24, 24);
      const sMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAudio: { value: 0 },
          uPulse: { value: 0.5 },
          uLayerOffset: { value: spec.offset },
          uError: { value: 0 },
        },
        vertexShader: SMOKE_VERTEX_SHADER,
        fragmentShader: SMOKE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const sMesh = new THREE.Mesh(sGeo, sMat);
      sMesh.position.z = spec.z;
      sMesh.rotation.y = spec.rotY;
      sMesh.renderOrder = spec.order;
      entityGroup.add(sMesh);
      smokeLayers.push({ mesh: sMesh, geo: sGeo, mat: sMat });
    }

    // 3D Glowing Star / Sparkle Particles swirling around the smoke silhouette
    const particleCount = 260;
    const pPositions = new Float32Array(particleCount * 3);
    const pScales = new Float32Array(particleCount);
    const pPhases = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      // Distribute organically around hooded figure & billowing lower robes
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.14 + Math.pow(Math.random(), 0.72) * 0.76;
      pPositions[i * 3] = Math.cos(angle) * radius * 0.92;
      pPositions[i * 3 + 1] = (Math.random() - 0.5) * 2.0;
      pPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.85;
      pScales[i] = 0.45 + Math.random() * 1.45;
      pPhases[i] = Math.random();
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
    particleGeo.setAttribute("aScale", new THREE.BufferAttribute(pScales, 1));
    particleGeo.setAttribute("aPhase", new THREE.BufferAttribute(pPhases, 1));

    const particleUniforms = {
      uTime: { value: 0 },
      uAudio: { value: 0 },
      uError: { value: 0 },
      uMotion: { value: prefersReducedMotion ? 0.25 : 1.0 },
    };
    const particleMat = new THREE.ShaderMaterial({
      uniforms: particleUniforms,
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    particles.renderOrder = 4;
    entityGroup.add(particles);

    // Synchronized Voice-Reactive 3D Harmonic Energy Wave Ribbons (2 flowing curves)
    const wavePointsCount = 72;
    const waveLines: Array<{
      line: THREE.Line;
      geo: THREE.BufferGeometry;
      mat: THREE.LineBasicMaterial;
      positions: Float32Array;
      yBase: number;
      zBase: number;
      phase: number;
    }> = [];

    for (let w = 0; w < 2; w++) {
      const positions = new Float32Array(wavePointsCount * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: w === 0 ? 0x7dd3fc : 0x38bdf8,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 5;
      entityGroup.add(line);
      waveLines.push({
        line,
        geo,
        mat,
        positions,
        yBase: -0.78 + w * 0.08,
        zBase: 0.24 + w * 0.08,
        phase: w * 1.9,
      });
    }

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          updateCameraFraming(width, height);
        }
      }
    });
    resizeObserver.observe(container);

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    let smoothedAudio = 0;
    let listenBlend = 0;
    let speakBlend = 0;
    let thinkBlend = 0;
    let errorBlend = 0;
    let tiltX = 0;
    let tiltY = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const syncState = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (syncState === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;

      const delta = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const state = stateRef.current;
      const motionScale = prefersReducedMotion ? 0.25 : 1.0;

      const isSpeaking = state === "speaking";
      const isListening = state === "listening";
      const isThinking = state === "thinking" || state === "connecting";
      const isError = state === "error";

      const rawAudio = audioLevelRef.current;
      const effectiveAudio =
        isSpeaking || isListening ? Math.max(rawAudio, isSpeaking ? 0.12 : 0.05) : 0;
      smoothedAudio = THREE.MathUtils.damp(smoothedAudio, effectiveAudio, 14, delta);

      listenBlend = THREE.MathUtils.damp(listenBlend, isListening ? 1 : 0, 7, delta);
      speakBlend = THREE.MathUtils.damp(speakBlend, isSpeaking ? 1 : 0, 8, delta);
      thinkBlend = THREE.MathUtils.damp(thinkBlend, isThinking ? 1 : 0, 6, delta);
      errorBlend = THREE.MathUtils.damp(errorBlend, isError ? 1 : 0, 7, delta);

      // Pulsing blue energy light synchronized with voice & state
      const pulse =
        0.5 +
        0.5 * Math.sin(t * (isSpeaking ? 4.2 : isListening ? 2.8 : 1.6)) *
          motionScale;

      pulsingLight.intensity =
        1.8 + pulse * 0.85 + smoothedAudio * 2.4;
      pulsingLight.color.setHex(isError ? 0xf59e0b : isSpeaking ? 0x7dd3fc : 0x38bdf8);

      // Gentle ethereal floating & pointer-follow 3D tilt
      const pointer = pointerLookRef.current;
      const targetTiltY =
        (pointer.active ? pointer.x * 0.16 : Math.sin(t * 0.55) * 0.06) *
        motionScale;
      const targetTiltX =
        (pointer.active ? -pointer.y * 0.1 : Math.cos(t * 0.7) * 0.03) *
        motionScale;

      tiltY = THREE.MathUtils.damp(tiltY, targetTiltY, 5, delta);
      tiltX = THREE.MathUtils.damp(tiltX, targetTiltX, 5, delta);
      dragYawRef.current = THREE.MathUtils.damp(dragYawRef.current, 0, 5, delta);

      entityGroup.position.y = Math.sin(t * 1.35) * 0.035 * motionScale;
      entityGroup.rotation.y = tiltY + dragYawRef.current;
      entityGroup.rotation.x = tiltX;

      // Subtle breathing scale pulse synced with speaking voice energy
      const breathScale =
        1.0 +
        Math.sin(t * 1.6) * 0.014 * motionScale +
        smoothedAudio * (isSpeaking ? 0.055 : 0.03);
      entityGroup.scale.set(breathScale, breathScale, 1);

      // Update core figure shader
      coreUniforms.uTime.value = t;
      coreUniforms.uAudio.value = smoothedAudio;
      coreUniforms.uPulse.value = pulse;
      coreUniforms.uListening.value = listenBlend;
      coreUniforms.uSpeaking.value = speakBlend;
      coreUniforms.uThinking.value = thinkBlend;
      coreUniforms.uError.value = errorBlend;

      // Update 3D flowing smoke layers
      for (let i = 0; i < smokeLayers.length; i++) {
        const layer = smokeLayers[i];
        layer.mat.uniforms.uTime.value = t;
        layer.mat.uniforms.uAudio.value = smoothedAudio;
        layer.mat.uniforms.uPulse.value = pulse;
        layer.mat.uniforms.uError.value = errorBlend;
        layer.mesh.rotation.z = Math.sin(t * 0.35 + i) * 0.06 * motionScale;
      }

      // Update 3D glowing particles
      particleUniforms.uTime.value = t;
      particleUniforms.uAudio.value = smoothedAudio;
      particleUniforms.uError.value = errorBlend;

      // Update synchronized voice energy wave ribbons
      const voiceActiveStrength = Math.max(speakBlend, listenBlend * 0.75);
      for (const wl of waveLines) {
        wl.mat.opacity = THREE.MathUtils.clamp(
          voiceActiveStrength * (0.28 + smoothedAudio * 0.72),
          0,
          0.9
        );
        wl.mat.color.setHex(
          isError ? 0xfbbf24 : isSpeaking ? 0xbae6fd : 0x38bdf8
        );
        if (wl.mat.opacity > 0.01) {
          const amp = (0.02 + smoothedAudio * 0.14) * voiceActiveStrength;
          for (let i = 0; i < wavePointsCount; i++) {
            const norm = i / (wavePointsCount - 1);
            const x = (norm - 0.5) * 1.45;
            const env = Math.sin(norm * Math.PI);
            const y =
              wl.yBase +
              Math.sin(norm * 10.0 - t * (isSpeaking ? 9.5 : 5.5) + wl.phase) *
                amp *
                env +
              Math.cos(norm * 18.0 + t * 7.2) * amp * 0.35 * env;
            const z = wl.zBase + Math.sin(norm * 5.0 + t * 2.5 + wl.phase) * 0.05;
            wl.positions[i * 3] = x;
            wl.positions[i * 3 + 1] = y;
            wl.positions[i * 3 + 2] = z;
          }
          (wl.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        }
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    if (isSoftwareGl) {
      frameId = window.setTimeout(tick, 0);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      resizeObserver.disconnect();
      coreGeo.dispose();
      coreMat.dispose();
      heroTexture.dispose();
      for (const layer of smokeLayers) {
        layer.geo.dispose();
        layer.mat.dispose();
      }
      particleGeo.dispose();
      particleMat.dispose();
      for (const wl of waveLines) {
        wl.geo.dispose();
        wl.mat.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [audioLevelRef]);

  const isActiveVoice =
    orbState === "listening" ||
    orbState === "speaking" ||
    orbState === "connecting";

  const stageHeightClass = compact
    ? "h-[36dvh] min-h-[240px] max-h-[340px] sm:h-[40dvh] lg:h-[calc(100dvh-10.5rem)] lg:max-h-[700px]"
    : "h-[46dvh] min-h-[300px] max-h-[470px] sm:h-[50dvh] lg:h-[calc(100dvh-10.5rem)] lg:max-h-[720px]";

  return (
    <div className="w-full flex flex-col items-center justify-center select-none">
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTap();
          }
        }}
        onPointerDown={(e) => {
          pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
          movedDuringDragRef.current = false;
        }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
            pointerLookRef.current = {
              x: Math.max(-1, Math.min(1, nx)),
              y: Math.max(-1, Math.min(1, ny)),
              active: true,
            };
          }
          if (pointerDownPosRef.current) {
            const dx = e.clientX - pointerDownPosRef.current.x;
            if (Math.abs(dx) > 6) {
              movedDuringDragRef.current = true;
              dragYawRef.current = Math.max(-0.45, Math.min(0.45, dx * 0.004));
            }
          }
        }}
        onPointerUp={() => {
          const wasDrag = movedDuringDragRef.current;
          pointerDownPosRef.current = null;
          movedDuringDragRef.current = false;
          if (!wasDrag) {
            onTap();
          }
        }}
        onPointerLeave={() => {
          pointerLookRef.current.active = false;
          pointerDownPosRef.current = null;
          movedDuringDragRef.current = false;
        }}
        aria-label={
          isActiveVoice
            ? "Stop SWATI AI voice conversation"
            : "Tap SWATI AI energy avatar to start voice conversation"
        }
        className={`relative w-full max-w-[460px] lg:max-w-none rounded-3xl overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-4 focus-visible:ring-offset-[#040711] bg-[radial-gradient(ellipse_at_50%_46%,rgba(37,99,235,0.22),rgba(8,14,32,0.4)_58%,rgba(4,7,17,0)_100%)] ${stageHeightClass}`}
      >
        <div ref={mountRef} className="w-full h-full pointer-events-none" />
      </div>

      <p
        aria-live="polite"
        className="mt-2 text-xs sm:text-sm font-medium tracking-wide text-blue-200/85 text-center px-2"
      >
        {statusLabel}
      </p>
    </div>
  );
}
