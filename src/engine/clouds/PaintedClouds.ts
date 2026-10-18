// Mây tích kiểu vẽ cọ (painterly): hàng nghìn billboard trong 1 draw call (InstancedBufferGeometry).
// - Cụm mây xếp thành tháp: đáy phẳng, đỉnh vồng.
// - Mép mây là các nét cọ (noise kéo dài theo hướng ngẫu nhiên mỗi puff), không phải hình tròn.
// - Màu chuyển mượt: đáy xanh lam đậm -> bóng xanh nhạt -> thân trắng, viền ấm phía mặt trời.
// - Bay lại gần thì mây mờ dần từ xa (không bị "đâm" vào mảng trắng đột ngột).
// - Vị trí "quấn" quanh người chơi trong shader -> mây vô tận.
import * as THREE from 'three';
import { rng, wrap } from '../core/math';
import { Environment } from '../sky/Environment';
import { NOISE_GLSL } from './shaderChunks';

const WRAP = 3000;                          // nửa cạnh vùng mây quanh người chơi (m)
const WIND = new THREE.Vector2(0.8, 0.35);  // mây trôi chậm (m/s)

const VERT = /* glsl */ `
attribute vec3 iCenter;
attribute float iScale;
attribute float iSeed;
attribute float iH;          // 0 = đáy cụm, 1 = đỉnh cụm
uniform vec3 uPlayer;
uniform float uWrap;
uniform float uTime;
uniform vec2 uWind;
uniform vec4 uClear[8];   // xyz = tâm đảo, w = bán kính vùng dọn mây
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying float vH;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vToCam;
varying float vDist;

void main() {
  vec2 c = iCenter.xz + uWind * uTime;
  vec2 rel = mod(c - uPlayer.xz + uWrap, 2.0 * uWrap) - uWrap;
  vec3 center = vec3(uPlayer.x + rel.x, iCenter.y, uPlayer.z + rel.y);

  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = center + (right * position.x + up * position.y) * iScale;

  float d = distance(cameraPosition, center);
  float edge  = 1.0 - smoothstep(uWrap * 0.72, uWrap, length(rel));
  // Mờ dần khi tiến lại gần: bắt đầu từ ~2.6 lần bán kính, tan hẳn khi gần tâm.
  float nearF = smoothstep(iScale * 0.35, iScale * 2.6, d);
  // Dọn mây quanh đảo để luôn nhìn thấy và cập cảng được.
  float clearF = 1.0;
  for (int i = 0; i < 8; i++) {
    if (uClear[i].w <= 0.0) continue;
    float dd = distance(center, uClear[i].xyz);
    clearF = min(clearF, smoothstep(uClear[i].w, uClear[i].w + 260.0, dd));
  }
  vFade = edge * nearF * clearF;

  vUv = uv;
  vSeed = iSeed;
  vH = iH;
  vRight = right;
  vUp = up;
  vToCam = normalize(cameraPosition - center);
  vDist = distance(cameraPosition, wp);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uDeep;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying float vH;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vToCam;
varying float vDist;
${NOISE_GLSL}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;

  // Nét cọ: noise kéo dài theo 1 hướng riêng của mỗi puff.
  float ang = vSeed * 6.2831;
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 bp = rot * p;
  float brush = vnoise(bp * vec2(1.6, 7.5) + vSeed * 23.0) * 0.6 + vnoise(bp * vec2(3.0, 15.0) + vSeed * 41.0) * 0.4;
  float n = vnoise(p * 2.4 + vSeed * 17.0);
  float dens = (1.0 - r2) + (n - 0.5) * 0.45 + (brush - 0.5) * 0.55;
  float a = smoothstep(0.08, 0.42, dens) * vFade;
  if (a < 0.01) discard;

  vec3 nrm = normalize(vRight * p.x + vUp * p.y + vToCam * sqrt(1.0 - r2));
  float l = dot(nrm, uLightDir) * 0.5 + 0.5;
  l += (brush - 0.5) * 0.25;         // vệt cọ trong thân mây
  l = l * 0.75 + vH * 0.45 - 0.08;   // đáy cụm tối, đỉnh sáng

  // Chuyển màu mượt kiểu vẽ tay: xanh lam đậm ở đáy -> trắng ở đỉnh.
  vec3 col = mix(uDeep, uShade, smoothstep(0.02, 0.38, l));
  col = mix(col, uLit, smoothstep(0.32, 0.66, l));
  // Viền ấm phía có nắng (bloom bắt nhẹ).
  float rim = pow(clamp(dot(nrm, uLightDir), 0.0, 1.0), 6.0) * (1.0 - r2 * 0.5);
  col += uLit * rim * 0.25;

  col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDist) * 0.8);
  gl_FragColor = vec4(col, a * 0.95);
  #include <colorspace_fragment>
}
`;

export class PaintedClouds {
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private centers: Float32Array;
  private scales: Float32Array;
  private count: number;
  private time = 0;

  private clear: THREE.Vector4[];

  /** clearZones: [x, y, z, bán kính] — vùng không có mây (quanh đảo). */
  constructor(scene: THREE.Scene, clearZones: [number, number, number, number][] = []) {
    this.clear = Array.from({ length: 8 }, (_, i) => new THREE.Vector4(...(clearZones[i] ?? [0, 0, 0, 0])));
    const rand = rng(1337);
    const centers: number[] = [], scales: number[] = [], seeds: number[] = [], hs: number[] = [];

    /** Một cụm mây tích: đáy ở baseY, cao towerH, rộng spread. */
    const cumulus = (baseY: number, puffs: number, spread: number, towerH: number, size: [number, number]) => {
      const cx = (rand() * 2 - 1) * WRAP, cz = (rand() * 2 - 1) * WRAP;
      const stretch = 0.55 + rand() * 0.6, angle = rand() * Math.PI;
      for (let i = 0; i < puffs; i++) {
        const h01 = Math.pow(rand(), 1.6);                 // dồn nhiều puff ở thân dưới
        const w = spread * (1 - 0.65 * h01);               // càng lên càng hẹp -> mái vòm
        const u = (rand() * 2 - 1), v = (rand() * 2 - 1) * stretch;
        const lx = u * w, lz = v * w;
        const s = (size[0] + rand() * (size[1] - size[0])) * (1 - 0.35 * h01);
        centers.push(
          cx + lx * Math.cos(angle) - lz * Math.sin(angle),
          baseY + s * 0.45 + h01 * towerH,                 // đáy phẳng
          cz + lx * Math.sin(angle) + lz * Math.cos(angle),
        );
        scales.push(s);
        seeds.push(rand());
        hs.push(0.15 + 0.85 * h01);
      }
    };

    // Mây thấp lác đác trên mặt biển.
    for (let i = 0; i < 26; i++) cumulus(60 + rand() * 60, 10 + Math.floor(rand() * 10), 120 + rand() * 120, 40 + rand() * 60, [45, 95]);
    // Tầng mây chính (độ cao bay): cụm vừa, có tháp.
    for (let i = 0; i < 28; i++) cumulus(170 + rand() * 140, 12 + Math.floor(rand() * 12), 100 + rand() * 110, 70 + rand() * 140, [40, 85]);
    // Mây tích khổng lồ ở xa: tháp cao vút như trong tranh.
    for (let i = 0; i < 18; i++) cumulus(60 + rand() * 60, 40 + Math.floor(rand() * 20), 260 + rand() * 160, 500 + rand() * 400, [90, 170]);

    this.count = scales.length;
    this.centers = new Float32Array(centers);
    this.scales = new Float32Array(scales);

    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.setAttribute('iCenter', new THREE.InstancedBufferAttribute(this.centers, 3));
    geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(this.scales, 1));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
    geo.setAttribute('iH', new THREE.InstancedBufferAttribute(new Float32Array(hs), 1));
    geo.instanceCount = this.count;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uPlayer: { value: new THREE.Vector3() },
        uWrap: { value: WRAP },
        uTime: { value: 0 },
        uWind: { value: WIND },
        uClear: { value: this.clear },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) },
        uLit: { value: new THREE.Color() },
        uShade: { value: new THREE.Color() },
        uDeep: { value: new THREE.Color() },
        uFogColor: { value: new THREE.Color() },
        uFogNear: { value: 1100 },
        uFogFar: { value: 7500 },
      },
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }

  get puffCount(): number {
    return this.count;
  }

  /** Trả về mật độ mây tại vị trí camera (0..1) để làm hiệu ứng "đang trong mây". */
  update(dt: number, player: THREE.Vector3, env: Environment): number {
    this.time += dt;
    const u = this.material.uniforms;
    u.uPlayer.value.copy(player);
    u.uTime.value = this.time;
    u.uLightDir.value.copy(env.lightDir);
    u.uLit.value.copy(env.c.cloudLit);
    u.uShade.value.copy(env.c.cloudShade);
    u.uDeep.value.copy(env.c.cloudDeep);
    u.uFogColor.value.copy(env.c.fog);
    u.uFogNear.value = env.fog.near;
    u.uFogFar.value = env.fog.far;

    // Cùng công thức wrap như shader, chạy trên CPU (vài nghìn phép tính, rất rẻ).
    let density = 0;
    const ox = WIND.x * this.time, oz = WIND.y * this.time, span = WRAP * 2;
    for (let i = 0; i < this.count; i++) {
      const s = this.scales[i] * 0.75;
      const dy = this.centers[i * 3 + 1] - player.y;
      if (Math.abs(dy) > s) continue;
      const dx = wrap(this.centers[i * 3] + ox - player.x + WRAP, span) - WRAP;
      const dz = wrap(this.centers[i * 3 + 2] + oz - player.z + WRAP, span) - WRAP;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < s * s) {
        // Puff gần đảo đã bị shader ẩn -> không tính.
        const px = player.x + dx, py = this.centers[i * 3 + 1], pz = player.z + dz;
        let visible = 1;
        for (const c of this.clear) if (c.w > 0) visible = Math.min(visible, THREE.MathUtils.smoothstep(Math.hypot(px - c.x, py - c.y, pz - c.z), c.w, c.w + 260));
        density += (1 - Math.sqrt(d2) / s) * visible;
      }
    }
    return Math.min(1, density * 0.7);
  }
}
