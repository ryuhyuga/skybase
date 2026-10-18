// Địa hình đảo trên mặt biển: đồi thấp, bãi cát, sườn đá, bờ cát ướt + bọt sóng.
// Toàn bộ địa hình tính từ 1 hàm độ cao (heightAt) dùng chung cho: mesh, heightmap cỏ (GPU), va chạm & camera (CPU).
// Dùng:
//   const terrain = new Terrain(scene, [{ x: 0, z: 0, radius: 300, height: 55, seed: 1 }]);
//   terrain.addHeightSource(myHeightFn);  // địa hình tự dựng (vd. Santorini trong demo) để va chạm/cỏ biết
import * as THREE from 'three';
import { COLORS } from '../sky/palette';
import { applyShoreline } from '../water/shoreline';
import { gradientMap } from '../render/toon';

export interface SeaIslandDef {
  x: number;
  z: number;
  radius: number;   // bán kính phần nổi (m)
  height: number;   // độ cao đồi tối đa (m)
  seed: number;
}

/** Hàm độ cao bổ sung (m). Trả về giá trị rất âm ở chỗ không có địa hình. */
export type HeightFn = (x: number, z: number) => number;

// ---------- noise thuần JS (xác định, không phụ thuộc GPU) ----------
function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, z: number, seed: number, oct = 5): number {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, z * f, seed + i * 17); f *= 2.03; amp *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Độ cao 1 nhóm đảo tại (x, z). Âm = dưới mặt biển. */
function islandsHeight(defs: SeaIslandDef[], x: number, z: number): number {
  let h = -40;
  for (const isl of defs) {
    const dx = x - isl.x, dz = z - isl.z;
    const raw = Math.sqrt(dx * dx + dz * dz) / isl.radius;
    if (raw > 1.6) continue;
    // Bờ biển uốn lượn: méo bán kính bằng noise
    const d = raw + (fbm(x * 0.004, z * 0.004, isl.seed) - 0.5) * 0.55;
    const shape = 1 - smooth(0, 1, d);
    const hills = fbm(x * 0.007 + 31, z * 0.007 - 17, isl.seed + 7);
    const hi = Math.pow(shape, 1.4) * isl.height * (0.45 + 0.9 * hills) + shape * 7 - 5;
    if (hi > h) h = hi;
  }
  return h;
}

/** Vùng mọc cỏ 0..1: đủ cao khỏi bãi cát và không quá dốc. */
function grassMask(h: number, slope: number): number {
  return smooth(3.5, 6.5, h) * (1 - smooth(0.55, 0.9, slope));
}

/** Vùng heightmap cho cỏ (bao trùm tất cả đảo). */
export const HEIGHTMAP = { minX: -2048, minZ: -2048, size: 4096, res: 1024 };

export class Terrain {
  private heightTex: THREE.DataTexture | null = null;
  private sources: HeightFn[] = [];

  constructor(scene: THREE.Scene, readonly islands: SeaIslandDef[] = []) {
    const heightAt = (x: number, z: number) => this.heightAt(x, z);
    const slopeAt = (x: number, z: number, e?: number) => this.slopeAt(x, z, e);
    const grassMaskAt = (_x: number, _z: number, h: number, sl: number) => grassMask(h, sl);
    // --- Mesh địa hình từng đảo ---
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() });
    applyShoreline(mat); // cát ướt + bọt sóng ở mép nước (kiểu Codrops)
    const cSand = new THREE.Color(COLORS.sand), cWet = new THREE.Color(COLORS.sandWet);
    const cG = new THREE.Color(COLORS.groundGrass), cGL = new THREE.Color(COLORS.groundGrassLight);
    const cCliff = new THREE.Color(COLORS.cliff), tmp = new THREE.Color();

    for (const isl of islands) {
      const size = isl.radius * 3.2, seg = 180;
      const geo = new THREE.PlaneGeometry(size, size, seg, seg);
      geo.rotateX(-Math.PI / 2);
      geo.translate(isl.x, 0, isl.z);
      const pos = geo.getAttribute('position');
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const h = heightAt(x, z), slope = slopeAt(x, z);
        pos.setY(i, h);
        // Màu: cát ướt -> cát -> nền cỏ (sáng/tối theo noise) -> vách đá ở chỗ dốc
        const g = grassMaskAt(x, z, h, slope);
        tmp.copy(cWet).lerp(cSand, smooth(-0.5, 1.5, h));
        const grassCol = cG.clone().lerp(cGL, fbm(x * 0.02, z * 0.02, isl.seed + 3));
        tmp.lerp(grassCol, g);
        tmp.lerp(cCliff, smooth(0.6, 1.1, slope) * smooth(2, 5, h));
        colors.set([tmp.r, tmp.g, tmp.b], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.layers.enable(1); // để mây volumetric dừng tia ở địa hình
      scene.add(mesh);
    }

  }

  /** Heightmap cho cỏ (chỉ tạo khi bật cỏ, vì tốn ~0.5s lúc khởi động). R = độ cao, G = vùng cỏ, B = biến thiên màu. */
  getHeightTexture(): THREE.DataTexture {
    if (this.heightTex) return this.heightTex;
    const { res, minX, minZ, size } = HEIGHTMAP;
    const heightAt = (x: number, z: number) => this.heightAt(x, z);
    const data = new Uint16Array(res * res * 4);
    const step = size / res;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const x = minX + (i + 0.5) * step, z = minZ + (j + 0.5) * step;
      const k = (i + j * res) * 4;
      let h = -40, m = 0, v = 0;
      // Chỉ tính chi tiết gần đảo (nhanh hơn)
      let near = false;
      for (const isl of this.islands) if (Math.hypot(x - isl.x, z - isl.z) < isl.radius * 1.6) { near = true; break; }
      if (near) {
        h = heightAt(x, z);
        m = grassMask(h, this.slopeAt(x, z, step));
        v = fbm(x * 0.012, z * 0.012, 99);
      }
      data[k] = THREE.DataUtils.toHalfFloat(h);
      data[k + 1] = THREE.DataUtils.toHalfFloat(m);
      data[k + 2] = THREE.DataUtils.toHalfFloat(v);
      data[k + 3] = THREE.DataUtils.toHalfFloat(1);
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.heightTex = tex;
    return tex;
  }

  /** Thêm địa hình tự dựng (mesh riêng) để va chạm, camera và cỏ biết. Lấy max với đảo có sẵn. */
  addHeightSource(fn: HeightFn): void {
    this.sources.push(fn);
    this.heightTex = null;
  }

  /** Độ cao địa hình tại (x, z) (m). Âm = dưới mặt biển. */
  heightAt(x: number, z: number): number {
    let h = islandsHeight(this.islands, x, z);
    for (const fn of this.sources) h = Math.max(h, fn(x, z));
    return h;
  }

  /** Độ dốc (|gradient|) tại (x, z). */
  slopeAt(x: number, z: number, e = 2): number {
    const hx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const hz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.sqrt(hx * hx + hz * hz);
  }
}
