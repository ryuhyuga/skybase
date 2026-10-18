// Sinh texture noise tileable cho mây volumetric (chạy 1 lần lúc khởi động, ~0.5–1s).
// - shape  (64³ RGBA): R = Perlin-Worley (hình khối chính), G/B/A = Worley 3 tần số (bào mòn khối)
// - detail (32³ RGB) : Worley 3 tần số để làm sợi/mép mây
// - weather (256² RG): R = độ phủ mây (chỗ nào có mây), G = loại mây (thấp dẹt <-> tháp cao)
import * as THREE from 'three';
import { rng } from '../core/math';

type Noise3 = (x: number, y: number, z: number) => number;

/** Worley (cellular) tileable: trả về khoảng cách tới điểm gần nhất (đơn vị ô), x,y,z trong [0,1). */
function worley3(cells: number, seed: number): Noise3 {
  const r = rng(seed);
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = r();
  return (x, y, z) => {
    const fx = x * cells, fy = y * cells, fz = z * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells, wz = ((cz % cells) + cells) % cells;
      const k = (wx + wy * cells + wz * cells * cells) * 3;
      const ddx = cx + pts[k] - fx, ddy = cy + pts[k + 1] - fy, ddz = cz + pts[k + 2] - fz;
      const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };
}

/** Perlin gradient noise tileable với chu kỳ `period`, trả về ~[-1, 1]. */
function perlin3(period: number, seed: number): Noise3 {
  const r = rng(seed);
  const n = period * period * period;
  const g = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = r() * Math.PI * 2, u = r() * 2 - 1, s = Math.sqrt(1 - u * u);
    g[i * 3] = Math.cos(t) * s; g[i * 3 + 1] = Math.sin(t) * s; g[i * 3 + 2] = u;
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const dot = (ix: number, iy: number, iz: number, dx: number, dy: number, dz: number) => {
    const k = ((ix % period) + (iy % period) * period + (iz % period) * period * period) * 3;
    return g[k] * dx + g[k + 1] * dy + g[k + 2] * dz;
  };
  return (x, y, z) => {
    const fx = x * period, fy = y * period, fz = z * period;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const u = fade(tx), v = fade(ty), w = fade(tz);
    const x0 = ix % period, y0 = iy % period, z0 = iz % period, x1 = (ix + 1) % period, y1 = (iy + 1) % period, z1 = (iz + 1) % period;
    return lerp(
      lerp(lerp(dot(x0, y0, z0, tx, ty, tz), dot(x1, y0, z0, tx - 1, ty, tz), u),
           lerp(dot(x0, y1, z0, tx, ty - 1, tz), dot(x1, y1, z0, tx - 1, ty - 1, tz), u), v),
      lerp(lerp(dot(x0, y0, z1, tx, ty, tz - 1), dot(x1, y0, z1, tx - 1, ty, tz - 1), u),
           lerp(dot(x0, y1, z1, tx, ty - 1, tz - 1), dot(x1, y1, z1, tx - 1, ty - 1, tz - 1), u), v),
      w,
    ) * 1.4;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toByte = (v: number) => Math.round(clamp01(v) * 255);



/** Weather map 256² (CPU, để CPU cũng tra được độ phủ mây). R = độ phủ, G = loại mây. */
export function generateWeather(): { weather: THREE.DataTexture; weatherData: Uint8Array; weatherSize: number } {
  // --- weather 256² ---
  const W = 256;
  const weatherData = new Uint8Array(W * W * 4);
  const c4 = perlin3(4, 41), c8 = perlin3(8, 42), c16 = perlin3(16, 43), cw = worley3(10, 44), t2 = perlin3(3, 45);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / W;
    const fbm = (c4(u, v, 0) * 0.55 + c8(u, v, 0) * 0.3 + c16(u, v, 0) * 0.15) * 0.5 + 0.5;
    const clumps = 1 - clamp01(cw(u, v, 0)); // cụm tròn kiểu mây tích
    const cov = fbm * (0.3 + 0.7 * clumps); // cụm rõ, nhiều khoảng trời trống
    const type = clamp01(t2(u, v, 0) * 0.5 + 0.5 + (clumps - 0.5) * 0.4);
    const i = (x + y * W) * 4;
    weatherData[i] = toByte(cov); weatherData[i + 1] = toByte(type); weatherData[i + 2] = 0; weatherData[i + 3] = 255;
  }
  // Chuẩn hoá độ phủ về đủ dải 0..1 để tham số `coverage` dễ đoán.
  let lo = 255, hi = 0;
  for (let i = 0; i < weatherData.length; i += 4) { lo = Math.min(lo, weatherData[i]); hi = Math.max(hi, weatherData[i]); }
  for (let i = 0; i < weatherData.length; i += 4) weatherData[i] = Math.round(((weatherData[i] - lo) / Math.max(1, hi - lo)) * 255);
  const weather = new THREE.DataTexture(weatherData, W, W, THREE.RGBAFormat);
  weather.wrapS = weather.wrapT = THREE.RepeatWrapping;
  weather.minFilter = weather.magFilter = THREE.LinearFilter;
  weather.needsUpdate = true;

  return { weather, weatherData, weatherSize: W };
}
