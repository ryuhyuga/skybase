// Tàu bay thành "sàn" cho nhân vật đi lại: boong, cầu thang, tầng dưới (khoang hàng + kho), buồng lái, bếp.
// Mọi thứ đọc từ model public/models/airship.glb (dựng bằng tools/blender/models/build_airship.py):
//  - bố cục sàn (scene extras "sb_layout"): mặt cắt thân, sàn tầng dưới, cầu thang, các phòng
//  - điểm mốc: spot_* (chỗ tương tác), stand_* (chỗ đứng dậy), board (chỗ lên tàu)
//  - hộp va chạm: tường, đồ đạc (nhãn Va chạm trong Blender)
//  - nhóm ẩn "sb_hide": upper (boong trở lên), roof_wheel, roof_kitchen -> cắt mái khi nhân vật vào trong
// Toạ độ theo ship.body (boong ở y = 0, mũi tàu hướng −Z). Blender (x, y, z) -> game (x, z, −y).
import * as THREE from 'three';
import type { LoadedModel, Platform, Pose } from '../engine';

export type SpotKind = 'helm' | 'hammock' | 'seat' | 'lean';

export interface DeckSpot {
  kind: SpotKind;
  label: string;          // chữ hiện ở gợi ý "E …"
  at: THREE.Vector3;      // chỗ nhân vật đứng / ngồi / nằm (toạ độ boong)
  yaw: number;            // hướng nhân vật khi vào chỗ
  pose: Pose | null;      // tư thế khi vào chỗ (võng: chọn trong menu)
  radius: number;         // đứng trong bán kính này thì hiện gợi ý
  stand: THREE.Vector3;   // chỗ đứng khi rời chỗ
}

/** Nhân vật đang ở đâu trên tàu: quyết định camera và phần nào bị cắt đi. */
export type DeckZone = 'deck' | 'wheelhouse' | 'kitchen' | 'lower';

interface Rect { x: number; y0: number; y1: number }
interface Layout {
  deckZ: number;
  lowerZ: number;
  profile: [number, number, number][]; // (y, nửa bề rộng, độ sâu) theo Blender
  lower: Rect;
  stair: { x0: number; x1: number; y0: number; y1: number };
  rooms: Record<string, Rect & { hide: string[] }>;
}

export interface ShipDeck {
  platform: Platform;
  spots: DeckSpot[];
  boardPoint: THREE.Vector3;
  /** Vùng của 1 điểm (toạ độ boong). */
  zoneAt(p: THREE.Vector3): DeckZone;
  /** Ẩn mái / tầng trên cho vùng này (null = hiện hết). */
  cutaway(zone: DeckZone | null): void;
}

const RAIL_INSET = 0.5;   // m: mép boong đi được, tính từ mép ngoài thân (lan can + bề dày mạn)
const STERN_INSET = 0.4;  // m: không đi sát tấm đuôi
const BOW_LIMIT = 16.8;   // m (Blender y): xa nhất phía mũi đi được

const SPOT_INFO: Record<string, { kind: SpotKind; label: string; pose: Pose | null; radius: number }> = {
  spot_helm: { kind: 'helm', label: 'Bánh lái', pose: 'helm', radius: 1.2 },
  spot_hammock: { kind: 'hammock', label: 'Võng', pose: 'lie', radius: 1.6 },
  spot_seat_bow: { kind: 'seat', label: 'Ngồi ghế mũi tàu', pose: 'sit', radius: 1.1 },
  spot_seat_kitchen: { kind: 'seat', label: 'Ngồi bàn ăn', pose: 'sit', radius: 1.0 },
  spot_lean_bow: { kind: 'lean', label: 'Tựa mũi tàu ngắm cảnh', pose: 'lean', radius: 1.1 },
  spot_lean_port: { kind: 'lean', label: 'Tựa lan can ngắm cảnh', pose: 'lean', radius: 1.0 },
  spot_lean_stbd: { kind: 'lean', label: 'Tựa lan can đuôi tàu', pose: 'lean', radius: 1.0 },
};

export function buildDeck(model: LoadedModel, body: THREE.Object3D): ShipDeck {
  const L = JSON.parse(String(model.root.children[0]?.userData.sb_layout ?? 'null')) as Layout | null;
  if (!L) throw new Error('airship.glb thiếu sb_layout');
  const P = L.profile;

  const halfWidth = (y: number): number => {
    if (y <= P[0][0]) return P[0][1];
    for (let i = 1; i < P.length; i++) {
      if (y <= P[i][0]) {
        const [y0, w0] = P[i - 1], [y1, w1] = P[i];
        return w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
      }
    }
    return P[P.length - 1][1];
  };
  const S = L.stair, lo = L.lower;
  const inStair = (x: number, y: number) => x >= S.x0 && x <= S.x1 && y >= S.y0 && y <= S.y1;

  const platform: Platform = {
    object: body,
    floorAt(x, z, footY) {
      const y = -z; // về toạ độ Blender
      const step = 0.6;
      let best: number | null = null;
      const take = (h: number) => { if (h <= footY + step && (best === null || h > best)) best = h; };
      // cầu thang: dốc từ sàn dưới (y0) lên boong (y1)
      if (inStair(x, y)) take(L.lowerZ + ((L.deckZ - L.lowerZ) * (y - S.y0)) / (S.y1 - S.y0));
      // boong (trừ lỗ cầu thang)
      else if (y >= P[0][0] + STERN_INSET && y <= BOW_LIMIT && Math.abs(x) <= halfWidth(y) - RAIL_INSET) take(L.deckZ);
      // tầng dưới
      if (Math.abs(x) <= lo.x && y >= lo.y0 + 0.3 && y <= lo.y1 - 0.3) take(L.lowerZ);
      return best;
    },
    colliders: model.colliders,
  };

  // ---- điểm mốc -> chỗ tương tác ----
  const local = (name: string) => {
    const o = model.markers.get(name);
    return o ? body.worldToLocal(o.getWorldPosition(new THREE.Vector3())) : null;
  };
  body.updateMatrixWorld(true);
  const spots: DeckSpot[] = [];
  for (const [name, info] of Object.entries(SPOT_INFO)) {
    const at = local(name);
    if (!at) continue;
    const stand = local(name.replace('spot_', 'stand_')) ?? new THREE.Vector3(at.x, 0, at.z);
    spots.push({ ...info, at, stand, yaw: Number(model.markers.get(name)!.userData.sb_yaw ?? 0) });
  }
  const boardPoint = local('board') ?? new THREE.Vector3(0, 0, 0);

  // ---- nhóm ẩn (cắt mái) ----
  const groups = new Map<string, THREE.Object3D[]>();
  model.root.traverse((o) => {
    const g = o.userData.sb_hide as string | undefined;
    if (!g) return;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  });
  let lastZone: DeckZone | null | undefined;
  const hideFor = (zone: DeckZone | null): string[] => {
    if (zone === 'lower') return ['upper', 'roof_wheel', 'roof_kitchen'];
    if (zone === 'wheelhouse' || zone === 'kitchen') return L.rooms[zone]?.hide ?? [];
    return [];
  };

  return {
    platform, spots, boardPoint,
    zoneAt(p) {
      if (p.y < (L.deckZ + L.lowerZ) / 2) return 'lower';
      const y = -p.z;
      for (const name of ['wheelhouse', 'kitchen'] as const) {
        const r = L.rooms[name];
        if (r && Math.abs(p.x) < r.x && y > r.y0 && y < r.y1) return name;
      }
      return 'deck';
    },
    cutaway(zone) {
      if (zone === lastZone) return;
      lastZone = zone;
      const hidden = new Set(hideFor(zone));
      for (const [g, objs] of groups) for (const o of objs) o.visible = !hidden.has(g);
    },
  };
}
