// Gió kiểu Wind Waker: vài sợi gió trắng mảnh, thoang thoảng.
// Mỗi sợi là một "nét bút": đầu chạy theo đường cong (hướng gió + uốn lượn, thỉnh thoảng cuộn 1 vòng),
// đuôi kéo theo sau rồi tan. Không lao vào camera; chỉ trôi trong thế giới quanh tàu.
// Toàn bộ sợi gió nằm trong 1 BufferGeometry, cập nhật trên CPU mỗi frame (rất nhẹ).
import * as THREE from 'three';

/** Chỉnh gió ở đây. */
export const WIND_FX = {
  wisps: 7,              // số sợi gió tối đa cùng lúc (<= 32)
  spawnEvery: [0.6, 1.8] as [number, number], // giây giữa 2 lần xuất hiện
  life: [3.2, 5.0] as [number, number],       // tuổi thọ 1 sợi (giây)
  speed: 12,             // tốc độ đầu sợi (m/s)
  trail: 1.4,            // độ dài đuôi (giây đường đi)
  width: 0.55,           // bề rộng nét (m)
  distance: [40, 110] as [number, number],    // khoảng cách xuất hiện quanh camera (m)
  loopChance: 0.55,      // xác suất sợi gió cuộn một vòng
  opacity: 0.85,
  windDir: new THREE.Vector3(1, 0, -0.35).normalize(), // hướng gió thế giới
};

const SEG = 48; // số điểm dọc mỗi sợi
const MAX_WISPS = 32; // bể sợi cấp sẵn; WIND_FX.wisps (<= 32) giới hạn số sợi đang bay

interface Wisp {
  alive: boolean;
  age: number;
  life: number;
  origin: THREE.Vector3;
  dir: THREE.Vector3;   // hướng bay (ngang)
  side: THREE.Vector3;  // vuông góc ngang
  waveAmp: number;
  waveFreq: number;
  phase: number;
  loopAt: number;       // thời điểm bắt đầu cuộn (âm = không cuộn)
  loopR: number;
  loopDur: number;
  rise: number;
}

const VERT = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vAlpha = aAlpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  if (vAlpha < 0.01) discard;
  gl_FragColor = vec4(uColor, vAlpha);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

export class WindFX {
  private wisps: Wisp[] = [];
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private alpha: Float32Array;
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private spawnTimer = 0;
  private tmp = new THREE.Vector3();
  private pts: THREE.Vector3[] = Array.from({ length: SEG }, () => new THREE.Vector3());

  constructor(scene: THREE.Scene) {
    const n = MAX_WISPS;
    this.pos = new Float32Array(n * SEG * 2 * 3);
    this.alpha = new Float32Array(n * SEG * 2);
    const idx: number[] = [];
    for (let w = 0; w < n; w++) {
      const base = w * SEG * 2;
      for (let i = 0; i < SEG - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(0xffffff) } }]),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);

    for (let i = 0; i < n; i++) {
      this.wisps.push({
        alive: false, age: 0, life: 1, origin: new THREE.Vector3(), dir: new THREE.Vector3(), side: new THREE.Vector3(),
        waveAmp: 0, waveFreq: 0, phase: 0, loopAt: -1, loopR: 0, loopDur: 0, rise: 0,
      });
    }
  }

  private rand(r: [number, number]): number {
    return r[0] + Math.random() * (r[1] - r[0]);
  }

  private spawn(w: Wisp, cam: THREE.Camera): void {
    // Vị trí ngẫu nhiên trong vùng phía trước camera, hơi lệch hai bên
    const fwd = cam.getWorldDirection(this.tmp).setY(0).normalize();
    const ang = (Math.random() - 0.5) * 1.3;
    const d = this.rand(WIND_FX.distance);
    const c = Math.cos(ang), s = Math.sin(ang);
    const dx = fwd.x * c - fwd.z * s, dz = fwd.x * s + fwd.z * c;
    w.dir.copy(WIND_FX.windDir).applyAxisAngle(THREE.Object3D.DEFAULT_UP, (Math.random() - 0.5) * 0.6);
    w.side.set(-w.dir.z, 0, w.dir.x);
    // Lùi điểm xuất phát ngược hướng gió để sợi gió bay ngang qua tầm nhìn
    w.origin.set(cam.position.x + dx * d, cam.position.y - 8 + (Math.random() - 0.5) * 24, cam.position.z + dz * d)
      .addScaledVector(w.dir, -WIND_FX.speed * 1.2);
    w.age = 0;
    w.life = this.rand(WIND_FX.life);
    w.waveAmp = 3 + Math.random() * 4;
    w.waveFreq = 1.4 + Math.random() * 1.2;
    w.phase = Math.random() * 6.28;
    w.rise = (Math.random() - 0.5) * 1.5;
    w.loopAt = Math.random() < WIND_FX.loopChance ? w.life * (0.25 + Math.random() * 0.3) : -1;
    w.loopR = 3 + Math.random() * 3;
    w.loopDur = 0.9 + Math.random() * 0.5;
    w.alive = true;
  }

  /** Vị trí đầu sợi gió tại thời điểm t (giây kể từ lúc sinh). */
  private pathAt(w: Wisp, t: number, out: THREE.Vector3): THREE.Vector3 {
    const sp = WIND_FX.speed;
    out.copy(w.origin)
      .addScaledVector(w.dir, sp * t)
      .addScaledVector(w.side, Math.sin(t * w.waveFreq * 2 + w.phase) * w.waveAmp);
    out.y += Math.sin(t * w.waveFreq * 1.3 + w.phase * 2) * w.waveAmp * 0.4 + w.rise * t;
    if (w.loopAt >= 0 && t > w.loopAt) {
      // Cuộn 1 vòng tròn đứng (trong mặt phẳng hướng bay + trục đứng), đồng thời "ghìm" tốc độ tiến
      const k = Math.min(1, (t - w.loopAt) / w.loopDur);
      const a = k * Math.PI * 2;
      const e = k * k * (3 - 2 * k);
      out.addScaledVector(w.dir, -sp * w.loopDur * e * 0.8 + Math.sin(a) * w.loopR);
      out.y += (1 - Math.cos(a)) * w.loopR;
    }
    return out;
  }

  update(dt: number, cam: THREE.Camera, visible = true): void {
    this.mesh.visible = visible;
    if (!visible) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const alive = this.wisps.reduce((c, w) => c + (w.alive ? 1 : 0), 0);
      const free = alive < WIND_FX.wisps ? this.wisps.find((w) => !w.alive) : undefined;
      if (free) this.spawn(free, cam);
      this.spawnTimer = this.rand(WIND_FX.spawnEvery);
    }

    const camPos = cam.position;
    for (let wi = 0; wi < this.wisps.length; wi++) {
      const w = this.wisps[wi];
      const base = wi * SEG * 2;
      if (!w.alive) {
        for (let i = 0; i < SEG * 2; i++) this.alpha[base + i] = 0;
        continue;
      }
      w.age += dt;
      if (w.age > w.life + WIND_FX.trail) { w.alive = false; continue; }

      // Đầu sợi dừng lại ở cuối đời, đuôi đuổi theo -> sợi gió "rút" lại rồi biến mất
      const head = Math.min(w.age, w.life);
      const tail = Math.max(0, w.age - WIND_FX.trail);
      const fadeIn = Math.min(1, w.age / 0.4);
      for (let i = 0; i < SEG; i++) this.pathAt(w, tail + (head - tail) * (i / (SEG - 1)), this.pts[i]);

      for (let i = 0; i < SEG; i++) {
        const p = this.pts[i];
        const prev = this.pts[Math.max(0, i - 1)], next = this.pts[Math.min(SEG - 1, i + 1)];
        const tang = this.tmp.subVectors(next, prev).normalize();
        const toCam = new THREE.Vector3().subVectors(camPos, p).normalize();
        const side = new THREE.Vector3().crossVectors(tang, toCam).normalize();
        const u = i / (SEG - 1);
        const taper = Math.sin(u * Math.PI) * (0.35 + 0.65 * u); // thon 2 đầu, đầu đậm hơn đuôi
        const hw = WIND_FX.width * 0.5 * taper;
        const k = (base + i * 2) * 3;
        this.pos[k] = p.x + side.x * hw; this.pos[k + 1] = p.y + side.y * hw; this.pos[k + 2] = p.z + side.z * hw;
        this.pos[k + 3] = p.x - side.x * hw; this.pos[k + 4] = p.y - side.y * hw; this.pos[k + 5] = p.z - side.z * hw;
        const a = WIND_FX.opacity * fadeIn * Math.pow(u, 0.7);
        this.alpha[base + i * 2] = a;
        this.alpha[base + i * 2 + 1] = a;
      }
    }
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('aAlpha').needsUpdate = true;
  }

  setTint(color: THREE.Color): void {
    this.material.uniforms.uColor.value.copy(color);
  }
}
