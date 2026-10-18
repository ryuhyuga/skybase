// Tự lái: bay tới đích đã chọn, tự giữ độ cao an toàn trên địa hình, tới nơi thì giảm tốc và lượn vòng quanh đích.
// "Giữ hướng": bay thẳng theo hướng lúc bật, vẫn tự nâng độ cao khi gặp núi.
import * as THREE from 'three';
import { wrapAngle } from '../engine';
import type { Ship } from './Ship';

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
  cruiseThrottle: 4,  // nấc ga khi bay đường dài (4 = "Nhanh")
  orbitThrottle: 2,   // nấc ga khi lượn quanh đích (2 = "Chậm")
  minAltitude: 110,   // m trên mặt biển
  clearance: 70,      // m cao hơn địa hình phía trước
  orbitExtra: 220,    // lượn vòng cách mép đảo bao nhiêu (m)
};

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

  /** Lệnh điều khiển cho frame này (đồng thời đặt nấc ga). */
  control(ship: Ship, heightAt: (x: number, z: number) => number): { steer: number; lift: number } {
    const A = AUTOPILOT;
    const p = ship.position;
    let desired = this.holdYaw;
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
        ship.throttle = A.orbitThrottle;
      } else {
        desired = bearing;
        ship.throttle = dist < orbitR + 400 ? 3 : A.cruiseThrottle;
      }
    } else {
      ship.throttle = A.cruiseThrottle;
    }
    const steer = THREE.MathUtils.clamp(wrapAngle(desired - ship.yaw) * 2.5, -1, 1);

    // độ cao: cao hơn địa hình cao nhất trong 500 m phía trước
    let maxH = 0;
    const fx = -Math.sin(ship.yaw), fz = -Math.cos(ship.yaw);
    for (let s = 0; s <= 500; s += 50) maxH = Math.max(maxH, heightAt(p.x + fx * s, p.z + fz * s));
    const targetAlt = Math.max(A.minAltitude, maxH + A.clearance);
    const lift = THREE.MathUtils.clamp((targetAlt - p.y) / 25, -1, 1);
    return { steer, lift };
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
