// Bảng chỉnh thông số trực tiếp trong game (lil-gui). Phím G để bật/tắt (World tự gắn).
// Mỗi "mục" gắn với 1 object cấu hình (WATER, BLOOM, VOLUME...): kéo slider là sửa thẳng object đó,
// hệ thống đọc lại mỗi frame. Tự lưu vào localStorage theo appId; nút "Copy cấu hình" chép code để dán làm mặc định.
//
// Thêm mục cho game mới:
//   world.panel.section('Tàu', 'ship', SHIP_CFG, (f) => { f.add(SHIP_CFG, 'speed', 0, 100); });
import GUI from 'lil-gui';

type Cfg = Record<string, unknown>;

interface Section {
  key: string;
  name: string;      // tên biến để in ra khi copy (vd. 'WATER')
  cfg: Cfg;
  defaults: Cfg;
}

/** Chỉ lưu/chép các giá trị đơn giản (số, chuỗi, bool); bỏ qua Vector3, mảng... */
function plain(cfg: Cfg): Cfg {
  const out: Cfg = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export class SettingsPanel {
  readonly gui: GUI;
  private sections: Section[] = [];
  private footer: GUI | null = null;

  constructor(private appId: string, private toast: (msg: string) => void = () => {}) {
    this.gui = new GUI({ title: 'Cài đặt hình ảnh (G để ẩn/hiện)', width: 310 });
    this.gui.domElement.style.zIndex = '20';
    this.gui.domElement.style.maxHeight = '100vh';
    this.gui.domElement.style.overflowY = 'auto';
    this.gui.onChange(() => this.save());
    this.gui.hide();
  }

  /**
   * Thêm 1 mục. `name` là tên biến cấu hình (in ra khi Copy), `build` thêm slider vào folder.
   * Giá trị đã lưu được nạp ngay khi gọi hàm này.
   */
  section(title: string, name: string, cfg: Cfg, build: (folder: GUI) => void, open = false): GUI {
    const key = `${this.appId}-${name.toLowerCase()}`;
    const defaults = plain(cfg);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw) as Cfg;
        for (const k of Object.keys(defaults)) if (k in saved && typeof saved[k] === typeof defaults[k]) cfg[k] = saved[k];
      }
    } catch { /* bỏ qua */ }
    this.sections.push({ key, name, cfg, defaults });
    const folder = this.gui.addFolder(title);
    build(folder);
    if (!open) folder.close();
    this.placeFooter();
    return folder;
  }

  toggle(): void {
    this.gui._hidden ? this.gui.show() : this.gui.hide();
  }

  private placeFooter(): void {
    // Nút copy / reset luôn nằm cuối bảng
    this.footer?.destroy();
    const f = this.gui.addFolder('Lưu cấu hình');
    f.add({ copy: () => this.copy() }, 'copy').name('📋 Copy cấu hình');
    f.add({ reset: () => this.reset() }, 'reset').name('↺ Về mặc định');
    this.footer = f;
  }

  private save(): void {
    try {
      for (const s of this.sections) localStorage.setItem(s.key, JSON.stringify(plain(s.cfg)));
    } catch { /* bỏ qua */ }
  }

  private copy(): void {
    const text = this.sections
      .map((s) => `// ${s.name}\n${JSON.stringify(plain(s.cfg), null, 2)}`)
      .join('\n\n');
    navigator.clipboard?.writeText(text).then(
      () => this.toast('Đã copy — dán các giá trị vào object cấu hình tương ứng (WATER, BLOOM, VOLUME...)'),
      () => { console.info(text); this.toast('Không copy được, xem console (F12)'); },
    );
  }

  private reset(): void {
    for (const s of this.sections) {
      Object.assign(s.cfg, s.defaults);
      try { localStorage.removeItem(s.key); } catch { /* bỏ qua */ }
    }
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this.toast('Đã về cấu hình mặc định');
  }
}
