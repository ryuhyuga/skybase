// Boong tàu thành "sàn" cho nhân vật đi lại: mặt sàn, lan can (mép), vật cản, võng, ghế, các chỗ tương tác.
// Mọi toạ độ ở đây theo ship.body (boong ở y = 0, mũi tàu hướng −Z).
import * as THREE from 'three';
import { COLORS, toon, type Platform, type Pose } from '../engine';
import type { Ship } from './Ship';

export type SpotKind = 'helm' | 'hammock' | 'seat' | 'lean';

export interface DeckSpot {
  kind: SpotKind;
  label: string;          // chữ hiện ở gợi ý "E …"
  at: THREE.Vector3;      // chỗ nhân vật đứng / ngồi / nằm (toạ độ boong)
  yaw: number;            // hướng nhân vật khi vào chỗ
  pose: Pose | null;      // tư thế khi vào chỗ (võng: chọn trong menu)
  radius: number;         // đứng trong bán kính này thì hiện gợi ý
}

/** Chỗ lên tàu (toạ độ boong). */
export const BOARD_POINT = new THREE.Vector3(-0.6, 0, 0.2);

export function buildDeck(ship: Ship): { platform: Platform; spots: DeckSpot[] } {
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
    new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));

  // ---- Võng ở đuôi tàu (vắt ngang) ----
  const wood = toon(COLORS.woodDark), cloth = toon(COLORS.hullCream), stripe = toon(COLORS.envelopeStripe);
  for (const x of [-1.55, 1.55]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.25, 6), wood);
    post.position.set(x, 0.62, 1.35);
    ship.body.add(post);
  }
  const sag = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3.0, 14, 1, true, Math.PI * 1.25, Math.PI * 0.5), cloth);
  sag.material = cloth.clone();
  (sag.material as THREE.MeshToonMaterial).side = THREE.DoubleSide;
  sag.rotation.z = Math.PI / 2;
  sag.scale.set(0.45, 1, 0.38);
  sag.position.set(0, 0.95, 1.35);
  const band = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.04, 0.08), stripe);
  band.position.set(0, 0.97, 1.08);
  ship.body.add(sag, band);

  // ---- Ghế (thùng gỗ) bên mạn phải, nhìn về mũi ----
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 1.2), toon(COLORS.wood));
  crate.position.set(1.22, 0.225, -4.2);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.05, 1.24), toon(COLORS.woodDark));
  lid.position.set(1.22, 0.47, -4.2);
  ship.body.add(crate, lid);

  for (const o of [sag, band, crate, lid]) o.layers.enable(1); // che mây

  const platform: Platform = {
    object: ship.body,
    floorAt(x, z) {
      // thân boong chữ nhật + mũi nhọn (theo lan can trong Cockpit.ts)
      if (z <= 1.85 && z >= -6.2) return Math.abs(x) <= 1.62 ? 0 : null;
      if (z < -6.2 && z >= -8.6) return Math.abs(x) <= (1.62 * (z + 8.6)) / 2.4 ? 0 : null;
      return null;
    },
    colliders: [
      box(-0.2, 0.2, 0, 1.4, -1.95, -1.45),     // cột bánh lái
      box(0.75, 1.15, 0, 1.3, -1.45, -1.05),    // la bàn
      box(-0.15, 0.15, 0, 2.6, -8.55, -8.25),   // cột mũi
      box(-1.62, 1.62, 0.5, 1.1, 1.0, 1.75),    // võng
      box(0.87, 1.57, 0, 0.5, -4.8, -3.6),      // thùng gỗ (thấp: đứng lên được)
    ],
  };

  const spots: DeckSpot[] = [
    { kind: 'helm', label: 'Bánh lái', at: new THREE.Vector3(0, 0, -0.85), yaw: 0, pose: 'helm', radius: 1.1 },
    { kind: 'hammock', label: 'Võng', at: new THREE.Vector3(0, 0.62, 1.35), yaw: Math.PI / 2, pose: 'lie', radius: 1.3 },
    { kind: 'seat', label: 'Ngồi ngắm cảnh', at: new THREE.Vector3(1.22, 0.49, -4.2), yaw: 0, pose: 'sit', radius: 1.0 },
    { kind: 'lean', label: 'Tựa mũi tàu ngắm cảnh', at: new THREE.Vector3(0, 0, -7.25), yaw: 0, pose: 'lean', radius: 1.0 },
    { kind: 'lean', label: 'Tựa lan can ngắm cảnh', at: new THREE.Vector3(-1.22, 0, -4.0), yaw: Math.PI / 2, pose: 'lean', radius: 0.9 },
  ];
  return { platform, spots };
}
