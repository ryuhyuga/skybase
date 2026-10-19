// HUD cho demo: chỉ số, gợi ý tương tác, menu chọn (phím số), màn tối khi ngủ, hướng dẫn phím, màn tiêu đề.
import { THROTTLE } from './Ship';

export type HudMode = 'walk' | 'deck' | 'helm' | 'rest';

const KEYS: Record<HudMode, string> = {
  walk: '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> đi · <kbd>Shift</kbd> chạy · <kbd>Space</kbd> nhảy · <kbd>Q</kbd> vẫy tay · <kbd>F</kbd> lên tàu (khi ở gần)',
  deck: '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> đi trên boong · <kbd>E</kbd> dùng (bánh lái, võng, ghế, lan can) · <kbd>F</kbd> nhảy khỏi tàu',
  helm: '<kbd>W</kbd>/<kbd>S</kbd> ga · <kbd>A</kbd>/<kbd>D</kbd> lái · <kbd>Space</kbd>/<kbd>Shift</kbd> lên xuống · <kbd>E</kbd> rời bánh lái',
  rest: '<kbd>E</kbd> hoặc <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> đứng dậy · kéo chuột để nhìn quanh',
};

const STYLE = `
.prompt2 { position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%); font-weight: 800; font-size: 16px; opacity: 0; transition: opacity .15s; white-space: nowrap; }
.prompt2.show { opacity: 1; }
.prompt2 kbd, .menu kbd { background: var(--ink); color: var(--cream-solid); border-radius: 6px; padding: 1px 8px; margin-right: 6px; font-family: inherit; }
.menu { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 300px; display: none; padding: 14px 18px; }
.menu.show { display: block; }
.menu h3 { margin: 0 0 10px; font-size: 18px; }
.menu .opt { padding: 7px 4px; font-weight: 700; font-size: 15px; border-top: 1px solid rgba(74,52,38,.12); }
.menu .esc { margin-top: 8px; font-size: 12px; color: var(--ink-soft); }
.status2 { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); font-weight: 800; font-size: 14px; display: none; }
.status2.show { display: block; }
.night { position: absolute; inset: 0; background: #050914; opacity: 0; pointer-events: none; display: grid; place-items: center; color: #cfd8ff; font-weight: 800; font-size: 26px; letter-spacing: .1em; }
.zzz { position: absolute; right: 18%; top: 30%; font-weight: 800; font-size: 34px; color: #fff; text-shadow: 0 2px 12px rgba(0,30,80,.5); opacity: 0; }
`;

export class Hud {
  private stats: HTMLElement;
  private help: HTMLElement;
  private splash: HTMLElement;
  private keys: HTMLElement;
  private promptEl: HTMLElement;
  private menuEl: HTMLElement;
  private statusEl: HTMLElement;
  private nightEl: HTMLElement;
  private zzzEl: HTMLElement;
  private mode: HudMode | '' = '';
  private menuItems: { label: string; run: () => void }[] = [];

  constructor(root: HTMLElement) {
    const st = document.createElement('style');
    st.textContent = STYLE;
    document.head.appendChild(st);
    root.innerHTML = `
      <div class="panel stats"></div>
      <div class="panel status2"></div>
      <div class="panel prompt2"></div>
      <div class="zzz">Z z z</div>
      <div class="panel menu"></div>
      <div class="panel help"><div class="keys"></div>
        Kéo chuột: xoay camera · cuộn: zoom · <kbd>H</kbd> camera về sau lưng · <kbd>V</kbd> đổi camera<br>
        <kbd>G</kbd> bảng chỉnh hình ảnh · <kbd>C</kbd> kiểu mây · <kbd>B</kbd> bloom · <kbd>[</kbd> <kbd>]</kbd> thời gian · <kbd>M</kbd> tiếng · <kbd>F1</kbd> ẩn
      </div>
      <div class="night"></div>
      <div class="splash"><div class="card"><h1>Skybase</h1><p>Bấm phím bất kỳ để bắt đầu</p></div></div>`;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.stats = q('.stats'); this.help = q('.help'); this.splash = q('.splash'); this.keys = q('.keys');
    this.promptEl = q('.prompt2'); this.menuEl = q('.menu'); this.statusEl = q('.status2');
    this.nightEl = q('.night'); this.zzzEl = q('.zzz');
  }

  update(mode: HudMode, lines: string[]): void {
    if (mode !== this.mode) { this.mode = mode; this.keys.innerHTML = KEYS[mode]; }
    this.stats.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  }

  shipLines(altitude: number, speed: number, throttle: number, clock: string): string[] {
    return [`Độ cao <b>${Math.round(altitude)} m</b>`, `Tốc độ <b>${Math.round(speed)} m/s</b> · ${THROTTLE[throttle].label}`, `Giờ <b>${clock}</b>`];
  }

  /** Gợi ý giữa màn hình, null = ẩn. */
  prompt(html: string | null): void {
    if (html) this.promptEl.innerHTML = html;
    this.promptEl.classList.toggle('show', !!html);
  }

  /** Dòng trạng thái trên cùng (tự lái…), rỗng = ẩn. */
  status(text: string): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('show', !!text);
  }

  get menuOpen(): boolean { return this.menuItems.length > 0; }

  openMenu(title: string, items: { label: string; run: () => void }[]): void {
    this.menuItems = items;
    this.menuEl.innerHTML = `<h3>${title}</h3>` + items.map((it, i) => `<div class="opt"><kbd>${i + 1}</kbd>${it.label}</div>`).join('')
      + '<div class="esc"><kbd>Esc</kbd>/<kbd>E</kbd> đóng</div>';
    this.menuEl.classList.add('show');
  }

  closeMenu(): void {
    this.menuItems = [];
    this.menuEl.classList.remove('show');
  }

  /** Chọn mục thứ i (0-based). */
  pick(i: number): void {
    const it = this.menuItems[i];
    if (!it) return;
    this.closeMenu();
    it.run();
  }

  /** Màn tối (0..1) + chữ, cho lúc ngủ. */
  night(opacity: number, text = ''): void {
    this.nightEl.style.opacity = String(opacity);
    this.nightEl.textContent = text;
  }

  zzz(on: boolean, t: number): void {
    this.zzzEl.style.opacity = on ? String(0.6 + 0.4 * Math.sin(t * 2)) : '0';
    this.zzzEl.style.transform = `translateY(${Math.sin(t * 1.3) * 8}px)`;
  }

  toggleHelp(): void {
    this.help.style.display = this.help.style.display === 'none' ? '' : 'none';
  }

  hideTitle(): void {
    this.splash.classList.add('hide');
  }
}
