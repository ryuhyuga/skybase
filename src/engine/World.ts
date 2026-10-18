// World: gom toàn bộ môi trường vào 1 chỗ — renderer, trời ngày đêm, mây volumetric (+ mây vẽ cọ dự phòng),
// biển stylized + bờ đảo, địa hình, cỏ, gió, bloom, speed lines, âm thanh nền, bảng chỉnh G.
// Game mới chỉ cần: tạo World, thêm nhân vật/tàu của mình vào world.scene, rồi mỗi frame gọi
//   world.update(dt, view)  ->  world.render(dt)
// Xem src/demo/main.ts làm ví dụ.
import * as THREE from 'three';
import { Ambience } from './audio/Ambience';
import { PaintedClouds } from './clouds/PaintedClouds';
import { VOLUME, VolumetricClouds } from './clouds/VolumetricClouds';
import type { Input } from './core/Input';
import { WIND_FX, WindFX } from './fx/WindFX';
import { BLOOM, PostFX } from './render/PostFX';
import { SPEED_LINES, SpeedLines } from './render/SpeedLines';
import { Environment, SKY } from './sky/Environment';
import { GRASS, Grass } from './terrain/Grass';
import { SeaIslandDef, Terrain } from './terrain/Terrain';
import { SettingsPanel } from './ui/SettingsPanel';
import { Toast } from './ui/Toast';
import { Ocean, WATER } from './water/Ocean';

/** Vùng không có mây: [x, y, z, bán kính] (m). Dùng quanh đảo bay, thành phố... */
export type ClearZone = [number, number, number, number];

export interface WorldOptions {
  /** Phần tử chứa canvas (chiếm toàn màn hình). */
  container: HTMLElement;
  /** Tiền tố lưu localStorage (cấu hình bảng G). Mỗi game một tên. */
  appId?: string;
  /** Đảo trên mặt biển (đồi, bãi cát, bờ sóng). */
  islands?: SeaIslandDef[];
  /** Vùng không mây cho mây volumetric. */
  clearZones?: ClearZone[];
  /** Vùng không mây cho mây vẽ cọ (mặc định = clearZones). */
  paintedClearZones?: ClearZone[];
  /** Bật cỏ Ghibli trên đảo (nặng). Mặc định theo GRASS.enabled. */
  grass?: boolean;
  /** Bật bảng chỉnh G với các mục mặc định (nước, mây, trời, bloom, gió, speed lines). Mặc định true. */
  panel?: boolean;
}

/** Thông tin camera / người chơi mỗi frame. */
export interface WorldView {
  camera: THREE.PerspectiveCamera;
  /** Khoảng cách camera tới người chơi (góc 3), để mây tan quanh nhân vật. 0 ở góc 1. */
  cameraDistance?: number;
  /** Tốc độ người chơi (m/s): speed lines, tiếng gió. */
  speed?: number;
  /** 'first' = speed lines vào sâu; 'third' = chỉ ở viền. */
  mode?: 'first' | 'third';
  /** Có vẽ sợi gió không (vd. tắt ở màn tiêu đề). */
  showWind?: boolean;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly env: Environment;
  readonly ocean: Ocean;
  readonly terrain: Terrain;
  readonly grass: Grass | null;
  readonly volume: VolumetricClouds;
  readonly painted: PaintedClouds;
  readonly wind: WindFX;
  readonly speedLines: SpeedLines;
  readonly audio = new Ambience();
  readonly toast: Toast;
  readonly panel: SettingsPanel | null;
  /** Mật độ mây tại camera (0..1), cập nhật trong update(). */
  cloudAtCamera = 0;

  private post: PostFX | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private readonly camPos = new THREE.Vector3();

  constructor(private opts: WorldOptions) {
    const el = opts.container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.renderer.toneMapping = THREE.NoToneMapping; // giữ nguyên màu palette, không làm bạc màu
    el.appendChild(this.renderer.domElement);

    const zones = opts.clearZones ?? [];
    this.env = new Environment(this.scene);
    this.painted = new PaintedClouds(this.scene, opts.paintedClearZones ?? zones);
    this.painted.setVisible(false);
    this.ocean = new Ocean(this.scene);
    this.terrain = new Terrain(this.scene, opts.islands ?? []);
    this.grass = (opts.grass ?? GRASS.enabled) ? new Grass(this.scene, this.terrain) : null;
    this.wind = new WindFX(this.scene);
    this.volume = new VolumetricClouds(this.renderer, zones, el.clientWidth, el.clientHeight);
    this.speedLines = new SpeedLines();
    this.toast = new Toast();
    this.panel = opts.panel === false ? null : new SettingsPanel(opts.appId ?? 'skybase', (m) => this.toast.show(m));
    if (this.panel) addDefaultSections(this.panel, this);

    window.addEventListener('resize', () => this.resize());
  }

  /** Ghép hậu kỳ cho camera (tự gọi ở frame đầu; gọi lại nếu đổi camera khác). */
  setCamera(camera: THREE.PerspectiveCamera): void {
    if (this.camera === camera) return;
    this.camera = camera;
    this.post = new PostFX(this.renderer, this.scene, camera);
    this.post.insertAfterScene(this.volume.compositePass);
    this.post.insertBeforeOutput(this.speedLines.pass);
  }

  /** Phím mặc định: C kiểu mây, G bảng chỉnh, B bloom, M tắt tiếng, ] [ tua thời gian. */
  handleKeys(input: Input): void {
    const t = (m: string) => this.toast.show(m);
    if (input.wasPressed('KeyC')) {
      this.setVolumetric(!this.volume.enabled);
      t(this.volume.enabled ? 'Mây: volumetric' : 'Mây: vẽ cọ (nhẹ)');
    }
    if (input.wasPressed('KeyG')) this.panel?.toggle();
    if (input.wasPressed('KeyB')) { BLOOM.enabled = !BLOOM.enabled; t(BLOOM.enabled ? 'Bloom: bật' : 'Bloom: tắt'); }
    if (input.wasPressed('KeyM')) t(this.audio.toggleMute() ? 'Đã tắt tiếng' : 'Đã bật tiếng');
    if (input.wasPressed('BracketRight')) {
      this.env.timeScale = this.env.timeScale >= 60 ? 1 : this.env.timeScale * 8;
      t(`Thời gian x${this.env.timeScale}`);
    }
    if (input.wasPressed('BracketLeft')) { this.env.timeScale = 1; t('Thời gian x1'); }
  }

  /** true = mây volumetric (đẹp), false = mây vẽ cọ (nhẹ, cho máy yếu). */
  setVolumetric(on: boolean): void {
    this.volume.setEnabled(on);
    this.painted.setVisible(!on);
  }

  /** Cập nhật môi trường theo camera. Gọi trước render(). */
  update(dt: number, view: WorldView): void {
    this.setCamera(view.camera);
    const cam = view.camera;
    const camPos = this.camPos.copy(cam.position);
    const env = this.env;

    env.update(dt, camPos);
    this.cloudAtCamera = this.volume.enabled ? this.volume.densityAt(camPos) * 0.6 : this.painted.update(dt, camPos, env);
    this.ocean.update(dt, camPos, env);
    this.grass?.update(dt, camPos, env);
    // Sợi gió ban đêm mờ và ngả màu trời, không trắng chói
    this.wind.setTint(env.c.cloudLit.clone().multiplyScalar(0.35 + 0.65 * env.dayFactor));
    this.wind.update(dt, cam, view.showWind ?? true);

    // Sương: "trong mây" giả lập chỉ dùng cho mây vẽ cọ; mây volumetric tự tạo sương thật
    const fogCloud = this.volume.enabled ? 0 : this.cloudAtCamera;
    env.fog.near = THREE.MathUtils.lerp(SKY.fogNear, 5, fogCloud);
    env.fog.far = THREE.MathUtils.lerp(SKY.fogFar, 220, fogCloud);
    env.fog.color.lerp(env.c.cloudLit, fogCloud);

    // Mây tan quanh camera tới quá người chơi một chút -> nhân vật luôn nhìn thấy rõ
    this.volume.nearFade = (view.cameraDistance ?? 0) + VOLUME.nearFade;
    this.volume.coverageScale = env.cloudCover; // ban đêm ít mây (ngẫu nhiên theo đêm)

    const speed = view.speed ?? 0;
    this.speedLines.update(dt, speed, view.mode ?? 'third', cam.aspect);
    this.audio.update(speed, this.cloudAtCamera);
  }

  /** Vẽ 1 frame: mây volumetric -> scene -> bloom -> speed lines -> màn hình. */
  render(dt: number): void {
    if (!this.camera || !this.post) return;
    this.volume.render(this.renderer, this.scene, this.camera, this.env, dt);
    this.post.render(1 - this.env.dayFactor, dt);
  }

  resize(): void {
    const el = this.opts.container;
    const w = el.clientWidth, h = el.clientHeight;
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h);
    this.volume.setSize(w, h);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }
}

/** Các mục mặc định của bảng G. Game thêm mục riêng bằng world.panel.section(...). */
function addDefaultSections(p: SettingsPanel, world: World): void {
  p.section('Trời & ngày đêm', 'SKY', SKY, (f) => {
    f.add(world.env, 'time', 0, 1, 0.001).name('Giờ trong ngày (0..1)').listen();
    f.add(world.env, 'timeScale', 0, 64, 1).name('Tốc độ thời gian').listen();
    f.add(SKY, 'dayLength', 30, 3600, 10).name('1 ngày = (giây)');
    f.add(SKY, 'fogNear', 0, 5000, 10).name('Sương bắt đầu (m)');
    f.add(SKY, 'fogFar', 500, 15000, 10).name('Sương đặc hẳn (m)');
    f.add(SKY, 'nightCloudMin', 0, 1, 0.01).name('Mây đêm ít nhất');
    f.add(SKY, 'nightCloudMax', 0, 1, 0.01).name('Mây đêm nhiều nhất');
  });

  p.section('Mây volumetric', 'VOLUME', VOLUME, (f) => {
    f.add(VOLUME, 'coverage', 0, 1, 0.01).name('Độ phủ');
    f.add(VOLUME, 'density', 0, 3, 0.01).name('Độ đặc');
    f.add(VOLUME, 'extinction', 0.005, 0.2, 0.001).name('Độ đục');
    f.add(VOLUME, 'bottom', 0, 2000, 10).name('Đáy mây (m)');
    f.add(VOLUME, 'top', 100, 4000, 10).name('Đỉnh mây (m)');
    f.add(VOLUME, 'edgeSoftness', 0, 1, 0.01).name('Mép mềm');
    f.add(VOLUME, 'detailStrength', 0, 1, 0.01).name('Bào mép');
    f.add(VOLUME, 'popcorn').name('Mép vồng súp lơ');
    f.add(VOLUME, 'sunIntensity', 0, 40, 0.1).name('Nắng');
    f.add(VOLUME, 'ambientIntensity', 0, 3, 0.01).name('Sáng môi trường');
    f.add(VOLUME, 'nearFade', 0, 300, 1).name('Tan quanh camera (m)');
  });

  p.section('Nước', 'WATER', WATER, (f) => {
    const c = f.addFolder('Màu');
    c.addColor(WATER, 'colorNear').name('Gần');
    c.addColor(WATER, 'colorMid').name('Giữa');
    c.addColor(WATER, 'colorFar').name('Xa');
    c.addColor(WATER, 'underwater').name('Đáy biển');
    c.addColor(WATER, 'foamColor').name('Bọt / sóng');
    const g = f.addFolder('Gradient');
    g.add(WATER, 'nearRadius', 0, 3000, 10).name('Bắt đầu đổi màu (m)');
    g.add(WATER, 'midRadius', 0, 4000, 10).name('Màu giữa tại (m)');
    g.add(WATER, 'farRadius', 100, 8000, 10).name('Màu xa từ (m)');
    g.add(WATER, 'gradientCurve', 0.2, 4, 0.05).name('Độ cong chuyển màu');
    g.add(WATER, 'alphaNear', 0, 1, 0.01).name('Độ đục gần');
    g.add(WATER, 'alphaRadius', 50, 5000, 10).name('Đục hẳn từ (m)');
    const pt = f.addFolder('Hoạ tiết');
    pt.add(WATER, 'textureSize', 1, 80, 1).name('Cỡ hoạ tiết');
    pt.add(WATER, 'foamOpacity', 0, 1, 0.01).name('Đốm bọt');
    pt.add(WATER, 'foamAlpha', 0, 1, 0.01).name('Độ đục bọt / sóng');
    pt.add(WATER, 'waveOpacity', 0, 1, 0.01).name('Nét sóng');
    pt.add(WATER, 'patternFar', 100, 5000, 10).name('Tắt hoạ tiết từ (m)');
    const w = f.addFolder('Sóng & bờ');
    w.add(WATER, 'waveSpeed', 0.1, 4, 0.05).name('Tốc độ nhấp nhô');
    w.add(WATER, 'waveAmplitude', 0, 5, 0.05).name('Biên độ (m)');
    w.add(WATER, 'foamDepth', 0.05, 5, 0.05).name('Dải bọt bờ (m)');
    w.add(WATER, 'shoreFoamOpacity', 0, 1, 0.01).name('Độ đậm bọt bờ');
    w.add(WATER, 'shoreFadeStart', 0, 1000, 5).name('Bọt bờ nhạt từ độ cao (m)');
    w.add(WATER, 'shoreFadeEnd', 10, 2000, 5).name('Bọt bờ tắt ở độ cao (m)');
    w.add(WATER, 'seabedDepth', 1, 60, 0.5).name('Độ sâu đáy (m)');
    w.close();
  }, true);

  p.section('Bloom (toả sáng)', 'BLOOM', BLOOM, (f) => {
    f.add(BLOOM, 'enabled').name('Bật').listen();
    f.add(BLOOM, 'strength', 0, 3, 0.01).name('Độ mạnh');
    f.add(BLOOM, 'radius', 0, 1.5, 0.01).name('Độ loang');
    f.add(BLOOM, 'threshold', 0, 1.5, 0.01).name('Ngưỡng (thấp = nhiều thứ toả)');
    f.add(BLOOM, 'nightBoost', 0, 2, 0.01).name('Tăng thêm ban đêm');
    f.add(BLOOM, 'nightThresholdDrop', 0, 1, 0.01).name('Hạ ngưỡng ban đêm');
  });

  p.section('Gió (Wind Waker)', 'WIND_FX', WIND_FX, (f) => {
    f.add(WIND_FX, 'wisps', 0, 32, 1).name('Số sợi tối đa');
    f.add(WIND_FX, 'speed', 1, 60, 0.5).name('Tốc độ (m/s)');
    f.add(WIND_FX, 'trail', 0.2, 4, 0.05).name('Độ dài đuôi (s)');
    f.add(WIND_FX, 'width', 0.05, 3, 0.01).name('Bề rộng nét (m)');
    f.add(WIND_FX, 'loopChance', 0, 1, 0.01).name('Xác suất cuộn vòng');
    f.add(WIND_FX, 'opacity', 0, 1, 0.01).name('Độ đậm');
  });

  p.section('Speed lines', 'SPEED_LINES', SPEED_LINES, (f) => {
    f.add(SPEED_LINES, 'minSpeed', 0, 100, 1).name('Bắt đầu từ (m/s)');
    f.add(SPEED_LINES, 'fullSpeed', 1, 150, 1).name('Mạnh nhất ở (m/s)');
    f.add(SPEED_LINES, 'innerFirst', 0, 1, 0.01).name('Độ sâu góc 1');
    f.add(SPEED_LINES, 'innerThird', 0, 1, 0.01).name('Độ sâu góc 3');
    f.add(SPEED_LINES, 'count', 20, 400, 1).name('Số tia');
    f.add(SPEED_LINES, 'opacity', 0, 1, 0.01).name('Độ đậm');
  });
}
