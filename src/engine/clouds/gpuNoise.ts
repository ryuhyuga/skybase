// Tạo noise 3D cho mây trên GPU (vẽ từng lát cắt rồi đọc ngược về), có mipmap.
// Chuyển thể từ CloudGeneratorShader / DetailGeneratorShader của
// leoawen/volumetric_cloud_atmosphere_scattering (MIT, © 2026 Leonardo Soares Gonçalves).
//
// - shape  (256³, 1 kênh): Perlin fbm (khối khói) trộn Worley fbm (bọt "popcorn"), erosion + contrast.
// - detail (32³, RGB): Worley 3 tần số để bào mép mây.
// Cả hai tileable (dùng mod theo chu kỳ) -> lặp liền mạch.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Chỉnh cách tạo khối mây ở đây (giống WORLD_CONFIG.generation của repo gốc). */
export const CLOUD_GEN = {
  resolution: 256,                // độ phân giải texture khối (128 nếu muốn khởi động nhanh hơn)
  layer1: { repeat: 2, scale: 1.0, seed: 0.0 }, // Perlin: hình khối lớn
  layer2: { repeat: 8, scale: 1.0, seed: 0.1 }, // Worley: bọt bồng
  mixStrength: 0.3,               // 0 = chỉ khói Perlin, 1 = toàn bọt Worley
  erosion: 0.3,
  contrast: 1.8,
  detail: { resolution: 32, scaleR: 2, scaleG: 4, scaleB: 8, seed: 0.2 },
};

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMMON = /* glsl */ `
vec3 hash33s(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
vec3 hash33u(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
float worleyNoise(vec3 p, float period, float seed) {
  vec3 id = floor(p), f = fract(p);
  float minDist = 1.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 nb = vec3(float(x), float(y), float(z));
    vec3 pt = hash33u(mod(id + nb, period) + vec3(seed * 10.0));
    minDist = min(minDist, length(nb + pt - f));
  }
  return 1.0 - clamp(minDist, 0.0, 1.0);
}`;

const SHAPE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uSliceZ;
uniform float uRepeat1, uScale1, uSeed1, uRepeat2, uScale2, uSeed2, uMixStrength, uContrast, uErosion;
${COMMON}
float periodicNoise(vec3 p, float period) {
  vec3 pi = floor(p), pf = fract(p);
  vec3 w = pf * pf * (3.0 - 2.0 * pf);
  vec3 p0 = mod(pi, period), p1 = mod(pi + 1.0, period);
  float n000 = dot(hash33s(vec3(p0.x, p0.y, p0.z)), pf - vec3(0, 0, 0));
  float n100 = dot(hash33s(vec3(p1.x, p0.y, p0.z)), pf - vec3(1, 0, 0));
  float n010 = dot(hash33s(vec3(p0.x, p1.y, p0.z)), pf - vec3(0, 1, 0));
  float n110 = dot(hash33s(vec3(p1.x, p1.y, p0.z)), pf - vec3(1, 1, 0));
  float n001 = dot(hash33s(vec3(p0.x, p0.y, p1.z)), pf - vec3(0, 0, 1));
  float n101 = dot(hash33s(vec3(p1.x, p0.y, p1.z)), pf - vec3(1, 0, 1));
  float n011 = dot(hash33s(vec3(p0.x, p1.y, p1.z)), pf - vec3(0, 1, 1));
  float n111 = dot(hash33s(vec3(p1.x, p1.y, p1.z)), pf - vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, w.x), mix(n010, n110, w.x), w.y), mix(mix(n001, n101, w.x), mix(n011, n111, w.x), w.y), w.z);
}
float fbmPerlin(vec3 p, float repeat, float scale) {
  float f = 0.0, amp = 0.5, period = repeat * scale;
  vec3 q = p * scale;
  for (int i = 0; i < 4; i++) { f += amp * periodicNoise(q, period); q *= 2.0; period *= 2.0; amp *= 0.5; }
  return f + 0.5;
}
float fbmWorley(vec3 p, float repeat, float scale) {
  float f = 0.0, amp = 0.5, period = repeat * scale;
  vec3 q = p * scale;
  for (int i = 0; i < 3; i++) { f += amp * worleyNoise(q, period, uSeed2); q *= 2.0; period *= 2.0; amp *= 0.5; }
  return f * 0.8;
}
void main() {
  // Lưu ý: seed của lớp Perlin cộng sau khi nhân repeat nên phải là số nguyên * period để không phá tile -> dùng 0.
  vec3 pos1 = vec3(vUv.x, uSliceZ, vUv.y) * uRepeat1;
  float baseCloud = fbmPerlin(pos1 + vec3(floor(uSeed1 * 10.0) * uRepeat1), uRepeat1, uScale1);
  vec3 pos2 = vec3(vUv.x, uSliceZ, vUv.y) * uRepeat2;
  float structure = fbmWorley(pos2, uRepeat2, uScale2);
  float f = mix(baseCloud, structure, uMixStrength);
  f = mix(f, f * f, uErosion);
  float d = clamp(uContrast * (f - 0.5) + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(d, d, d, 1.0);
}`;

const DETAIL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uSliceZ, uScaleR, uScaleG, uScaleB, uSeed;
${COMMON}
void main() {
  vec3 pos = vec3(vUv.x, uSliceZ, vUv.y);
  gl_FragColor = vec4(worleyNoise(pos * uScaleR, uScaleR, uSeed), worleyNoise(pos * uScaleG, uScaleG, uSeed),
                      worleyNoise(pos * uScaleB, uScaleB, uSeed), 1.0);
}`;

/** Vẽ từng lát z của khối size³ bằng shader, gom về mảng CPU. channels = số kênh giữ lại. */
function bake(renderer: THREE.WebGLRenderer, frag: string, uniforms: Record<string, { value: unknown }>, size: number, channels: 1 | 4): Uint8Array {
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: { uSliceZ: { value: 0 }, ...uniforms } });
  const quad = new FullScreenQuad(mat);
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false });
  const px = new Uint8Array(size * size * 4);
  const out = new Uint8Array(size * size * size * channels);
  const prev = renderer.getRenderTarget();
  for (let z = 0; z < size; z++) {
    mat.uniforms.uSliceZ.value = (z + 0.5) / size;
    renderer.setRenderTarget(rt);
    quad.render(renderer);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    const off = z * size * size * channels;
    if (channels === 1) for (let i = 0; i < size * size; i++) out[off + i] = px[i * 4];
    else out.set(px, off);
  }
  renderer.setRenderTarget(prev);
  rt.dispose(); mat.dispose(); quad.dispose();
  return out;
}

function tex3D(data: Uint8Array<ArrayBuffer>, size: number, format: THREE.AnyPixelFormat): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = format;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; // mây xa tự lấy mức mờ hơn -> hết lấm tấm
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export interface GpuCloudNoise {
  shape: THREE.Data3DTexture;
  detail: THREE.Data3DTexture;
  /** Bản CPU của khối shape (1 byte/voxel) để tra mật độ ở vị trí camera. */
  shapeData: Uint8Array;
  shapeSize: number;
  maxLod: number;
}

export function bakeCloudNoise(renderer: THREE.WebGLRenderer): GpuCloudNoise {
  const g = CLOUD_GEN, S = g.resolution, D = g.detail.resolution;
  const t0 = performance.now();
  const shapeData = bake(renderer, SHAPE_FRAG, {
    uRepeat1: { value: g.layer1.repeat }, uScale1: { value: g.layer1.scale }, uSeed1: { value: g.layer1.seed },
    uRepeat2: { value: g.layer2.repeat }, uScale2: { value: g.layer2.scale }, uSeed2: { value: g.layer2.seed },
    uMixStrength: { value: g.mixStrength }, uContrast: { value: g.contrast }, uErosion: { value: g.erosion },
  }, S, 1);
  const detailData = bake(renderer, DETAIL_FRAG, {
    uScaleR: { value: g.detail.scaleR }, uScaleG: { value: g.detail.scaleG }, uScaleB: { value: g.detail.scaleB }, uSeed: { value: g.detail.seed },
  }, D, 4);
  console.info(`[clouds] baked noise ${S}³ + ${D}³ in ${Math.round(performance.now() - t0)} ms`);
  return {
    shape: tex3D(shapeData as Uint8Array<ArrayBuffer>, S, THREE.RedFormat),
    detail: tex3D(detailData as Uint8Array<ArrayBuffer>, D, THREE.RGBAFormat),
    shapeData, shapeSize: S, maxLod: Math.log2(S) - 3,
  };
}
