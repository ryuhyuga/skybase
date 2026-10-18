// Bầu trời vẽ tay (gradient kiểu anime) + mặt trời + chu kỳ ngày đêm.
// Đêm: sao lấp lánh (3 lớp, sao lớn có tia chữ thập), ngân hà, tinh vân, trăng lưỡi liềm có quầng.
// Xuất màu cho mây, biển mây, sương mù dùng chung -> cả thế giới đồng bộ tông màu.
import * as THREE from 'three';
import { ATMOSPHERE, AtmosphereKey } from './palette';

type ColorField = Exclude<keyof AtmosphereKey, 'e'>;
const tmpA = new THREE.Color(), tmpB = new THREE.Color();

function sample(e: number, field: ColorField, out: THREE.Color): THREE.Color {
  const K = ATMOSPHERE;
  if (e <= K[0].e) return out.setHex(K[0][field]);
  if (e >= K[K.length - 1].e) return out.setHex(K[K.length - 1][field]);
  for (let i = 0; i < K.length - 1; i++) {
    if (e >= K[i].e && e <= K[i + 1].e) {
      const t = (e - K[i].e) / (K[i + 1].e - K[i].e);
      return out.copy(tmpA.setHex(K[i][field])).lerp(tmpB.setHex(K[i + 1][field]), t);
    }
  }
  return out;
}

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uDay;
uniform float uTime;
varying vec3 vWorld;

float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise3(p); p *= 2.07; a *= 0.5; } return v; }

// Một lớp sao: lưới 3D trên hướng nhìn, mỗi ô có xác suất chứa 1 ngôi sao, lấp lánh theo thời gian.
float starLayer(vec3 dir, float scale, float density, float size, float seed, out float sparkle) {
  vec3 p = dir * scale + seed;
  vec3 id = floor(p);
  vec3 f = fract(p);
  sparkle = 0.0;
  float h = hash13(id);
  if (h > density) return 0.0;
  vec3 q = f - (hash33(id + 11.0) * 0.6 + 0.2);
  float d = length(q);
  float tw = 0.55 + 0.45 * sin(uTime * (1.2 + h * 5.0) + h * 80.0);
  float b = smoothstep(size, 0.0, d) * tw * (0.45 + 0.55 * hash13(id + 5.0));
  // Tia chữ thập kiểu anime cho sao lớn
  vec3 u = normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + 1e-4);
  vec3 v = cross(u, dir);
  float qx = dot(q, u), qy = dot(q, v);
  sparkle = (smoothstep(size * 0.18, 0.0, abs(qx)) * smoothstep(size * 3.2, 0.0, abs(qy)) +
             smoothstep(size * 0.18, 0.0, abs(qy)) * smoothstep(size * 3.2, 0.0, abs(qx))) * tw;
  return b;
}

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  float h = dir.y;
  float night = 1.0 - uDay;

  // Nền trời: chân trời sáng, lên cao đậm nhanh (cong) -> trời sâu và bão hoà như tranh
  float t = pow(smoothstep(-0.02, 0.9, h), 0.5);
  vec3 col = mix(uHorizon, uZenith, t);
  // Ban đêm: dải sáng xanh ngọc sát chân trời
  col += vec3(0.08, 0.42, 0.85) * exp(-max(h, 0.0) * 9.0) * 0.32 * night;
  col = mix(uFog, col, smoothstep(-0.25, 0.02, h)); // dưới chân trời hoà vào sương

  // Mặt trời: đĩa sáng + quầng lớn (bloom bắt được)
  float d = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (pow(d, 8.0) * 0.22 + pow(d, 64.0) * 0.45 + pow(d, 900.0) * 1.2) * (0.3 + 0.7 * uDay);
  col = mix(col, uSunColor * 2.4 + 0.3, smoothstep(0.9993, 0.9996, d) * uDay);

  if (night > 0.001 && h > -0.05) {
    float above = smoothstep(-0.02, 0.18, h);

    // Ngân hà: dải sáng chéo bầu trời + tinh vân + vệt bụi tối
    vec3 N = normalize(vec3(0.35, 0.55, -0.75));
    float bd = dot(dir, N);
    float band = exp(-bd * bd / 0.05);
    float neb = fbm3(dir * 3.5 + 2.0), neb2 = fbm3(dir * 9.0 + 7.0);
    float milky = band * smoothstep(0.32, 0.8, neb * 0.7 + neb2 * 0.4);
    milky *= 1.0 - 0.55 * smoothstep(0.55, 0.75, fbm3(dir * 6.0 + 3.0)) * band;
    col += mix(vec3(0.25, 0.5, 1.0), vec3(0.8, 0.88, 1.0), neb2) * milky * 0.8 * night * above;
    // Vệt tinh vân mảnh rải rác (như mây sáng mờ trong ảnh)
    float wisp = smoothstep(0.58, 0.85, fbm3(dir * vec3(2.0, 7.0, 2.0) + vec3(5.0, uTime * 0.002, 1.0)));
    col += vec3(0.3, 0.55, 1.0) * wisp * 0.18 * night * above;

    // Trăng lưỡi liềm + quầng
    float ma = acos(clamp(dot(dir, uMoonDir), -1.0, 1.0));
    float R = 0.032;
    vec3 tg = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + 1e-4);
    vec3 offD = normalize(uMoonDir + tg * R * 0.55 + cross(tg, uMoonDir) * R * 0.25);
    float a2 = acos(clamp(dot(dir, offD), -1.0, 1.0));
    float disk = smoothstep(R, R * 0.9, ma);
    float crescent = disk * smoothstep(R * 0.86, R * 0.94, a2); // phần đĩa không bị che -> lưỡi liềm mảnh
    vec3 moonCol = vec3(1.0, 0.96, 0.82);
    col += moonCol * (exp(-ma * 22.0) * 0.22 + exp(-ma * 5.0) * 0.07) * night;

    // Sao: 3 lớp (nhỏ dày, vừa, lớn có tia chữ thập); dày hơn trong dải ngân hà
    float sp1, sp2, sp3;
    float s1 = starLayer(dir, 300.0, 0.14 + band * 0.22, 0.22, 0.0, sp1);
    float s2 = starLayer(dir, 120.0, 0.06 + band * 0.06, 0.16, 17.0, sp2);
    float s3 = starLayer(dir, 45.0, 0.04, 0.09, 41.0, sp3);
    float starsAll = s1 * 1.0 + s2 * 1.4 + s3 * 2.2 + sp3 * 1.3 + sp2 * 0.35;
    vec3 starCol = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.95, 0.85), hash13(floor(dir * 160.0)));
    col += starCol * starsAll * night * night * above * (1.0 - disk);

    col = mix(col, moonCol * 1.25, crescent * night * above);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Chỉnh trời / ngày đêm ở đây (bảng G cũng chỉnh được). */
export const SKY = {
  fogNear: 1100,        // sương bắt đầu (m) — camera góc 3 nhìn rộng nên để xa
  fogFar: 7500,         // sương đặc hẳn (m)
  dayLength: 720,       // 1 ngày = bao nhiêu giây thật
  nightCloudMin: 0.05,  // độ phủ mây ban đêm thấp nhất (x độ phủ ban ngày)
  nightCloudMax: 0.65,  // ... cao nhất (mỗi đêm ngẫu nhiên trong khoảng này)
};

export class Environment {
  /** 0..1 = một ngày. */
  time = 0.06;
  timeScale = 1;

  readonly sunDir = new THREE.Vector3();
  /** Hướng nguồn sáng chính (mặt trời ban ngày, mặt trăng ban đêm). */
  readonly lightDir = new THREE.Vector3();
  readonly c = {
    zenith: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(),
    ambient: new THREE.Color(), cloudLit: new THREE.Color(), cloudShade: new THREE.Color(),
    cloudDeep: new THREE.Color(), fog: new THREE.Color(),
    water: new THREE.Color(), waterDeep: new THREE.Color(), foam: new THREE.Color(),
  };
  dayFactor = 1;
  elevation = 0;
  readonly fog: THREE.Fog;

  private skyMat: THREE.ShaderMaterial;
  private sky: THREE.Mesh;
  private sun = new THREE.DirectionalLight(0xffffff, 2.5);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1);
  readonly moonDir = new THREE.Vector3();
  /** Hệ số mây (1 = bình thường). Ban đêm ngẫu nhiên theo từng đêm: có đêm quang, có đêm lác đác mây. */
  cloudCover = 1;
  private dayCount = 0;
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uZenith: { value: this.c.zenith }, uHorizon: { value: this.c.horizon }, uFog: { value: this.c.fog },
        uSunDir: { value: this.sunDir }, uSunColor: { value: this.c.sun }, uDay: { value: 1 },
        uMoonDir: { value: this.moonDir }, uTime: { value: 0 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), this.skyMat);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    scene.add(this.sky, this.sun, this.sun.target, this.hemi);

    this.fog = new THREE.Fog(0xffffff, SKY.fogNear, SKY.fogFar);
    scene.fog = this.fog;
  }

  /** Giờ trong ngày dạng "HH:MM" (mặt trời cao nhất ~13:00). */
  clock(): string {
    const h = (this.time * 24 + 7) % 24;
    return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  }

  update(dt: number, camPos: THREE.Vector3): void {
    this.elapsed += dt;
    const next = this.time + (dt * this.timeScale) / SKY.dayLength;
    if (next >= 1) this.dayCount++;
    this.time = next % 1;

    // Ngày dài hơn đêm: độ cao mặt trời -24°..52°.
    const e = 38 * Math.sin(this.time * Math.PI * 2) + 14;
    this.elevation = e;
    const az = this.time * 360 + 90;
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - e), THREE.MathUtils.degToRad(az));
    this.dayFactor = THREE.MathUtils.smoothstep(e, -6, 10);

    for (const k of Object.keys(this.c) as ColorField[]) sample(e, k, this.c[k]);

    // Trăng ở phía đối diện mặt trời, luôn trên chân trời khi đêm
    // Thấp ~20–30° để camera góc 3 dễ thấy trăng ngay phía trước
    this.moonDir.set(-this.sunDir.x, Math.abs(this.sunDir.y) * 0.25 + 0.3, -this.sunDir.z).normalize();
    if (e > -2) this.lightDir.copy(this.sunDir);
    else this.lightDir.copy(this.moonDir);

    // Mây ban đêm: mỗi đêm một kiểu (dựa trên số ngày), từ quang hẳn tới lác đác vài cụm
    const nightSeed = Math.sin((this.dayCount + (this.time > 0.5 ? 0 : -1)) * 12.9898) * 43758.5453;
    const nightCover = SKY.nightCloudMin + (SKY.nightCloudMax - SKY.nightCloudMin) * (nightSeed - Math.floor(nightSeed));
    this.cloudCover = THREE.MathUtils.lerp(nightCover, 1, this.dayFactor);

    this.skyMat.uniforms.uDay.value = this.dayFactor;
    this.skyMat.uniforms.uTime.value = this.elapsed;
    this.sky.position.copy(camPos);

    this.sun.position.copy(camPos).addScaledVector(this.lightDir, 500);
    this.sun.target.position.copy(camPos);
    this.sun.color.copy(this.c.sun);
    this.sun.intensity = 0.6 + 2.4 * this.dayFactor;

    this.hemi.color.copy(this.c.ambient);
    this.hemi.groundColor.copy(this.c.ambient).multiplyScalar(0.7);
    this.hemi.intensity = 1.0 + 0.6 * this.dayFactor;

    this.fog.color.copy(this.c.fog);
  }
}
