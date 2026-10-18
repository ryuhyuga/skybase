// DEMO: cách dùng engine.
// Nhân vật đi bộ trên đảo mẫu (model từ Blender). Lại gần tàu bấm F để lên boong, đi lại trên boong như trên đất.
// Trên boong bấm E ở:
//  - Bánh lái: 1 Lái tay (góc 3 / góc 1 như cũ) · 2 Tự lái tới đích đã chọn · 3 Dừng tự lái
//  - Võng: 1 Ngủ trưa (tua nhanh ~2 giờ, nhìn trời) · 2 Ngủ tới sáng (tối dần, tỉnh dậy 7:00, tàu tự lái vẫn bay tiếp)
//  - Ghế / lan can: ngồi hoặc tựa ngắm cảnh
// Làm game mới: copy cả folder, giữ src/engine/, thay src/demo/ bằng game của anh.
import * as THREE from 'three';
import './style.css';
import {
  CameraRig, CHARACTER_CAMERA, CharacterController, Input, loadCharacter, loadModel, SKY, THIRD_PERSON, Trail, TRAIL_FX, World,
  type SeaIslandDef,
} from '../engine';
import { Autopilot, AUTOPILOT, DESTINATIONS } from './Autopilot';
import { Hud, type HudMode } from './Hud';
import { animateSantorini, buildSantorini, santoriniHeight } from './Santorini';
import { Ship } from './Ship';
import { BOARD_POINT, buildDeck, type DeckSpot } from './ShipDeck';

/** Đảo trên biển: thêm đảo = thêm 1 dòng. */
const ISLANDS: SeaIslandDef[] = [
  { x: -380, z: 160, radius: 300, height: 55, seed: 1 },
  { x: 1650, z: -2050, radius: 230, height: 70, seed: 2 },
  { x: -1350, z: -420, radius: 360, height: 45, seed: 3 },
  { x: 1450, z: 700, radius: 210, height: 60, seed: 4 },
];

const app = document.getElementById('app')!;
const world = new World({
  container: app,
  appId: 'skybase',
  islands: ISLANDS,
  // Không mây quanh Santorini (x, y, z, bán kính)
  clearZones: [[0, 150, -1900, 900]],
});
const heightAt = (x: number, z: number) => world.terrain.heightAt(x, z);

// Địa hình tự dựng: báo cho terrain biết để va chạm / camera / cỏ đúng độ cao
buildSantorini(world.scene);
world.terrain.addHeightSource(santoriniHeight);

// Model xuất từ Blender bằng add-on Skybase Tools (tools/blender/): đảo nhỏ có nhà, cây, đèn lồng, cầu cảng.
// Nhãn đặt trong Blender (địa hình, phát sáng, va chạm, điểm mốc) được loadModel áp tự động.
const sample = loadModel(world, 'models/sample.glb', { position: new THREE.Vector3(230, 0, -60) });

const ship = new Ship();
world.scene.add(ship.rig);
// Tàu đậu cạnh cầu cảng của đảo mẫu, mũi hướng Bắc
ship.position.set(244, 16, 4);
ship.throttle = 1; // "Dừng"
const deck = buildDeck(ship);
const autopilot = new Autopilot();

// Vệt khí 2 bên tàu: neo ở mép khí cầu (vệt chính) và 2 bên mạn thuyền (vệt phụ, mảnh hơn).
// Neo là con của ship.body nên nghiêng theo tàu khi rẽ.
const trails: Trail[] = [];
for (const side of [-1, 1]) {
  const env = new THREE.Object3D();
  env.position.set(side * 5.05, 10.3, -1.2); // mép rộng nhất của khí cầu
  const hull = new THREE.Object3D();
  hull.position.set(side * 1.95, -1.3, -3.5); // mạn thuyền
  ship.body.add(env, hull);
  trails.push(new Trail(world.scene, env), new Trail(world.scene, hull, { width: 0.55, opacity: 0.7 }));
}
const trailTint = new THREE.Color();

// Nhân vật ghép khối (public/models/character.glb): animation thủ tục theo từng bộ phận.
// Xuất hiện trên cầu cảng của đảo mẫu, nhìn về phía Bắc (vào đảo).
let hero: CharacterController | null = null;
Promise.all([loadCharacter(world, 'models/character.glb', { height: 1.8 }), sample])
  .then(([c, m]) => {
    hero = new CharacterController(world, c, { colliders: m.colliders });
    const dock = m.markers.get('dock')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(230, 2, 8);
    hero.teleport(dock.add(new THREE.Vector3(0, 0.5, 4)), 0); // trên mặt cầu, cách đầu cầu 4 m
  })
  .catch((e) => console.warn('Không load được nhân vật hoặc đảo mẫu', e));

const BOARD_DIST = 26; // m: lại gần tàu cỡ này (theo phương ngang) mới lên được
const BOARD_HEIGHT = 30; // m: tàu cao hơn mức này so với người thì không với tới
const NAP_HOURS = 2;
const HOUR_SECONDS = () => SKY.dayLength / 24; // 1 giờ trong game = bao nhiêu giây thật

/** Đang làm gì: tự do (đất hoặc boong) · cầm lái · ngồi/tựa · ngủ trưa · ngủ tới sáng. */
type Activity = 'free' | 'helm' | 'pose' | 'nap' | 'sleep';
let activity: Activity = 'free';
let activeSpot: DeckSpot | null = null;
let napHours = 0;
let savedTimeScale = 1;
let savedCamMode: 'first' | 'third' = 'third';
let sleepT = 0;
let sleepDone = false;

const cam = new CameraRig(app.clientWidth / app.clientHeight);
cam.groundHeight = heightAt;
cam.profile = CHARACTER_CAMERA;

const input = new Input(world.renderer.domElement);
const hud = new Hud(document.getElementById('hud')!);
const toast = (m: string) => world.toast.show(m);

// ---------- lên / xuống tàu ----------
function tryBoard(): void {
  if (!hero) return;
  const hp = hero.getWorldPosition();
  const d = Math.hypot(hp.x - ship.position.x, hp.z - ship.position.z);
  if (d > BOARD_DIST) { toast(`Lại gần tàu hơn để lên (${Math.round(d)} m)`); return; }
  if (ship.position.y - hp.y > BOARD_HEIGHT) { toast('Tàu ở cao quá, không với tới'); return; }
  hero.board(deck.platform, BOARD_POINT, 0);
  cam.snap();
  toast('Lên tàu · E ở bánh lái để lái, ở võng để ngủ');
}

function jumpOff(): void {
  if (!hero) return;
  hero.leavePlatform();
  hero.vy = 4;
  cam.snap();
  toast('Nhảy khỏi tàu!');
}

// ---------- tương tác trên boong ----------
function nearestSpot(): DeckSpot | null {
  if (!hero?.platform) return null;
  let best: DeckSpot | null = null, bd = Infinity;
  for (const s of deck.spots) {
    const d = Math.hypot(hero.position.x - s.at.x, hero.position.z - s.at.z);
    if (d < s.radius && d < bd) { best = s; bd = d; }
  }
  return best;
}

function standUp(at?: THREE.Vector3): void {
  if (!hero) return;
  const s = activeSpot;
  const stand = at ?? (s?.kind === 'hammock' ? new THREE.Vector3(0, 0, 0.45) : s?.kind === 'seat' ? new THREE.Vector3(0.55, 0, -4.2) : s?.at.clone());
  hero.setPose(null, stand);
  activity = 'free';
  activeSpot = null;
  cam.profile = CHARACTER_CAMERA;
}

function takeHelm(spot: DeckSpot): void {
  if (!hero) return;
  autopilot.stop();
  hero.setPose('helm', spot.at, spot.yaw);
  activeSpot = spot;
  activity = 'helm';
  cam.profile = THIRD_PERSON;
  cam.snap();
  toast('Lái tay · W/S ga, A/D lái, Space/Shift lên xuống · E rời bánh lái');
}

function leaveHelm(): void {
  standUp(new THREE.Vector3(0, 0, -0.85));
  ship.throttle = 1;
  cam.snap();
  toast('Rời bánh lái · tàu giảm tốc và dừng');
}

function openHelmMenu(spot: DeckSpot): void {
  const items = [
    { label: 'Lái tay (Manual)', run: () => takeHelm(spot) },
    { label: 'Tự lái (Auto) · chọn đích', run: () => openDestinationMenu() },
  ];
  if (autopilot.active) items.push({ label: 'Dừng tự lái', run: () => { autopilot.stop(); ship.throttle = 1; toast('Đã dừng tự lái'); } });
  hud.openMenu('Bánh lái', items);
}

function openDestinationMenu(): void {
  hud.openMenu('Tự lái tới đâu?', [
    ...DESTINATIONS.map((d) => ({ label: d.name, run: () => { autopilot.engage(ship, d); toast(`Tự lái → ${d.name}. Đi dạo, ngắm cảnh hay ngủ một giấc nhé`); } })),
    { label: 'Giữ hướng hiện tại', run: () => { autopilot.engage(ship, null); toast('Tự lái · giữ hướng hiện tại'); } },
  ]);
}

function sitOrLean(spot: DeckSpot): void {
  if (!hero) return;
  hero.setPose(spot.pose, spot.at, spot.yaw);
  activeSpot = spot;
  activity = 'pose';
  toast(spot.kind === 'seat' ? 'Ngồi ngắm cảnh · kéo chuột để nhìn quanh' : 'Tựa lan can ngắm cảnh · kéo chuột để nhìn quanh');
}

function lieDown(spot: DeckSpot, mode: 'nap' | 'sleep'): void {
  if (!hero) return;
  hero.setPose('lie', spot.at, spot.yaw);
  activeSpot = spot;
  activity = mode;
  savedCamMode = cam.mode;
  if (cam.mode !== 'third') cam.toggle();
  cam.autoOrbit = 0.12; // camera lượn chậm quanh tàu, thấy mây trôi và trời đổi màu
  if (mode === 'nap') {
    napHours = 0;
    savedTimeScale = world.env.timeScale;
    world.env.timeScale = 12;
    toast('Ngủ trưa một chút… (E để dậy)');
  } else {
    sleepT = 0;
    sleepDone = false;
  }
}

function openHammockMenu(spot: DeckSpot): void {
  hud.openMenu('Võng', [
    { label: 'Ngủ trưa (Nap) · khoảng 2 tiếng', run: () => lieDown(spot, 'nap') },
    { label: 'Ngủ tới sáng (Sleep) · dậy lúc 7:00', run: () => lieDown(spot, 'sleep') },
  ]);
}

function interact(spot: DeckSpot): void {
  if (spot.kind === 'helm') openHelmMenu(spot);
  else if (spot.kind === 'hammock') openHammockMenu(spot);
  else sitOrLean(spot);
}

function wakeUp(): void {
  if (activity === 'nap') world.env.timeScale = savedTimeScale;
  cam.autoOrbit = 0;
  if (cam.mode !== savedCamMode) cam.toggle();
  hud.night(0);
  hud.zzz(false, 0);
  standUp();
}

/** Số giờ từ bây giờ tới 7:00 sáng (giờ hiển thị của Environment.clock). */
function hoursUntilMorning(): number {
  const h = (world.env.time * 24 + 7) % 24;
  return h < 7 ? 7 - h : 31 - h;
}

// ---------- bảng chỉnh G: mục riêng của game ----------
world.panel?.section('Vệt khí 2 bên tàu', 'TRAIL_FX', TRAIL_FX, (f) => {
  f.add(TRAIL_FX, 'life', 0.2, 3, 0.05).name('Độ dài (giây)');
  f.add(TRAIL_FX, 'width', 0.1, 4, 0.05).name('Bề rộng gốc (m)');
  f.add(TRAIL_FX, 'spread', 1, 5, 0.1).name('Loe ra ở cuối');
  f.add(TRAIL_FX, 'opacity', 0, 1, 0.01).name('Độ đậm');
  f.add(TRAIL_FX, 'minSpeed', 0, 45, 1).name('Hiện từ tốc độ (m/s)');
  f.add(TRAIL_FX, 'fullSpeed', 1, 80, 1).name('Rõ nhất ở (m/s)');
  f.add(TRAIL_FX, 'wobble', 0, 2, 0.01).name('Gợn sóng (m)');
  f.add(TRAIL_FX, 'core', 0, 1, 0.01).name('Lõi sáng');
});
world.panel?.section('Tự lái', 'AUTOPILOT', AUTOPILOT, (f) => {
  f.add(AUTOPILOT, 'cruiseThrottle', 2, 5, 1).name('Nấc ga khi bay xa');
  f.add(AUTOPILOT, 'orbitThrottle', 1, 4, 1).name('Nấc ga khi lượn quanh đích');
  f.add(AUTOPILOT, 'minAltitude', 20, 600, 5).name('Độ cao thấp nhất (m)');
  f.add(AUTOPILOT, 'clearance', 10, 300, 5).name('Cao hơn địa hình (m)');
  f.add(AUTOPILOT, 'orbitExtra', 50, 800, 10).name('Lượn cách mép đảo (m)');
});
world.panel?.section('Camera góc 3', 'THIRD_PERSON', THIRD_PERSON, (f) => {
  f.add(THIRD_PERSON, 'distance', 10, 200, 1).name('Khoảng cách (m)');
  f.add(THIRD_PERSON, 'pitch', -0.3, 1.2, 0.01).name('Góc nhìn xuống');
  f.add(THIRD_PERSON, 'height', 0, 40, 0.5).name('Độ cao điểm nhìn (m)');
  f.add(THIRD_PERSON, 'lookAhead', 0, 200, 1).name('Nhìn vượt trước (m)');
  f.add(THIRD_PERSON, 'fov', 30, 100, 1).name('FOV');
});

// Âm thanh chỉ phát sau khi người chơi tương tác
let started = false;
const start = () => { if (!started) { started = true; hud.hideTitle(); world.audio.start(); } };
window.addEventListener('pointerdown', start);
window.addEventListener('keydown', start);

let sampleModel: Awaited<typeof sample> | null = null;
sample.then((m) => { sampleModel = m; }).catch((e) => console.warn('Không load được models/sample.glb', e));

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const clock = new THREE.Clock();
let elapsed = 0;

function frame(): void {
  const dt = Math.min(0.1, clock.getDelta());
  elapsed += dt;

  world.handleKeys(input); // C mây · G bảng chỉnh · B bloom · M tiếng · [ ] thời gian
  if (input.wasPressed('KeyH')) hud.toggleHelp();

  // ---- menu (chặn mọi phím khác khi đang mở) ----
  if (hud.menuOpen) {
    for (let i = 0; i < 9; i++) if (input.wasPressed(`Digit${i + 1}`, `Numpad${i + 1}`)) hud.pick(i);
    if (input.wasPressed('Escape', 'KeyE')) hud.closeMenu();
  } else if (started && hero) {
    if (input.wasPressed('KeyV') && activity !== 'nap' && activity !== 'sleep') {
      toast(cam.toggle() === 'third' ? 'Camera: góc nhìn thứ ba' : activity === 'helm' ? 'Camera: buồng lái' : 'Camera: góc nhìn thứ nhất');
    }
    const pressedE = input.wasPressed('KeyE');
    const pressedMove = MOVE_KEYS.some((k) => input.wasPressed(k));
    if (activity === 'free') {
      if (input.wasPressed('KeyF')) { if (hero.platform) jumpOff(); else tryBoard(); }
      const spot = nearestSpot();
      if (spot && pressedE) interact(spot);
    } else if (activity === 'helm') {
      if (pressedE) leaveHelm();
    } else if (activity === 'pose') {
      if (pressedE || pressedMove) standUp();
    } else if (activity === 'nap') {
      if (pressedE || pressedMove) wakeUp();
    }
  }

  // ---- tàu ----
  const piloting = activity === 'helm';
  if (piloting) ship.update(dt, input, !started || hud.menuOpen);
  else if (autopilot.active) ship.update(dt, input, true, autopilot.control(ship, heightAt));
  else ship.update(dt, input, true);
  const ground = heightAt(ship.position.x, ship.position.z) + 12;
  if (ship.position.y < ground) { ship.position.y = ground; ship.vy = Math.max(0, ship.vy); }
  if (sampleModel?.hit(ship.position, 8)) ship.bump();

  // ---- ngủ ----
  if (activity === 'nap') {
    napHours += (dt * world.env.timeScale) / HOUR_SECONDS();
    hud.zzz(true, elapsed);
    if (napHours >= NAP_HOURS) { wakeUp(); toast('Ngủ dậy rồi, khoẻ cả người!'); }
  } else if (activity === 'sleep') {
    sleepT += dt;
    hud.zzz(sleepT < 1.6, elapsed);
    if (sleepT < 1.6) hud.night(sleepT / 1.6);
    else if (!sleepDone) {
      // màn tối hẳn: tua thời gian tới sáng; tàu đang tự lái thì bay tiếp quãng đường tương ứng
      const hours = hoursUntilMorning();
      autopilot.fastForward(ship, Math.min(hours * HOUR_SECONDS(), 900), heightAt, input as never);
      for (const t of trails) t.reset();
      world.env.time = 0; // 7:00
      sleepDone = true;
      hud.night(1, '7:00 sáng');
    } else if (sleepT < 3.4) hud.night(1, '7:00 sáng');
    else if (sleepT < 5.0) hud.night(1 - (sleepT - 3.4) / 1.6, '');
    else { wakeUp(); toast(autopilot.active ? `Chào buổi sáng! ${autopilot.status(ship)}` : 'Chào buổi sáng!'); }
  }

  // ---- nhân vật + camera ----
  if (hero) {
    hero.locked = !started || hud.menuOpen || activity !== 'free';
    hero.update(dt, input, cam);
    // cầm lái ở góc 1: ẩn nhân vật để không che tầm nhìn buồng lái
    hero.character.rig.visible = !(piloting && cam.mode === 'first');
    if (piloting) cam.update(dt, ship, input);
    else cam.update(dt, hero.cameraTarget, input);
  } else {
    cam.update(dt, ship, input);
  }

  // ---- gợi ý + HUD ----
  const spot = activity === 'free' && !hud.menuOpen ? nearestSpot() : null;
  if (spot) hud.prompt(`<kbd>E</kbd>${spot.label}`);
  else if (hero && activity === 'free' && !hero.platform && !hud.menuOpen) {
    const hp = hero.getWorldPosition();
    const near = Math.hypot(hp.x - ship.position.x, hp.z - ship.position.z) < BOARD_DIST && ship.position.y - hp.y < BOARD_HEIGHT;
    hud.prompt(near ? '<kbd>F</kbd>Lên tàu' : null);
  } else hud.prompt(null);

  hud.status(autopilot.active ? autopilot.status(ship) : piloting ? 'Lái tay' : hero?.platform && ship.speed < 1 ? 'Tàu đang dừng' : '');
  const clockText = `Giờ <b>${world.env.clock()}</b>`;
  let mode: HudMode = 'walk';
  let lines: string[];
  if (piloting) { mode = 'helm'; lines = hud.shipLines(ship.position.y, ship.speed, ship.throttle, world.env.clock()); }
  else if (!hero) lines = [clockText];
  else if (activity === 'nap' || activity === 'sleep') { mode = 'rest'; lines = [activity === 'nap' ? 'Đang ngủ trưa' : 'Đang ngủ', clockText]; }
  else if (activity === 'pose') { mode = 'rest'; lines = [activeSpot?.kind === 'seat' ? 'Đang ngồi ngắm cảnh' : 'Đang tựa lan can', `Độ cao tàu <b>${Math.round(ship.position.y)} m</b>`, clockText]; }
  else if (hero.platform) { mode = 'deck'; lines = ['Trên tàu · đi dạo', `Độ cao tàu <b>${Math.round(ship.position.y)} m</b> · <b>${Math.round(ship.speed)} m/s</b>`, clockText]; }
  else {
    const st = hero.swimming ? 'đang bơi' : !hero.grounded ? 'trên không' : hero.speed > 4 ? 'chạy' : hero.speed > 0.3 ? 'đi' : 'đứng';
    lines = [`Đi bộ · <b>${st}</b>`, `Tốc độ <b>${hero.speed.toFixed(1)} m/s</b>`, clockText];
  }
  hud.update(mode, lines);

  // ---- môi trường ----
  const speed = piloting || !hero ? ship.speed : hero.speed;
  world.update(dt, { camera: cam.camera, cameraDistance: cam.distance, speed, mode: cam.mode, showWind: started });
  animateSantorini(dt);
  // vệt khí: ban đêm mờ và ngả màu trời như sợi gió
  trailTint.copy(world.env.c.cloudLit).multiplyScalar(0.35 + 0.65 * world.env.dayFactor);
  for (const t of trails) { t.setTint(trailTint); t.update(dt, cam.camera, ship.speed); }
  ship.setLamp(1 - world.env.dayFactor);
  ship.pointNeedle(autopilot.active && autopilot.dest
    ? Math.atan2(autopilot.dest.x - ship.position.x, -(autopilot.dest.z - ship.position.z)) : null, dt);

  world.render(dt);
  input.endFrame();
  requestAnimationFrame(frame);
}

// Debug trong console khi chạy npm run dev: gõ `game` (vd. game.world.env.time = 0.53 để xem hoàng hôn)
if (import.meta.env.DEV) {
  Object.assign(window, {
    game: {
      world, ship, cam, autopilot, deck, hud,
      get hero() { return hero; }, get sample() { return sampleModel; }, get activity() { return activity; },
      tryBoard, jumpOff, interact, takeHelm, wakeUp,
    },
  });
}

requestAnimationFrame(frame);
