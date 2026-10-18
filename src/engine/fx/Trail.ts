// Vệt khí (trail) kiểu anime: dải trắng mềm kéo dài sau một điểm neo (mép khí cầu, đầu cánh, ván lướt...).
// Điểm được ghi theo toạ độ thế giới nên vệt ở lại phía sau khi vật bay đi. Luôn quay mặt về camera,
// mờ dần + loe rộng dần theo tuổi, gợn sóng nhẹ, mép mềm. Bay càng nhanh vệt càng rõ, đứng yên thì tắt.
//
// Dùng:
//   const left = new Trail(scene, anchorObject);          // anchorObject: Object3D con của tàu, đặt ở mép
//   mỗi frame: left.update(dt, camera, speed);
import * as THREE from 'three';

/** Chỉnh vệt khí ở đây (bảng G cũng chỉnh được nếu game thêm mục). Dùng chung cho mọi Trail. */
export const TRAIL_FX = {
  life: 1.3,          // giây: vệt dài bằng quãng đường bay trong ngần này thời gian
  width: 1.8,         // bề rộng ở gốc (m)
  spread: 2.2,        // cuối vệt rộng gấp mấy lần gốc (khí loang ra)
  opacity: 0.8,
  minSpeed: 8,        // m/s: bắt đầu hiện
  fullSpeed: 32,      // m/s: rõ nhất
  wobble: 0.35,       // gợn sóng ngang (m) ở cuối vệt
  wobbleFreq: 7,      // tần số gợn
  core: 0.45,         // 0 = dải mềm đều, 1 = lõi sáng mảnh ở giữa
};

const MAX_POINTS = 64;

const VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSide;
varying float vAlpha;
varying float vSide;
#include <fog_pars_vertex>
void main() {
  vAlpha = aAlpha;
  vSide = aSide;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uCore;
varying float vAlpha;
varying float vSide;
#include <fog_pars_fragment>
void main() {
  float edge = 1.0 - abs(vSide);                 // 1 ở giữa, 0 ở mép
  float soft = mix(edge, pow(edge, 3.0), uCore);  // lõi sáng hơn mép
  float a = vAlpha * soft;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

interface Pt { p: THREE.Vector3; age: number }

export class Trail {
  readonly mesh: THREE.Mesh;
  private pts: Pt[] = [];
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(MAX_POINTS * 2 * 3);
  private alpha = new Float32Array(MAX_POINTS * 2);
  private material: THREE.ShaderMaterial;
  private intensity = 0;
  private sample = 0;
  private phase = Math.random() * 10;
  private tmp = new THREE.Vector3();
  private tan = new THREE.Vector3();
  private toCam = new THREE.Vector3();
  private side = new THREE.Vector3();

  /** scale: nhân bề rộng / độ đậm riêng cho vệt này (vd. vệt phụ mảnh hơn). */
  constructor(scene: THREE.Scene, private anchor: THREE.Object3D, private scale = { width: 1, opacity: 1 }) {
    const sideAttr = new Float32Array(MAX_POINTS * 2);
    const idx: number[] = [];
    for (let i = 0; i < MAX_POINTS; i++) {
      sideAttr[i * 2] = -1; sideAttr[i * 2 + 1] = 1;
      if (i < MAX_POINTS - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(sideAttr, 1));
    this.geo.setIndex(idx);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(0xffffff) }, uCore: { value: TRAIL_FX.core } }]),
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  /** Màu vệt (vd. ban đêm tối đi, ngả màu trời). */
  setTint(c: THREE.Color): void {
    this.material.uniforms.uColor.value.copy(c);
  }

  /** Xoá vệt (khi dịch chuyển tức thời). */
  reset(): void {
    this.pts.length = 0;
  }

  update(dt: number, camera: THREE.Camera, speed: number): void {
    const C = TRAIL_FX;
    const target = THREE.MathUtils.smoothstep(Math.abs(speed), C.minSpeed, C.fullSpeed);
    this.intensity += (target - this.intensity) * (1 - Math.exp(-3 * dt));
    this.phase += dt;
    this.material.uniforms.uCore.value = C.core;

    // Tuổi điểm cũ tăng; bỏ điểm quá tuổi
    for (const q of this.pts) q.age += dt;
    while (this.pts.length && this.pts[this.pts.length - 1].age > C.life) this.pts.pop();

    // Ghi điểm mới ở đầu (giãn cách theo thời gian để vệt dài cố định số điểm)
    const head = this.anchor.getWorldPosition(this.tmp);
    this.sample += dt;
    const step = C.life / (MAX_POINTS - 2);
    if (!this.pts.length || this.sample >= step) {
      this.sample = 0;
      this.pts.unshift({ p: head.clone(), age: 0 });
      if (this.pts.length > MAX_POINTS - 1) this.pts.length = MAX_POINTS - 1;
    }

    const n = this.pts.length + 1; // điểm 0 = vị trí neo hiện tại (vệt dính liền vào tàu)
    this.mesh.visible = this.intensity > 0.01 && n > 2;
    if (!this.mesh.visible) return;

    const camPos = camera.position;
    for (let i = 0; i < MAX_POINTS; i++) {
      const k = i * 2;
      if (i >= n) { this.alpha[k] = this.alpha[k + 1] = 0; continue; }
      const cur = i === 0 ? head : this.pts[i - 1].p;
      const age = i === 0 ? 0 : this.pts[i - 1].age;
      const prev = i === 0 ? head : i === 1 ? head : this.pts[i - 2].p;
      const next = i + 1 < n ? this.pts[i].p : cur;
      this.tan.subVectors(prev, next);
      if (this.tan.lengthSq() < 1e-8) this.tan.set(0, 0, 1);
      this.tan.normalize();
      this.toCam.subVectors(camPos, cur).normalize();
      this.side.crossVectors(this.tan, this.toCam);
      if (this.side.lengthSq() < 1e-8) this.side.set(1, 0, 0);
      this.side.normalize();

      const u = Math.min(1, age / C.life);
      const hw = C.width * this.scale.width * 0.5 * (1 + (C.spread - 1) * u);
      // gợn sóng vuông góc với hướng bay, lớn dần về cuối
      const wob = Math.sin(age * C.wobbleFreq + this.phase * 2.3) * C.wobble * u;
      const cx = cur.x + this.side.x * wob, cy = cur.y + this.side.y * wob, cz = cur.z + this.side.z * wob;
      const p = k * 3;
      this.pos[p] = cx - this.side.x * hw; this.pos[p + 1] = cy - this.side.y * hw; this.pos[p + 2] = cz - this.side.z * hw;
      this.pos[p + 3] = cx + this.side.x * hw; this.pos[p + 4] = cy + this.side.y * hw; this.pos[p + 5] = cz + this.side.z * hw;
      // mờ dần về cuối, hiện dần từ gốc (không có mép cắt cứng ở chỗ neo)
      const a = C.opacity * this.scale.opacity * this.intensity * Math.pow(1 - u, 1.6) * THREE.MathUtils.smoothstep(u, 0, 0.06);
      this.alpha[k] = this.alpha[k + 1] = a;
    }
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('aAlpha').needsUpdate = true;
  }
}
