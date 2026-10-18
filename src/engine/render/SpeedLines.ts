// Speed lines kiểu anime: tia trắng mảnh toả ra từ tâm màn hình khi bay nhanh / đang tăng tốc.
// Là 1 pass hậu kỳ (sau bloom, trước OutputPass). Góc 1: tia vào sâu gần tâm; góc 3: chỉ ở viền.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { damp } from '../core/math';

/** Chỉnh speed lines ở đây. */
export const SPEED_LINES = {
  minSpeed: 24,          // m/s: bắt đầu xuất hiện (ga "Vừa" = 20, "Nhanh" = 32, "Hết ga" = 45)
  fullSpeed: 45,         // m/s: mạnh nhất
  accelBoost: 0.5,       // cộng thêm khi đang tăng tốc
  innerFirst: 0.22,      // góc 1: tia bắt đầu từ bán kính này (0 = tâm, ~0.9 = góc màn hình)
  innerThird: 0.62,      // góc 3: chỉ ở viền
  count: 140,            // số "khe" tia quanh vòng tròn
  opacity: 0.75,
};

const SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uInner: { value: 0.6 },
    uAspect: { value: 1 },
    uCount: { value: 140 },
    uOpacity: { value: 0.75 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uIntensity;
    uniform float uInner;
    uniform float uAspect;
    uniform float uCount;
    uniform float uOpacity;
    varying vec2 vUv;
    float hash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uIntensity < 0.003) { gl_FragColor = base; return; }
      vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(p) / (0.5 * length(vec2(uAspect, 1.0))); // 0 tâm .. 1 góc màn hình
      float a = atan(p.y, p.x) / 6.28318 + 0.5;
      float seg = a * uCount;
      float id = floor(seg);
      float f = fract(seg);
      // Mỗi khe đổi trạng thái ~14 lần/giây, lệch pha ngẫu nhiên -> nhấp nháy như vẽ tay
      float tick = floor(uTime * 14.0 + hash(id) * 7.0);
      float h = hash(id * 13.17 + tick * 1.731);
      float h2 = hash(id * 7.31 + tick * 3.11);
      float on = step(1.0 - uIntensity * 0.45, h);
      float start = uInner + h2 * 0.22 * (1.0 - uInner);
      // Nét mảnh, thon dần vào trong
      float w = mix(0.06, 0.22, h2) * smoothstep(start, 1.0, r);
      float line = smoothstep(w, 0.0, abs(f - 0.5));
      float radial = smoothstep(start, start + 0.12, r);
      float alpha = on * line * radial * uOpacity * min(1.0, uIntensity * 1.6);
      gl_FragColor = vec4(mix(base.rgb, vec3(1.0), alpha), base.a);
    }`,
};

export class SpeedLines {
  readonly pass: ShaderPass;
  private intensity = 0;
  private prevSpeed = 0;
  private accel = 0;
  private time = 0;

  constructor() {
    this.pass = new ShaderPass(SHADER);
  }

  update(dt: number, speed: number, mode: 'first' | 'third', aspect: number): void {
    this.time += dt;
    const sp = Math.abs(speed);
    // Gia tốc (m/s²), làm mượt; chỉ tính khi đang tăng tốc
    const a = dt > 0 ? (sp - this.prevSpeed) / dt : 0;
    this.prevSpeed = sp;
    this.accel = damp(this.accel, Math.max(0, a), 4, dt);

    const k = THREE.MathUtils.smoothstep(sp, SPEED_LINES.minSpeed, SPEED_LINES.fullSpeed);
    const boost = SPEED_LINES.accelBoost * Math.min(1, this.accel / 6) * THREE.MathUtils.smoothstep(sp, 12, 24);
    const target = Math.min(1, k + boost);
    this.intensity = damp(this.intensity, target, target > this.intensity ? 4 : 2, dt);

    const u = this.pass.uniforms;
    u.uTime.value = this.time;
    u.uIntensity.value = this.intensity;
    u.uInner.value = mode === 'first' ? SPEED_LINES.innerFirst : SPEED_LINES.innerThird;
    u.uAspect.value = aspect;
    u.uCount.value = SPEED_LINES.count;
    u.uOpacity.value = SPEED_LINES.opacity;
    this.pass.enabled = this.intensity > 0.003;
  }
}
