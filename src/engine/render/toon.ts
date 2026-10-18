// Vật liệu cel-shading (bóng chia mảng) dùng chung cho đảo và tàu.
import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/** 3 mảng sáng: bóng / nửa tối / sáng. */
export function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

const cache = new Map<string, THREE.MeshToonMaterial>();

export function toon(color: number, opts: { emissive?: number; emissiveIntensity?: number } = {}): THREE.MeshToonMaterial {
  const key = `${color}:${opts.emissive ?? 0}:${opts.emissiveIntensity ?? 0}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      gradientMap: gradientMap(),
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
    });
    cache.set(key, m);
  }
  return m;
}
