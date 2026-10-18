// Mây volumetric tả thực (raymarching), lấy cảm hứng từ các engine mây kiểu Nubis / Hillaire.
//
// Mỗi frame:
//  1. Depth prepass (nửa độ phân giải): chỉ đảo + tàu (layer 1) -> biết tia mây phải dừng ở đâu.
//  2. Cloud pass (nửa độ phân giải): mỗi pixel bắn tia qua lớp mây [bottom, top], lấy mẫu mật độ
//     từ weather map + noise 3D, tính ánh sáng (Beer–Lambert, phase Henyey–Greenstein 2 thuỳ,
//     "powder", tán xạ nhiều lần xấp xỉ, ánh sáng môi trường theo độ cao), phối cảnh khí quyển.
//     Điểm bắt đầu tia được jitter bằng blue noise rồi trộn với frame trước (reprojection) cho mịn.
//
// Nâng cấp theo leoawen/volumetric_cloud_atmosphere_scattering (MIT): noise 3D tạo trên GPU 256³ có mipmap,
// LOD theo khoảng cách, blue noise, mép mềm chỉnh được (threshold/edgeSoftness), chế độ "popcorn",
// chống bóng ma theo khoảng cách (gần: noise tĩnh, xa: noise trượt).
//  3. Composite (trong EffectComposer, trước bloom): scene * transmittance + ánh sáng mây.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { wrap } from '../core/math';
import { Environment } from '../sky/Environment';
import { bakeCloudNoise, GpuCloudNoise } from './gpuNoise';
import { generateWeather } from './weather';

/** Chỉnh mây volumetric ở đây. */
export const VOLUME = {
  bottom: 170,          // đáy lớp mây (m)
  top: 820,             // đỉnh lớp mây (m)
  coverage: 0.42,       // độ phủ 0..1
  density: 0.9,         // độ đặc
  extinction: 0.045,    // hệ số tắt sáng / m (càng lớn mây càng "đục")
  weatherScale: 9000,   // 1 ô weather map = bao nhiêu mét
  shapeScale: 1 / 1600, // 1 ô texture khối = 1600 m
  detailScale: 1 / 230, // tần số chi tiết mép
  detailStrength: 0.38, // độ bào mép (erosionStrength)
  popcorn: true,        // true = mép vồng tròn như súp lơ, false = khoét lỗ xốp
  threshold: 0.0,       // ngưỡng "sàn" của noise
  edgeSoftness: 0.22,   // 0 = mép sắc, 1 = khói rất mềm
  shapeBase: 0.2,       // đáy mây: độ cao (0..1) mà mây đạt đủ bề rộng
  shapeBaseCurve: 0.35, // < 1 = đáy phẳng gọn
  lodDistance: 6000,    // xa dần tới mức này thì lấy mipmap mờ nhất
  ghostCutoff: 300,     // gần hơn mức này: noise tĩnh + chống bóng ma chặt
  minStep: 8,           // bước tia gần camera (m) — nhỏ = mịn, hết vệt bậc thang
  stepGrowth: 0.022,    // bước tăng dần theo khoảng cách
  maxStep: 160,         // bước tia xa nhất (m)
  detailDistance: 2500, // xa hơn mức này bỏ lớp chi tiết (nhanh hơn, mắt không thấy khác)
  nearFade: 45,         // mây tan trong bán kính này quanh camera (góc 3 tự cộng thêm khoảng cách tới tàu)
  lightSteps: 3,
  shadowOffset: 30,     // bước đầu tiên của tia tới mặt trời (m)
  maxDistance: 10000,
  resolutionScale: 0.5, // render mây ở 1/2 độ phân giải
  historyBlend: 0.86,   // trộn với frame trước (0 = tắt temporal)
  sunIntensity: 12,
  ambientIntensity: 0.9,
  wind: new THREE.Vector3(4, 0, 1.5), // m/s
};

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
#include <packing>
uniform sampler3D uShape;
uniform sampler2D uBlue;
uniform vec2 uBlueOffset;
uniform float uHasBlue;
uniform float uMaxLod;
uniform float uLodDist;
uniform float uThreshold;
uniform float uEdgeSoft;
uniform float uShapeBase;
uniform float uShapeBaseCurve;
uniform float uPopcorn;
uniform float uGhostCutoff;
uniform float uShadowOffset;
uniform sampler3D uDetail;
uniform sampler2D uWeather;
uniform sampler2D uDepth;
uniform sampler2D uHistory;
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform vec3 uCamPos;
uniform vec3 uCamFwd;
uniform float uNear;
uniform float uFar;
uniform float uBottom;
uniform float uTop;
uniform float uCoverage;
uniform float uDensity;
uniform float uExtinction;
uniform float uWeatherScale;
uniform float uShapeScale;
uniform float uDetailScale;
uniform float uDetailStrength;
uniform float uMaxDist;
uniform vec3 uWindOffset;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform vec3 uFogColor;
uniform float uFogDist;
uniform float uFrame;
uniform float uHistoryBlend;
uniform float uMinStep;
uniform float uStepGrowth;
uniform float uMaxStep;
uniform float uNearFade;
uniform float uDetailDist;
uniform int uLightSteps;
uniform vec4 uClear[8];
varying vec2 vUv;

float remap(float v, float l0, float h0, float l1, float h1) {
  return l1 + (v - l0) * (h1 - l1) / max(h0 - l0, 1e-5);
}

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.5663706 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

float cloudDensity(vec3 p, float distCam, bool detail) {
  float hf = (p.y - uBottom) / (uTop - uBottom);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec3 q = p + uWindOffset;
  vec2 w = texture(uWeather, q.xz / uWeatherScale).rg;
  float cov = smoothstep(1.0 - uCoverage - 0.12, 1.0 - uCoverage + 0.3, w.r);
  if (cov <= 0.0) return 0.0;

  // Hình dáng theo chiều cao: đáy phẳng (pow), đỉnh thuôn; kênh G = mây thấp dẹt <-> tháp mây cao
  float topH = mix(0.5, 1.0, w.g);
  float shapeBottom = pow(smoothstep(0.0, uShapeBase, hf), uShapeBaseCurve);
  float shapeTop = 1.0 - smoothstep(topH * 0.45, topH, hf);
  float dyn = cov * shapeBottom * shapeTop;
  if (dyn <= 0.0) return 0.0;

  // Khối mây: lấy mipmap mờ dần theo khoảng cách (LOD thủ công như repo gốc)
  float lod = uMaxLod * clamp(distCam / uLodDist, 0.0, 1.0);
  float n = textureLod(uShape, q * uShapeScale, lod).r;
  float dens = remap(n, 1.0 - dyn, 1.0, 0.0, 1.0);
  if (dens <= 0.0) return 0.0;

  if (detail) {
    vec3 d = texture(uDetail, q * uDetailScale).rgb;
    float df = d.r * 0.625 + d.g * 0.25 + d.b * 0.125;
    float pattern = uPopcorn > 0.5 ? 1.0 - df : df;   // popcorn: mép vồng tròn
    float strength = uDetailStrength * (1.0 - clamp(distCam / uDetailDist, 0.0, 1.0));
    dens = remap(dens, pattern * strength, 1.0, 0.0, 1.0);
  }
  dens = clamp(dens, 0.0, 1.0);

  // Dọn mây quanh đảo
  for (int i = 0; i < 8; i++) {
    if (uClear[i].w <= 0.0) continue;
    dens *= smoothstep(uClear[i].w, uClear[i].w + 420.0, distance(p, uClear[i].xyz));
  }
  return dens;
}

/** Mật độ cuối cùng: mép mềm chỉnh được (smoothstep threshold -> threshold + edgeSoftness). */
float finalDensity(float raw) {
  return smoothstep(uThreshold, uThreshold + uEdgeSoft, raw) * uDensity;
}

float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 wp = uInvViewProj * vec4(ndc, 1.0, 1.0);
  wp /= wp.w;
  vec3 dir = normalize(wp.xyz - uCamPos);

  // Khoảng cách tới vật thể (đảo, tàu) -> tia dừng tại đó.
  float sceneDist = 1e9;
  float dz = texture(uDepth, vUv).x;
  if (dz < 1.0) sceneDist = -perspectiveDepthToViewZ(dz, uNear, uFar) / max(dot(dir, uCamFwd), 1e-3);

  // Giao tia với lớp mây
  float t0, t1;
  if (uCamPos.y < uBottom) {
    if (dir.y <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    t0 = (uBottom - uCamPos.y) / dir.y; t1 = (uTop - uCamPos.y) / dir.y;
  } else if (uCamPos.y > uTop) {
    if (dir.y >= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    t0 = (uTop - uCamPos.y) / dir.y; t1 = (uBottom - uCamPos.y) / dir.y;
  } else {
    t0 = 0.0;
    t1 = dir.y > 0.001 ? (uTop - uCamPos.y) / dir.y : (dir.y < -0.001 ? (uBottom - uCamPos.y) / dir.y : uMaxDist);
  }
  t1 = min(t1, min(uMaxDist, sceneDist));
  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // Blue noise (ít vệt hơn IGN). Gần camera dùng noise tĩnh (đỡ bóng ma), xa dùng noise trượt mỗi frame.
  vec2 nuv = gl_FragCoord.xy / 256.0;
  float nStatic = uHasBlue > 0.5 ? texture(uBlue, nuv).r : ign(gl_FragCoord.xy);
  float nSlide = uHasBlue > 0.5 ? texture(uBlue, nuv + uBlueOffset).r : ign(gl_FragCoord.xy + uFrame * 5.588238);
  float jit = t0 < uGhostCutoff ? nStatic : nSlide;
  float t = t0 + clamp(uMinStep + t0 * uStepGrowth, uMinStep, uMaxStep) * jit;
  float dt = uMinStep;

  float cosT = dot(dir, uSunDir);
  float phase = mix(hg(cosT, 0.78), hg(cosT, -0.25), 0.3) + 0.04;

  float T = 1.0;
  vec3 L = vec3(0.0);
  float wDist = 0.0, wSum = 0.0;
  int empty = 0;

  for (int i = 0; i < 320; i++) {
    if (t > t1 || T < 0.01) break;
    // Bước nhỏ ở gần, lớn dần ra xa
    dt = clamp(uMinStep + (t - t0) * uStepGrowth + t0 * uStepGrowth * 0.5, uMinStep, uMaxStep);
    vec3 p = uCamPos + dir * t;
    float dens = finalDensity(cloudDensity(p, t, t < uDetailDist)) * smoothstep(uNearFade * 0.6, uNearFade, t);
    if (dens > 0.002) {
      empty = 0;
      // Tia tới mặt trời: bước dài dần
      float ld = 0.0, ls = uShadowOffset;
      vec3 lp = p;
      for (int j = 0; j < 10; j++) {
        if (j >= uLightSteps) break;
        lp += uSunDir * ls;
        ld += finalDensity(cloudDensity(lp, t, false)) * ls;
        ls *= 1.6;
      }
      float sigma = dens * uExtinction;
      float beer = exp(-ld * uExtinction);
      float multi = exp(-ld * uExtinction * 0.12) * 0.75;  // tán xạ nhiều lần (xấp xỉ) -> mây không xám xịt
      float lightT = max(beer, multi);
      float powder = 1.0 - exp(-dens * uExtinction * 40.0);
      float hf = clamp((p.y - uBottom) / (uTop - uBottom), 0.0, 1.0);
      vec3 amb = mix(uAmbBottom, uAmbTop, smoothstep(0.0, 1.0, hf));
      vec3 S = (uSunColor * lightT * phase * mix(0.6, 1.0, powder) + amb) * sigma;
      float tr = exp(-sigma * dt);
      L += T * (S - S * tr) / max(sigma, 1e-6);
      float a = T * (1.0 - tr);
      wDist += t * a; wSum += a;
      T *= tr;
      t += dt;
    } else {
      // Vùng trống: bước dài hơn cho nhanh
      empty++;
      t += dt * (empty > 2 ? 3.0 : 1.0);
    }
  }

  float md = wSum > 0.0 ? wDist / wSum : max(t0, 1.0);
  // Phối cảnh khí quyển: mây xa nhạt dần vào màu chân trời
  float fogA = 1.0 - exp(-md / uFogDist);
  L = mix(L, uFogColor * (1.0 - T), fogA);
  vec4 cur = vec4(L, T);

  // Temporal: chiếu điểm đại diện về frame trước, trộn lịch sử.
  // - Pixel không chạm mây (wSum = 0) đã chính xác -> không trộn (tránh kéo mây đè lên tàu/đảo).
  // - Lịch sử lệch quá xa giá trị hiện tại (vật vừa lộ ra) -> giảm/bỏ trộn để không có bóng ma.
  if (uHistoryBlend > 0.0 && wSum > 0.0) {
    vec4 pc = uPrevViewProj * vec4(uCamPos + dir * md, 1.0);
    if (pc.w > 0.0) {
      vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
      if (puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0) {
        vec4 h = texture(uHistory, puv);
        float diff = abs(h.a - cur.a);
        // Chống bóng ma theo khoảng cách: gần camera nhạy hơn nhiều (như repo gốc)
        float distF = smoothstep(uGhostCutoff, uGhostCutoff * 2.0, md);
        float sup = mix(0.06, 0.45, distF);
        float blend = uHistoryBlend * (1.0 - smoothstep(sup * 0.33, sup, diff));
        cur = mix(cur, h, blend);
      }
    }
  }
  gl_FragColor = cur;
}`;

const COMPOSITE = {
  uniforms: { tDiffuse: { value: null }, tClouds: { value: null } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tClouds;
    varying vec2 vUv;
    void main() {
      vec4 s = texture2D(tDiffuse, vUv);
      vec4 c = texture2D(tClouds, vUv);
      gl_FragColor = vec4(s.rgb * c.a + c.rgb, s.a);
    }`,
};

export class VolumetricClouds {
  enabled = true;
  /** Bán kính mây tan quanh camera (m). main.ts đặt theo kiểu camera. */
  nearFade = VOLUME.nearFade;
  /** Nhân với VOLUME.coverage (World gán = env.cloudCover để ban đêm ít mây). */
  coverageScale = 1;
  readonly compositePass: ShaderPass;
  private noise: GpuCloudNoise;
  private weatherData: Uint8Array;
  private weatherSize: number;
  private blueOffset = new THREE.Vector2();
  private material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private depthRT: THREE.WebGLRenderTarget;
  private depthCam = new THREE.PerspectiveCamera();
  private depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  private prevViewProj = new THREE.Matrix4();
  private frame = 0;
  private resetHistory = true;
  private windOffset = new THREE.Vector3();
  private clear: THREE.Vector4[];
  private tmpM = new THREE.Matrix4();

  constructor(renderer: THREE.WebGLRenderer, clearZones: [number, number, number, number][], width: number, height: number) {
    this.noise = bakeCloudNoise(renderer);
    const wx = generateWeather();
    this.weatherData = wx.weatherData;
    this.weatherSize = wx.weatherSize;
    // Blue noise 256² (từ repo gốc, MIT) — chưa tải xong thì shader tự dùng IGN
    const blue = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}bluenoise.png`, () => { this.material.uniforms.uHasBlue.value = 1; });
    blue.wrapS = blue.wrapT = THREE.RepeatWrapping;
    blue.minFilter = blue.magFilter = THREE.NearestFilter;
    blue.generateMipmaps = false;
    blue.colorSpace = THREE.NoColorSpace;
    this.clear = Array.from({ length: 8 }, (_, i) => new THREE.Vector4(...(clearZones[i] ?? [0, 0, 0, 0])));

    const [w, h] = this.rtSize(width, height);
    const mk = () => new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.targets = [mk(), mk()];
    this.depthRT = new THREE.WebGLRenderTarget(w, h, { depthTexture: new THREE.DepthTexture(w, h), depthBuffer: true });
    this.depthCam.layers.set(1);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uShape: { value: this.noise.shape }, uDetail: { value: this.noise.detail }, uWeather: { value: wx.weather },
        uBlue: { value: blue }, uBlueOffset: { value: this.blueOffset }, uHasBlue: { value: 0 }, uMaxLod: { value: this.noise.maxLod },
        uLodDist: { value: 6000 }, uThreshold: { value: 0 }, uEdgeSoft: { value: 0.2 }, uShapeBase: { value: 0.2 }, uShapeBaseCurve: { value: 0.35 },
        uPopcorn: { value: 1 }, uGhostCutoff: { value: 300 }, uShadowOffset: { value: 30 },
        uDepth: { value: this.depthRT.depthTexture }, uHistory: { value: null },
        uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() }, uCamFwd: { value: new THREE.Vector3() },
        uNear: { value: 0.3 }, uFar: { value: 30000 },
        uBottom: { value: 0 }, uTop: { value: 0 }, uCoverage: { value: 0 }, uDensity: { value: 0 }, uExtinction: { value: 0 },
        uWeatherScale: { value: 0 }, uShapeScale: { value: 0 }, uDetailScale: { value: 0 }, uDetailStrength: { value: 0 },
        uMaxDist: { value: 0 }, uWindOffset: { value: this.windOffset },
        uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
        uAmbTop: { value: new THREE.Color() }, uAmbBottom: { value: new THREE.Color() },
        uFogColor: { value: new THREE.Color() }, uFogDist: { value: 16000 },
        uFrame: { value: 0 }, uHistoryBlend: { value: 0 }, uMinStep: { value: 8 }, uStepGrowth: { value: 0.014 }, uMaxStep: { value: 110 }, uNearFade: { value: 80 }, uDetailDist: { value: 2500 }, uLightSteps: { value: 6 },
        uClear: { value: this.clear },
      },
    });
    this.quad = new FullScreenQuad(this.material);

    this.compositePass = new ShaderPass(COMPOSITE);
  }

  private rtSize(width: number, height: number): [number, number] {
    return [Math.max(1, Math.round(width * VOLUME.resolutionScale)), Math.max(1, Math.round(height * VOLUME.resolutionScale))];
  }

  setSize(width: number, height: number): void {
    const [w, h] = this.rtSize(width, height);
    this.targets.forEach((t) => t.setSize(w, h));
    this.depthRT.setSize(w, h);
    this.resetHistory = true;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.compositePass.enabled = on;
    this.resetHistory = true;
  }

  /** Gọi khi dịch chuyển tức thời (teleport, load save) để không bị bóng mờ frame cũ. */
  reset(): void {
    this.resetHistory = true;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, env: Environment, dt: number): void {
    if (!this.enabled) return;
    this.windOffset.addScaledVector(VOLUME.wind, dt);
    camera.updateMatrixWorld();

    // 1. Depth prepass: chỉ layer 1 (đảo + tàu)
    this.depthCam.copy(camera, false);
    this.depthCam.layers.set(1);
    const prevOverride = scene.overrideMaterial;
    const prevTarget = renderer.getRenderTarget();
    scene.overrideMaterial = this.depthMat;
    renderer.setRenderTarget(this.depthRT);
    renderer.clear(true, true, true);
    renderer.render(scene, this.depthCam);
    scene.overrideMaterial = prevOverride;

    // 2. Cloud pass
    const u = this.material.uniforms;
    const viewProj = this.tmpM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uInvViewProj.value.copy(viewProj).invert();
    u.uPrevViewProj.value.copy(this.prevViewProj);
    u.uCamPos.value.copy(camera.position);
    camera.getWorldDirection(u.uCamFwd.value);
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uBottom.value = VOLUME.bottom; u.uTop.value = VOLUME.top;
    u.uCoverage.value = VOLUME.coverage * this.coverageScale; u.uDensity.value = VOLUME.density; u.uExtinction.value = VOLUME.extinction;
    u.uWeatherScale.value = VOLUME.weatherScale; u.uShapeScale.value = VOLUME.shapeScale;
    u.uDetailScale.value = VOLUME.detailScale; u.uDetailStrength.value = VOLUME.detailStrength;
    u.uMaxDist.value = VOLUME.maxDistance; u.uLightSteps.value = VOLUME.lightSteps;
    u.uMinStep.value = VOLUME.minStep; u.uStepGrowth.value = VOLUME.stepGrowth; u.uMaxStep.value = VOLUME.maxStep;
    u.uNearFade.value = this.nearFade;
    u.uDetailDist.value = VOLUME.detailDistance;
    u.uLodDist.value = VOLUME.lodDistance;
    u.uThreshold.value = VOLUME.threshold;
    u.uEdgeSoft.value = Math.max(0.001, VOLUME.edgeSoftness);
    u.uShapeBase.value = VOLUME.shapeBase;
    u.uShapeBaseCurve.value = VOLUME.shapeBaseCurve;
    u.uPopcorn.value = VOLUME.popcorn ? 1 : 0;
    u.uGhostCutoff.value = VOLUME.ghostCutoff;
    u.uShadowOffset.value = VOLUME.shadowOffset;
    // Noise trượt: dịch blue noise theo dãy tỉ lệ vàng mỗi frame
    this.blueOffset.set((this.frame * 0.618034) % 1, (this.frame * 0.754878) % 1);

    // Ánh sáng: mặt trời ban ngày / trăng ban đêm, môi trường lấy từ màu trời và biển
    const day = env.dayFactor;
    u.uSunDir.value.copy(env.lightDir);
    u.uSunColor.value.copy(env.c.sun).multiplyScalar(VOLUME.sunIntensity * (0.06 + 0.94 * day));
    const amb = VOLUME.ambientIntensity;
    u.uAmbTop.value.copy(env.c.zenith).lerp(new THREE.Color(1, 1, 1), 0.65).multiplyScalar((0.12 + 0.95 * day) * amb);
    u.uAmbBottom.value.copy(env.c.horizon).lerp(env.c.zenith, 0.3).multiplyScalar((0.06 + 0.55 * day) * amb);
    u.uFogColor.value.copy(env.c.horizon);

    u.uFrame.value = this.frame++ % 64;
    u.uHistoryBlend.value = this.resetHistory ? 0 : VOLUME.historyBlend;
    u.uHistory.value = this.targets[1].texture;

    renderer.setRenderTarget(this.targets[0]);
    this.quad.render(renderer);
    renderer.setRenderTarget(prevTarget);

    this.compositePass.uniforms.tClouds.value = this.targets[0].texture;
    this.targets.reverse(); // frame sau đọc frame này làm lịch sử
    this.prevViewProj.copy(viewProj);
    this.resetHistory = false;
  }

  /** Mật độ mây ở vị trí p (CPU, xấp xỉ khối chính) -> 0..1, dùng cho âm thanh và hiệu ứng trong mây. */
  densityAt(p: THREE.Vector3): number {
    const hf = (p.y - VOLUME.bottom) / (VOLUME.top - VOLUME.bottom);
    if (hf <= 0 || hf >= 1) return 0;
    const qx = p.x + this.windOffset.x, qy = p.y + this.windOffset.y, qz = p.z + this.windOffset.z;
    const W = this.weatherSize;
    const wx = Math.floor(wrap(qx / VOLUME.weatherScale, 1) * W), wz = Math.floor(wrap(qz / VOLUME.weatherScale, 1) * W);
    const wi = (wx + wz * W) * 4;
    const wr = this.weatherData[wi] / 255, wg = this.weatherData[wi + 1] / 255;
    const cov = THREE.MathUtils.smoothstep(wr, 1 - VOLUME.coverage * this.coverageScale - 0.12, 1 - VOLUME.coverage * this.coverageScale + 0.3);
    if (cov <= 0) return 0;
    const topH = 0.5 + 0.5 * wg;
    const bottom = Math.pow(THREE.MathUtils.smoothstep(hf, 0, VOLUME.shapeBase), VOLUME.shapeBaseCurve);
    const dyn = cov * bottom * (1 - THREE.MathUtils.smoothstep(hf, topH * 0.45, topH));
    if (dyn <= 0) return 0;
    const S = this.noise.shapeSize;
    const sx = Math.floor(wrap(qx * VOLUME.shapeScale, 1) * S), sy = Math.floor(wrap(qy * VOLUME.shapeScale, 1) * S), sz = Math.floor(wrap(qz * VOLUME.shapeScale, 1) * S);
    const n = this.noise.shapeData[sx + sy * S + sz * S * S] / 255;
    let d = THREE.MathUtils.clamp((n - (1 - dyn)) / Math.max(dyn, 1e-5), 0, 1);
    for (const c of this.clear) if (c.w > 0) d *= THREE.MathUtils.smoothstep(Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z), c.w, c.w + 420);
    d = THREE.MathUtils.smoothstep(d, VOLUME.threshold, VOLUME.threshold + Math.max(0.001, VOLUME.edgeSoftness));
    return Math.min(1, d * VOLUME.density);
  }
}
