// Tự lái: bay tới đích đã chọn ở độ cao + tốc độ người chơi đặt (bảng tự lái), tới nơi thì giảm tốc và lượn vòng quanh đích.
// Gặp đảo / núi phía trước thì tự nâng lên cao hơn địa hình rồi hạ lại. Độ cao 0 = chạy trên mặt nước như thuyền.
// "Giữ hướng": đi thẳng theo hướng lúc bật.
import * as THREE from 'three';
import { wrapAngle } from '../engine';
import { FLOAT_HEIGHT, type Ship } from './Ship';

export interface Destination { name: string; x: number; z: number; radius: number }

/** Danh sách đích tự lái. Thêm đảo = thêm 1 dòng. */
export const DESTINATIONS: Destination[] = [
  { name: 'Santorini', x: 0, z: -1900, radius: 700 },
  { name: 'Đảo nhỏ có cầu cảng', x: 230, z: -60, radius: 90 },
  { name: 'Đảo cỏ phía Tây', x: -380, z: 160, radius: 300 },
  { name: 'Đảo xa phía Tây', x: -1350, z: -420, radius: 360 },
  { name: 'Đảo phía Đông', x: 1450, z: 700, radius: 210 },
  { name: 'Đảo Đông Bắc', x: 1650, z: -2050, radius: 230 },
];

export const AUTOPILOT = {
  altitude: 110,      // m: độ cao boong so với mặt biển (0 = nổi trên nước như thuyền)
  speed: 32,          // m/s khi đi đường dài
  orbitSpeed: 14,     // m/s tối đa khi lượn quanh đích
  approachSpeed: 20,  // m/s tối đa khi sắp tới đích
  clearance: 70,      // m cao hơn địa hình phía trước (chỉ khi có đất)
  orbitExtra: 220,    // lượn vòng cách mép đảo bao nhiêu (m)
};
export const AUTOPILOT_MAX_ALT = 600;
export const AUTOPILOT_MAX_SPEED = 45;

export class Autopilot {
  active = false;
  dest: Destination | null = null;   // null = giữ hướng
  arrived = false;
  private holdYaw = 0;

  engage(ship: Ship, dest: Destination | null): void {
    this.active = true;
    this.dest = dest;
    this.arrived = false;
    this.holdYaw = ship.yaw;
  }

  stop(): void {
    this.active = false;
  }

  /** Mô tả trạng thái cho HUD. */
  status(ship: Ship): string {
    if (!this.active) return '';
    if (!this.dest) return 'Tự lái · giữ hướng';
    const d = Math.hypot(this.dest.x - ship.position.x, this.dest.z - ship.position.z);
    return this.arrived ? `Tự lái · đang lượn quanh ${this.dest.name}` : `Tự lái → ${this.dest.name} · ${(d / 1000).toFixed(1)} km`;
  }

  /** Lệnh điều khiển cho frame này: hướng, lên/xuống, tốc độ. */
  control(ship: Ship, heightAt: (x: number, z: number) => number): { steer: number; lift: number; speed: number } {
    const A = AUTOPILOT;
    const p = ship.position;
    let desired = this.holdYaw;
    let speed = A.speed;
    if (this.dest) {
      const dx = this.dest.x - p.x, dz = this.dest.z - p.z;
      const dist = Math.hypot(dx, dz);
      const bearing = Math.atan2(-dx, -dz);
      const orbitR = this.dest.radius + A.orbitExtra;
      if (dist < orbitR + 60) this.arrived = true;
      if (this.arrived) {
        // lượn vòng ngược chiều kim đồng hồ, kéo dần về đúng bán kính
        const err = THREE.MathUtils.clamp((dist - orbitR) / orbitR, -0.6, 0.6);
        desired = bearing - Math.PI / 2 + err * 1.2;
        speed = Math.min(A.speed, A.orbitSpeed);
      } else {
        desired = bearing;
        if (dist < orbitR + 400) speed = Math.min(A.speed, A.approachSpeed);
      }
    }
    const steer = THREE.MathUtils.clamp(wrapAngle(desired - ship.yaw) * 2.5, -1, 1);

    // độ cao: theo bảng tự lái, nhưng cao hơn địa hình cao nhất trong 500 m phía trước nếu có đất
    let maxH = -Infinity;
    const fx = -Math.sin(ship.yaw), fz = -Math.cos(ship.yaw);
    for (let s = 0; s <= 500; s += 50) maxH = Math.max(maxH, heightAt(p.x + fx * s, p.z + fz * s));
    let targetAlt = Math.max(A.altitude, FLOAT_HEIGHT - 1); // 0 m = ép xuống mặt nước (sàn nổi chặn lại)
    if (maxH > 0.5) targetAlt = Math.max(targetAlt, maxH + A.clearance);
    const lift = THREE.MathUtils.clamp((targetAlt - p.y) / 25, -1, 1);
    return { steer, lift, speed };
  }

  /** Tua nhanh `seconds` giây (khi ngủ): mô phỏng bay với bước lớn. */
  fastForward(ship: Ship, seconds: number, heightAt: (x: number, z: number) => number, input: never): void {
    const dt = 0.25;
    for (let t = 0; t < seconds; t += dt) {
      if (this.active) ship.update(dt, input, true, this.control(ship, heightAt));
      else ship.update(dt, input, true);
      const g = heightAt(ship.position.x, ship.position.z) + 12;
      if (ship.position.y < g) ship.position.y = g;
    }
  }
}
