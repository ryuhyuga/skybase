// Điều khiển nhân vật đi bộ góc 3: đi theo hướng camera, chạy, nhảy, trọng lực, leo bậc thấp, bơi khi xuống nước,
// đứng được trên hộp va chạm thấp (cầu cảng, bậc thềm) và bị chặn bởi hộp cao (tường, thân cây).
// Đi được trên vật đang di chuyển (boong tàu…) qua board(platform): nhân vật thành con của vật đó, toạ độ tính theo vật.
// Tư thế đặc biệt (ngồi, nằm, tựa lan can, cầm lái) qua setPose(): khoá di chuyển, game tự đặt chỗ.
// Dùng với CameraRig: cam.update(dt, controller.cameraTarget, input) (nhớ cam.profile = CHARACTER_CAMERA).
//
// Phím mặc định: W/A/S/D đi · Shift chạy · Space nhảy · Q vẫy tay (E để dành cho tương tác của game).
import * as THREE from 'three';
import type { CameraRig, CameraTarget } from '../camera/CameraRig';
import type { Input } from '../core/Input';
import { damp, wrapAngle } from '../core/math';
import { SEA_LEVEL, waterShared } from '../water/Ocean';
import type { World } from '../World';
import type { Character, Pose } from './Character';

/** Chỉnh cảm giác điều khiển ở đây. */
export const CHARACTER_MOVE = {
  walkSpeed: 3.2,   // m/s
  runSpeed: 7.0,
  swimSpeed: 2.4,
  accel: 12,        // tăng/giảm tốc
  turnRate: 12,     // xoay người theo hướng đi
  jumpSpeed: 6.0,   // m/s lúc bật nhảy
  gravity: 20,      // m/s²
  stepHeight: 0.55, // bậc cao nhất bước lên được (m)
  radius: 0.35,     // bán kính va chạm (m)
  swimDepth: 0.62,  // nước sâu hơn (x chiều cao) thì chuyển sang bơi
};

export interface ControllerOptions {
  /** Hộp va chạm (vd. từ loadModel(...).colliders). Có thể thêm sau qua controller.colliders.push(...). */
  colliders?: THREE.Box3[];
}

/** Vật nhân vật đứng lên được và di chuyển theo (boong tàu, thang máy, bè…). Toạ độ theo `object`. */
export interface Platform {
  object: THREE.Object3D;
  /**
   * Độ cao sàn tại (x, z) theo toạ độ của object; null = ngoài sàn (bị chặn, vd. lan can).
   * footY = độ cao chân hiện tại: sàn nhiều tầng (boong + khoang dưới) chọn tầng cao nhất không vượt footY + bậc.
   */
  floorAt(x: number, z: number, footY: number): number | null;
  /** Hộp va chạm theo toạ độ của object (cột, bánh lái, đồ đạc…). */
  colliders?: THREE.Box3[];
}

export class CharacterController {
  /** Hướng (theo toạ độ của sàn nếu đang trên sàn, không thì theo thế giới). */
  yaw = 0;
  speed = 0;
  vy = 0;
  grounded = true;
  swimming = false;
  /** Khoá điều khiển (đang mở menu, cắt cảnh…). */
  locked = false;
  /** Phím vẫy tay. */
  waveKey = 'KeyQ';
  colliders: THREE.Box3[];
  /** Sàn đang đứng (null = mặt đất thế giới). */
  platform: Platform | null = null;
  /** Tư thế đặc biệt đang dùng (null = tự do đi lại). */
  pose: Pose | null = null;

  /** Đưa vào CameraRig: luôn trả toạ độ/hướng THẾ GIỚI kể cả khi đang đứng trên sàn di chuyển. */
  readonly cameraTarget: CameraTarget;

  private vel = new THREE.Vector2();
  private wave = 0;
  private waveTimer = 0;
  private impact = 0;
  private worldPos = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(private world: World, readonly character: Character, opts: ControllerOptions = {}) {
    this.colliders = opts.colliders ?? [];
    const self = this;
    this.cameraTarget = {
      get position() { return self.getWorldPosition(); },
      get yaw() { return self.worldYaw; },
      get speed() { return self.speed; },
      get eye() { return self.character.eye; },
      get body() { return self.character.body; },
      get frameYaw() { return self.platform ? self.platformYaw() : 0; },
    };
  }

  /** Vị trí theo toạ độ cha (thế giới, hoặc sàn nếu đang trên sàn). */
  get position(): THREE.Vector3 { return this.character.rig.position; }
  get eye(): THREE.Object3D { return this.character.eye; }
  get body(): THREE.Object3D { return this.character.body; }

  /** Vị trí thế giới (dùng chung 1 vector, copy nếu cần giữ). */
  getWorldPosition(): THREE.Vector3 {
    return this.character.rig.getWorldPosition(this.worldPos);
  }

  /** Hướng theo thế giới. */
  get worldYaw(): number {
    return this.yaw + (this.platform ? this.platformYaw() : 0);
  }

  private platformYaw(): number {
    this.platform!.object.getWorldQuaternion(this.tmpQ);
    return this.tmpE.setFromQuaternion(this.tmpQ, 'YXZ').y;
  }

  /** Đặt nhân vật tại vị trí thế giới (tự đặt lên mặt đất nếu y thấp hơn đất). Rời sàn nếu đang trên sàn. */
  teleport(p: THREE.Vector3, yaw = this.worldYaw): void {
    if (this.platform) this.leavePlatform();
    this.position.copy(p);
    this.yaw = yaw;
    this.vel.set(0, 0);
    this.vy = 0;
    this.pose = null;
    this.position.y = Math.max(p.y, this.groundAt(p.x, p.z, p.y + 50));
  }

  /** Lên sàn di chuyển tại vị trí (toạ độ của sàn). */
  board(platform: Platform, local: THREE.Vector3, yaw = 0): void {
    this.platform = platform;
    platform.object.add(this.character.rig);
    this.position.copy(local);
    this.position.y = Math.max(local.y, platform.floorAt(local.x, local.z, local.y) ?? local.y);
    this.yaw = yaw;
    this.vel.set(0, 0);
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
  }

  /** Rời sàn: nhân vật về lại thế giới tại đúng chỗ đang đứng (rồi rơi theo trọng lực). */
  leavePlatform(): void {
    if (!this.platform) return;
    const yaw = this.worldYaw;
    const wp = this.getWorldPosition().clone();
    this.world.scene.add(this.character.rig);
    this.character.rig.position.copy(wp);
    this.yaw = yaw;
    this.platform = null;
    this.pose = null;
    this.grounded = false;
  }

  /** Vào tư thế đặc biệt tại chỗ (toạ độ cha hiện tại). null = đứng dậy đi tiếp. */
  setPose(pose: Pose | null, at?: THREE.Vector3, yaw?: number): void {
    this.pose = pose;
    if (at) this.position.copy(at);
    if (yaw !== undefined) this.yaw = yaw;
    this.vel.set(0, 0);
    this.speed = 0;
    this.vy = 0;
    this.grounded = true;
  }

  /** Độ cao chỗ đứng: địa hình hoặc mặt trên hộp va chạm thấp hơn chân + bậc. */
  groundAt(x: number, z: number, footY: number): number {
    const r = CHARACTER_MOVE.radius * 0.5;
    let g: number;
    let boxes = this.colliders;
    if (this.platform) {
      g = this.platform.floorAt(x, z, footY) ?? -1e9;
      boxes = this.platform.colliders ?? [];
    } else {
      g = this.world.terrain.heightAt(x, z);
    }
    for (const b of boxes) {
      if (x < b.min.x - r || x > b.max.x + r || z < b.min.z - r || z > b.max.z + r) continue;
      if (b.max.y <= footY + CHARACTER_MOVE.stepHeight && b.max.y > g) g = b.max.y;
    }
    return g;
  }

  private blocked(x: number, z: number, footY: number): boolean {
    const M = CHARACTER_MOVE, h = this.character.height, r = M.radius;
    const boxes = this.platform ? this.platform.colliders ?? [] : this.colliders;
    for (const b of boxes) {
      if (x < b.min.x - r || x > b.max.x + r || z < b.min.z - r || z > b.max.z + r) continue;
      if (b.max.y > footY + M.stepHeight && b.min.y < footY + h) return true;
    }
    if (this.platform) {
      // ngoài mép sàn (lan can): chặn — kiểm tra cả thân người (bán kính) chứ không chỉ tâm
      const pf = this.platform;
      const f = (fx: number, fz: number) => pf.floorAt(fx, fz, footY);
      return f(x, z) === null || f(x + r, z) === null || f(x - r, z) === null || f(x, z + r) === null || f(x, z - r) === null;
    }
    // vách đất quá dốc
    const climb = M.stepHeight + (this.swimming ? h * 0.6 : 0); // từ dưới nước được trèo lên bờ cao hơn chút
    return this.world.terrain.heightAt(x, z) > footY + climb;
  }

  update(dt: number, input: Input, cam: CameraRig): void {
    if (this.pose) {
      // đang ngồi/nằm/tựa/cầm lái: chỉ animate, game tự đặt vị trí
      this.character.rig.rotation.y = this.yaw;
      this.character.animate(dt, this.animState());
      return;
    }
    const M = CHARACTER_MOVE;
    const p = this.position;
    const h = this.character.height;

    // --- hướng nhập theo camera ---
    let ix = 0, iz = 0, run = false, jump = false;
    if (!this.locked) {
      iz = (input.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (input.isDown('KeyS', 'ArrowDown') ? 1 : 0);
      ix = (input.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (input.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
      run = input.isDown('ShiftLeft', 'ShiftRight');
      jump = input.wasPressed('Space');
      if (input.wasPressed(this.waveKey)) this.waveTimer = 2.2;
    }
    const pYaw = this.platform ? this.platformYaw() : 0;
    let wantX = 0, wantZ = 0;
    if (cam.mode === 'first') {
      // góc 1: A/D xoay người, W/S đi tới/lùi
      this.yaw -= ix * 2.2 * dt;
      wantX = -Math.sin(this.yaw) * iz; wantZ = -Math.cos(this.yaw) * iz;
    } else {
      const vy = cam.viewYaw - pYaw; // hướng camera tính theo sàn
      const fx = -Math.sin(vy), fz = -Math.cos(vy); // phía trước camera
      const rx = -fz, rz = fx;                       // bên phải camera
      wantX = fx * iz + rx * ix; wantZ = fz * iz + rz * ix;
    }
    const len = Math.hypot(wantX, wantZ);
    if (len > 1) { wantX /= len; wantZ /= len; }

    const top = this.swimming ? M.swimSpeed : run ? M.runSpeed : M.walkSpeed;
    this.vel.x = damp(this.vel.x, wantX * top, M.accel, dt);
    this.vel.y = damp(this.vel.y, wantZ * top, M.accel, dt);
    this.speed = this.vel.length();
    if (len > 0.1 && cam.mode === 'third') {
      const target = Math.atan2(-wantX, -wantZ);
      this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-M.turnRate * dt));
    }

    // --- di chuyển ngang, trượt theo từng trục khi bị chặn ---
    const nx = p.x + this.vel.x * dt, nz = p.z + this.vel.y * dt;
    if (!this.blocked(nx, p.z, p.y)) p.x = nx; else this.vel.x = 0;
    if (!this.blocked(p.x, nz, p.y)) p.z = nz; else this.vel.y = 0;

    // --- đứng / nhảy / rơi / bơi ---
    const ground = this.groundAt(p.x, p.z, p.y);
    const water = SEA_LEVEL + Math.sin(waterShared.uTime.value * waterShared.uWaveSpeed.value) * waterShared.uWaveAmplitude.value;
    const deep = !this.platform && water - ground > h * M.swimDepth;
    if (deep && p.y <= water - h * 0.35 + 0.05) {
      this.swimming = true;
      this.grounded = false;
      // nổi lên mặt nước, nhấp nhô theo sóng
      p.y = damp(p.y, water - h * 0.42, 4, dt);
      this.vy = 0;
      if (jump) { this.vy = M.jumpSpeed * 0.8; this.swimming = false; p.y = water - h * 0.3; }
    } else {
      this.swimming = false;
      if (this.grounded && jump) { this.vy = M.jumpSpeed; this.grounded = false; }
      this.vy -= M.gravity * dt;
      p.y += this.vy * dt;
      if (p.y <= ground) {
        // đáp đất: nhớ vận tốc rơi để animation nhún theo
        if (!this.grounded) this.impact = this.vy;
        p.y = ground; this.vy = 0; this.grounded = true;
      } else if (this.grounded && p.y - ground < M.stepHeight && this.vy <= 0) {
        p.y = ground; this.vy = 0; // bám dốc xuống, không bay khỏi dốc
      } else {
        this.grounded = false;
      }
    }

    this.waveTimer = Math.max(0, this.waveTimer - dt);
    this.wave = damp(this.wave, this.waveTimer > 0 && this.grounded && this.speed < 0.5 ? 1 : 0, 8, dt);

    this.character.rig.rotation.y = this.yaw;
    this.character.animate(dt, this.animState());
    this.impact = 0;
  }

  private animState() {
    return { speed: this.speed, walkSpeed: CHARACTER_MOVE.walkSpeed, runSpeed: CHARACTER_MOVE.runSpeed,
      grounded: this.grounded, vy: this.impact || this.vy, swimming: this.swimming, wave: this.wave, pose: this.pose };
  }
}
