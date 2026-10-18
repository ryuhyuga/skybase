// Tàu bay: điều khiển nhẹ nhàng, có quán tính, nghiêng khi rẽ, bồng bềnh khi đứng yên.
// rig = vị trí + hướng trong thế giới; body = nghiêng/lắc (chỉ là hình ảnh).
// Camera không nằm ở đây: xem CameraRig (góc 1 dùng `eye`, góc 3 bám theo rig).
import * as THREE from 'three';
import { Input } from '../engine/core/Input';
import { damp, wrapAngle } from '../engine/core/math';
import { buildCockpit, CockpitParts } from './Cockpit';

export const THROTTLE = [
  { label: 'Lùi', speed: -6 },
  { label: 'Dừng', speed: 0 },
  { label: 'Chậm', speed: 10 },
  { label: 'Vừa', speed: 20 },
  { label: 'Nhanh', speed: 32 },
  { label: 'Hết ga', speed: 45 },
];

export const MIN_ALT = 14;   // sát mặt biển
export const MAX_ALT = 1100;

export class Ship {
  readonly rig = new THREE.Group();
  readonly body = new THREE.Group();
  /** Vị trí mắt người lái (góc nhìn thứ nhất). */
  readonly eye = new THREE.Object3D();
  readonly parts: CockpitParts;

  yaw = 0;            // 0 = hướng Bắc (-Z)
  speed = 0;
  vy = 0;
  throttle = 2;
  steer = 0;
  private t = 0;
  private propSpin = 0;

  constructor() {
    this.parts = buildCockpit();
    this.eye.position.set(0, 2.25, 0.4);
    this.body.add(this.parts.root, this.eye);
    this.rig.add(this.body);
    this.rig.rotation.order = 'YXZ';
    this.body.rotation.order = 'YXZ';
    this.rig.traverse((o) => o.layers.enable(1)); // để mây volumetric biết tàu che phía trước
  }

  get position(): THREE.Vector3 {
    return this.rig.position;
  }

  /** Hướng mũi tàu theo la bàn (radian, 0 = Bắc, tăng theo chiều kim đồng hồ). */
  get heading(): number {
    return wrapAngle(-this.yaw);
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Vận tốc thế giới (m/s). */
  velocity(out = new THREE.Vector3()): THREE.Vector3 {
    return this.forward(out).multiplyScalar(this.speed).setY(this.vy);
  }

  /** control: lệnh từ tự lái (steer -1..1 trái/phải, lift -1..1 xuống/lên) thay cho bàn phím. */
  update(dt: number, input: Input, controlsLocked: boolean, control?: { steer: number; lift: number }): void {
    this.t += dt;

    if (!controlsLocked) {
      if (input.wasPressed('KeyW', 'ArrowUp')) this.throttle = Math.min(THROTTLE.length - 1, this.throttle + 1);
      if (input.wasPressed('KeyS', 'ArrowDown')) this.throttle = Math.max(0, this.throttle - 1);
    }
    const steerIn = control ? control.steer : controlsLocked ? 0 : (input.isDown('KeyA', 'ArrowLeft') ? 1 : 0) - (input.isDown('KeyD', 'ArrowRight') ? 1 : 0);
    const liftIn = control ? control.lift : controlsLocked ? 0 : (input.isDown('Space') ? 1 : 0) - (input.isDown('ShiftLeft', 'ShiftRight', 'ControlLeft') ? 1 : 0);

    // Quán tính nặng nề của tàu bay
    this.speed = damp(this.speed, THROTTLE[this.throttle].speed, 0.5, dt);
    this.steer = damp(this.steer, steerIn, 2.2, dt);
    this.vy = damp(this.vy, liftIn * 14, 1.4, dt);

    const turnRate = this.steer * 0.32 * (0.35 + 0.65 * Math.min(1, Math.abs(this.speed) / 20));
    this.yaw += turnRate * dt;

    this.rig.position.addScaledVector(this.forward(), this.speed * dt);
    this.rig.position.y = THREE.MathUtils.clamp(this.rig.position.y + this.vy * dt, MIN_ALT, MAX_ALT);
    this.rig.rotation.y = this.yaw;

    // Nghiêng khi rẽ, ngóc mũi khi lên, bồng bềnh nhẹ
    const sp = Math.min(1, Math.abs(this.speed) / 15);
    this.body.rotation.z = this.steer * 0.09 * sp + Math.sin(this.t * 0.55) * 0.012;
    this.body.rotation.x = this.vy * 0.006 + Math.sin(this.t * 0.8) * 0.008;
    this.body.position.y = Math.sin(this.t * 0.7) * 0.18;

    // Bánh lái, cờ, cánh quạt
    this.parts.wheel.rotation.z = this.steer * 2.6;
    this.parts.flag.rotation.y = Math.sin(this.t * (2 + sp * 4)) * (0.15 + sp * 0.2) + 0.1;
    this.propSpin += dt * (1.5 + this.speed * 0.6);
    this.parts.propeller.rotation.z = this.propSpin;
  }

  /** Kim la bàn chỉ về hướng (bearing, radian) mục tiêu. */
  pointNeedle(bearing: number | null, dt: number): void {
    const target = bearing === null ? Math.sin(this.t * 0.3) * 0.4 : -wrapAngle(bearing - this.heading);
    const cur = this.parts.needle.rotation.y;
    this.parts.needle.rotation.y = cur + wrapAngle(target - cur) * (1 - Math.exp(-4 * dt));
  }

  setLamp(night: number): void {
    this.parts.lamp.emissiveIntensity = 0.6 + night * 2.5;
  }

  /** Chạm đảo: giảm tốc. */
  bump(): void {
    this.speed *= 0.6;
  }
}
