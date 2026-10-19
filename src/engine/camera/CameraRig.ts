// Camera: góc 3 (mặc định, nhìn xa và rộng) hoặc góc 1 (trong buồng lái). Phím V để đổi.
// - Góc 3: bám sau tàu, trễ nhẹ khi rẽ; kéo chuột để xoay quanh tàu, cuộn chuột để zoom.
// - Góc 1: mắt người lái; kéo chuột để nhìn quanh.
// Thả chuột một lúc thì camera tự về lại vị trí mặc định (profile.idleReturn giây; 0 = giữ nguyên góc đã kéo).
// cam.reset() đưa camera về mặc định (sau lưng vật đang bám) bất cứ lúc nào.
import * as THREE from 'three';
import { Input } from '../core/Input';
import { damp, wrapAngle } from '../core/math';

export type CamMode = 'third' | 'first';

/** Vật thể camera bám theo (tàu, xe, nhân vật...). Ship trong demo/ đã khớp interface này. */
export interface CameraTarget {
  /** Vị trí trong thế giới. */
  readonly position: THREE.Vector3;
  /** Hướng (radian, 0 = -Z). Camera góc 3 trễ nhẹ theo hướng này. */
  readonly yaw: number;
  /** Tốc độ (m/s), để mở FOV khi chạy nhanh. */
  readonly speed: number;
  /** Điểm mắt cho góc 1 (con của body). */
  readonly eye: THREE.Object3D;
  /** Phần thân có nghiêng/lắc; góc 1 lấy hướng nhìn từ đây. */
  readonly body: THREE.Object3D;
  /**
   * Hướng của sàn đang đứng (boong tàu…), radian. Có thì camera xoay theo sàn,
   * nên góc nhìn so với sàn giữ nguyên khi tàu rẽ (kể cả khi followRate = 0).
   */
  readonly frameYaw?: number;
}

/** Chỉnh cảm giác camera góc 3 ở đây. */
export const THIRD_PERSON = {
  distance: 62,       // khoảng cách mặc định (m)
  minDistance: 22,
  maxDistance: 180,
  pitch: 0.26,        // góc nhìn xuống mặc định (radian)
  height: 12,         // camera xoay quanh điểm này (cao hơn boong, ngang khí cầu)
  lookAhead: 60,      // nhìn vượt lên trước mũi tàu -> tàu nằm dưới khung hình, thấy xa phía trước
  lookUp: 8,
  fov: 64,
  fovSpeedBoost: 8,   // FOV mở thêm khi bay nhanh -> cảm giác tốc độ
  fullSpeed: 45,      // tốc độ (m/s) coi là "hết ga" để tính FOV
  followRate: 2.2,    // camera xoay theo hướng nhân vật nhanh cỡ nào (0 = không tự xoay)
  minHeight: 4,       // camera không thấp hơn mặt biển + mức này (và mặt đất + mức này)
  near: 2,            // mặt phẳng gần ở góc 3 (lớn = ít z-fighting ở xa; nhân vật nhỏ cần nhỏ hơn)
  firstFov: 72,       // FOV góc 1
  idleReturn: 3,      // thả chuột bao nhiêu giây thì camera tự về góc mặc định (0 = không tự về, giữ góc đã kéo)
};

export type CameraProfile = typeof THIRD_PERSON;

/** Profile camera cho nhân vật đi bộ cao ~1.8 m (gán cam.profile = CHARACTER_CAMERA). */
export const CHARACTER_CAMERA: CameraProfile = {
  distance: 7.5, minDistance: 2.5, maxDistance: 30,
  pitch: 0.32, height: 1.5, lookAhead: 2.5, lookUp: 0.6,
  fov: 60, fovSpeedBoost: 4, fullSpeed: 7,
  followRate: 0.8, minHeight: 0.6, near: 0.15, firstFov: 75, idleReturn: 3,
};

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'third';
  /** Hàm độ cao mặt đất (gán từ Terrain.heightAt để camera không chui vào đồi). */
  groundHeight: (x: number, z: number) => number = () => 0;
  /** Thông số góc 3 đang dùng. Đổi profile khi đổi giữa tàu và người (vd. CHARACTER_CAMERA). */
  profile: CameraProfile = THIRD_PERSON;
  /** Tự xoay vòng quanh nhân vật (radian/giây), vd. khi ngủ hay cắt cảnh. 0 = tắt. */
  autoOrbit = 0;

  private camYaw = 0;
  private orbitYaw = 0;
  private orbitPitch = 0;
  private dist = THIRD_PERSON.distance;
  private distTarget = THIRD_PERSON.distance;
  private lastProfile: CameraProfile | null = null;
  private lastYaw = 0;
  private fpYaw = 0;
  private fpPitch = 0;
  private idle = 0;
  private pos = new THREE.Vector3();
  private first = true;
  private resetYaw = false;
  private lastFrame = 0;

  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(aspect: number) {
    // far 20 km (đủ cho trời/biển, sương che phần xa); near đổi theo kiểu camera để giữ độ chính xác chiều sâu
    this.camera = new THREE.PerspectiveCamera(THIRD_PERSON.fov, aspect, 0.3, 20000);
  }

  /** Khoảng cách hiện tại từ camera tới tàu (m); 0 ở buồng lái. */
  get distance(): number {
    return this.mode === 'third' ? this.dist : 0;
  }

  /** Đặt camera ngay vào vị trí (khi dịch chuyển tàu, load save). */
  snap(): void {
    this.first = true;
  }

  /** Về góc mặc định: sau lưng vật đang bám, góc nghiêng và khoảng cách mặc định của profile. Chuyển mượt, không giật. */
  reset(): void {
    this.orbitYaw = this.orbitPitch = this.fpYaw = this.fpPitch = 0;
    this.distTarget = this.profile.distance;
    this.idle = 0;
    this.resetYaw = true;
  }

  toggle(): CamMode {
    this.mode = this.mode === 'third' ? 'first' : 'third';
    this.first = true;
    return this.mode;
  }

  update(dt: number, ship: CameraTarget, input: Input): void {
    // Kéo chuột: xoay góc nhìn; cuộn: zoom (góc 3)
    if (this.autoOrbit && !input.dragging) {
      this.orbitYaw += this.autoOrbit * dt;
      this.idle = 0;
    } else if (input.dragging && (input.lookDX || input.lookDY)) {
      if (this.mode === 'third') {
        this.orbitYaw -= input.lookDX * 0.005;
        this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + input.lookDY * 0.004, -0.35, 1.0);
      } else {
        this.fpYaw = THREE.MathUtils.clamp(this.fpYaw - input.lookDX * 0.004, -2.6, 2.6);
        this.fpPitch = THREE.MathUtils.clamp(this.fpPitch - input.lookDY * 0.004, -1.0, 1.25);
      }
      this.idle = 0;
    } else if (!input.dragging) {
      this.idle += dt;
      const back = this.profile.idleReturn;
      if (back > 0 && this.idle > back) {
        this.orbitYaw = damp(this.orbitYaw, 0, 1.2, dt);
        this.orbitPitch = damp(this.orbitPitch, 0, 1.2, dt);
        this.fpYaw = damp(this.fpYaw, 0, 1.5, dt);
        this.fpPitch = damp(this.fpPitch, 0, 1.5, dt);
      }
    }
    const P = this.profile;
    this.lastYaw = ship.yaw;
    if (P !== this.lastProfile) {
      // đổi profile: trượt dần về khoảng cách mặc định của profile mới, giữ nguyên hướng nhìn (không giật)
      if (!this.lastProfile) this.dist = P.distance;
      this.distTarget = P.distance;
      this.lastProfile = P;
    }
    if (input.wheel) {
      this.distTarget = THREE.MathUtils.clamp(this.distTarget * (input.wheel > 0 ? 1.12 : 0.89), P.minDistance, P.maxDistance);
    }

    const speedK = Math.min(1, Math.abs(ship.speed) / P.fullSpeed);

    if (this.mode === 'first') {
      ship.eye.getWorldPosition(this.camera.position);
      ship.body.getWorldQuaternion(this.camera.quaternion);
      this.tmpE.set(this.fpPitch - 0.06, this.fpYaw, 0);
      this.camera.quaternion.multiply(this.tmpQ.setFromEuler(this.tmpE));
      this.setNear(Math.min(0.3, P.near)); // góc 1: cần gần để thấy bánh lái / tay
      this.setFov(P.firstFov + speedK * 4);
      return;
    }

    // Góc 3: hướng camera trễ nhẹ sau hướng tàu
    const frame = ship.frameYaw ?? 0;
    if (this.first || this.resetYaw) this.camYaw = ship.yaw;
    else this.camYaw += wrapAngle(frame - this.lastFrame); // sàn (boong tàu) xoay thì camera xoay theo
    this.lastFrame = frame;
    this.resetYaw = false;
    this.camYaw += wrapAngle(ship.yaw - this.camYaw) * (1 - Math.exp(-P.followRate * dt));
    this.dist = damp(this.dist, this.distTarget, 5, dt);

    const yaw = this.camYaw + this.orbitYaw;
    const pitch = THREE.MathUtils.clamp(P.pitch + this.orbitPitch, -0.3, 1.3);
    const target = this.tmpV.copy(ship.position).setY(ship.position.y + P.height);
    const desired = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).multiplyScalar(this.dist).add(target);
    // Không chui xuống biển hay xuyên vào đồi
    desired.y = Math.max(desired.y, P.minHeight, this.groundHeight(desired.x, desired.z) + P.minHeight);

    if (this.first) this.pos.copy(desired);
    else this.pos.lerp(desired, 1 - Math.exp(-10 * dt));
    this.first = false;

    this.camera.position.copy(this.pos);
    // Nhìn về phía trước theo hướng camera (không phải hướng tàu) để kéo chuột xoay vẫn tự nhiên.
    const ahead = P.lookAhead * Math.max(0, Math.cos(this.orbitPitch));
    this.camera.lookAt(
      target.x - Math.sin(yaw) * ahead,
      target.y + P.lookUp,
      target.z - Math.cos(yaw) * ahead,
    );
    this.setNear(P.near); // góc 3: near lớn hơn -> hết z-fighting nước/bờ ở xa
    this.setFov(P.fov + speedK * P.fovSpeedBoost);
  }

  private setNear(n: number): void {
    if (this.camera.near === n) return;
    this.camera.near = n;
    this.camera.updateProjectionMatrix();
  }

  private setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov += (fov - this.camera.fov) * 0.08;
    this.camera.updateProjectionMatrix();
  }

  /** Hướng camera đang nhìn (radian, cùng quy ước yaw) — để nhân vật đi theo hướng camera. */
  get viewYaw(): number {
    return this.mode === 'third' ? this.camYaw + this.orbitYaw : this.lastYaw + this.fpYaw;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
