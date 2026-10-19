// Nước stylized — dựng lại đúng kỹ thuật của bài Codrops "Creating Stylized Water Effects with React Three Fiber"
// (thaslle/stylized-water, MIT © Codrops), chuyển sang Three.js thuần và phóng to tỉ lệ ~10 lần cho thế giới Skyship.
//
// - Mặt nước: MeshStandardMaterial vá shader (tương đương CustomShaderMaterial), cả mặt nhấp nhô theo sin.
//   Đốm bọt = simplex noise cắt ngưỡng; nét sóng = dải noise có ngưỡng dao động; gần trong suốt, xa đục dần,
//   xa chuyển sang màu "far" và tắt hoạ tiết.
// - Đáy biển: mặt phẳng màu underwater ngay dưới nước (như bài gốc).
// - Bờ đảo: xem shoreline.ts (cát ướt, màu dưới nước, dải bọt trắng theo mực nước).
import * as THREE from 'three';
import { Environment } from '../sky/Environment';

export const SEA_LEVEL = 0;

/** Chỉnh nước ở đây (giá trị mặc định lấy từ bài gốc, đã đổi tỉ lệ). */
export const WATER = {
  // Màu (gradient 3 nấc theo khoảng cách tới camera: gần -> giữa -> xa)
  colorNear: '#00fccd',
  colorMid: '#14e0e8',
  colorFar: '#1ceeff',
  underwater: '#118a4f',
  foamColor: '#ffffff',
  // Gradient
  midRadius: 520,        // m — nơi đạt đúng màu "giữa"
  gradientCurve: 1.0,    // < 1 = đổi màu sớm (gần camera), > 1 = giữ màu gần lâu hơn
  alphaNear: 0.6,        // độ đục nước ngay dưới tàu (0 = trong vắt thấy đáy, 1 = đục)
  alphaRadius: 800,      // m — tới đây nước đục hẳn
  // Hoạ tiết
  foamOpacity: 1.0,      // đốm bọt (độ đậm màu)
  foamAlpha: 1.0,        // độ đục của bọt + nét sóng (0 = trong suốt như nước, 1 = che hẳn)
  waveOpacity: 1.0,      // nét sóng
  patternFar: 900,       // m — hoạ tiết tắt dần tới đây
  waveSpeed: 1.2,
  waveAmplitude: 1.0,    // m (gốc 0.1 đơn vị)
  textureSize: 45,       // 1..80 như thanh trượt "Texture Size" của bài; càng lớn hoạ tiết càng to
  worldScale: 10,        // 1 đơn vị scene gốc = 10 m ở Skyship
  foamDepth: 0.5,        // m — bề dày dải bọt trên bờ (gốc 0.05)
  shoreFoamOpacity: 1.0, // độ đậm dải bọt ven bờ
  shoreFadeStart: 60,    // m — camera cao hơn mức này thì bọt ven bờ bắt đầu nhạt
  shoreFadeEnd: 300,     // m — tới độ cao này bọt ven bờ tắt hẳn
  seabedDepth: 9,        // m dưới mực nước (gốc: nước cao 0.9 so với đáy)
  nearRadius: 260,       // m — trong bán kính này giữ nguyên màu gần
  farRadius: 1400,       // m — từ đây trở ra là màu xa
};

/** Uniform dùng chung giữa mặt nước và bờ đảo (shoreline.ts) để bọt đồng nhịp với sóng. */
export const waterShared = {
  uTime: { value: 0 },
  uWaterLevel: { value: SEA_LEVEL },
  uWaveSpeed: { value: WATER.waveSpeed },
  uWaveAmplitude: { value: WATER.waveAmplitude },
  uFoamDepth: { value: WATER.foamDepth },
  uUnderwaterColor: { value: new THREE.Color(WATER.underwater) },
  uSeabed: { value: SEA_LEVEL - WATER.seabedDepth },
  uFoamLight: { value: 1 },
  uShoreFoamOp: { value: 1 },
  uShoreFadeStart: { value: 60 },
  uShoreFadeEnd: { value: 300 },
};

/** Mực nước lúc này (mặt biển nhấp nhô lên xuống theo sóng). Dùng cho vật nổi, nhân vật bơi, hiệu ứng trên mặt nước. */
export function waterLevelNow(): number {
  return SEA_LEVEL + Math.sin(waterShared.uTime.value * waterShared.uWaveSpeed.value) * waterShared.uWaveAmplitude.value;
}

// Simplex noise 2D (Ashima / Stefan Gustavson), y như shader gốc
const SNOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}`;

export class Ocean {
  private water: THREE.Mesh;
  private seabed: THREE.Mesh;
  private time = 0;
  private uniforms = {
    uColorNear: { value: new THREE.Color(WATER.colorNear) },
    uColorMid: { value: new THREE.Color(WATER.colorMid) },
    uColorFar: { value: new THREE.Color(WATER.colorFar) },
    uFoamColor: { value: new THREE.Color(WATER.foamColor) },
    uMidR: { value: WATER.midRadius },
    uCurve: { value: WATER.gradientCurve },
    uAlphaNear: { value: WATER.alphaNear },
    uAlphaR: { value: WATER.alphaRadius },
    uFoamOp: { value: WATER.foamOpacity },
    uFoamAlpha: { value: WATER.foamAlpha },
    uWaveOp: { value: WATER.waveOpacity },
    uPatternFar: { value: WATER.patternFar },
    uTextureSize: { value: WATER.textureSize },
    uUvScale: { value: 1 / (256 * WATER.worldScale) },
    uNearR: { value: WATER.nearRadius },
    uFarR: { value: WATER.farRadius },
  };

  constructor(scene: THREE.Scene) {
    // --- Mặt nước ---
    // Màu trắng: shader tự nhân ánh sáng với gradient màu (gần/giữa/xa) -> cả 3 màu đều theo ngày đêm
    // polygonOffset: đẩy nước nhích về phía camera -> không giành chiều sâu (z-fighting) với bãi cát khi nhấp nhô
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, waterShared, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uWaveSpeed; uniform float uWaveAmplitude;
varying vec3 vWaterW;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
// Cả mặt nước nhấp nhô lên xuống theo sin (z là trục đứng vì mặt phẳng đã xoay)
transformed.z += sin(uTime * uWaveSpeed) * uWaveAmplitude;
vWaterW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uTime; uniform vec3 uColorNear; uniform vec3 uColorMid; uniform vec3 uColorFar; uniform vec3 uFoamColor;
uniform float uTextureSize; uniform float uUvScale;
uniform float uNearR; uniform float uMidR; uniform float uFarR; uniform float uCurve;
uniform float uAlphaNear; uniform float uAlphaR; uniform float uFoamOp; uniform float uFoamAlpha; uniform float uWaveOp; uniform float uPatternFar;
uniform float uFoamLight;
varying vec3 vWaterW;
${SNOISE}`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
{
  // "uv" theo toạ độ thế giới: 1 ô 256 đơn vị gốc = 256 * worldScale mét -> hoạ tiết đúng tỉ lệ bài gốc
  vec2 wuv = vWaterW.xz * uUvScale;
  float textureSize = 100.0 - uTextureSize;

  // Đốm bọt
  float noiseBase = snoise(wuv * (textureSize * 2.8) + sin(uTime * 0.3)) * 0.5 + 0.5;
  vec3 foam = smoothstep(0.08, 0.001, vec3(noiseBase));
  foam = step(0.5, foam);

  // Nét sóng: dải noise quanh ngưỡng dao động nhẹ
  float noiseWaves = snoise(wuv * textureSize + sin(uTime * -0.1)) * 0.5 + 0.5;
  float threshold = 0.6 + 0.01 * sin(uTime * 2.0);
  vec3 waveEffect = 1.0 - (smoothstep(threshold + 0.03, threshold + 0.032, vec3(noiseWaves)) +
                           smoothstep(threshold, threshold - 0.01, vec3(noiseWaves)));
  waveEffect = step(0.5, waveEffect);

  // Gradient 3 nấc theo khoảng cách tới camera (thay cho "vignette" theo uv của bài gốc)
  float dist = length(vWaterW.xz - cameraPosition.xz);
  vec3 lit = gl_FragColor.rgb; // ánh sáng mặt trời + môi trường (material màu trắng)
  float g1 = pow(clamp((dist - uNearR) / max(uMidR - uNearR, 1.0), 0.0, 1.0), uCurve);
  float g2 = pow(clamp((dist - uMidR) / max(uFarR - uMidR, 1.0), 0.0, 1.0), uCurve);
  vec3 baseColor = mix(mix(uColorNear, uColorMid, smoothstep(0.0, 1.0, g1)), uColorFar, smoothstep(0.0, 1.0, g2)) * lit;

  // Hoạ tiết tắt dần ra xa
  float patternFade = smoothstep(uNearR, uPatternFar, dist);
  vec3 foamV = foam * uFoamOp;
  vec3 waveV = waveEffect * uWaveOp;
  vec3 combinedEffect = min(waveV + foamV, 1.0);
  combinedEffect = mix(combinedEffect, vec3(0.0), patternFade);
  vec3 foamEffect = mix(foamV, vec3(0.0), patternFade);

  vec3 finalColor = (1.0 - combinedEffect) * baseColor + combinedEffect * uFoamColor * uFoamLight;
  // Độ đục: alphaNear ngay dưới camera -> 1 ở alphaRadius; bọt luôn đục
  float a = mix(uAlphaNear, 1.0, smoothstep(0.0, uAlphaR, dist));
  // Bọt / nét sóng: độ đục chỉnh được (uFoamAlpha)
  vec3 alpha = vec3(mix(a, 1.0, combinedEffect.r * uFoamAlpha));
  gl_FragColor = vec4(finalColor, alpha.r);
}`);
    };
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), mat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.renderOrder = 2;
    scene.add(this.water);

    // --- Đáy biển (như mặt phẳng underwater dưới địa hình của bài gốc) ---
    this.seabed = new THREE.Mesh(
      new THREE.PlaneGeometry(30000, 30000),
      new THREE.MeshStandardMaterial({ color: WATER.underwater, roughness: 1 }),
    );
    this.seabed.rotation.x = -Math.PI / 2;
    scene.add(this.seabed);
  }

  update(dt: number, player: THREE.Vector3, env: Environment): void {
    this.time += dt;
    waterShared.uTime.value = this.time;
    waterShared.uWaveSpeed.value = WATER.waveSpeed;
    waterShared.uWaveAmplitude.value = WATER.waveAmplitude;
    waterShared.uFoamDepth.value = WATER.foamDepth;
    waterShared.uSeabed.value = SEA_LEVEL - WATER.seabedDepth;
    // Bọt trắng tối đi khi đêm xuống (bài gốc chỉ có ban ngày)
    waterShared.uFoamLight.value = 0.3 + 0.7 * env.dayFactor;

    // Đồng bộ thông số từ WATER (bảng chỉnh G sửa trực tiếp object này)
    const u = this.uniforms;
    u.uColorNear.value.set(WATER.colorNear);
    u.uColorMid.value.set(WATER.colorMid);
    u.uColorFar.value.set(WATER.colorFar);
    u.uFoamColor.value.set(WATER.foamColor);
    u.uTextureSize.value = WATER.textureSize;
    u.uNearR.value = WATER.nearRadius;
    u.uMidR.value = Math.max(WATER.midRadius, WATER.nearRadius + 1);
    u.uFarR.value = Math.max(WATER.farRadius, WATER.midRadius + 1);
    u.uCurve.value = WATER.gradientCurve;
    u.uAlphaNear.value = WATER.alphaNear;
    u.uAlphaR.value = WATER.alphaRadius;
    u.uFoamOp.value = WATER.foamOpacity;
    u.uFoamAlpha.value = WATER.foamAlpha;
    waterShared.uShoreFoamOp.value = WATER.shoreFoamOpacity;
    waterShared.uShoreFadeStart.value = WATER.shoreFadeStart;
    waterShared.uShoreFadeEnd.value = Math.max(WATER.shoreFadeEnd, WATER.shoreFadeStart + 1);
    u.uWaveOp.value = WATER.waveOpacity;
    u.uPatternFar.value = WATER.patternFar;
    waterShared.uUnderwaterColor.value.set(WATER.underwater);
    (this.seabed.material as THREE.MeshStandardMaterial).color.set(WATER.underwater);

    this.water.position.set(player.x, SEA_LEVEL, player.z);
    this.seabed.position.set(player.x, SEA_LEVEL - WATER.seabedDepth, player.z);
  }
}
