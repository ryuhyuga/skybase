// Tàu chạm mặt nước: vệt sóng chữ V + bọt sau đuôi, sóng rẽ ở mũi, tia nước bắn, gợn tròn khi đứng yên, cú đáp nước.
// Dùng Wake của engine; ở đây chỉ chọn chỗ sinh hạt theo hình thân tàu (toạ độ ship.body, mũi hướng −Z).
import * as THREE from 'three';
import { Wake, waterLevelNow, type World } from '../engine';
import { DRAFT, HULL_DEPTH, type Ship } from './Ship';

/** Chỉnh hiệu ứng nước của tàu (bảng G: "Sóng nước sau tàu"). */
export const SHIP_WATER = {
  foam: 1.0,        // độ dày vệt bọt (số mảng bọt sinh ra)
  spray: 1.0,       // lượng tia nước ở mũi
  bowSpread: 0.22,  // sóng mũi toả ra ngoài nhanh cỡ nào (x tốc độ tàu) → độ mở chữ V
  ripples: true,    // gợn tròn khi tàu nổi đứng yên
};

// Điểm trên thân ở mực nước khi tàu nổi (đáy chìm DRAFT m): mũi, 2 bên thân, đuôi.
// Bề rộng mực nước lấy theo mặt cắt thân trong build_airship.py.
const BOW = new THREE.Vector3(1.4, 0, -11.5);
const SIDES = [new THREE.Vector3(3.9, 0, -5), new THREE.Vector3(4.0, 0, 3)];
const STERN = new THREE.Vector3(1.6, 0, 11.5);

export class ShipWater {
  readonly wake: Wake;
  private distAcc = 0;
  private timeAcc = 0;
  private sprayAcc = 0;
  private ringT = 0;
  private wasIn = 0;
  private lastY = 0;
  private v = new THREE.Vector3();
  private p = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();

  constructor(world: World, private ship: Ship) {
    this.wake = new Wake(world.scene);
    this.lastY = ship.position.y;
  }

  /** Thân tàu chìm bao nhiêu so với lúc nổi bình thường (0 = không chạm, 1 = nổi đủ mớn nước). */
  get immersion(): number {
    const bottom = this.ship.position.y + this.ship.body.position.y - HULL_DEPTH;
    return THREE.MathUtils.clamp((waterLevelNow() - bottom) / DRAFT, 0, 1.3);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number, tint: THREE.Color): void {
    const S = SHIP_WATER, ship = this.ship;
    const k = this.immersion;
    const vy = (ship.position.y - this.lastY) / Math.max(dt, 1e-3);
    this.lastY = ship.position.y;
    const wy = waterLevelNow();
    ship.forward(this.fwd);
    this.right.set(-this.fwd.z, 0, this.fwd.x); // bên phải mũi tàu
    const sp = Math.abs(ship.speed);
    const body = ship.body;

    // ---- cú đáp xuống nước: vòng sóng + tia nước quanh thân ----
    if (k > 0.08 && this.wasIn <= 0.08 && vy < -1.5) {
      const c = body.localToWorld(this.p.set(0, 0, 0));
      for (let i = 0; i < 3; i++) this.wake.ring(c.x, c.z, 8 + i * 3, 30 + i * 10, 3 + i);
      for (let i = 0; i < 60 * S.spray; i++) {
        const a = Math.random() * Math.PI * 2;
        const lp = this.p.set(Math.cos(a) * 4, 0, Math.sin(a) * 11);
        body.localToWorld(lp).setY(wy + 0.2);
        this.v.set(Math.cos(a) * (3 + Math.random() * 4), 3 + Math.random() * 5 + Math.min(6, -vy * 0.4), Math.sin(a) * (3 + Math.random() * 4));
        this.wake.spray(lp, this.v, 0.5 + Math.random() * 0.5);
      }
    }
    this.wasIn = k;

    if (k > 0.02) {
      const amount = Math.min(1, k * 1.4);
      // ---- vệt bọt: sinh theo quãng đường đi được (đi nhanh vẫn liền mạch), đứng yên thì thưa ----
      this.distAcc += sp * dt;
      this.timeAcc += dt;
      const step = 2.2 / Math.max(0.2, S.foam);
      while ((this.distAcc >= step && sp > 0.8) || this.timeAcc > 0.6) {
        this.distAcc = Math.max(0, this.distAcc - step);
        this.timeAcc = 0;
        if (sp < 0.8 && Math.random() > 0.35) continue;
        const sk = Math.min(1, sp / 25);
        const out = sp * S.bowSpread + 0.4;
        for (const side of [-1, 1]) {
          // sóng mũi: toả ra 2 bên rồi lùi lại sau → chữ V
          this.emit(BOW, side, out * (0.85 + Math.random() * 0.3), (0.8 + sk * 0.6) * amount, (2.4 + sk * 2.6) * amount, -sp * 0.12);
          // dọc thân: bọt mảnh sát mạn
          if (Math.random() < 0.6) for (const s of SIDES) this.emit(s, side, 0.6 + out * 0.3, 0.6 * amount, (1.4 + sk * 1.4) * amount, -sp * 0.05);
          // đuôi: bọt xoáy ở lại phía sau, loang dần
          this.emit(STERN, side, 0.4 + Math.random() * 0.8, (0.9 + sk * 0.6) * amount, (2.6 + sk * 2.4) * amount, -sp * 0.08);
        }
      }
      // ---- tia nước ở mũi khi đi nhanh ----
      this.sprayAcc += dt * Math.max(0, sp - 4) * 2.2 * S.spray * amount;
      while (this.sprayAcc >= 1) {
        this.sprayAcc -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        const lp = body.localToWorld(this.p.set(BOW.x * side * (0.6 + Math.random() * 0.5), 0, BOW.z - Math.random() * 1.5)).setY(wy + 0.2);
        const outV = 1.5 + Math.random() * 2.5 + sp * 0.08;
        this.v.copy(this.right).multiplyScalar(side * outV).addScaledVector(this.fwd, sp * (0.55 + Math.random() * 0.2));
        this.v.y = 2 + Math.random() * 3 + sp * 0.06;
        this.wake.spray(lp, this.v, 0.35 + Math.random() * 0.45, 0.9 + Math.random() * 0.4);
      }
      // ---- gợn tròn khi nổi đứng yên ----
      this.ringT -= dt;
      if (S.ripples && sp < 3 && this.ringT <= 0) {
        this.ringT = 1.8 + Math.random();
        const c = body.localToWorld(this.p.set(0, 0, (Math.random() - 0.5) * 10));
        this.wake.ring(c.x, c.z, 11, 28 + Math.random() * 8, 5);
      }
    }

    this.wake.setTint(tint);
    this.wake.update(dt, camera, viewportHeight);
  }

  /** Mảng bọt tại điểm thân `local` (x lật theo bên), trôi ra ngoài `out` m/s và theo hướng tàu `along` m/s. */
  private emit(local: THREE.Vector3, side: number, out: number, s0: number, s1: number, along: number): void {
    const w = this.ship.body.localToWorld(this.p.set(local.x * side, 0, local.z + (Math.random() - 0.5) * 1.2));
    const vx = this.right.x * side * out + this.fwd.x * along;
    const vz = this.right.z * side * out + this.fwd.z * along;
    this.wake.foam(w.x + (Math.random() - 0.5), w.z + (Math.random() - 0.5), vx, vz, s0, s1);
  }
}
