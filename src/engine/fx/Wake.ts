// Hiệu ứng nước kiểu anime cho vật chạm mặt biển (thuyền, tàu hạ xuống nước, cá, đá ném…):
//  - foam(): mảng bọt trắng nằm trên mặt nước, loang to dần, trôi ra ngoài rồi vỡ lỗ chỗ và tan (vệt sóng chữ V sau thuyền)
//  - ring(): vòng gợn sóng lan ra (chạm nước, thuyền đứng yên bồng bềnh)
//  - spray(): tia nước bắn lên rồi rơi theo trọng lực (mũi thuyền rẽ sóng, cú đáp xuống nước)
// Mọi thứ tính trên GPU theo tuổi hạt, CPU chỉ ghi lúc sinh ra nên rất nhẹ. Hạt nằm theo mực nước nhấp nhô (waterLevelNow).
//
// Dùng:
//   const wake = new Wake(world.scene);
//   wake.foam(x, z, vx, vz, 2, 7);           // bọt ở (x, z), trôi theo (vx, vz) m/s, to từ 2 m lên 7 m
//   mỗi frame: wake.update(dt, camera, world.renderer.domElement.height);
import * as THREE from 'three';
import { waterLevelNow } from '../water/Ocean';

/** Chỉnh hiệu ứng nước ở đây (dùng chung cho mọi Wake). */
export const WAKE_FX = {
  foamLife: 5,        // giây: mảng bọt sống bao lâu (vệt sóng dài cỡ tốc độ x thời gian này)
  ringLife: 4.5,      // giây: vòng gợn sóng
  sprayLife: 1.2,     // giây: tia nước tối đa
  opacity: 0.8,
  breakup: 1.0,       // bọt vỡ lỗ chỗ nhiều cỡ nào về cuối đời (0 = giữ nguyên mảng)
  drag: 0.55,         // bọt trôi chậm dần (lớn = dừng sớm)
  gravity: 9.8,       // tia nước rơi xuống
};

const MAX_FOAM = 1024;
const MAX_SPRAY = 512;

const NOISE = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}`;

const FOAM_VERT = /* glsl */ `
uniform float uTime; uniform float uWaterY; uniform float uDrag;
attribute vec4 iA;   // x, z, vx, vz
attribute vec4 iB;   // sinh lúc, sống bao lâu, cỡ đầu, cỡ cuối
attribute vec2 iC;   // loại (0 bọt, 1 vòng), hạt giống
varying vec2 vUv; varying float vT; varying float vKind; varying float vSeed;
#include <fog_pars_vertex>
void main() {
  float age = uTime - iB.x;
  float t = age / iB.y;
  vUv = position.xy; vT = t; vKind = iC.x; vSeed = iC.y;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // chưa sinh / đã tan: đẩy ra ngoài màn hình
  float drift = (1.0 - exp(-age * uDrag)) / uDrag;          // trôi chậm dần
  float grow = 1.0 - (1.0 - t) * (1.0 - t);
  float size = mix(iB.z, iB.w, grow);
  vec3 p = vec3(iA.x + iA.z * drift + position.x * size, uWaterY + 0.07 + iC.x * 0.01, iA.y + iA.w * drift + position.y * size);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FOAM_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity; uniform float uBreak; uniform float uTime;
varying vec2 vUv; varying float vT; varying float vKind; varying float vSeed;
${NOISE}
#include <fog_pars_fragment>
void main() {
  float r = length(vUv);
  float n = vnoise(vUv * 2.6 + vSeed * 17.0);
  float a;
  if (vKind < 0.5) {
    // mảng bọt: mép gợn, vỡ lỗ chỗ dần theo tuổi; viền ngoài sáng hơn (2 tông kiểu cel)
    float edge = 0.62 + 0.3 * n;
    float holes = vnoise(vUv * 5.5 + vSeed * 31.0 + vT * 1.5);
    a = step(r, edge) * step(vT * uBreak, holes * 1.15);
    float rim = step(edge - 0.12, r);
    gl_FragColor = vec4(uColor * mix(0.9, 1.0, rim), 1.0);
  } else {
    // vòng gợn: dải mảnh, đứt quãng
    float w = mix(0.07, 0.025, vT);
    a = step(abs(r - 0.82 - 0.08 * n), w) * step(0.25 + vT * 0.5, vnoise(vUv * 7.0 + vSeed * 13.0) + 0.3);
    gl_FragColor = vec4(uColor, 1.0);
  }
  a *= uOpacity * (1.0 - smoothstep(0.55, 1.0, vT)) * smoothstep(0.0, 0.04, vT);
  if (a < 0.01) discard;
  gl_FragColor.a = a;
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

const SPRAY_VERT = /* glsl */ `
uniform float uTime; uniform float uWaterY; uniform float uGravity; uniform float uPx;
attribute vec3 aV; attribute vec3 aInfo; // sinh lúc, sống bao lâu, cỡ (m)
varying float vT;
#include <fog_pars_vertex>
void main() {
  float age = uTime - aInfo.x;
  vT = age / aInfo.y;
  vec3 p = position + aV * age + vec3(0.0, -0.5 * uGravity * age * age, 0.0);
  if (vT < 0.0 || vT > 1.0 || p.y < uWaterY - 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(aInfo.z * (1.0 - 0.5 * vT) * uPx / -mvPosition.z, 1.0, 64.0);
  #include <fog_vertex>
}`;

const SPRAY_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity;
varying float vT;
#include <fog_pars_fragment>
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  gl_FragColor = vec4(uColor, uOpacity * (1.0 - smoothstep(0.6, 1.0, vT)));
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

export class Wake {
  readonly foamMesh: THREE.Mesh;
  readonly sprayPoints: THREE.Points;
  private time = 0;
  private foamA = new Float32Array(MAX_FOAM * 4);
  private foamB = new Float32Array(MAX_FOAM * 4).fill(-1e6);
  private foamC = new Float32Array(MAX_FOAM * 2);
  private sprayP = new Float32Array(MAX_SPRAY * 3);
  private sprayV = new Float32Array(MAX_SPRAY * 3);
  private sprayI = new Float32Array(MAX_SPRAY * 3).fill(-1e6);
  private nf = 0;
  private ns = 0;
  private dirtyF = false;
  private dirtyS = false;
  private foamGeo: THREE.InstancedBufferGeometry;
  private sprayGeo = new THREE.BufferGeometry();
  private foamMat: THREE.ShaderMaterial;
  private sprayMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const quad = new THREE.PlaneGeometry(2, 2);
    this.foamGeo = new THREE.InstancedBufferGeometry();
    this.foamGeo.index = quad.index;
    this.foamGeo.setAttribute('position', quad.getAttribute('position'));
    this.foamGeo.setAttribute('iA', new THREE.InstancedBufferAttribute(this.foamA, 4));
    this.foamGeo.setAttribute('iB', new THREE.InstancedBufferAttribute(this.foamB, 4));
    this.foamGeo.setAttribute('iC', new THREE.InstancedBufferAttribute(this.foamC, 2));
    this.foamGeo.instanceCount = MAX_FOAM;
    const common = {
      uTime: { value: 0 }, uWaterY: { value: 0 }, uColor: { value: new THREE.Color(0xe6f4f2) }, uOpacity: { value: WAKE_FX.opacity },
    };
    this.foamMat = new THREE.ShaderMaterial({
      vertexShader: FOAM_VERT, fragmentShader: FOAM_FRAG, transparent: true, depthWrite: false, fog: true,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...common, uBreak: { value: WAKE_FX.breakup }, uDrag: { value: WAKE_FX.drag } },
    });
    // tứ giác dựng trên mặt phẳng XY trong geometry, shader đặt nằm ngang trên mặt nước
    this.foamMesh = new THREE.Mesh(this.foamGeo, this.foamMat);
    this.foamMesh.frustumCulled = false;
    this.foamMesh.renderOrder = 4; // sau mặt nước (renderOrder 2) để nước không phủ lên bọt

    this.sprayGeo.setAttribute('position', new THREE.BufferAttribute(this.sprayP, 3));
    this.sprayGeo.setAttribute('aV', new THREE.BufferAttribute(this.sprayV, 3));
    this.sprayGeo.setAttribute('aInfo', new THREE.BufferAttribute(this.sprayI, 3));
    this.sprayMat = new THREE.ShaderMaterial({
      vertexShader: SPRAY_VERT, fragmentShader: SPRAY_FRAG, transparent: true, depthWrite: false, fog: true,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...THREE.UniformsUtils.clone(common), uGravity: { value: WAKE_FX.gravity }, uPx: { value: 500 } },
    });
    this.sprayPoints = new THREE.Points(this.sprayGeo, this.sprayMat);
    this.sprayPoints.frustumCulled = false;
    this.sprayPoints.renderOrder = 5;
    scene.add(this.foamMesh, this.sprayPoints);
  }

  /** Mảng bọt tại (x, z), trôi theo (vx, vz) m/s (chậm dần), to từ size0 tới size1 (bán kính, m). */
  foam(x: number, z: number, vx: number, vz: number, size0: number, size1: number, life = WAKE_FX.foamLife): void {
    this.put(x, z, vx, vz, life, size0, size1, 0);
  }

  /** Vòng gợn sóng tại (x, z), lan từ bán kính r0 tới r1 (m). */
  ring(x: number, z: number, r0: number, r1: number, life = WAKE_FX.ringLife): void {
    this.put(x, z, 0, 0, life, r0 / 0.82, r1 / 0.82, 1);
  }

  /** Tia nước: bắn từ p với vận tốc v (m/s), cỡ giọt `size` (m). */
  spray(p: THREE.Vector3, v: THREE.Vector3, size = 0.5, life = WAKE_FX.sprayLife): void {
    const i = this.ns;
    this.ns = (this.ns + 1) % MAX_SPRAY;
    this.sprayP.set([p.x, p.y, p.z], i * 3);
    this.sprayV.set([v.x, v.y, v.z], i * 3);
    this.sprayI.set([this.time, life * (0.6 + 0.4 * Math.random()), size], i * 3);
    this.dirtyS = true;
  }

  /** Màu bọt (vd. ban đêm tối đi theo ánh trời). */
  setTint(c: THREE.Color): void {
    this.foamMat.uniforms.uColor.value.copy(c);
    this.sprayMat.uniforms.uColor.value.copy(c);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    this.time += dt;
    const wy = waterLevelNow();
    for (const m of [this.foamMat, this.sprayMat]) {
      m.uniforms.uTime.value = this.time;
      m.uniforms.uWaterY.value = wy;
      m.uniforms.uOpacity.value = WAKE_FX.opacity;
    }
    this.foamMat.uniforms.uBreak.value = WAKE_FX.breakup;
    this.foamMat.uniforms.uDrag.value = Math.max(0.01, WAKE_FX.drag);
    this.sprayMat.uniforms.uGravity.value = WAKE_FX.gravity;
    // đổi cỡ giọt (m) ra pixel: chiều cao khung hình * 0.5 * cot(fov/2)
    this.sprayMat.uniforms.uPx.value = viewportHeight * 0.5 * camera.projectionMatrix.elements[5];
    if (this.dirtyF) {
      for (const n of ['iA', 'iB', 'iC']) (this.foamGeo.getAttribute(n) as THREE.InstancedBufferAttribute).needsUpdate = true;
      this.dirtyF = false;
    }
    if (this.dirtyS) {
      for (const n of ['position', 'aV', 'aInfo']) (this.sprayGeo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
      this.dirtyS = false;
    }
  }

  private put(x: number, z: number, vx: number, vz: number, life: number, s0: number, s1: number, kind: number): void {
    const i = this.nf;
    this.nf = (this.nf + 1) % MAX_FOAM;
    this.foamA.set([x, z, vx, vz], i * 4);
    this.foamB.set([this.time, life * (0.85 + 0.3 * Math.random()), s0, s1], i * 4);
    this.foamC.set([kind, Math.random()], i * 2);
    this.dirtyF = true;
  }
}
