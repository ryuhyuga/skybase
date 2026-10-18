// Tiện ích nhỏ dùng chung.

/** Random có seed (mulberry32): cùng seed -> cùng thế giới mỗi lần chạy. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** mod luôn dương (JS % giữ dấu số bị chia). */
export const wrap = (x: number, m: number) => ((x % m) + m) % m;

/** Đưa góc về [-PI, PI]. */
export const wrapAngle = (a: number) => wrap(a + Math.PI, Math.PI * 2) - Math.PI;

/** Nội suy tiến tới đích, không phụ thuộc FPS. rate càng lớn càng nhanh. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));
