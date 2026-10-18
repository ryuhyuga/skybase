// Đảo kiểu Santorini: miệng núi lửa (caldera) hình lưỡi liềm.
// - Mặt trong: vách đá dựng đứng lộ tầng đá núi lửa nâu đỏ; mặt ngoài: dốc thoải ra bãi cát đen.
// - Bên kia vịnh: đảo lưỡi liềm nhỏ (như Thirasia); giữa vịnh: đảo núi lửa đen (như Nea Kameni).
// - Làng trắng chen chúc trên mép vách: nhà khối, mái vòm xanh, mái cong, hoa giấy hồng, cối xay gió.
// Hàm santoriniHeight() được SeaIslands.heightAt() gộp vào -> tàu/camera va chạm đúng địa hình.
import * as THREE from 'three';
import { rng, wrapAngle } from '../engine/core/math';
import { applyShoreline } from '../engine/water/shoreline';
import { gradientMap } from '../engine/render/toon';

/** Chỉnh đảo ở đây. */
export const SANTORINI = {
  x: 0,
  z: -1900,
  ringRadius: 640,     // bán kính vành caldera (m)
  cliffHeight: 150,    // độ cao vách (m)
  outerSlope: 430,     // độ dài dốc ngoài ra tới biển (m)
  houses: 1100,        // số nhà tối đa
};

// ---- noise JS nhỏ, xác định ----
function h2(ix: number, iz: number, s: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vn(x: number, z: number, s: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h2(ix, iz, s), b = h2(ix + 1, iz, s), c = h2(ix, iz + 1, s), d = h2(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, z: number, s: number, o = 4): number {
  let t = 0, a = 0.5, f = 1;
  for (let i = 0; i < o; i++) { t += a * vn(x * f, z * f, s + i * 13); f *= 2.07; a *= 0.5; }
  return t / (1 - Math.pow(0.5, o));
}
const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Lưỡi liềm chính: từ Tây Bắc -> Bắc -> Đông -> Nam -> Tây Nam (θ đo từ +X, -Z là Bắc)
const MAIN_A0 = -2.25, MAIN_A1 = 2.35;
const THIRA_W = 0.42; // nửa bề rộng (rad) đảo nhỏ phía Tây

/** Bán kính vành (lượn sóng, không tròn hoàn hảo). */
function ringR(theta: number): number {
  return SANTORINI.ringRadius + 55 * Math.sin(3 * theta + 1) + 30 * Math.sin(7 * theta + 2) + (fbm(Math.cos(theta) * 3, Math.sin(theta) * 3, 5) - 0.5) * 70;
}

/** Độ cao địa hình Santorini tại (x, z), âm nếu dưới biển. */
export function santoriniHeight(x: number, z: number): number {
  const dx = x - SANTORINI.x, dz = z - SANTORINI.z;
  const r = Math.sqrt(dx * dx + dz * dz);
  if (r > SANTORINI.ringRadius + SANTORINI.outerSlope + 220) return -40;
  const theta = Math.atan2(dz, dx);

  // Mặt nạ lưỡi liềm (2 đầu thấp dần xuống biển) + đảo nhỏ phía Tây
  const mMain = ss(MAIN_A0, MAIN_A0 + 0.35, theta) * (1 - ss(MAIN_A1 - 0.35, MAIN_A1, theta));
  const mThira = (1 - ss(THIRA_W * 0.6, THIRA_W, Math.abs(wrapAngle(theta - Math.PI)))) * 0.62;
  const mask = Math.max(mMain, mThira);

  let h = -40;
  if (mask > 0) {
    const R = ringR(theta);
    const jag = (fbm(x * 0.008, z * 0.008, 9) - 0.5) * 14 + (fbm(x * 0.03, z * 0.03, 10) - 0.5) * 4; // vách lượn, hơi lởm chởm
    const u = r - R + jag;
    let prof: number;
    if (u < 0) prof = Math.pow(ss(-120, -4, u), 0.85);         // vách trong dốc ~55°
    else prof = Math.pow(1 - ss(0, SANTORINI.outerSlope, u), 1.3); // dốc ngoài thoải
    const H = SANTORINI.cliffHeight * (0.8 + 0.4 * fbm(theta * 2.5, 1.3, 3));
    const ridges = u > 0 ? (fbm(x * 0.012, z * 0.012, 4) - 0.5) * 22 * prof : 0;
    h = (H * prof + ridges) * mask - 7;
  }

  // Đảo núi lửa đen giữa vịnh
  const kx = dx - 70, kz = dz + 40, kd = Math.sqrt(kx * kx + kz * kz);
  if (kd < 220) {
    const cone = Math.pow(1 - ss(0, 200, kd + (fbm(x * 0.03, z * 0.03, 21) - 0.5) * 60), 1.6);
    h = Math.max(h, cone * 48 - 6 + (fbm(x * 0.05, z * 0.05, 22) - 0.5) * 8 * cone);
  }
  return h;
}

/** Có nằm trên đảo núi lửa đen giữa vịnh không (để tô màu). */
function isKameni(x: number, z: number): boolean {
  const kx = x - SANTORINI.x - 70, kz = z - SANTORINI.z + 40;
  return kx * kx + kz * kz < 230 * 230;
}

const hubs: THREE.Object3D[] = [];

const C = {
  tuffLight: new THREE.Color(0xd6c3a2),  // tầng đá tuff sáng
  rustRed: new THREE.Color(0x9a4f3a),    // tầng đá đỏ gỉ
  darkLava: new THREE.Color(0x4a3a36),   // đá núi lửa tối
  plateau: new THREE.Color(0xd9c8a0),    // đất khô trên cao
  scrub: new THREE.Color(0x9aa064),      // bụi cây ô liu
  blackSand: new THREE.Color(0x5a514c),  // bãi cát đen
  kameni: new THREE.Color(0x3a3331),
};

/** Vật liệu địa hình: toon + tầng đá núi lửa nằm ngang trên vách (tính theo độ cao mỗi pixel). */
function strataMaterial(): THREE.MeshToonMaterial {
  // Bóng nhẹ hơn toon mặc định: nắng Địa Trung Hải chói, vách không bị loang mảng tối
  const soft = new THREE.DataTexture(new Uint8Array([195, 195, 195, 255, 228, 228, 228, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  soft.minFilter = soft.magFilter = THREE.NearestFilter;
  soft.generateMipmaps = false;
  soft.needsUpdate = true;
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: soft });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTuff = { value: C.tuffLight };
    sh.uniforms.uRust = { value: C.rustRed };
    sh.uniforms.uLava = { value: C.darkLava };
    sh.uniforms.uPumice = { value: new THREE.Color(0xe9dcc2) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCliff;\nvarying float vCliff;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCliff = aCliff;\nvWPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uTuff; uniform vec3 uRust; uniform vec3 uLava; uniform vec3 uPumice;
varying float vCliff; varying vec3 vWPos;
float sHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
vec3 strata(vec3 p) {
  float warp = sin(p.x * 0.011) * 4.0 + sin(p.z * 0.015 + 1.7) * 4.0 + sin((p.x + p.z) * 0.04) * 1.2;
  float y = p.y + warp;
  float band = floor(y / 6.5);
  float r = sHash(band);
  vec3 c = r < 0.38 ? uTuff : (r < 0.72 ? uRust : uLava);
  float f = fract(y / 6.5);
  c *= 0.82 + 0.18 * smoothstep(0.0, 0.12, f);          // đường ranh tối giữa các tầng
  c = mix(c, uPumice, smoothstep(98.0, 118.0, p.y));   // lớp đá bọt sáng trên đỉnh vách
  return c;
}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, strata(vWPos), vCliff);');
  };
  return mat;
}

export function buildSantorini(scene: THREE.Scene): void {
  const group = new THREE.Group();

  // ---------- Địa hình ----------
  const size = (SANTORINI.ringRadius + SANTORINI.outerSlope + 200) * 2, seg = 440;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(SANTORINI.x, 0, SANTORINI.z);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const cliffAttr = new Float32Array(pos.count);
  const c = new THREE.Color();
  const e = 2.5;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = santoriniHeight(x, z);
    pos.setY(i, h);
    const gx = (santoriniHeight(x + e, z) - santoriniHeight(x - e, z)) / (2 * e);
    const gz = (santoriniHeight(x, z + e) - santoriniHeight(x, z - e)) / (2 * e);
    const slope = Math.sqrt(gx * gx + gz * gz);

    if (isKameni(x, z)) {
      c.copy(C.kameni).lerp(C.darkLava, fbm(x * 0.04, z * 0.04, 31));
    } else {
      // Mặt bằng: đất khô + bụi cây; bờ: cát đen
      // Bụi cây chỉ mọc chỗ thoải (chỗ dốc mà trộn vào sẽ thành vệt loang trên vách)
      c.copy(C.plateau).lerp(C.scrub, ss(0.45, 0.7, fbm(x * 0.015, z * 0.015, 41)) * 0.8 * (1 - ss(0.25, 0.45, slope)));
      c.lerp(C.blackSand, 1 - ss(1, 9, h));
      // Vách: các tầng đá ngang (tuff sáng / đỏ gỉ / đen), uốn nhẹ theo noise
      // Vách: tầng đá được tô trong shader theo độ cao từng pixel (xem strataMaterial)
      cliffAttr[i] = ss(0.45, 0.8, slope) * ss(2, 8, h);
    }
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aCliff', new THREE.BufferAttribute(cliffAttr, 1));
  geo.computeVertexNormals();
  const terrainMat = strataMaterial();
  applyShoreline(terrainMat); // cát ướt + bọt sóng ở mép nước (kiểu Codrops)
  const terrain = new THREE.Mesh(geo, terrainMat);
  group.add(terrain);

  // ---------- Làng ----------
  buildVillage(group);

  group.traverse((o) => o.layers.enable(1)); // mây volumetric dừng tia ở đảo
  scene.add(group);
}

function buildVillage(group: THREE.Group): void {
  const rand = rng(777);
  const toonMat = () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradientMap() });

  interface House { x: number; z: number; y: number; w: number; d: number; hgt: number; rot: number; kind: number }
  const houses: House[] = [];
  const grid = new Map<string, { x: number; z: number; r: number }[]>();
  const cell = 16;
  const free = (x: number, z: number, r: number) => {
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const o of grid.get(`${gx + a},${gz + b}`) ?? []) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
    }
    return true;
  };
  const mark = (x: number, z: number, r: number) => {
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push({ x, z, r });
  };

  // Hai cụm làng chính (kiểu Oia ở mũi Bắc, Fira ở phía Đông) + rải rác dọc vành
  const clusters = [
    { a: -1.55, spread: 0.32, weight: 0.42 },
    { a: -0.15, spread: 0.38, weight: 0.42 },
    { a: 0.9, spread: 0.5, weight: 0.16 },
  ];
  for (let attempt = 0; attempt < SANTORINI.houses * 7 && houses.length < SANTORINI.houses; attempt++) {
    let pick = rand(), cl = clusters[0];
    for (const k of clusters) { if (pick < k.weight) { cl = k; break; } pick -= k.weight; }
    const theta = cl.a + (rand() + rand() + rand() - 1.5) * cl.spread;
    const R = ringR(theta);
    // Nhà dày đặc sát mép vách, thưa dần vào trong đất liền; một số nhà "treo" xuống đầu vách
    const u = -38 + Math.pow(rand(), 1.6) * 160; // từ đầu vách (âm) vào đất liền
    const x = SANTORINI.x + Math.cos(theta) * (R + u), z = SANTORINI.z + Math.sin(theta) * (R + u);
    const w = 5 + rand() * 6, d = 5 + rand() * 5, hgt = 3.2 + rand() * 3;
    const rad = Math.max(w, d) * 0.62;
    if (!free(x, z, rad)) continue;
    // Lấy độ cao 4 góc: nhà cắm xuống dốc (bậc thang) thay vì lơ lửng
    const hs = [[-w, -d], [w, -d], [-w, d], [w, d]].map(([a, b]) => santoriniHeight(x + a * 0.5, z + b * 0.5));
    const hMin = Math.min(...hs), hMax = Math.max(...hs);
    if (hMin < 40 || hMax - hMin > 6.5) continue; // chỗ quá dốc thì bỏ, tránh nhà thành cột
    mark(x, z, rad);
    const r = rand();
    const kind = r < 0.05 ? 2 : r < 0.15 ? 1 : 0; // 2 = nhà thờ mái vòm xanh, 1 = mái cong, 0 = mái bằng
    houses.push({ x, z, y: hMin - 0.6, w, d, hgt: hgt + (hMax - hMin) * 0.8 + 0.6, rot: -theta + (rand() - 0.5) * 0.25, kind });
  }

  const n = houses.length;
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const walls = new THREE.InstancedMesh(box, toonMat(), n);
  const pastel = [0xf6f3ec, 0xf6f3ec, 0xf6f3ec, 0xf6f3ec, 0xf1e2c4, 0xeec7b4, 0xf0e2a8, 0xe9d6c8];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  const vaults: House[] = [], churches: House[] = [];
  houses.forEach((hs, i) => {
    q.setFromAxisAngle(up, hs.rot);
    m.compose(p.set(hs.x, hs.y, hs.z), q, s.set(hs.w, hs.hgt, hs.d));
    walls.setMatrixAt(i, m);
    walls.setColorAt(i, color.setHex(hs.kind === 2 ? 0xf8f6f0 : pastel[Math.floor(rand() * pastel.length)]));
    if (hs.kind === 1) vaults.push(hs);
    if (hs.kind === 2) churches.push(hs);
  });
  group.add(walls);

  // Mái cong (nửa trụ trắng)
  const vaultGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false, 0, Math.PI);
  vaultGeo.rotateZ(Math.PI / 2);
  vaultGeo.rotateY(Math.PI / 2);
  const vaultMesh = new THREE.InstancedMesh(vaultGeo, toonMat(), Math.max(1, vaults.length));
  vaults.forEach((hs, i) => {
    q.setFromAxisAngle(up, hs.rot);
    m.compose(p.set(hs.x, hs.y + hs.hgt, hs.z), q, s.set(hs.w * 0.98, hs.w * 0.5, hs.d * 0.98));
    vaultMesh.setMatrixAt(i, m);
    vaultMesh.setColorAt(i, color.setHex(rand() < 0.3 ? 0x6fa8dc : 0xf6f3ec));
  });
  vaultMesh.count = vaults.length;
  group.add(vaultMesh);

  // Nhà thờ: trống tròn trắng + mái vòm xanh + tháp chuông
  const drumGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  drumGeo.translate(0, 0.5, 0);
  const domeGeo = new THREE.SphereGeometry(0.5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const drums = new THREE.InstancedMesh(drumGeo, toonMat(), Math.max(1, churches.length));
  const domes = new THREE.InstancedMesh(domeGeo, toonMat(), Math.max(1, churches.length * 2));
  const towers = new THREE.InstancedMesh(box, toonMat(), Math.max(1, churches.length));
  let di = 0;
  churches.forEach((hs, i) => {
    const r = Math.min(hs.w, hs.d) * 0.8;
    const top = hs.y + hs.hgt;
    m.compose(p.set(hs.x, top, hs.z), q.identity(), s.set(r, r * 0.45, r));
    drums.setMatrixAt(i, m);
    drums.setColorAt(i, color.setHex(0xf8f6f0));
    m.compose(p.set(hs.x, top + r * 0.45, hs.z), q, s.set(r * 1.04, r * 0.9, r * 1.04));
    domes.setMatrixAt(di, m);
    domes.setColorAt(di++, color.setHex(0x2c5cc8));
    // Tháp chuông nhỏ có mái vòm xanh
    q.setFromAxisAngle(up, hs.rot);
    const tx = hs.x + Math.cos(hs.rot) * hs.w * 0.45, tz = hs.z - Math.sin(hs.rot) * hs.w * 0.45;
    m.compose(p.set(tx, hs.y, tz), q, s.set(2.4, hs.hgt + r * 1.3, 2.4));
    towers.setMatrixAt(i, m);
    towers.setColorAt(i, color.setHex(0xf3ead8));
    m.compose(p.set(tx, hs.y + hs.hgt + r * 1.3, tz), q, s.set(2.6, 2.2, 2.6));
    domes.setMatrixAt(di, m);
    domes.setColorAt(di++, color.setHex(0x2c5cc8));
  });
  drums.count = towers.count = churches.length;
  domes.count = di;
  group.add(drums, domes, towers);

  // Hoa giấy hồng bám quanh nhà
  const flowerGeo = new THREE.IcosahedronGeometry(1, 0);
  const flowers = new THREE.InstancedMesh(flowerGeo, toonMat(), Math.floor(n * 0.35) + 1);
  let fi = 0;
  const flowerCols = [0xd6337a, 0xe0479a, 0xc22a6e, 0x7fb348];
  houses.forEach((hs) => {
    if (rand() > 0.35 || fi >= flowers.count) return;
    const a = rand() * Math.PI * 2;
    const fx = hs.x + Math.cos(a) * hs.w * 0.6, fz = hs.z + Math.sin(a) * hs.d * 0.6;
    const sc = 1.2 + rand() * 1.8;
    m.compose(p.set(fx, santoriniHeight(fx, fz) + sc * 0.6, fz), q.identity(), s.set(sc, sc * 0.8, sc));
    flowers.setMatrixAt(fi, m);
    flowers.setColorAt(fi++, color.setHex(flowerCols[Math.floor(rand() * flowerCols.length)]));
  });
  flowers.count = fi;
  group.add(flowers);

  // Cối xay gió ở mũi phía Bắc (kiểu Oia)
  const white = new THREE.MeshToonMaterial({ color: 0xf6f3ec, gradientMap: gradientMap() });
  const thatch = new THREE.MeshToonMaterial({ color: 0x8b6a45, gradientMap: gradientMap() });
  const sail = new THREE.MeshToonMaterial({ color: 0xefe6d2, gradientMap: gradientMap(), side: THREE.DoubleSide });
  for (const [theta, uOff] of [[-1.95, 95], [-1.85, 120], [-2.02, 140]] as const) {
    const R = ringR(theta);
    const x = SANTORINI.x + Math.cos(theta) * (R + uOff), z = SANTORINI.z + Math.sin(theta) * (R + uOff);
    const y = santoriniHeight(x, z) - 1;
    const mill = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, 11, 14), white);
    tower.position.y = 5.5;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 4, 14), thatch);
    roof.position.y = 13;
    const hub = new THREE.Group();
    hub.position.set(0, 10, 3.6);
    for (let k = 0; k < 6; k++) {
      const arm = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 7), sail);
      arm.position.y = 4;
      const holder = new THREE.Group();
      holder.rotation.z = (k * Math.PI) / 3;
      holder.add(arm);
      hub.add(holder);
    }
    hubs.push(hub);
    mill.add(tower, roof, hub);
    mill.position.set(x, y, z);
    mill.rotation.y = -theta + Math.PI / 2;
    group.add(mill);
  }
}

/** Quay cánh cối xay gió (gọi mỗi frame). */
export function animateSantorini(dt: number): void {
  for (const h of hubs) h.rotation.z += dt * 0.5;
}
