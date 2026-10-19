// Tàu bay: điều khiển nhẹ nhàng, có quán tính, nghiêng khi rẽ, bồng bềnh khi đứng yên.
// rig = vị trí + hướng trong thế giới; body = nghiêng/lắc (chỉ là hình ảnh).
// Camera không nằm ở đây: xem CameraRig (góc 1 dùng `eye`, góc 3 bám theo rig).
// Hình tàu là model public/models/airship.glb (tools/blender/models/build_airship.py), gắn vào bằng useModel():
// game tìm các node theo tên để cử động: wheel (bánh lái), needle (kim la bàn), prop_L / prop_R (cánh quạt),
// flag_dome / flag_bow (cờ), eye_helm (mắt người lái ở góc 1).
import * as THREE from 'three';
import { waterLevelNow, type LoadedModel } from '../engine';
import { Input } from '../engine/core/Input';
import { damp, wrapAngle } from '../engine/core/math';

/** Các bộ phận cử động được của tàu (Object3D rỗng nếu model thiếu node đó). */
export interface ShipParts {
  wheel: THREE.Object3D;
  needle: THREE.Object3D;
  props: THREE.Object3D[];
  flags: THREE.Object3D[];
  lamps: THREE.MeshToonMaterial[];
}

export const THROTTLE = [
  { label: 'Lùi', speed: -6 },
  { label: 'Dừng', speed: 0 },
  { label: 'Chậm', speed: 10 },
  { label: 'Vừa', speed: 20 },
  { label: 'Nhanh', speed: 32 },
  { label: 'Hết ga', speed: 45 },
];

export const MAX_ALT = 1100;
/** Thân tàu sâu bao nhiêu dưới boong (m), theo model airship.glb. */
export const HULL_DEPTH = 6.5;
/** Tàu nổi trên nước thì đáy thân chìm bao sâu (m). */
export const DRAFT = 1.6;
/** Độ cao boong khi tàu nổi trên mặt nước (so với mực nước): thấp nhất tàu hạ được. */
export const FLOAT_HEIGHT = HULL_DEPTH - DRAFT;

export class Ship {
  readonly rig = new THREE.Group();
  readonly body = new THREE.Group();
  /** Vị trí mắt người lái (góc nhìn thứ nhất). */
  readonly eye = new THREE.Object3D();
  parts: ShipParts = { wheel: new THREE.Object3D(), needle: new THREE.Object3D(), props: [], flags: [], lamps: [] };

  yaw = 0;            // 0 = hướng Bắc (-Z)
  speed = 0;
  vy = 0;
  throttle = 2;
  steer = 0;
  private t = 0;
  private propSpin = 0;

  constructor() {
    this.eye.position.set(0, 1.62, -1.7);
    this.body.add(this.eye);
    this.rig.add(this.body);
    this.rig.rotation.order = 'YXZ';
    this.body.rotation.order = 'YXZ';
  }

  /** Gắn model tàu (load bằng loadModel với addToScene: false) vào thân tàu. */
  useModel(model: LoadedModel): void {
    this.body.add(model.root);
    const find = (n: string) => model.root.getObjectByName(n) ?? model.markers.get(n);
    const none = () => new THREE.Object3D();
    const lamps = new Set<THREE.MeshToonMaterial>();
    model.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
      if ((o as THREE.Mesh).isMesh && Number(o.userData.sb_glow ?? 0) > 0 && m?.emissive) lamps.add(m);
    });
    this.parts = {
      wheel: find('wheel') ?? none(),
      needle: find('needle') ?? none(),
      props: ['prop_L', 'prop_R'].map(find).filter((o): o is THREE.Object3D => !!o),
      flags: ['flag_dome', 'flag_bow'].map(find).filter((o): o is THREE.Object3D => !!o),
      lamps: [...lamps],
    };
    const eye = model.markers.get('eye_helm');
    if (eye) this.eye.position.copy(this.body.worldToLocal(eye.getWorldPosition(new THREE.Vector3())));
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

  /** Đang nổi trên mặt nước (đáy thân chạm nước). */
  floating = false;

  /**
   * control: lệnh từ tự lái thay cho bàn phím: steer -1..1 (trái/phải), lift -1..1 (xuống/lên),
   * speed (m/s, tuỳ chọn) thay cho nấc ga.
   */
  update(dt: number, input: Input, controlsLocked: boolean, control?: { steer: number; lift: number; speed?: number }): void {
    this.t += dt;

    if (!controlsLocked) {
      if (input.wasPressed('KeyW', 'ArrowUp')) this.throttle = Math.min(THROTTLE.length - 1, this.throttle + 1);
      if (input.wasPressed('KeyS', 'ArrowDown')) this.throttle = Math.max(0, this.throttle - 1);
    }
    const steerIn = control ? control.steer : controlsLocked ? 0 : (input.isDown('KeyA', 'ArrowLeft') ? 1 : 0) - (input.isDown('KeyD', 'ArrowRight') ? 1 : 0);
    const liftIn = control ? control.lift : controlsLocked ? 0 : (input.isDown('Space') ? 1 : 0) - (input.isDown('ShiftLeft', 'ShiftRight', 'ControlLeft') ? 1 : 0);

    // Quán tính nặng nề của tàu bay
    this.speed = damp(this.speed, control?.speed ?? THROTTLE[this.throttle].speed, 0.5, dt);
    this.steer = damp(this.steer, steerIn, 2.2, dt);
    this.vy = damp(this.vy, liftIn * 14, 1.4, dt);

    const turnRate = this.steer * 0.32 * (0.35 + 0.65 * Math.min(1, Math.abs(this.speed) / 20));
    this.yaw += turnRate * dt;

    this.rig.position.addScaledVector(this.forward(), this.speed * dt);
    // thấp nhất: nổi trên mặt nước, bồng bềnh theo sóng
    const floor = waterLevelNow() + FLOAT_HEIGHT;
    // đang nổi mà không kéo lên: bám theo mặt nước (lên xuống theo sóng) thay vì lơ lửng khi sóng hạ
    if (this.floating && liftIn <= 0) this.rig.position.y = floor;
    this.rig.position.y = THREE.MathUtils.clamp(this.rig.position.y + this.vy * dt, floor, MAX_ALT);
    this.floating = this.rig.position.y <= floor + 0.05;
    if (this.floating && this.vy < 0) this.vy = 0;
    this.rig.rotation.y = this.yaw;

    // Nghiêng khi rẽ, ngóc mũi khi lên, bồng bềnh nhẹ
    const sp = Math.min(1, Math.abs(this.speed) / 15);
    this.body.rotation.z = this.steer * 0.09 * sp + Math.sin(this.t * 0.55) * 0.012;
    this.body.rotation.x = this.vy * 0.006 + Math.sin(this.t * 0.8) * (this.floating ? 0.016 : 0.008);
    this.body.position.y = Math.sin(this.t * 0.7) * 0.18;

    // Bánh lái, cờ, cánh quạt
    this.parts.wheel.rotation.z = this.steer * 2.6;
    for (const [i, f] of this.parts.flags.entries()) f.rotation.y = Math.sin(this.t * (2 + sp * 4) + i * 1.7) * (0.15 + sp * 0.2) + 0.1;
    this.propSpin += dt * (1.5 + this.speed * 0.6);
    for (const [i, p] of this.parts.props.entries()) p.rotation.z = i ? -this.propSpin : this.propSpin; // 2 bên quay ngược nhau
  }

  /** Kim la bàn chỉ về hướng (bearing, radian) mục tiêu. */
  pointNeedle(bearing: number | null, dt: number): void {
    const target = bearing === null ? Math.sin(this.t * 0.3) * 0.4 : -wrapAngle(bearing - this.heading);
    const cur = this.parts.needle.rotation.y;
    this.parts.needle.rotation.y = cur + wrapAngle(target - cur) * (1 - Math.exp(-4 * dt));
  }

  /** Đèn trên tàu: ban ngày dịu, ban đêm sáng rõ (night 0..1). */
  setLamp(night: number): void {
    for (const m of this.parts.lamps) m.emissiveIntensity = 0.6 + night * 2.6;
  }

  /** Chạm đảo: giảm tốc. */
  bump(): void {
    this.speed *= 0.6;
  }
}
