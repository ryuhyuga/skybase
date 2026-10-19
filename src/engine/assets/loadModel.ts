// Load model .glb xuất từ Blender bằng add-on "Skybase Tools" (tools/blender/) và tự áp đúng theo nhãn:
//   sb_role    'prop' | 'terrain' | 'marker'
//   sb_toon    1 = đổi vật liệu sang cel-shading 3 mảng (gradientMap của engine)
//   sb_clouds  1 = che mây volumetric (layer 1)
//   sb_collide 1 = có hộp va chạm (model.colliders / model.hit())
//   sb_glow    độ sáng phát sáng (bloom), sb_glow_color '#rrggbb' (không có = màu vật liệu)
//   sb_light   tầm chiếu sáng ban đêm (m) quanh vật phát sáng, 0 = không chiếu
// Địa hình (terrain): có bờ cát ướt + bọt sóng (applyShoreline) và đăng ký độ cao để tàu/camera không xuyên qua.
// Model không có nhãn (xuất bằng cách khác) vẫn load được: coi như 'prop', toon, che mây.
//
// Dùng:
//   const island = await loadModel(world, 'models/sample.glb', { position: new THREE.Vector3(300, 0, -400) });
//   island.markers.get('dock')        // Object3D của điểm mốc tên 'dock'
//   island.hit(ship.position, 6)      // chạm vật có nhãn Va chạm?
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gradientMap } from '../render/toon';
import type { Lamp } from '../render/LampLights';
import type { HeightFn } from '../terrain/Terrain';
import { applyShoreline } from '../water/shoreline';
import type { World } from '../World';

export interface LoadModelOptions {
  position?: THREE.Vector3;
  /** Xoay quanh trục đứng (radian). */
  rotationY?: number;
  scale?: number;
  /** Tự thêm vào world.scene (mặc định true). */
  addToScene?: boolean;
  /** Đăng ký độ cao địa hình với world.terrain (mặc định true nếu model có địa hình). */
  registerTerrain?: boolean;
}

export interface LoadedModel {
  root: THREE.Group;
  /** Điểm mốc theo tên (Empty trong Blender có vai trò "Điểm mốc"). */
  markers: Map<string, THREE.Object3D>;
  /** Hộp va chạm (toạ độ thế giới) của các vật có nhãn "Va chạm". */
  colliders: THREE.Box3[];
  /** Điểm (bán kính r) có chạm hộp va chạm nào không. */
  hit(point: THREE.Vector3, radius?: number): boolean;
  /** Đèn (vật có nhãn Phát sáng + Chiếu sáng) đã đăng ký với world.lamps. */
  lamps: Lamp[];
  /** Độ cao địa hình của model tại (x, z); không có địa hình thì luôn rất âm. */
  heightAt: HeightFn;
}

interface Tags { role: string; toon: boolean; clouds: boolean; collide: boolean; glow: number; glowColor: string | null; light: number }

const loader = new GLTFLoader();
const NO_GROUND = -1e9;

/** Nhãn của 1 object: lấy từ chính nó hoặc tổ tiên gần nhất có nhãn (mesh nhiều vật liệu bị tách thành nhóm con). */
function tagsOf(o: THREE.Object3D): Tags {
  let p: THREE.Object3D | null = o;
  while (p && p.userData.sb_role === undefined) p = p.parent;
  const u = p?.userData ?? {};
  return {
    role: u.sb_role ?? 'prop',
    toon: u.sb_toon === undefined ? true : !!u.sb_toon,
    clouds: u.sb_clouds === undefined ? true : !!u.sb_clouds,
    collide: !!u.sb_collide,
    glow: Number(u.sb_glow ?? 0),
    glowColor: typeof u.sb_glow_color === 'string' ? u.sb_glow_color : null,
    // tầm chiếu sáng ban đêm (m); file cũ không có nhãn này: vật phát sáng tự chiếu 8 m
    light: u.sb_light !== undefined ? Number(u.sb_light) : Number(u.sb_glow ?? 0) > 0 ? 8 : 0,
  };
}

const toonCache = new Map<string, THREE.Material>();

/** Đổi 1 vật liệu bất kỳ (glTF standard / unlit) sang toon của engine. Dùng cho model không qua add-on. */
export function toToon(src: THREE.Material, glow = 0): THREE.Material {
  return convertMaterial(src, { role: 'prop', toon: true, clouds: true, collide: false, glow, glowColor: null, light: 0 }, false);
}

function convertMaterial(src: THREE.Material, t: Tags, terrain: boolean): THREE.Material {
  const key = `${src.uuid}|${t.toon}|${t.glow}|${t.glowColor}|${terrain}`;
  const hit = toonCache.get(key);
  if (hit) return hit;
  const s = src as THREE.MeshStandardMaterial;
  let m: THREE.MeshToonMaterial | THREE.MeshStandardMaterial;
  if (t.toon) {
    m = new THREE.MeshToonMaterial({
      name: s.name,
      color: s.color ?? new THREE.Color(0xffffff),
      map: s.map ?? null,
      vertexColors: s.vertexColors,
      transparent: s.transparent,
      opacity: s.opacity,
      alphaTest: s.alphaTest,
      side: s.side,
      gradientMap: gradientMap(),
      emissive: s.emissive ?? new THREE.Color(0),
      emissiveMap: s.emissiveMap ?? null,
      emissiveIntensity: s.emissiveIntensity ?? 1,
    });
  } else {
    m = s.clone();
  }
  if (t.glow > 0) {
    m.emissive = t.glowColor ? new THREE.Color(t.glowColor) : (m.color as THREE.Color).clone();
    m.emissiveIntensity = t.glow;
  }
  if (terrain) applyShoreline(m);
  toonCache.set(key, m);
  return m;
}

/** Ghi độ cao các tam giác địa hình vào lưới (lấy max) -> tra cứu nhanh, không cần raycast. */
function buildHeightField(meshes: THREE.Mesh[]): HeightFn {
  if (!meshes.length) return () => NO_GROUND;
  const box = new THREE.Box3();
  for (const m of meshes) box.expandByObject(m);
  const sizeX = box.max.x - box.min.x, sizeZ = box.max.z - box.min.z;
  const cell = THREE.MathUtils.clamp(Math.max(sizeX, sizeZ) / 512, 0.5, 8);
  const nx = Math.ceil(sizeX / cell) + 1, nz = Math.ceil(sizeZ / cell) + 1;
  const h = new Float32Array(nx * nz).fill(NO_GROUND);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

  for (const mesh of meshes) {
    const g = mesh.geometry, pos = g.getAttribute('position'), idx = g.getIndex();
    const tri = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < tri; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - box.min.x) / cell));
      const x1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x, c.x) - box.min.x) / cell));
      const z0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - box.min.z) / cell));
      const z1 = Math.min(nz - 1, Math.ceil((Math.max(a.z, b.z, c.z) - box.min.z) / cell));
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(d) < 1e-9) continue; // tam giác dựng đứng
      for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
        const px = box.min.x + gx * cell, pz = box.min.z + gz * cell;
        const w0 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / d;
        const w1 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const y = w0 * a.y + w1 * b.y + w2 * c.y;
        const k = gx + gz * nx;
        if (y > h[k]) h[k] = y;
      }
    }
  }

  return (x: number, z: number) => {
    const fx = (x - box.min.x) / cell, fz = (z - box.min.z) / cell;
    if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return NO_GROUND;
    const ix = Math.min(nx - 2, Math.floor(fx)), iz = Math.min(nz - 2, Math.floor(fz));
    const tx = fx - ix, tz = fz - iz;
    const h00 = h[ix + iz * nx], h10 = h[ix + 1 + iz * nx], h01 = h[ix + (iz + 1) * nx], h11 = h[ix + 1 + (iz + 1) * nx];
    if (h00 <= NO_GROUND || h10 <= NO_GROUND || h01 <= NO_GROUND || h11 <= NO_GROUND) return Math.max(h00, h10, h01, h11);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };
}

export async function loadModel(world: World, url: string, opts: LoadModelOptions = {}): Promise<LoadedModel> {
  const gltf = await loader.loadAsync(url);
  const root = new THREE.Group();
  root.name = url;
  root.add(gltf.scene);
  if (opts.position) root.position.copy(opts.position);
  if (opts.rotationY) root.rotation.y = opts.rotationY;
  if (opts.scale) root.scale.setScalar(opts.scale);
  root.updateMatrixWorld(true);

  const markers = new Map<string, THREE.Object3D>();
  const colliders: THREE.Box3[] = [];
  const terrainMeshes: THREE.Mesh[] = [];
  const lamps: Lamp[] = [];
  const lit = new Set<THREE.Object3D>();
  // vật trong Blender có thể bị glTF tách thành nhóm + nhiều mesh con: gom về object mang nhãn
  const lightOwner = (o: THREE.Object3D) => { let p: THREE.Object3D | null = o; while (p && p.userData.sb_role === undefined) p = p.parent; return p ?? o; };

  root.traverse((o) => {
    const t = tagsOf(o);
    if (t.role === 'marker' && o.userData.sb_role === 'marker') {
      markers.set(o.name, o);
      return;
    }
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    const terrain = t.role === 'terrain';
    if (t.role === 'marker') { mesh.visible = false; return; }
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => convertMaterial(m, t, terrain))
      : convertMaterial(mesh.material, t, terrain);
    if (t.clouds) mesh.layers.enable(1);
    if (terrain) terrainMeshes.push(mesh);
    if (t.collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    if (t.light > 0 && t.glow > 0 && !lit.has(lightOwner(mesh))) {
      // đèn: chiếu sáng ban đêm từ tâm vật (1 đèn cho mỗi vật, kể cả khi mesh bị tách theo vật liệu)
      lit.add(lightOwner(mesh));
      mesh.geometry.computeBoundingBox();
      const c = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
      const col = t.glowColor ? new THREE.Color(t.glowColor) : ((mesh.material as THREE.MeshToonMaterial).color?.clone() ?? new THREE.Color(0xffb04a));
      lamps.push(world.lamps.add(mesh, { color: col, range: t.light, intensity: 1.2 + t.glow * 0.25, offset: c }));
    }
  });

  const heightAt = buildHeightField(terrainMeshes);
  if (terrainMeshes.length && opts.registerTerrain !== false) world.terrain.addHeightSource(heightAt);
  if (opts.addToScene !== false) world.scene.add(root);

  const tmp = new THREE.Vector3();
  return {
    root, markers, colliders, heightAt, lamps,
    hit(point, radius = 0) {
      for (const b of colliders) if (b.distanceToPoint(tmp.copy(point)) <= radius) return true;
      return false;
    },
  };
}
