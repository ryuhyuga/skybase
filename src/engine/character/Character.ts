// Nhân vật dạng ghép khối (đầu, tóc, thân, tay, chân là các mesh rời, pivot đặt ở khớp) + animation thủ tục:
// đứng thở, đi, chạy, nhảy/rơi, bơi, vẫy tay. Không cần skeleton hay clip animation.
//
// Model đầu vào: .glb có các node tên bắt đầu bằng head / hair / torso|body|chest / belt / arm / leg
// (như character.glb trong public/models). Mặt trước hướng −Z (trong Blender: +Y). Tay/chân trái phải tự nhận
// theo vị trí x. Pivot của node phải ở khớp: vai cho tay, hông cho chân, cổ cho đầu.
//
// Dùng:  const hero = await loadCharacter(world, 'models/character.glb');
//        mỗi frame: hero.animate(dt, { speed, grounded, vy, swimming })  (CharacterController tự gọi)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toToon } from '../assets/loadModel';
import { damp } from '../core/math';
import type { World } from '../World';

/** Chỉnh dáng chuyển động ở đây. */
export const CHARACTER_ANIM = {
  strideLength: 1.1,   // m mỗi bước (theo chiều cao 1.8 m): lớn = bước dài, chậm
  legSwing: 0.6,       // biên độ vung chân khi đi (radian)
  legSwingRun: 0.95,
  armSwing: 0.55,
  armSwingRun: 0.95,
  bounce: 0.035,       // nảy người mỗi bước (x chiều cao)
  runLean: 0.18,       // chồm người khi chạy (radian)
  breathe: 0.018,      // thở khi đứng yên
  lookAround: 0.35,    // đầu nhìn quanh khi đứng yên (radian)
  blend: 12,           // độ mượt chuyển giữa các tư thế
};

export interface AnimState {
  /** Tốc độ ngang (m/s). */
  speed: number;
  /** Tốc độ coi là "đi" và "chạy" (m/s) để trộn tư thế. */
  walkSpeed?: number;
  runSpeed?: number;
  grounded: boolean;
  /** Vận tốc đứng (m/s), để biết đang nhảy lên hay rơi xuống. */
  vy: number;
  swimming: boolean;
  /** Đang vẫy tay (0..1). */
  wave?: number;
  /** Tư thế đặc biệt (bỏ qua đi/chạy/bơi). */
  pose?: Pose | null;
}

/**
 * Tư thế đặc biệt. Gốc rig đặt ở:
 *  - 'sit': mặt ghế (ngồi, chân duỗi ra trước) · 'lie': mặt võng/giường (nằm ngửa, đầu về phía +Z của rig)
 *  - 'lean': sàn, sát lan can phía trước (chồm người, tay gác lan can) · 'helm': sàn, sau bánh lái (2 tay cầm lái)
 */
export type Pose = 'sit' | 'lie' | 'lean' | 'helm';

interface Joint { node: THREE.Object3D; rest: THREE.Euler; side: number }

export interface CharacterParts {
  head?: Joint; torso?: Joint;
  armL?: Joint; armR?: Joint; legL?: Joint; legR?: Joint;
}

const loader = new GLTFLoader();

export class Character {
  /** Đặt vị trí + hướng ở đây (rig.position, rig.rotation.y). */
  readonly rig = new THREE.Group();
  /** Nảy/nghiêng/bơi (con của rig, pivot ở giữa người). */
  readonly body = new THREE.Group();
  /** Điểm mắt cho camera góc 1. */
  readonly eye = new THREE.Object3D();
  readonly parts: CharacterParts;
  readonly height: number;

  private model: THREE.Object3D;
  private phase = 0;
  private t = 0;
  private wasGrounded = true;
  private squash = 0;

  constructor(model: THREE.Object3D, height: number) {
    this.height = height;
    this.model = model;
    this.rig.rotation.order = 'YXZ';
    // pivot của body ở giữa người -> nghiêng/bơi xoay quanh hông thay vì quanh bàn chân
    this.body.position.y = height * 0.5;
    model.position.y = -height * 0.5;
    this.body.add(model);
    this.rig.add(this.body);
    this.eye.position.set(0, height * 0.42, -height * 0.06);
    this.body.add(this.eye);
    this.parts = rigParts(model);
  }

  /** Cập nhật tư thế. Gọi mỗi frame (CharacterController tự gọi). */
  animate(dt: number, s: AnimState): void {
    const A = CHARACTER_ANIM;
    const h = this.height;
    this.t += dt;
    const walk = s.walkSpeed ?? 3.2, run = s.runSpeed ?? 7;
    const scale = h / 1.8;
    const move = s.grounded && !s.swimming ? THREE.MathUtils.clamp(s.speed / walk, 0, 1) : 0;
    const runK = s.grounded && !s.swimming ? THREE.MathUtils.clamp((s.speed - walk) / (run - walk), 0, 1) : 0;
    const air = !s.grounded && !s.swimming ? 1 : 0;
    const swim = s.swimming ? 1 : 0;

    // Pha bước chân theo quãng đường -> chân không trượt
    if (s.swimming) this.phase += dt * (2.2 + s.speed * 1.2);
    else this.phase += (s.speed * dt) / (A.strideLength * scale) * Math.PI;
    const sw = Math.sin(this.phase);
    const bob = (1 - Math.cos(this.phase * 2)) * 0.5;

    // Tiếp đất: nhún nhẹ
    if (s.grounded && !this.wasGrounded && !s.swimming) this.squash = Math.min(1, Math.abs(s.vy) / 8);
    this.wasGrounded = s.grounded;
    this.squash = damp(this.squash, 0, 8, dt);

    const legAmp = THREE.MathUtils.lerp(A.legSwing, A.legSwingRun, runK) * move;
    const armAmp = THREE.MathUtils.lerp(A.armSwing, A.armSwingRun, runK) * move;
    const idle = (1 - move) * (1 - air) * (1 - swim);
    const breathe = Math.sin(this.t * 1.7);
    const k = A.blend;
    const P = this.parts;

    if (s.pose) {
      this.animatePose(dt, s.pose, breathe);
      return;
    }

    // --- chân ---
    const airLegL = 0.55 * Math.sign(s.vy || -1), airLegR = -0.35;
    const swimKick = Math.sin(this.phase * 2.5) * 0.35;
    setJoint(P.legL, dt, k, legAmp * sw + air * airLegL + swim * swimKick, 0, 0);
    setJoint(P.legR, dt, k, -legAmp * sw + air * airLegR - swim * swimKick, 0, 0);

    // --- tay --- (z dương = giơ tay sang ngang, nhân với side để đúng bên)
    const wave = s.wave ?? 0;
    const swimArm = this.phase;
    const armXL = -armAmp * sw + air * -0.5 + swim * (Math.sin(swimArm) * 1.4 - 0.4);
    const armXR = armAmp * sw + air * -0.5 + swim * (Math.sin(swimArm + Math.PI) * 1.4 - 0.4);
    const armZ = 0.08 + idle * 0.03 * breathe + air * 0.9 + runK * 0.12 + swim * 0.5;
    setJoint(P.armL, dt, k, armXL, 0, armZ);
    setJoint(P.armR, dt, k, armXR * (1 - wave) + wave * -0.25, 0, armZ * (1 - wave) + wave * (2.5 + Math.sin(this.t * 9) * 0.35));

    // --- thân, đầu ---
    setJoint(P.torso, dt, k, -A.runLean * runK - 0.05 * move, sw * 0.12 * move, 0);
    const look = idle * Math.sin(this.t * 0.37) * A.lookAround;
    setJoint(P.head, dt, k, idle * 0.04 * breathe + swim * 0.9 + air * -0.1, look + sw * -0.08 * move, 0);
    if (P.torso) {
      const sy = 1 + idle * A.breathe * breathe;
      P.torso.node.scale.y = damp(P.torso.node.scale.y, sy * Math.sign(P.torso.node.scale.y || 1), 10, dt);
    }

    // --- cả người: nảy bước, nghiêng bơi, nhún khi tiếp đất ---
    const y = h * 0.5 + bob * A.bounce * h * move - this.squash * 0.12 * h;
    this.body.position.y = damp(this.body.position.y, y, 20, dt);
    this.body.position.z = damp(this.body.position.z, 0, 8, dt);
    this.body.rotation.x = damp(this.body.rotation.x, swim * -1.15, 6, dt);
    const sq = 1 - this.squash * 0.18;
    this.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    this.model.position.y = -h * 0.5;
  }

  /** Tư thế tĩnh có thở nhẹ: ngồi, nằm, tựa lan can, cầm lái. */
  private animatePose(dt: number, pose: Pose, breathe: number): void {
    const h = this.height, P = this.parts, k = 6;
    const t = this.t;
    let legL = 0, legR = 0, armLX = 0, armRX = 0, armZ = 0.08, torsoX = 0, headX = 0, headY = 0;
    let bodyY = h * 0.5, bodyRX = 0, bodyZ = 0;
    if (pose === 'sit') {
      legL = legR = 1.45;                      // đùi duỗi ra trước
      armLX = armRX = 0.35; armZ = 0.12;       // tay đặt lên đùi
      torsoX = 0.06 + breathe * 0.015;
      headX = -0.12; headY = Math.sin(t * 0.25) * 0.5; // ngước nhìn, đảo mắt ngắm cảnh
      bodyY = h * 0.2;
    } else if (pose === 'lie') {
      bodyRX = Math.PI / 2;                    // nằm ngửa
      bodyY = h * 0.12;
      bodyZ = h * 0.05;
      armLX = armRX = 0.1; armZ = 0.25 + breathe * 0.02;
      legL = 0.05; legR = -0.05;
      headX = -0.1 + Math.sin(t * 0.3) * 0.03;
      torsoX = breathe * 0.02;
    } else if (pose === 'lean') {
      torsoX = -0.38 + breathe * 0.02;         // chồm người ra lan can
      armLX = armRX = 1.35; armZ = 0.3;        // gác tay lên lan can
      headX = -0.35; headY = Math.sin(t * 0.2) * 0.45; // ngẩng nhìn xa, quay đầu chầm chậm
      legL = 0.05; legR = -0.12;
    } else if (pose === 'helm') {
      armLX = 1.05 + Math.sin(t * 0.9) * 0.04; armRX = 1.05 - Math.sin(t * 0.9) * 0.04; armZ = 0.18;
      torsoX = -0.08; headX = -0.05;
      legL = 0.12; legR = -0.12;               // đứng tấn nhẹ
    }
    setJoint(P.legL, dt, k, legL, 0, 0);
    setJoint(P.legR, dt, k, legR, 0, 0);
    setJoint(P.armL, dt, k, armLX, 0, armZ);
    setJoint(P.armR, dt, k, armRX, 0, armZ);
    setJoint(P.torso, dt, k, torsoX, 0, 0);
    setJoint(P.head, dt, k, headX, headY, 0);
    if (P.torso) P.torso.node.scale.y = damp(P.torso.node.scale.y, Math.sign(P.torso.node.scale.y || 1), 10, dt);
    this.body.position.y = damp(this.body.position.y, bodyY, 8, dt);
    this.body.position.z = damp(this.body.position.z, bodyZ, 8, dt);
    this.body.rotation.x = damp(this.body.rotation.x, bodyRX, 6, dt);
    this.body.scale.set(1, 1, 1);
  }
}

function setJoint(j: Joint | undefined, dt: number, k: number, x: number, y: number, z: number): void {
  if (!j) return;
  const r = j.node.rotation;
  r.x = damp(r.x, j.rest.x + x, k, dt);
  r.y = damp(r.y, j.rest.y + y * j.side, k, dt);
  r.z = damp(r.z, j.rest.z + z * j.side, k, dt);
}

/** Tìm các bộ phận theo tên node; gắn đầu + tay vào thân để cúi/xoay thân thì cả phần trên đi theo. */
function rigParts(model: THREE.Object3D): CharacterParts {
  model.updateMatrixWorld(true);
  const top = model.children.length === 1 && model.children[0].children.length > 1 ? model.children[0].children : model.children;
  const find = (re: RegExp) => top.filter((o) => re.test(o.name.toLowerCase()));
  const centerX = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).x;
  const joint = (node: THREE.Object3D, side: number): Joint => ({ node, rest: node.rotation.clone(), side });

  const parts: CharacterParts = {};
  const torso = find(/^(torso|body|chest|spine)/)[0];
  const head = find(/^head/)[0];
  if (torso) parts.torso = joint(torso, 1);
  if (head) parts.head = joint(head, 1);
  // tóc, mũ, kính... đi theo đầu; thắt lưng đi theo thân
  if (head) for (const o of find(/^(hair|hat|helmet|glasses|face|ear|eye)/)) head.attach(o);
  if (torso) for (const o of find(/^(belt|cape|backpack|scarf)/)) torso.attach(o);
  for (const o of find(/^arm/)) {
    const side = centerX(o) > 0 ? 1 : -1; // nhìn về −Z: +X là bên phải
    if (side > 0) parts.armR = joint(o, 1); else parts.armL = joint(o, -1);
  }
  for (const o of find(/^leg/)) {
    const side = centerX(o) > 0 ? 1 : -1;
    if (side > 0) parts.legR = joint(o, 1); else parts.legL = joint(o, -1);
  }
  if (torso) {
    if (head) torso.attach(head);
    if (parts.armL) torso.attach(parts.armL.node);
    if (parts.armR) torso.attach(parts.armR.node);
    // attach() đổi transform -> lưu lại tư thế nghỉ sau khi gắn
    for (const j of [parts.head, parts.armL, parts.armR]) if (j) j.rest.copy(j.node.rotation);
  }
  return parts;
}

export interface LoadCharacterOptions {
  /** Chiều cao mong muốn (m). Model tự scale theo. Mặc định 1.8. */
  height?: number;
  addToScene?: boolean;
}

/** Load nhân vật ghép khối từ .glb, đổi vật liệu sang toon, scale đúng chiều cao. */
export async function loadCharacter(world: World, url: string, opts: LoadCharacterOptions = {}): Promise<Character> {
  const gltf = await loader.loadAsync(url);
  const scene = gltf.scene;
  const box = new THREE.Box3().setFromObject(scene);
  const height = opts.height ?? 1.8;
  const s = height / Math.max(1e-3, box.max.y - box.min.y);
  // Gói model: đáy chân ở y = 0, scale đúng chiều cao
  const holder = new THREE.Group();
  holder.add(scene);
  scene.position.y = -box.min.y;
  holder.scale.setScalar(s);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map((x) => toToon(x)) : toToon(m.material);
    m.layers.enable(1); // che mây
  });
  const c = new Character(holder, height);
  if (opts.addToScene !== false) world.scene.add(c.rig);
  return c;
}
